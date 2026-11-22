// Texts to customers: appointment confirmed / moved (the block, the estimate to sign, « pay now » when card payment is on),
// the mechanic arrived (the invoice to pay during the work), invoice (with « Payer »), extra work to approve, payment
// reminder, the day-before reminder, the window of a flexible booking just fixed (« window »). Each text carries a secret link to the customer's own page.
// When automatic texts are not set up, the app gets the text and the link back, to send them itself.
// `op` (optional, the app's own id of this send): the same send arriving twice — the answer was lost on a weak signal
// and the person tapped again — texts the customer once and answers the first result again.
// Part 28 (« Envoyer les heures aux clients »): what a customer was told (jobs.told_*) is written by the server only, under
// one lease per appointment (tell_take / tell_done / tell_release, migration 20261122000100_reorganiser.sql):
//   - the three « told » texts (booking, window, moved) take the lease before the text is made; a customer whose told
//     hours still hold, or whose lease another send holds right now, gets no text (« already »); sent → told = the hours
//     THAT text said; an answer that came too late (« peut-être parti ») → told too (never a second text by itself);
//   - `{ action: 'day', day, base, op, only, again? }` = the day's button: every customer of `only` still owed his hours
//     gets the text of his state (booking / window / moved) with the hours he must be told now, three at a time, while
//     the answer still has time (`left` = the ones for the next call).
import { serve, json, body, fail } from '../_shared/http.ts';
import { adminDb, caller, settings, secret, type Caller } from '../_shared/db.ts';
import { newToken, sha256hex } from '../_shared/tokens.ts';
import { baseOf, clientLink } from '../_shared/links.ts';
import { sendSms, e164 } from '../_shared/ghl.ts';
import { money, longDay, localDay, fill, first, payNowWords, servicesList, subtotalWords, whenText, jobWindow, WINDOW_TEXT, type Lang } from '../_shared/texts.ts';
import { sumLines, lineCents } from '../_shared/money.ts';

type Row = Record<string, any>;
const KINDS = ['booking', 'moved', 'arrived', 'invoice', 'extras', 'payment_reminder', 'reminder', 'window'];
/** the texts that tell a customer his day and hours: sent under the lease, they write what he was told (Part 28) */
const TOLD_KINDS = ['booking', 'window', 'moved'];
const LINK_DAYS = 90;

/** a text without its links (each text carries a new one) */
const bare = (x: unknown) => String(x || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_KINDS = ['invoice', 'payment_reminder', 'arrived'];
/** the texts of a FINISHED invoice: the only ones someone who keeps the books may send for a job they cannot see */
const BILL_KINDS = ['invoice', 'payment_reminder'];
/** the total of lines, the same way everywhere (a discount counts negative): _shared/money.ts */
const taxed = (lines: Record<string, any>[], s: Record<string, any>): number => sumLines(lines, s).total;
export async function makeLink(jobId: string | null, quoteId: string | null, by: string | null, base: string, lang: string) {
  const token = newToken(24);
  // a link that was not kept would open « lien invalide »: no text goes with it
  const { error } = await adminDb().from('public_links').insert({ token_hash: await sha256hex(token), job_id: jobId, quote_id: quoteId,
    expires_at: new Date(Date.now() + LINK_DAYS * 86400000).toISOString(), created_by: by });
  if (error) throw error;
  return clientLink(base, token, lang);
}

/** the app waits 40 s for this function (callFn): the text must be answered before, counted from the request's arrival */
const ANSWER_MS = 35000;

/* ---------- the words of a text (the single texts and the day's button: the same words, the same variables) ---------- */

/** the template of a kind: the garage's (Réglages → Textos) in the customer's language, else French; « window » has a text
    of its own even when the settings were never given one; « arrived » says « pay online » only when card payment is on */
export function templateOf(kind: string, s: Row, lang: Lang, cardOn: boolean): string {
  const tplKind = kind === 'arrived' && !cardOn ? 'arrived_no_pay' : kind;
  return (s.messages?.[lang]?.[tplKind] || s.messages?.fr?.[tplKind] || (kind === 'window' ? WINDOW_TEXT[lang] : '')) as string;
}
/** what the person sending is called (« arrived » and « extras » name the mechanic) */
interface Sender { short_name?: string | null; full_name?: string | null }
/** The variables of a text for a job, and its template adapted to the job's moment (whenText). Every word a customer reads
    comes from here: a refusal (an empty invoice, nothing to approve…) is thrown as today. `as` = the caller's own database
    (only « arrived » needs it: the invoice is made as that person). */
async function textVars(kind: string, tpl: string, j: Row, cu: Row, s: Row, lang: Lang, cardOn: boolean, who: { as?: Caller['db']; me?: Sender } = {}):
  Promise<{ tpl: string; vars: Record<string, string> }> {
  const db = adminDb();
  const garage = s.company?.name || 'Mécanique Mobile H.I.S';
  const vars: Record<string, string> = { prenom: first(cu.first_name) || '', garage, telephone: s.company?.phone || '' };
  // a block job: its block's words and hours; a 'day' job: its window (« entre 14 h et 18 h ») or « dans la journée ; … »
  const when = whenText(tpl, j as never, s.booking?.blocks, lang);
  Object.assign(vars, when.vars);
  vars.payer = payNowWords(cardOn, lang);
  const { data: items, error: ei } = await db.from('job_items').select('*').eq('job_id', j.id).is('deleted_at', null);
  if (ei) throw ei;
  const its = (items || []) as Record<string, any>[];
  if (kind === 'booking' || kind === 'moved') {
    const planned = its.filter((i) => ['planned', 'done', 'approved'].includes(i.status)).sort((x, y) => (x.sort ?? 0) - (y.sort ?? 0));
    vars.total = money(taxed(planned, s), lang);
    // the estimate, line by line, and the total before taxes (« + tx »); no invoice and no payment before the work
    vars.services = servicesList(planned as never, lang);
    vars.soustotal = subtotalWords(planned as never, lang);
    vars.payer = '';
  }
  if (kind === 'extras' || kind === 'arrived') {
    const { data: mech } = j.truck_id ? await db.from('trucks').select('driver_id, staff:driver_id(short_name, full_name)').eq('id', j.truck_id).maybeSingle() : { data: null };
    vars.mecano = first((mech as any)?.staff?.short_name || (mech as any)?.staff?.full_name || who.me?.short_name || who.me?.full_name) || (lang === 'en' ? 'Your mechanic' : 'Votre mécano');
  }
  if (kind === 'arrived') {
    // the invoice being made from the work (an invoice already being edited is kept as it is)
    const { error: e1 } = await (who.as || db).rpc('invoice_for_job', { p_op: crypto.randomUUID(), p_job: j.id, p_refresh: false });
    if (e1) throw e1;
    // a read that fails is a server problem: never « the invoice is empty », never an amount due that forgets a payment
    const { data: inv, error: ev } = await db.from('invoices').select('*').eq('job_id', j.id).neq('status', 'void').is('deleted_at', null).maybeSingle();
    if (ev) throw ev;
    const v = inv as Record<string, any> | null;
    if (!v || !v.total_cents) fail('nothing', 'La facture est vide : ajoute le travail d’abord.');
    const { data: pays, error: ep } = await db.from('payments').select('amount_cents, invoice_id').eq('job_id', j.id).is('deleted_at', null);
    if (ep) throw ep;
    const paid = v!.status === 'draft' ? ((pays || []) as Record<string, any>[]).filter((p) => !p.invoice_id).reduce((t, p) => t + p.amount_cents, 0) : v!.paid_cents;
    vars.total = money(v!.total_cents, lang);
    vars.montant = money(Math.max(0, v!.total_cents - paid), lang);
  }
  if (kind === 'extras') {
    const prop = its.filter((i) => i.status === 'proposed');
    if (!prop.length) fail('nothing', 'Aucun travail proposé à faire approuver.');
    vars.montant = money(prop.reduce((t, i) => t + lineCents(i), 0), lang);
    const { data: veh } = j.vehicle_id ? await db.from('vehicles').select('year, make, model').eq('id', j.vehicle_id).maybeSingle() : { data: null };
    vars.vehicule = veh ? [veh.year, veh.make, veh.model].filter(Boolean).join(' ') : (lang === 'en' ? 'vehicle' : 'véhicule');
  }
  if (kind === 'invoice' || kind === 'payment_reminder') {
    const { data: inv, error: ev } = await db.from('invoices').select('*').eq('job_id', j.id).neq('status', 'void').is('deleted_at', null).maybeSingle();
    if (ev) throw ev;
    const v = inv as Record<string, any> | null;
    if (!v || v.status === 'draft') fail('invoice_first', 'Termine la facture avant de l’envoyer.');
    const prefix = s.billing?.invoice_prefix ?? 'F-', pad = Number(s.billing?.pad ?? 4);
    vars.numero = `${prefix}${String(v.number).padStart(pad, '0')}`;
    vars.total = money(v.total_cents, lang);
    vars.montant = money(Math.max(0, v.total_cents - v.paid_cents), lang);
    vars.date = longDay(localDay(new Date(v.issued_at)), lang);   // the day in Montréal, not the server's (an invoice finished in the evening)
    if (kind === 'payment_reminder' && v.status === 'paid') fail('paid', 'Cette facture est déjà payée.');
  }
  return { tpl: when.tpl, vars };
}
/** the text itself, with its new link (each text carries one) */
async function withLink(t: { tpl: string; vars: Record<string, string> }, jobId: string, by: string | null, base: string, lang: Lang) {
  const link = await makeLink(jobId, null, by, base, lang);
  return { message: fill(t.tpl, { ...t.vars, lien: link }), link };
}
/** the words of a text of `kind` for a job, ready to send: the template, the variables, a new link (Part 28: the single
    texts and the day's button send exactly the same words) */
export async function buildText(kind: string, job: Row, customer: Row, s: Row, lang: Lang, base: string, by: string | null, cardOn: boolean, who: { as?: Caller['db']; me?: Sender } = {}) {
  const tpl = templateOf(kind, s, lang, cardOn);
  if (!tpl) fail('template', 'Ce texto n’a pas de modèle dans les réglages.');
  return withLink(await textVars(kind, tpl, job, customer, s, lang, cardOn, who), String(job.id), by, base, lang);
}

/* ---------- what a customer was told (Part 28): the lease and the told write ---------- */

/** the blocks with their hours: the settings', else the garage's three (as blocks_set() of the database) */
const DEFAULT_BLOCKS = [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }];
const blocksOf = (s: Row): Row[] => (Array.isArray(s.booking?.blocks) ? s.booking.blocks : DEFAULT_BLOCKS);
export interface Told { day: string; start: number | null; end: number | null }
/** the day and the hours a single text says for a job (what it tells the customer): a 'day' job its window (none:
    flexible, « dans la journée »), a block job its block's hours */
export function toldOf(j: Row, s: Row): Told {
  if (j.block === 'day') {
    const w = jobWindow(j as never);
    return { day: String(j.day), start: w ? w[0] : null, end: w ? w[1] : null };
  }
  const b = blocksOf(s).find((x) => x.key === j.block);
  const n = (x: unknown) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x));
  return { day: String(j.day), start: b ? n(b.start) : null, end: b ? n(b.end) : null };
}
/** one answer of tell_take for one appointment */
interface Take {
  id: string; take?: boolean; busy?: boolean; gone?: boolean; already?: boolean;
  state?: string; kind?: string; now?: { day: string; start: number | null; end: number | null; rewin?: boolean; ws?: number | null; we?: number | null };
  job?: Row;
}
/** the lease's number: tell_done / tell_release drop exactly the lease this call took (never another send's) */
const leaseToken = () => 1 + Math.floor(Math.random() * 2147483646);
/** tell_take's answer: one entry per appointment asked */
function takes(data: unknown): Take[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as Row | null)?.jobs) ? (data as Row).jobs : [];
  return (list as Row[]).filter((x) => x && typeof x.id === 'string') as Take[];
}
/** the told write of a text that went (or may have gone): once more on a hiccup, never thrown (the text is out) */
async function toldDone(jobId: string, token: number, now: Row, how: 'sms' | 'maybe', by: string | null, kind: string) {
  const db = adminDb();
  for (let i = 0; i < 2; i++) {
    const { error } = await db.rpc('tell_done', { p_job: jobId, p_token: token, p_now: now, p_how: how, p_by: by, p_kind: kind });
    if (!error) return;
    console.error('notify: tell_done', jobId, String(error.message || error).slice(0, 200));
  }
}
/** a text that did not go: the lease is dropped (the next send may text him) */
async function release(jobId: string, token: number) {
  try {
    const { error } = await adminDb().rpc('tell_release', { p_job: jobId, p_token: token });
    if (error) console.error('notify: tell_release', jobId, String(error.message || error).slice(0, 200));
  } catch (e) { console.error('notify: tell_release', jobId, String((e as Error)?.message || e).slice(0, 200)); }
}

/* ---------- the day's button: « Envoyer les heures aux clients » ---------- */

const DAY_MAX = 100, ROUND = 3, ROUND_LEFT_MS = 12000;
const NOT_TELL = 'Seuls le propriétaire et le bureau envoient les heures aux clients.';
const BAD_LIST = 'La liste des clients à texter n’est pas bonne. Rouvre-la.';
const SERVER = 'Le serveur a eu un problème. Réessaie dans un instant.';
/** distinct appointment ids of a list sent by the app; anything else refused */
function idList(x: unknown, max: number): string[] {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x) || x.length > max || !x.every((v) => typeof v === 'string' && UUID.test(v))) fail('bad_list', BAD_LIST);
  return [...new Set((x as string[]).map((v) => v.toLowerCase()))];
}
interface DayAnswer {
  ok: true; status: 'done'; day: string;
  sent: string[]; maybe: string[]; already: string[]; busy: string[]; gone: string[];
  quiet: { id: string; phone: string | null; why: 'sms_ok' | 'kind_off' }[];
  no_phone: string[];
  failed: { id: string; error: string; phone: string | null; told: Told; kind: string }[];
  by_hand: { id: string; phone: string | null; message: string; link: string; told: Told; kind: string }[];
  left: string[];
}
async function sendDay(req: Request, b: Row, until: number): Promise<Row> {
  const c = await caller(req);
  if (!(c.access.owner || c.access.rights?.book)) fail('not_allowed', NOT_TELL, 403);
  const day = String(b.day || '');
  if (!DAY.test(day)) fail('bad_list', BAD_LIST);
  const asked = idList(b.only, DAY_MAX);
  // only the appointments this person may open (their own row rules, as the single texts): the others are not texted
  let mine: string[] = [];
  if (asked.length) {
    const { data: seen, error } = await c.db.from('jobs').select('id').in('id', asked);
    if (error) throw error;
    const ok = new Set(((seen || []) as Row[]).map((r) => String(r.id).toLowerCase()));
    mine = asked.filter((id) => ok.has(id)).sort();       // in id order: tell_take locks in that order
  }
  const again = idList(b.again, DAY_MAX).filter((id) => mine.includes(id));
  const db = adminDb();
  // the same press arriving twice (the same op): its first answer. The app never asks a lost press again with the same
  // op (the told and the lease make a new one safe), so an op in flight here is a doubled request: awaited a few seconds
  const op = UUID.test(String(b.op || '')) ? String(b.op) : null;
  if (op) {
    const { data: done, error: e9 } = await db.rpc('op_begin', { p_op: op, p_name: 'notify_day' });
    if (e9) throw e9;
    if (done) {
      if ((done as Row).status) return done as Row;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const { data: row } = await db.from('op_log').select('result').eq('op', op).maybeSingle();
        const res = (row as Row | null)?.result;
        if (res?.status) return res as Row;
        if (!row) break;
      }
      fail('busy', 'Ces textos sont déjà en train de partir. Réessaie dans un instant.', 409);
    }
  }
  const out: DayAnswer = { ok: true, status: 'done', day, sent: [], maybe: [], already: [], busy: [], gone: [], quiet: [], no_phone: [], failed: [], by_hand: [], left: [] };
  try {
    const s = await settings();
    const cardOn = !!(await secret('stripe_key'));
    const base = baseOf(b.base);
    const token = leaseToken();
    let rest = mine, did = false;
    while (rest.length && until - Date.now() > ROUND_LEFT_MS) {
      const batch = rest.slice(0, ROUND);
      const { data, error } = await db.rpc('tell_take', { p_jobs: batch, p_again: again, p_token: token });
      if (error) {
        // nothing done yet: the server's problem is said; else what went is answered, the rest left for the next call
        if (!did) throw error;
        console.error('notify day: tell_take', String(error.message || error).slice(0, 200));
        break;
      }
      did = true;
      rest = rest.slice(ROUND);
      const got = takes(data);
      const answered = new Set(got.map((x) => x.id.toLowerCase()));
      // an id the server did not answer is left for the next call (never lost, never texted twice: the lease)
      for (const id of batch) if (!answered.has(id)) out.left.push(id);
      const taken = got.filter((x) => x.take && x.job && x.now);
      for (const x of got) {
        if (x.take && x.job && x.now) continue;
        if (x.take) { await release(x.id, token); out.failed.push({ id: x.id, error: SERVER, phone: null, told: { day, start: null, end: null }, kind: String(x.kind || '') }); }
        else if (x.busy) out.busy.push(x.id);
        else if (x.gone) out.gone.push(x.id);
        else out.already.push(x.id);
      }
      if (!taken.length) continue;
      const custIds = [...new Set(taken.map((x) => x.job!.customer_id).filter(Boolean))];
      const { data: custs, error: ec } = custIds.length ? await db.from('customers').select('*').in('id', custIds) : { data: [], error: null };
      if (ec) {
        // the customers could not be read: nothing sent for this round, every lease dropped, said as not sent
        console.error('notify day: customers', String(ec.message || ec).slice(0, 200));
        for (const x of taken) {
          await release(x.id, token);
          out.failed.push({ id: x.id, error: SERVER, phone: null, told: { day: x.now!.day, start: x.now!.start, end: x.now!.end }, kind: String(x.kind) });
        }
        continue;
      }
      const byId = new Map(((custs || []) as Row[]).map((r) => [String(r.id), r]));
      await Promise.all(taken.map((x) => sendOne(x, (byId.get(String(x.job!.customer_id)) || {}) as Row, { c, s, cardOn, base, token, until, out })));
    }
    out.left.push(...rest);
  } catch (e) {
    if (op) { try { await db.from('op_log').delete().eq('op', op).is('result', null); } catch { /* the error is what counts */ } }
    throw e;
  }
  if (op) { try { await db.rpc('op_save', { p_op: op, p_name: 'notify_day', p_result: out }); } catch { /* the texts are what count */ } }
  return out;
}
/** one customer of the day's button, his lease taken: the text of his state with the hours he must be told now */
async function sendOne(x: Take, cu: Row, k: { c: Caller; s: Row; cardOn: boolean; base: string; token: number; until: number; out: DayAnswer }) {
  const db = adminDb();
  const j = x.job!, now = x.now!, kind = String(x.kind || ''), id = x.id;
  const told: Told = { day: String(now.day), start: now.start ?? null, end: now.end ?? null };
  const phone = (cu.phone as string | null) || null;
  let message = '', link = '';
  try {
    if (!TOLD_KINDS.includes(kind)) fail('kind', 'Type de texto inconnu.');
    const lang: Lang = cu.lang === 'en' ? 'en' : 'fr';
    // the job as taken, with the hours he must be told now (a 'day' job: those hours as its window, so the words say them)
    const jj = j.block === 'day' ? { ...j, win_start: now.start ?? null, win_end: now.end ?? null } : j;
    ({ message, link } = await buildText(kind, jj, cu, k.s, lang, k.base, k.c.id, k.cardOn));
  } catch (e) {
    // nothing was sent: the lease is dropped, he stays owed his hours
    console.error('notify day: words', id, String((e as Error)?.message || e).slice(0, 200));
    await release(id, k.token);
    k.out.failed.push({ id, error: (e as Error)?.message && (e as { code?: string }).code === 'template' ? String((e as Error).message) : SERVER, phone, told, kind });
    return;
  }
  const row = (status: string, ref: string | null, error: string | null) => db.from('messages').insert({ job_id: id, customer_id: cu.id || null, staff_id: k.c.id,
    kind, channel: 'sms', to_addr: phone, body: message, status, provider_ref: ref, error, created_by: k.c.id }).then(({ error: e }) => {
    if (e) console.error('notify day: messages', id, String(e.message || e).slice(0, 200));
  });
  // a customer who refuses texts, or this kind switched off in Réglages: to tell by hand (« À avertir toi-même »)
  const why = cu.sms_ok === false ? 'sms_ok' as const : k.s.messages?.on?.[kind] === false ? 'kind_off' as const : null;
  if (why) { await row('skipped', null, 'quiet'); await release(id, k.token); k.out.quiet.push({ id, phone, why }); return; }
  // no cell number: nobody can text him, by hand either (to call)
  if (!e164(phone)) { await row('skipped', null, 'no_phone'); await release(id, k.token); k.out.no_phone.push(id); return; }
  const res = await sendSms({ first: cu.first_name, last: cu.last_name, phone, email: cu.email }, message, undefined, { until: k.until });
  // from here the text may be out: never sent again by itself (sent or « peut-être parti » = told)
  await row(res.status === 'sent' ? 'sent' : res.status === 'error' ? 'failed' : 'skipped', res.id || null, res.error || res.status);
  if (res.status === 'sent') { await toldDone(id, k.token, now, 'sms', k.c.id, kind); k.out.sent.push(id); return; }
  if (res.status === 'error' && res.maybe) { await toldDone(id, k.token, now, 'maybe', k.c.id, kind); k.out.maybe.push(id); return; }
  await release(id, k.token);
  if (res.status === 'off') k.out.by_hand.push({ id, phone, message, link, told, kind });
  else if (res.status === 'no_phone') k.out.no_phone.push(id);
  else k.out.failed.push({ id, error: res.error || SERVER, phone, told, kind });
}

/* ---------- one text ---------- */

export const handler = serve(async (req) => {
  const until = Date.now() + ANSWER_MS;
  const b = await body(req);
  // the day's button: its own rights and answer (a request without `kind` is still refused « kind » below)
  if (b.action === 'day') return json(await sendDay(req, b as Row, until));
  const kind = String(b.kind || '');
  if (!KINDS.includes(kind)) fail('kind', 'Type de texto inconnu.');
  const c = await caller(req);
  const db = adminDb();
  // the person must see the job through the normal rules
  if (!UUID.test(String(b.job_id || ''))) fail('not_found', 'Cette job n’existe plus.', 404);
  const { data: seen, error } = await c.db.from('jobs').select('*').eq('id', String(b.job_id || '')).maybeSingle();
  if (error) throw error;
  let job = seen as Record<string, any> | null;
  const r = c.access.rights;
  if (!job && BILL_KINDS.includes(kind) && (c.access.owner || r.treasury || r.edit_invoices)) {
    // someone who keeps the books without the agenda (a treasurer, the office's « edit invoices »): the finished invoice
    // of the job is theirs to send when the database's own rule shows it to them. Never with « Factures » alone (a
    // mechanic of another truck sees every invoice), never « arrived » (« your mechanic is here »): as before, the job
    // must be theirs to see
    const { data: inv, error: e0 } = await c.db.from('invoices').select('id').eq('job_id', String(b.job_id)).is('deleted_at', null).limit(1);
    if (e0) throw e0;
    if (inv?.length) job = (await db.from('jobs').select('*').eq('id', String(b.job_id)).is('deleted_at', null).maybeSingle()).data as Record<string, any> | null;
  }
  if (!job) fail('not_found', 'Cette job n’existe plus (ou tu n’y as pas accès).');
  const j = job as Record<string, any>;
  const mine = c.access.trucks.includes(j.truck_id) || j.created_by === c.id;
  if (['booking', 'moved', 'extras', 'reminder', 'window'].includes(kind) && !(r.book || mine || c.access.owner)) fail('not_allowed', 'Tu ne peux pas texter ce client.', 403);
  if (MONEY_KINDS.includes(kind) && !(r.edit_invoices || r.invoices || mine || c.access.owner)) fail('not_allowed', 'Tu ne peux pas envoyer cette facture.', 403);

  const s = await settings();
  // a read that fails is a server problem, never « this customer has no number » nor an empty estimate
  const { data: cust, error: ec } = await db.from('customers').select('*').eq('id', j.customer_id).maybeSingle();
  if (ec) throw ec;
  const cu = (cust || {}) as Record<string, any>;
  const lang: Lang = cu.lang === 'en' ? 'en' : 'fr';
  const cardOn = !!(await secret('stripe_key'));
  const tpl = templateOf(kind, s, lang, cardOn);
  if (!tpl) fail('template', 'Ce texto n’a pas de modèle dans les réglages.');
  if (kind === 'booking' && j.confirm_sent_at && !b.resend) return json({ ok: true, status: 'already' });
  if (['booking', 'moved', 'reminder', 'window'].includes(kind) && j.status !== 'booked') fail('not_booked', 'Ce rendez-vous n’est plus à venir.');
  // the window of a flexible booking was just fixed: only a job that has one
  if (kind === 'window' && !jobWindow(j as never)) fail('no_window', 'Ce rendez-vous n’a pas encore de plage d’arrivée.');
  if (kind === 'arrived') {
    if (j.status !== 'on_site') fail('not_on_site', 'Le mécano n’est pas encore arrivé chez ce client.');
    if (!b.resend) {
      const { count, error: ea } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('job_id', j.id).eq('kind', 'arrived').eq('status', 'sent');
      if (ea) throw ea;
      if (count) return json({ ok: true, status: 'already' });
    }
  }

  const when = await textVars(kind, tpl, j, cu, s, lang, cardOn, { as: c.db, me: c.access });
  if (kind === 'window' && !b.resend) {
    // the same window is told once (asked twice, or the evening's lock run again); another window is a new text
    const { data: prev, error: ew } = await db.from('messages').select('body').eq('job_id', j.id).eq('kind', 'window').eq('status', 'sent').order('created_at', { ascending: false }).limit(1);
    if (ew) throw ew;
    if (prev?.length && bare((prev[0] as Record<string, any>).body) === bare(fill(when.tpl, { ...when.vars, lien: '' }))) return json({ ok: true, status: 'already' });
  }
  // the same send again (same `op`): the first one's answer, nothing texted twice
  const op = UUID.test(String(b.op || '')) ? String(b.op) : null;
  if (op) {
    const { data: done, error: e9 } = await db.rpc('op_begin', { p_op: op, p_name: `notify_${kind}` });
    if (!e9 && done) {
      if ((done as Record<string, any>).status) return json(done);
      // the same send is going on right now (two taps at once): its answer is awaited a few seconds; never « sent »
      // before it is known (it may still fail, or come back as a text to send by hand)
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const { data: row } = await db.from('op_log').select('result').eq('op', op).maybeSingle();
        const res = (row as Record<string, any> | null)?.result;
        if (res?.status) return json(res);
        if (!row) break;                              // the first one did not send: it freed the op
      }
      fail('busy', 'Ce texto est déjà en train de partir. Réessaie dans un instant.', 409);
    }
  }
  /** the send is over: its answer is kept for a second arrival; a text that did not go frees the op (the retry sends) */
  const close = async (out: Record<string, unknown>, went: boolean) => {
    if (!op) return;
    try {
      if (went) await db.rpc('op_save', { p_op: op, p_name: `notify_${kind}`, p_result: out });
      else await db.from('op_log').delete().eq('op', op).is('result', null);
    } catch { /* the text itself is what counts */ }
  };
  // Part 28: a text that tells the customer his day and hours goes under the lease of his appointment. Not owed anything
  // new (what he was told still holds), or another send holding him right now (the day's button, a second phone): no
  // text. `resend` (« Renvoyer le texto ») sends again whatever he was told.
  const telling = TOLD_KINDS.includes(kind);
  const token = leaseToken();
  const told = telling ? toldOf(j, s) : null;
  if (telling) {
    let x: Take | undefined;
    try {
      const { data, error: et } = await db.rpc('tell_take', { p_jobs: [j.id], p_again: null, p_token: token, p_force: !!b.resend });
      if (et) throw et;
      x = takes(data).find((t) => t.id.toLowerCase() === String(j.id).toLowerCase());
    } catch (e) { await close({}, false); throw e; }
    if (!x?.take) {
      await close({}, false);
      if (x?.gone) fail('not_booked', 'Ce rendez-vous n’est plus à venir.');
      return json({ ok: true, status: 'already' });
    }
  }
  let out: Record<string, unknown> = {}, went = false;
  try {
    const { message, link } = await withLink(when, j.id, c.id, baseOf(b.base), lang);

    const quiet = cu.sms_ok === false || s.messages?.on?.[kind] === false;
    const res = quiet ? { status: 'quiet' as const } : await sendSms({ first: cu.first_name, last: cu.last_name, phone: cu.phone, email: cu.email }, message, undefined, { until });
    const maybe = res.status === 'error' && (res as { maybe?: boolean }).maybe === true;
    went = res.status === 'sent' || maybe;
    await db.from('messages').insert({ job_id: j.id, customer_id: cu.id || null, staff_id: c.id, kind, channel: 'sms', to_addr: cu.phone || null, body: message,
      status: res.status === 'sent' ? 'sent' : res.status === 'error' ? 'failed' : 'skipped', provider_ref: (res as { id?: string }).id || null, error: (res as { error?: string }).error || res.status, created_by: c.id });
    if (telling) {
      // what THAT text said is what he was told (it writes confirm_sent_at too, except for « window »); a text that did not
      // go drops the lease: he stays owed his hours
      if (res.status === 'sent') await toldDone(j.id, token, { ...told, rewin: false }, 'sms', c.id, kind);
      else if (maybe) await toldDone(j.id, token, { ...told, rewin: false }, 'maybe', c.id, kind);
      else await release(j.id, token);
    } else if (res.status === 'sent' && kind === 'invoice') await db.from('invoices').update({ sent_at: new Date().toISOString() }).eq('job_id', j.id).neq('status', 'void').is('deleted_at', null);
    out = { ok: res.status === 'sent', status: res.status, error: (res as { error?: string }).error, message, link, phone: cu.phone || null,
      ...(maybe ? { maybe: true } : {}),
      // a text to send by hand (texting not set up), or one that did not go: the app's « send by hand » sheet offers
      // « C'est envoyé » with what this message says (tell_mark how 'hand')
      ...(telling && (res.status === 'off' || res.status === 'error') ? { told, kind, job_id: j.id } : {}) };
    await close(out, res.status === 'sent');
    return json(out);
  } catch (e) {
    if (telling && !went) await release(j.id, token);
    await close({}, false);   // nothing went: the same op may try again
    throw e;
  }
});
