// The customer's own page (no account: the secret link in the text is the key).
//   view    the appointment, the estimate (to sign), the extra work to answer, the invoice (being made, or finished)
//   sign    the customer signs the estimate with the finger (with the authorization of work: nothing to sign at the door)
//   answer  accept or decline an extra work (asked to confirm on the page first)
//   pay     opens Stripe's card page for what is due (the same page is reused while it is open)
//   check   back from Stripe: asks Stripe whether it is paid
import { serve, json, body, fail, Fail } from '../_shared/http.ts';
import { adminDb, secret, settings } from '../_shared/db.ts';
import { sha256hex } from '../_shared/tokens.ts';
import { baseOf } from '../_shared/links.ts';
import { stripeCall } from '../_shared/stripe.ts';
import { applyCheckout } from '../_shared/payments.ts';
import { longDay, first, money } from '../_shared/texts.ts';
import { sumLines } from '../_shared/money.ts';

type Row = Record<string, any>;

async function linkOf(token: unknown): Promise<Row> {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(t)) fail('bad_link', 'Ce lien est incomplet. Demandez-en un nouveau au garage.');
  const { data } = await adminDb().from('public_links').select('*').eq('token_hash', await sha256hex(t)).maybeSingle();
  const l = data as Row | null;
  if (!l || l.revoked_at) fail('bad_link', 'Ce lien n’est plus valide. Demandez-en un nouveau au garage.', 404);
  if (Date.parse(l.expires_at) < Date.now()) fail('expired', 'Ce lien a expiré. Demandez-en un nouveau au garage.', 410);
  return l;
}
/** the totals of lines, the same way everywhere (discounts count negative): _shared/money.ts */
const taxesOf = (s: Row, lines: Row[]) => sumLines(lines, s);
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
      items: items.map((i) => ({ description: i.description, qty: Number(i.qty || 1), unit_cents: Number(i.unit_cents || 0) })),
      totals: taxesOf(s, items), valid_until: (q as Row).valid_until || null };
  }
  const { data: job } = await db.from('jobs').select('*').eq('id', l.job_id).maybeSingle();
  const j = job as Row | null;
  if (!j || j.deleted_at) fail('gone', 'Ce dossier n’existe plus.', 404);
  const [{ data: cust }, { data: items }, { data: inv }, { data: pays }, { data: veh }, { data: trip }] = await Promise.all([
    db.from('customers').select('first_name, lang').eq('id', j.customer_id).maybeSingle(),
    db.from('job_items').select('*').eq('job_id', j.id).is('deleted_at', null).order('sort'),
    db.from('invoices').select('*').eq('job_id', j.id).neq('status', 'void').is('deleted_at', null).maybeSingle(),
    db.from('payments').select('amount_cents, method, paid_at, invoice_id').eq('job_id', j.id).is('deleted_at', null),
    j.vehicle_id ? db.from('vehicles').select('year, make, model').eq('id', j.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('trips').select('status').eq('job_id', j.id).eq('status', 'active').maybeSingle()
  ]);
  const its = (items || []) as Row[];
  const block = (s.booking?.blocks || []).find((b: Row) => b.key === j.block) || {};
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
      start: block.start ?? null, end: block.end ?? null, status: j.status, tracking: !!trip,
      vehicle: veh ? [(veh as Row).year, (veh as Row).make, (veh as Row).model].filter(Boolean).join(' ') : null, waiver_signed: !!j.waiver_signed_at },
    estimate: { signed_at: j.estimate_signed_at || null, signer: j.estimate_signer || null, cents: j.estimate_cents ?? null,
      changed, can_sign: open && !issued && planned.length > 0 && expected.total > 0 && (!signed || changed) },
    conditions: conditions || null,
    bill: draft ? { lines: (draft.lines || []) as Row[], subtotal_cents: draft.subtotal_cents, tps_cents: draft.tps_cents, tvq_cents: draft.tvq_cents, total_cents: draft.total_cents } : null,
    items: planned.map((i) => ({ id: i.id, description: i.description, qty: Number(i.qty), unit_cents: i.unit_cents, status: i.status })),
    extras: its.filter((i) => ['proposed', 'approved', 'declined'].includes(i.status)).map((i) => ({ id: i.id, description: i.description, qty: Number(i.qty),
      unit_cents: i.unit_cents, total_cents: Math.round(Number(i.qty) * i.unit_cents), status: i.status, note: i.note, answered_via: i.answered_via })),
    expected,
    prepaid_cents: prepaid,
    invoice: issued ? { number: `${prefix}${String(v!.number).padStart(pad, '0')}`, issued_at: v!.issued_at, due_on: v!.due_on, status: v!.status,
      lines: v!.lines, subtotal_cents: v!.subtotal_cents, tps_cents: v!.tps_cents, tvq_cents: v!.tvq_cents, total_cents: v!.total_cents, paid_cents: v!.paid_cents,
      notes: v!.notes } : null,
    pay: { available: stripeOn && balance >= 50 && (issued ? !['cancelled', 'no_show'].includes(j.status) : open),
      amount_cents: balance, kind: issued ? 'invoice' : 'prepay', pending: !!l.last_session && !!l.last_session_expires && Date.parse(l.last_session_expires) > Date.now() }
  };
}

async function answer(req: Request): Promise<Response> {
  const b = await body(req);
  const action = String(b.action || 'view');
  const l = await linkOf(b.token);
  const db = adminDb();
  if (action === 'view') return json(await view(l));

  if (action === 'answer') {
    if (!l.job_id) fail('bad_link', 'Rien à répondre ici.');
    if (b.confirm !== true) fail('confirm', 'Confirmez votre réponse.');
    const { data: it } = await db.from('job_items').select('*').eq('id', String(b.item_id || '')).eq('job_id', l.job_id).is('deleted_at', null).maybeSingle();
    const i = it as Row | null;
    if (!i) fail('gone', 'Cette proposition n’existe plus.', 404);
    if (i.status === 'proposed') {
      await db.from('job_items').update({ status: b.accept ? 'approved' : 'declined', answered_at: new Date().toISOString(), answered_via: 'link' }).eq('id', i.id).eq('status', 'proposed');
      // the mechanic's app shows the answer at once (realtime); it is also kept in the job's history
      await db.from('messages').insert({ job_id: l.job_id, kind: 'extras_answer', channel: 'web', body: `${b.accept ? 'Accepté' : 'Refusé'} : ${i.description}`, status: 'skipped', error: 'answer' });
    }
    return json(await view(l));
  }

  if (action === 'sign') {
    if (!l.job_id) fail('bad_link', 'Rien à signer ici.');
    if (b.confirm !== true) fail('confirm', 'Cochez « J’accepte » pour signer.');
    const signer = String(b.signer || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (signer.length < 2) fail('signer', 'Écrivez votre nom.');
    const png = String(b.png || '');
    const data = png.startsWith('data:image/png;base64,') ? png.slice(22) : png;
    // a real picture of a signature (a PNG of a reasonable size), never anything else
    if (!/^iVBORw0KGgo[A-Za-z0-9+/]+=*$/.test(data) || data.length < 300 || data.length > 400000) fail('signature', 'La signature n’est pas arrivée. Signez encore.');
    const v = await view(l) as Row;
    if (!v.estimate?.can_sign) fail('signed', v.estimate?.signed_at ? 'Cette estimation est déjà signée.' : 'Il n’y a plus rien à signer ici.');
    const s = await settings();
    const num = (x: unknown) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n > 0 && n < 5000 ? n : null; };
    const { data: att, error } = await db.from('attachments').insert({ kind: 'signature', mime: 'image/png', data, bytes: Math.round(data.length * 0.75),
      width: num(b.width), height: num(b.height), job_id: l.job_id, created_by: null }).select('id').single();
    if (error) throw error;
    const now = new Date().toISOString();
    const { data: jr } = await db.from('jobs').select('waiver_signed_at').eq('id', l.job_id).single();
    const patch: Row = { estimate_signed_at: now, estimate_signer: signer, estimate_attachment: (att as Row).id, estimate_cents: v.expected.total };
    // the estimate's page carries the authorization of work: signed here, nothing is left to sign at the door
    if (!(jr as Row | null)?.waiver_signed_at) Object.assign(patch, { waiver_signed_at: now, waiver_signer: signer, waiver_version: String(s.waiver?.version || '1'), waiver_attachment: (att as Row).id, waiver_via: 'online' });
    const { error: e2 } = await db.from('jobs').update(patch).eq('id', l.job_id);
    if (e2) throw e2;
    await db.from('messages').insert({ job_id: l.job_id, kind: 'estimate_signed', channel: 'web', status: 'skipped', error: 'answer',
      body: `${signer} : ${money(v.expected.total, v.lang === 'en' ? 'en' : 'fr')}` });
    return json(await view(l));
  }

  if (action === 'pay') {
    const key = await secret('stripe_key');
    if (!key) fail('no_stripe', 'Le paiement par carte n’est pas offert pour l’instant. Payez sur place ou appelez le garage.');
    const v = await view(l) as Row;
    if (v.kind !== 'job' || !v.pay.available) fail('nothing', v.pay?.amount_cents ? 'Le paiement par carte n’est pas offert pour ce dossier.' : 'Rien à payer : merci !');
    const amount = v.pay.amount_cents as number;
    // one open card page per job (never two payments for the same thing): the same page is reused while it is open
    // for the amount due; any other page still open — an older text's link, or this one for an amount that has since
    // changed — is closed in Stripe first
    const { data: links } = await db.from('public_links').select('id, last_session, last_session_amount, last_session_expires').eq('job_id', l.job_id).not('last_session', 'is', null);
    const open = ((links || []) as Row[]).filter((o) => o.last_session_expires && Date.parse(o.last_session_expires) > Date.now() + 60000)
      .sort((a, b) => (a.id === l.id ? -1 : b.id === l.id ? 1 : 0));
    for (const o of open) {
      const sess = await stripeCall(key, 'GET', `/checkout/sessions/${encodeURIComponent(o.last_session)}`).catch(() => null);
      if (!sess) continue;
      if (sess.payment_status === 'paid') { await applyCheckout(sess); return json({ ok: true, paid: true }); }
      if (sess.status === 'open' && sess.url && o.last_session_amount === amount) {
        if (o.id !== l.id) await db.from('public_links').update({ last_session: sess.id, last_session_url: sess.url, last_session_amount: amount, last_session_expires: o.last_session_expires }).eq('id', l.id);
        return json({ ok: true, url: sess.url });
      }
      if (sess.status === 'open') {
        await stripeCall(key, 'POST', `/checkout/sessions/${encodeURIComponent(o.last_session)}/expire`).catch(() => null);
        await db.from('public_links').update({ last_session: null, last_session_url: null, last_session_amount: null, last_session_expires: null }).eq('id', o.id);
      }
    }
    const lang = v.lang === 'en' ? 'en' : 'fr';
    const base = baseOf(b.base);
    const back = `${base}client.html#t=${String(b.token)}${lang === 'en' ? '&l=en' : ''}`;
    const { data: inv } = await db.from('invoices').select('id').eq('job_id', l.job_id).neq('status', 'void').neq('status', 'draft').is('deleted_at', null).maybeSingle();
    const label = v.invoice ? (lang === 'en' ? `Invoice ${v.invoice.number}` : `Facture ${v.invoice.number}`)
      : v.job.status === 'on_site' ? (lang === 'en' ? `Work of ${v.job.day_label_en}` : `Travaux du ${v.job.day_label_fr}`)
      : (lang === 'en' ? `Appointment of ${v.job.day_label_en}` : `Rendez-vous du ${v.job.day_label_fr}`);
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const sess = await stripeCall(key, 'POST', '/checkout/sessions', [
      ['mode', 'payment'], ['locale', lang === 'en' ? 'en' : 'fr-CA'], ['expires_at', expires],
      ['line_items[0][quantity]', 1], ['line_items[0][price_data][currency]', 'cad'], ['line_items[0][price_data][unit_amount]', amount],
      ['line_items[0][price_data][product_data][name]', `${label} — ${v.garage.name}`],
      ['success_url', `${back}&retour=paye`], ['cancel_url', back],
      ['metadata[job_id]', l.job_id], ['metadata[invoice_id]', (inv as Row | null)?.id || ''], ['metadata[kind]', v.pay.kind], ['metadata[link]', l.id],
      ['payment_intent_data[metadata][job_id]', l.job_id], ['payment_intent_data[description]', `${label} — ${v.garage.name}`]
    ], `pay-${l.id}-${amount}-${Math.floor(Date.now() / 600000)}`);
    await db.from('public_links').update({ last_session: sess.id, last_session_url: sess.url, last_session_amount: amount, last_session_expires: new Date(expires * 1000).toISOString() }).eq('id', l.id);
    return json({ ok: true, url: sess.url });
  }

  if (action === 'check') {
    const key = await secret('stripe_key');
    if (key && l.last_session) {
      const sess = await stripeCall(key, 'GET', `/checkout/sessions/${encodeURIComponent(l.last_session)}`);
      if (sess.payment_status === 'paid') await applyCheckout(sess);
    }
    return json(await view(l));
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
    return json({ ok: false, code: e.code, error: e.message, garage }, e.status);
  }
});
