// The customer's own page (no account: the secret link in the text is the key).
//   view    the appointment, the estimate (to sign), the extra work to answer, the invoice (being made, or finished)
//   sign    the customer signs the estimate with the finger (with the authorization of work: nothing to sign at the door)
//   answer  accept or decline an extra work (asked to confirm on the page first)
//   pay     opens Stripe's card page for what is due: ONE open page per job, whatever the text the customer came from
//   check   back from Stripe: asks Stripe whether it is paid
// « sign » and « answer » take the amount the page displayed (`shown_cents`, optional: the total for sign, the line's
// amount for answer): when it is no longer the amount, nothing is written and the answer is HTTP 409
// { ok: false, code: 'amount_changed', error, current_cents }. Without it, as before (yesterday's page keeps working).
import { serve, json, body, fail, Fail, withTimeout } from '../_shared/http.ts';
import { adminDb, secret, settings } from '../_shared/db.ts';
import { sha256hex } from '../_shared/tokens.ts';
import { baseOf } from '../_shared/links.ts';
import { stripeCall, StripeError } from '../_shared/stripe.ts';
import { applyCheckout, stripeOp } from '../_shared/payments.ts';
import { sumLines, lineCents } from '../_shared/money.ts';
import { visitorMark } from '../_shared/visitor.ts';
import { longDay, first, money, jobWindow } from '../_shared/texts.ts';

type Row = Record<string, any>;

async function linkOf(token: unknown): Promise<Row> {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(t)) fail('bad_link', 'Ce lien est incomplet. Demandez-en un nouveau au garage.');
  // the database not answering is a server problem: never « this link is no longer valid » to a customer whose link is good
  const { data, error } = await adminDb().from('public_links').select('*').eq('token_hash', await sha256hex(t)).maybeSingle();
  if (error) throw error;
  const l = data as Row | null;
  if (!l || l.revoked_at) fail('bad_link', 'Ce lien n’est plus valide. Demandez-en un nouveau au garage.', 404);
  if (Date.parse(l.expires_at) < Date.now()) fail('expired', 'Ce lien a expiré. Demandez-en un nouveau au garage.', 410);
  return l;
}
/** the totals of lines, the same way everywhere (a discount counts negative): _shared/money.ts */
const taxesOf = (s: Row, lines: Row[]) => sumLines(lines, s);
/** the amount the page displayed, when it says so (yesterday's page does not: null; anything not a number never matches) */
function shownCents(x: unknown): number | null {
  if (x === undefined || x === null || x === '') return null;
  const n = Math.round(Number(x));
  return Number.isFinite(n) ? n : NaN;
}
async function view(l: Row) {
  const db = adminDb();
  const s = await settings();
  const garage = { name: s.company?.name || 'Mécanique Mobile H.I.S', phone: s.company?.phone || null, email: s.company?.email || null,
    address: s.company?.address || null, tps_no: s.company?.tps_no || null, tvq_no: s.company?.tvq_no || null,
    footer_fr: s.company?.footer_fr || null, footer_en: s.company?.footer_en || null };
  const stripeOn = !!(await secret('stripe_key'));
  if (l.quote_id) {
    const { data: q } = await db.from('quotes').select('*').eq('id', l.quote_id).maybeSingle();
    if (!q) fail('gone', 'Cet estimé n’existe plus.', 404);
    const items = ((q as Row).items || []) as Row[];
    return { ok: true, kind: 'quote', garage, lang: (q as Row).lang || 'fr', number: (q as Row).number, vehicle: (q as Row).vehicle_text || null,
      // the quantity as written (an option at 0 stays 0; nothing written = 1): the lines add up to the total shown
      items: items.map((i) => ({ description: i.description, qty: i.qty === null || i.qty === undefined || i.qty === '' ? 1 : Number(i.qty), unit_cents: Number(i.unit_cents || 0) })),
      totals: taxesOf(s, items), valid_until: (q as Row).valid_until || null };
  }
  const { data: job, error: ej } = await db.from('jobs').select('*').eq('id', l.job_id).maybeSingle();
  if (ej) throw ej;
  const j = job as Row | null;
  if (!j || j.deleted_at) fail('gone', 'Ce dossier n’existe plus.', 404);
  const reads = await Promise.all([
    db.from('customers').select('first_name, lang').eq('id', j.customer_id).maybeSingle(),
    db.from('job_items').select('*').eq('job_id', j.id).is('deleted_at', null).order('sort'),
    db.from('invoices').select('*').eq('job_id', j.id).neq('status', 'void').is('deleted_at', null).maybeSingle(),
    db.from('payments').select('amount_cents, method, paid_at, invoice_id').eq('job_id', j.id).is('deleted_at', null),
    j.vehicle_id ? db.from('vehicles').select('year, make, model').eq('id', j.vehicle_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('trips').select('status').eq('job_id', j.id).eq('status', 'active').is('deleted_at', null).limit(1).maybeSingle()
  ]);
  // a read that failed would show a wrong page (no lines, nothing paid, nothing to pay): a server problem instead
  for (const r of reads) if (r.error) throw r.error;
  const [{ data: cust }, { data: items }, { data: inv }, { data: pays }, { data: veh }, { data: trip }] = reads;
  const its = (items || []) as Row[];
  // a block job: its block's hours; a 'day' job (« Plages d’arrivée »): the window promised, or « flexible » (no hours yet)
  const win = jobWindow(j as never);
  const block = j.block === 'day' ? (win ? { start: win[0], end: win[1] } : {}) : (s.booking?.blocks || []).find((b: Row) => b.key === j.block) || {};
  const v = inv as Row | null;
  const issued = v && v.status !== 'draft';
  // the invoice being made (from the mechanic's arrival): its own lines, rebates and taxes are what is due
  const draft = v && v.status === 'draft' ? v : null;
  const prepaid = ((pays || []) as Row[]).filter((p) => !p.invoice_id).reduce((t, p) => t + p.amount_cents, 0);
  const planned = its.filter((i) => ['planned', 'done', 'approved'].includes(i.status));
  const expected = draft ? { subtotal: draft.subtotal_cents, tps: draft.tps_cents, tvq: draft.tvq_cents, total: draft.total_cents } : taxesOf(s, planned);
  const balance = issued ? Math.max(0, v!.total_cents - v!.paid_cents) : Math.max(0, expected.total - prepaid);
  const open = ['booked', 'en_route', 'on_site'].includes(j.status);
  // to sign: not signed yet, or the work changed since (a new total)
  const signed = !!j.estimate_signed_at;
  const changed = signed && Number(j.estimate_cents) !== expected.total;
  const lang = (cust as Row | null)?.lang === 'en' ? 'en' : 'fr';
  const conditions = String(s.waiver?.[lang] || s.waiver?.fr || '').replaceAll('{garage}', garage.name);
  const prefix = s.billing?.invoice_prefix ?? 'F-', pad = Number(s.billing?.pad ?? 4);
  await db.from('public_links').update({ views: (l.views || 0) + 1, last_seen_at: new Date().toISOString() }).eq('id', l.id);
  return {
    ok: true, kind: 'job', garage, lang: (cust as Row | null)?.lang || 'fr',
    customer: { first: first((cust as Row | null)?.first_name) },
    job: { number: j.number, day: j.day, day_label_fr: longDay(j.day, 'fr'), day_label_en: longDay(j.day, 'en'), block: j.block,
      start: block.start ?? null, end: block.end ?? null, flex: j.block === 'day' && !win, status: j.status, tracking: !!trip,
      vehicle: veh ? [(veh as Row).year, (veh as Row).make, (veh as Row).model].filter(Boolean).join(' ') : null, waiver_signed: !!j.waiver_signed_at },
    estimate: { signed_at: j.estimate_signed_at || null, signer: j.estimate_signer || null, cents: j.estimate_cents ?? null,
      changed, can_sign: open && !issued && planned.length > 0 && (!signed || changed) },
    conditions: conditions || null,
    bill: draft ? { lines: (draft.lines || []) as Row[], subtotal_cents: draft.subtotal_cents, tps_cents: draft.tps_cents, tvq_cents: draft.tvq_cents, total_cents: draft.total_cents } : null,
    items: planned.map((i) => ({ id: i.id, description: i.description, qty: Number(i.qty), unit_cents: i.unit_cents, status: i.status })),
    extras: its.filter((i) => ['proposed', 'approved', 'declined'].includes(i.status)).map((i) => ({ id: i.id, description: i.description, qty: Number(i.qty),
      unit_cents: i.unit_cents, total_cents: lineCents(i), status: i.status, note: i.note, answered_via: i.answered_via })),
    expected,
    prepaid_cents: prepaid,
    invoice: issued ? { number: `${prefix}${String(v!.number).padStart(pad, '0')}`, issued_at: v!.issued_at, due_on: v!.due_on, status: v!.status,
      lines: v!.lines, subtotal_cents: v!.subtotal_cents, tps_cents: v!.tps_cents, tvq_cents: v!.tvq_cents, total_cents: v!.total_cents, paid_cents: v!.paid_cents,
      notes: v!.notes } : null,
    // a job « Payé par le Coffre » (the garage's own people) is never paid by card
    pay: { available: stripeOn && balance >= 50 && !j.coffre_id && (issued ? !['cancelled', 'no_show'].includes(j.status) : open),
      amount_cents: balance, kind: issued ? 'invoice' : 'prepay', pending: !!l.last_session && !!l.last_session_expires && Date.parse(l.last_session_expires) > Date.now() }
  };
}

/* ---------- the card page (Stripe Checkout): one open page per job ---------- */
type PageState = 'paid' | 'open' | 'expired' | 'processing';
interface Page { link: Row; sess: Row }
const sessPath = (id: string) => `/checkout/sessions/${encodeURIComponent(id)}`;
/** the link forgets a card page (only if it still holds that one) */
async function forget(linkId: string, session: string) {
  await adminDb().from('public_links').update({ last_session: null, last_session_url: null, last_session_amount: null, last_session_expires: null })
    .eq('id', linkId).eq('last_session', session);
}
async function remember(linkId: string, sess: Row, amount: number, expires: string) {
  const { error } = await adminDb().from('public_links').update({ last_session: sess.id, last_session_url: sess.url, last_session_amount: amount, last_session_expires: expires }).eq('id', linkId);
  if (error) throw error;
}
/** when a card page stops being payable (Stripe's own clock, else what the link kept) */
const pageEnd = (x: Page): number => (Number(x.sess.expires_at) > 0 ? Number(x.sess.expires_at) * 1000 : Date.parse(x.link.last_session_expires || '') || 0);
/** Every card page the job's links remember, as Stripe sees it NOW (each text has its own link, so a job can hold
    several). A paid one is recorded (once, even if Stripe's notice never came) and forgotten; a closed one is forgotten;
    the open ones are returned. `states`: what each page was. Stripe not answering is thrown. */
async function cardPages(key: string, jobId: string): Promise<{ open: Page[]; paid: number; states: Map<string, PageState> }> {
  const { data, error } = await adminDb().from('public_links').select('id, last_session, last_session_amount, last_session_expires').eq('job_id', jobId).not('last_session', 'is', null);
  if (error) throw error;
  const open: Page[] = [], states = new Map<string, PageState>(), read = new Map<string, Row | null>();
  let paid = 0;
  for (const link of (data || []) as Row[]) {
    const id = String(link.last_session);
    if (!read.has(id)) {
      try { read.set(id, await stripeCall(key, 'GET', sessPath(id))); }
      catch (e) { if (e instanceof StripeError && e.status === 404) read.set(id, null); else throw e; }   // 404: a page of another Stripe key
    }
    const sess = read.get(id);
    if (sess?.payment_status === 'paid') {
      if (!states.has(id)) { await applyCheckout(sess); paid++; }
      states.set(id, 'paid');
      await forget(link.id, id);
    } else if (sess?.status === 'open') {
      states.set(id, 'open');
      open.push({ link, sess });
    } else if (sess?.status === 'complete') {
      states.set(id, 'processing');          // a slow means of payment: Stripe's notice will say when it is paid
    } else {
      states.set(id, 'expired');
      await forget(link.id, id);
    }
  }
  return { open, paid, states };
}
/** closes a card page at Stripe so it can no longer be paid; true when it was paid at that very moment (then it is
    recorded). A page that can be neither closed nor read is thrown: no second page while the first may still take money. */
async function closePage(key: string, x: Page): Promise<boolean> {
  const id = String(x.sess.id);
  let paid = false;
  try { await stripeCall(key, 'POST', `${sessPath(id)}/expire`); }
  catch (e) {
    const now = await stripeCall(key, 'GET', sessPath(id));
    if (now?.payment_status === 'paid') { await applyCheckout(now); paid = true; }
    else if (now?.status === 'open') throw e;
  }
  await forget(x.link.id, id);
  return paid;
}
/* One card page made at a time per job: an atomic claim (a row of op_log, the same id for the same job, so the database's
   own unique key decides ONE winner however the taps interleave). The winner makes the page and frees the claim once the
   page is remembered (or on failure); the others wait for that page. A claim left by a function that died is old after
   CLAIM_STALE_MS and taken over. */
const CLAIM_STALE_MS = 20000;
/** the database does not have op_begin yet (the new migrations not applied at the moment the functions are deployed):
    no claim, the page is made as yesterday (one page per link, Stripe's key merges the double taps of a link) */
const NO_CLAIM = 'none';
const noFunction = (e: { code?: string } | null) => e?.code === 'PGRST202' || e?.code === '42883';
async function claimPage(jobId: string): Promise<string | null> {
  const db = adminDb();
  const op = await stripeOp(`pay-claim:${jobId}`);
  for (let i = 0; i < 2; i++) {
    const { data, error } = await db.rpc('op_begin', { p_op: op, p_name: 'client_pay' });
    if (error && noFunction(error)) { console.error('client pay: op_begin missing, no claim'); return NO_CLAIM; }
    if (error) throw error;
    if (data === null) return op;                                  // claimed: this request makes the page
    // somebody holds it: taken over only when it is old (its maker died before freeing it)
    const { data: gone, error: e2 } = await db.from('op_log').delete().eq('op', op).is('result', null)
      .lt('at', new Date(Date.now() - CLAIM_STALE_MS).toISOString()).select('op');
    if (e2) throw e2;
    if (!gone?.length) return null;
  }
  return null;
}
async function freeClaim(op: string | null) {
  if (!op || op === NO_CLAIM) return;
  const { error } = await adminDb().from('op_log').delete().eq('op', op).is('result', null);
  if (error) console.error('client pay: claim not freed', String(error.message).slice(0, 200));   // old after CLAIM_STALE_MS anyway
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** somebody else is making the page right now: wait for it, until `deadline` at most (the page waits 15 s in all) */
async function pageOfOther(key: string, jobId: string, good: (x: Page) => boolean, deadline: number): Promise<Page | null> {
  const seen = new Map<string, Row | null>();
  while (Date.now() + 350 < deadline) {
    await sleep(350);
    const { data } = await adminDb().from('public_links').select('id, last_session, last_session_amount, last_session_expires').eq('job_id', jobId).not('last_session', 'is', null);
    for (const link of (data || []) as Row[]) {
      const id = String(link.last_session);
      if (!seen.has(id)) {
        const left = deadline - Date.now();
        if (left < 300) return null;
        seen.set(id, await withTimeout(stripeCall(key, 'GET', sessPath(id)), left, 'service de paiement').catch(() => null));
      }
      const sess = seen.get(id);
      if (sess?.status === 'open' && sess.url && good({ link, sess })) return { link, sess };
    }
  }
  return null;
}
const PAY_DOWN = 'Le paiement par carte ne répond pas pour l’instant. Réessayez dans un instant, payez sur place ou appelez le garage.';
/** Stripe refusing or not answering is said in words the customer can act on (never « the server had a problem ») */
function stripeDown(e: unknown): never {
  if (e instanceof StripeError || (e instanceof Fail && e.code === 'timeout')) {
    console.error('client pay: Stripe', e instanceof StripeError ? e.status : 'timeout', String((e as Error).message).slice(0, 200));
    fail('pay_unavailable', PAY_DOWN, 502);
  }
  throw e;
}
/** the time slice of a card page: the same link asking again within it (a double tap, a lost answer) is the same request
    for Stripe (same key, same parameters: the same page back) */
const SLICE_S = 600;

async function pay(l: Row, b: Row): Promise<Response> {
  const key = await secret('stripe_key');
  if (!key) fail('no_stripe', 'Le paiement par carte n’est pas offert pour l’instant. Payez sur place ou appelez le garage.');
  let v = await view(l) as Row;
  if (v.kind !== 'job' || !v.pay.available) fail('nothing', v.pay?.amount_cents ? 'Le paiement par carte n’est pas offert pour ce dossier.' : 'Rien à payer : merci !');
  const db = adminDb();
  const waitUntil = Date.now() + 7000;          // the longest a request waits for another one's page
  let claim: string | null = null;
  try {
    let amount = 0, invoiceId = '';
    for (let round = 0; ; round++) {
      // a page already paid (Stripe's notice late or lost) is counted first: what is due is what is left after it
      const pages = await cardPages(key, l.job_id);
      if (pages.paid || round) {
        v = await view(l) as Row;
        if (!v.pay.available) return json({ ok: true, paid: true });
      }
      amount = v.pay.amount_cents as number;
      const { data: inv, error } = await db.from('invoices').select('id').eq('job_id', l.job_id).neq('status', 'void').neq('status', 'draft').is('deleted_at', null).maybeSingle();
      if (error) throw error;
      invoiceId = String((inv as Row | null)?.id || '');
      // the one page kept: open for the amount due, for the invoice of now, with time left (this link's own first);
      // every other open page — an older text's link, an amount that has since changed — is closed at Stripe
      const good = (x: Page) => Number(x.sess.amount_total) === amount && String(x.sess.metadata?.invoice_id || '') === invoiceId && !!x.sess.url && pageEnd(x) > Date.now() + 60000;
      const keep = pages.open.filter(good).sort((x, y) => (x.link.id === l.id ? -1 : y.link.id === l.id ? 1 : 0))[0] || null;
      let paidNow = false;
      for (const x of pages.open) if (x.sess.id !== keep?.sess.id) paidNow = (await closePage(key, x)) || paidNow;
      if (paidNow && round < 2) continue;                 // paid while it was being closed: count again
      if (keep) {
        if (keep.link.id !== l.id) await remember(l.id, keep.sess, amount, new Date(pageEnd(keep)).toISOString());
        return json({ ok: true, url: keep.sess.url });
      }
      if (claim) break;                                   // claimed, and looked again with the claim held: no page yet → make it
      claim = await claimPage(l.job_id);
      if (claim) continue;                                // a page remembered just before the claim is found by that look
      // two texts tapped at the same moment: the second waits for the first one's page instead of making its own
      const other = await pageOfOther(key, l.job_id, good, waitUntil);
      if (other) {
        if (other.link.id !== l.id) await remember(l.id, other.sess, amount, new Date(pageEnd(other)).toISOString());
        return json({ ok: true, url: other.sess.url });
      }
      // the other one's page never came (it failed, or it is for another amount): never a second page without the claim
      if (Date.now() >= waitUntil - 400 || round >= 6) fail('pay_unavailable', PAY_DOWN, 502);
    }
    // the language the page is shown in (the customer may have switched it); yesterday's page does not say: the file's
    const lang = b.lang === 'en' || b.lang === 'fr' ? b.lang : v.lang === 'en' ? 'en' : 'fr';
    const base = baseOf(b.base);
    const back = `${base}client.html#t=${String(b.token)}${lang === 'en' ? '&l=en' : ''}`;
    const label = v.invoice ? (lang === 'en' ? `Invoice ${v.invoice.number}` : `Facture ${v.invoice.number}`)
      : v.job.status === 'on_site' ? (lang === 'en' ? `Work of ${v.job.day_label_en}` : `Travaux du ${v.job.day_label_fr}`)
      : (lang === 'en' ? `Appointment of ${v.job.day_label_en}` : `Rendez-vous du ${v.job.day_label_fr}`);
    // the key of « the same request sent twice »: the link, the amount, the invoice and the time slice, with parameters
    // that follow from them only (the end of the page = end of the slice + 1 h), so the same link tapped twice gets the
    // same page back from Stripe, never a second one nobody remembers
    const slice = Math.floor(Date.now() / 1000 / SLICE_S);
    const make = (expires: number, idem: string) => stripeCall(key, 'POST', '/checkout/sessions', [
      ['mode', 'payment'], ['locale', lang === 'en' ? 'en' : 'fr-CA'], ['expires_at', expires],
      ['line_items[0][quantity]', 1], ['line_items[0][price_data][currency]', 'cad'], ['line_items[0][price_data][unit_amount]', amount],
      ['line_items[0][price_data][product_data][name]', `${label} — ${v.garage.name}`],
      ['success_url', `${back}&retour=paye`], ['cancel_url', back],
      ['metadata[job_id]', l.job_id], ['metadata[invoice_id]', invoiceId], ['metadata[kind]', v.pay.kind], ['metadata[link]', l.id],
      ['payment_intent_data[metadata][job_id]', l.job_id], ['payment_intent_data[description]', `${label} — ${v.garage.name}`]
    ], idem);
    let expires = (slice + 1) * SLICE_S + 3600;
    // (the language is in the key: the same link asking in the other language is another request, never a refusal)
    const idem = `pay-${l.id}-${amount}-${invoiceId.slice(0, 8)}-${slice}${lang === 'en' ? '-en' : ''}`;
    // Stripe answers a key it already saw with the answer it gave THEN (a page « open » at the time), or refuses it when
    // the words changed since (the appointment is now under way: another label): the page is asked as it is NOW
    let sess: Row | null = null;
    try { sess = await make(expires, idem); }
    catch (e) { if (!(e instanceof StripeError && e.kind === 'idempotency_error')) throw e; }
    if (sess?.id) {
      try { sess = { ...sess, ...(await stripeCall(key, 'GET', sessPath(String(sess.id)))) }; }
      catch { /* Stripe's answer to the making is kept */ }
    }
    // a page completed but not paid yet (a slow means of payment on its way) stays the one page, as before: never a
    // second page to pay while the first payment may still pass
    const processing = sess?.status === 'complete' && sess?.payment_status !== 'paid';
    if (sess?.status !== 'open' && !processing) {
      // that same request was answered earlier in the slice by a page since closed (or paid): a new page, its own key
      if (sess?.payment_status === 'paid') await applyCheckout(sess);
      expires = Math.floor(Date.now() / 1000) + 3600;
      sess = await make(expires, `${idem}-${crypto.randomUUID().slice(0, 8)}`);
    }
    const made = sess as Row;
    await remember(l.id, made, amount, new Date((Number(made.expires_at) > 0 ? Number(made.expires_at) : expires) * 1000).toISOString());
    return json({ ok: true, url: made.url });
  } catch (e) { stripeDown(e); }
  finally { await freeClaim(claim).catch(() => undefined); }
}

async function answer(req: Request): Promise<Response> {
  const b = await body<Row>(req);
  const action = String(b.action || 'view');
  let l = await linkOf(b.token);
  const db = adminDb();
  if (action === 'view') return json(await view(l));

  if (action === 'answer') {
    if (!l.job_id) fail('bad_link', 'Rien à répondre ici.');
    if (b.confirm !== true) fail('confirm', 'Confirmez votre réponse.');
    // a read that fails is a server problem, never « this proposal no longer exists » nor « this appointment is over »
    const itemId = String(b.item_id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) fail('gone', 'Cette proposition n’existe plus.', 404);
    const { data: it, error: ei } = await db.from('job_items').select('*').eq('id', itemId).eq('job_id', l.job_id).is('deleted_at', null).maybeSingle();
    if (ei) throw ei;
    const i = it as Row | null;
    if (!i) fail('gone', 'Cette proposition n’existe plus.', 404);
    if (i.status === 'proposed') {
      // extra work is answered while the appointment is coming or under way and its invoice not finished: afterwards
      // an « accepted » would never be done nor billed
      const [{ data: jb, error: e1 }, { data: inv, error: e2 }] = await Promise.all([
        db.from('jobs').select('status, deleted_at').eq('id', l.job_id).maybeSingle(),
        db.from('invoices').select('id').eq('job_id', l.job_id).in('status', ['issued', 'paid']).is('deleted_at', null).limit(1)
      ]);
      if (e1 || e2) throw e1 || e2;
      const j = jb as Row | null;
      if (!j || j.deleted_at || !['booked', 'en_route', 'on_site'].includes(j.status) || inv?.length) {
        fail('closed', 'Ce rendez-vous est terminé : cette proposition ne peut plus être acceptée ici. Appelez le garage.', 409);
      }
      // the price the customer saw (the page sends it): another price since = nothing written, the page shows the new one
      const shown = shownCents(b.shown_cents), now = lineCents(i);
      const moved = (cents: number) => fail('amount_changed', 'Le prix de ce travail a changé. Regardez le nouveau montant avant de répondre.', 409, { current_cents: cents, item_id: i.id });
      if (shown !== null && shown !== now) moved(now);
      // written only while it is still the line that was read (a price changed in between is never approved)
      let w = db.from('job_items').update({ status: b.accept ? 'approved' : 'declined', answered_at: new Date().toISOString(), answered_via: 'link' }).eq('id', i.id).eq('status', 'proposed');
      if (shown !== null) w = w.eq('unit_cents', i.unit_cents).eq('qty', i.qty);
      const { data: done, error: ew } = await w.select('id');
      if (ew) throw ew;
      if (!done?.length) {
        if (shown !== null) {
          const { data: again, error: e3 } = await db.from('job_items').select('qty, unit_cents, kind, status').eq('id', i.id).maybeSingle();
          if (e3) throw e3;
          if ((again as Row | null)?.status === 'proposed') moved(lineCents(again as Row));
        }
        return json(await view(l));
      }
      // the mechanic's app shows the answer at once (realtime); it is also kept in the job's history
      await db.from('messages').insert({ job_id: l.job_id, kind: 'extras_answer', channel: 'web', body: `${b.accept ? 'Accepté' : 'Refusé'} : ${i.description}`, status: 'skipped', error: 'answer' });
    }
    return json(await view(l));
  }

  if (action === 'sign') {
    if (!l.job_id) fail('bad_link', 'Rien à signer ici.');
    if (b.confirm !== true) fail('confirm', 'Cochez « J’accepte » pour signer.');
    const v = await view(l) as Row;
    if (!v.estimate?.can_sign) fail('signed', v.estimate?.signed_at ? 'Cette estimation est déjà signée.' : 'Il n’y a plus rien à signer ici.');
    // the total the customer saw (the page sends it): another total since = nothing is signed, the page shows the new one
    const shown = shownCents(b.shown_cents);
    if (shown !== null && shown !== v.expected.total) {
      fail('amount_changed', 'Le montant de l’estimation a changé. Regardez le nouveau total avant de signer.', 409, { current_cents: v.expected.total });
    }
    const s = await settings();
    // one tap (« J’accepte et je signe »): an electronic signature in the name on the customer's file; or the name typed
    // and a signature drawn with the finger (the older page)
    // the name on the file signs: a read that fails never signs « Client » instead of the customer's name
    const { data: jc, error: ejc } = await db.from('jobs').select('waiver_signed_at, customer:customer_id(first_name, last_name, company)').eq('id', l.job_id).single();
    if (ejc) throw ejc;
    const cuj = ((jc as Row | null)?.customer || {}) as Row;
    const onFile = [cuj.first_name, cuj.last_name].filter(Boolean).join(' ').trim() || String(cuj.company || '').trim();
    const click = b.click === true;
    const signer = (click ? onFile || String(b.signer || '') : String(b.signer || '')).replace(/\s+/g, ' ').trim().slice(0, 80) || (click ? 'Client' : '');
    if (signer.length < 2) fail('signer', 'Écrivez votre nom.');
    let attId: string | null = null;
    if (!click) {
      const png = String(b.png || '');
      const data = png.startsWith('data:image/png;base64,') ? png.slice(22) : png;
      // a real picture of a signature (a PNG of a reasonable size), never anything else
      if (!/^iVBORw0KGgo[A-Za-z0-9+/]+=*$/.test(data) || data.length < 300 || data.length > 400000) fail('signature', 'La signature n’est pas arrivée. Signez encore.');
      const num = (x: unknown) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n > 0 && n < 5000 ? n : null; };
      const { data: att, error } = await db.from('attachments').insert({ kind: 'signature', mime: 'image/png', data, bytes: Math.round(data.length * 0.75),
        width: num(b.width), height: num(b.height), job_id: l.job_id, created_by: null }).select('id').single();
      if (error) throw error;
      attId = (att as Row).id as string;
    }
    const now = new Date().toISOString();
    const patch: Row = { estimate_signed_at: now, estimate_signer: signer, estimate_attachment: attId, estimate_cents: v.expected.total };
    // the estimate's page carries the authorization of work: signed here, nothing is left to sign at the door
    if (!(jc as Row | null)?.waiver_signed_at) Object.assign(patch, { waiver_signed_at: now, waiver_signer: signer, waiver_version: String(s.waiver?.version || '1'), waiver_attachment: attId, waiver_via: 'online' });
    // the proof of an electronic signature: when, which link, from which device (the address is kept as a fingerprint
    // only, made with a secret of the server), the amount seen and the lines it was for
    // (the proof is written first: never an electronic signature without its proof)
    if (click) {
      const { error: ep } = await db.from('activity').insert({ entity: 'job', entity_id: l.job_id, action: 'signed_online', data: {
        signer, at: now, version: String(s.waiver?.version || '1'), cents: v.expected.total, shown_cents: shown, link: l.id,
        lines: ((v.items || []) as Row[]).map((i) => ({ id: i.id, description: i.description, qty: i.qty, unit_cents: i.unit_cents })),
        device: (req.headers.get('user-agent') || '').slice(0, 160), ip: await visitorMark(req, 'sig') } });
      if (ep) throw ep;
    }
    const { error: e2 } = await db.from('jobs').update(patch).eq('id', l.job_id);
    if (e2) throw e2;
    await db.from('messages').insert({ job_id: l.job_id, kind: 'estimate_signed', channel: 'web', status: 'skipped', error: 'answer',
      body: `${signer} : ${money(v.expected.total, v.lang === 'en' ? 'en' : 'fr')}` });
    return json(await view(l));
  }

  if (action === 'pay') return await pay(l, b);

  if (action === 'check') {
    // « session »: what became of the card page this link opened (paid / open / expired / processing; none = no page;
    // unknown = Stripe did not answer). The other pages of the job are looked at too: a paid one is never left out.
    const key = await secret('stripe_key');
    let session: string = 'none';
    if (key && l.job_id) {
      const mine = l.last_session ? String(l.last_session) : '';
      try {
        const pages = await cardPages(key, l.job_id);
        if (mine) session = pages.states.get(mine) || 'expired';
        l = await linkOf(b.token);
      } catch (e) {
        if (!(e instanceof StripeError) && !(e instanceof Fail && e.code === 'timeout')) throw e;
        session = 'unknown';
      }
    }
    // `checked`: the same, in the words the page reads (paid / open / expired; null = no page or still on its way;
    // absent = Stripe did not answer)
    const checked = session === 'paid' || session === 'open' || session === 'expired' ? session : session === 'unknown' ? undefined : null;
    return json({ ...(await view(l)), session, checked });
  }
  fail('action', 'Action inconnue.');
}

/* a refusal (link expired, gone…) still says who to call: the garage's name and phone come with it */
export const handler = serve(async (req) => {
  try { return await answer(req); }
  catch (e) {
    if (!(e instanceof Fail)) throw e;
    let garage: { name: string; phone: string | null } | null = null;
    try { const s = await settings(); garage = { name: s.company?.name || 'Mécanique Mobile H.I.S', phone: s.company?.phone || null }; } catch { /* without it */ }
    return json({ ...(e.data || {}), ok: false, code: e.code, error: e.message, garage }, e.status);
  }
});
