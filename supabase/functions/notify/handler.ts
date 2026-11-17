// Texts to customers: appointment confirmed / moved (the block, the estimate to sign, « pay now » when card payment is on),
// the mechanic arrived (the invoice to pay during the work), invoice (with « Payer »), extra work to approve, payment
// reminder, the day-before reminder, the window of a flexible booking just fixed (« window »). Each text carries a secret link to the customer's own page.
// When automatic texts are not set up, the app gets the text and the link back, to send them itself.
// `op` (optional, the app's own id of this send): the same send arriving twice — the answer was lost on a weak signal
// and the person tapped again — texts the customer once and answers the first result again.
import { serve, json, body, fail } from '../_shared/http.ts';
import { adminDb, caller, settings, secret } from '../_shared/db.ts';
import { newToken, sha256hex } from '../_shared/tokens.ts';
import { baseOf, clientLink } from '../_shared/links.ts';
import { sendSms } from '../_shared/ghl.ts';
import { money, longDay, localDay, fill, first, payNowWords, servicesList, subtotalWords, whenText, jobWindow, WINDOW_TEXT, type Lang } from '../_shared/texts.ts';
import { sumLines, lineCents } from '../_shared/money.ts';

const KINDS = ['booking', 'moved', 'arrived', 'invoice', 'extras', 'payment_reminder', 'reminder', 'window'];
const LINK_DAYS = 90;

/** a text without its links (each text carries a new one) */
const bare = (x: unknown) => String(x || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

export const handler = serve(async (req) => {
  const b = await body(req);
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
  const garage = s.company?.name || 'Mécanique Mobile H.I.S';
  const cardOn = !!(await secret('stripe_key'));
  // « the mechanic arrived » says « pay online » only when card payment is on
  const tplKind = kind === 'arrived' && !cardOn ? 'arrived_no_pay' : kind;
  // « window » has a text of its own even when the settings were never given one
  const tpl = (s.messages?.[lang]?.[tplKind] || s.messages?.fr?.[tplKind] || (kind === 'window' ? WINDOW_TEXT[lang] : '')) as string;
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
    vars.mecano = first((mech as any)?.staff?.short_name || (mech as any)?.staff?.full_name || c.access.short_name || c.access.full_name) || (lang === 'en' ? 'Your mechanic' : 'Votre mécano');
  }
  if (kind === 'arrived') {
    // the invoice being made from the work (an invoice already being edited is kept as it is)
    const { error: e1 } = await c.db.rpc('invoice_for_job', { p_op: crypto.randomUUID(), p_job: j.id, p_refresh: false });
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
  if (kind === 'window' && !b.resend) {
    // the same window is told once (asked twice, or the evening's lock run again); another window is a new text
    const { data: prev, error: ew } = await db.from('messages').select('body').eq('job_id', j.id).eq('kind', 'window').eq('status', 'sent').order('created_at', { ascending: false }).limit(1);
    if (ew) throw ew;
    if (prev?.length && bare((prev[0] as Record<string, any>).body) === bare(fill(when.tpl, { ...vars, lien: '' }))) return json({ ok: true, status: 'already' });
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
  try {
    vars.lien = await makeLink(j.id, null, c.id, baseOf(b.base), lang);
    const message = fill(when.tpl, vars);

    const quiet = cu.sms_ok === false || s.messages?.on?.[kind] === false;
    const res = quiet ? { status: 'quiet' as const } : await sendSms({ first: cu.first_name, last: cu.last_name, phone: cu.phone, email: cu.email }, message);
    await db.from('messages').insert({ job_id: j.id, customer_id: cu.id || null, staff_id: c.id, kind, channel: 'sms', to_addr: cu.phone || null, body: message,
      status: res.status === 'sent' ? 'sent' : res.status === 'error' ? 'failed' : 'skipped', provider_ref: (res as { id?: string }).id || null, error: (res as { error?: string }).error || res.status, created_by: c.id });
    if (res.status === 'sent' && (kind === 'booking' || kind === 'moved')) {
      await db.from('jobs').update({ confirm_sent_at: new Date().toISOString() }).eq('id', j.id);
    }
    if (res.status === 'sent' && kind === 'invoice') await db.from('invoices').update({ sent_at: new Date().toISOString() }).eq('job_id', j.id).neq('status', 'void').is('deleted_at', null);
    const out = { ok: res.status === 'sent', status: res.status, error: (res as { error?: string }).error, message, link: vars.lien, phone: cu.phone || null };
    await close(out, res.status === 'sent');
    return json(out);
  } catch (e) {
    await close({}, false);   // nothing went: the same op may try again
    throw e;
  }
});
