// Texts to customers: appointment confirmed / moved (the block, the estimate to sign, « pay now » when card payment is on),
// the mechanic arrived (the invoice to pay during the work), invoice (with « Payer »), extra work to approve, payment
// reminder, the day-before reminder. Each text carries a secret link to the customer's own page.
// When automatic texts are not set up, the app gets the text and the link back, to send them itself.
import { serve, json, body, fail } from '../_shared/http.ts';
import { adminDb, caller, settings, secret } from '../_shared/db.ts';
import { newToken, sha256hex } from '../_shared/tokens.ts';
import { baseOf, clientLink } from '../_shared/links.ts';
import { sendSms } from '../_shared/ghl.ts';
import { money, clock, longDay, fill, first, blockWords, payNowWords, servicesList, subtotalWords, type Lang } from '../_shared/texts.ts';
import { sumLines } from '../_shared/money.ts';

const KINDS = ['booking', 'moved', 'arrived', 'invoice', 'extras', 'payment_reminder', 'reminder'];
const LINK_DAYS = 90;

function blockWindow(s: Record<string, any>, key: string): [number, number] {
  const b = (s.booking?.blocks || []).find((x: { key: string }) => x.key === key) || { start: 480, end: 720 };
  return [b.start, b.end];
}
/** the total of lines, the same way everywhere (discounts count negative): _shared/money.ts */
const taxed = (lines: Record<string, unknown>[], s: Record<string, any>): number => sumLines(lines, s).total;
export async function makeLink(jobId: string | null, quoteId: string | null, by: string | null, base: string, lang: string) {
  const token = newToken(24);
  await adminDb().from('public_links').insert({ token_hash: await sha256hex(token), job_id: jobId, quote_id: quoteId,
    expires_at: new Date(Date.now() + LINK_DAYS * 86400000).toISOString(), created_by: by });
  return clientLink(base, token, lang);
}

export const handler = serve(async (req) => {
  const b = await body(req);
  const kind = String(b.kind || '');
  if (!KINDS.includes(kind)) fail('kind', 'Type de texto inconnu.');
  const c = await caller(req);
  const db = adminDb();
  // the person must see the job through the normal rules
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(b.job_id || ''))) fail('not_found', 'Cette job n’existe plus.', 404);
  const { data: job, error } = await c.db.from('jobs').select('*').eq('id', String(b.job_id || '')).maybeSingle();
  if (error) throw error;
  if (!job) fail('not_found', 'Cette job n’existe plus (ou tu n’y as pas accès).');
  const j = job as Record<string, any>;
  const mine = c.access.trucks.includes(j.truck_id) || j.created_by === c.id;
  const r = c.access.rights;
  if (['booking', 'moved', 'extras', 'reminder'].includes(kind) && !(r.book || mine || c.access.owner)) fail('not_allowed', 'Tu ne peux pas texter ce client.', 403);
  if (['invoice', 'payment_reminder', 'arrived'].includes(kind) && !(r.edit_invoices || r.invoices || mine || c.access.owner)) fail('not_allowed', 'Tu ne peux pas envoyer cette facture.', 403);

  const s = await settings();
  const { data: cust } = await db.from('customers').select('*').eq('id', j.customer_id).maybeSingle();
  const cu = (cust || {}) as Record<string, any>;
  const lang: Lang = cu.lang === 'en' ? 'en' : 'fr';
  const garage = s.company?.name || 'Mécanique Mobile H.I.S';
  const cardOn = !!(await secret('stripe_key'));
  // « the mechanic arrived » says « pay online » only when card payment is on
  const tplKind = kind === 'arrived' && !cardOn ? 'arrived_no_pay' : kind;
  const tpl = (s.messages?.[lang]?.[tplKind] || s.messages?.fr?.[tplKind] || '') as string;
  if (!tpl) fail('template', 'Ce texto n’a pas de modèle dans les réglages.');
  if (kind === 'booking' && j.confirm_sent_at && !b.resend) return json({ ok: true, status: 'already' });
  if (['booking', 'moved', 'reminder'].includes(kind) && j.status !== 'booked') fail('not_booked', 'Ce rendez-vous n’est plus à venir.');
  if (kind === 'arrived') {
    if (j.status !== 'on_site') fail('not_on_site', 'Le mécano n’est pas encore arrivé chez ce client.');
    if (!b.resend) {
      const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('job_id', j.id).eq('kind', 'arrived').eq('status', 'sent');
      if (count) return json({ ok: true, status: 'already' });
    }
  }

  const vars: Record<string, string> = { prenom: first(cu.first_name) || '', garage, telephone: s.company?.phone || '' };
  const [a, z] = blockWindow(s, j.block);
  vars.jour = longDay(j.day, lang); vars.debut = clock(a, lang); vars.fin = clock(z, lang); vars.bloc = blockWords(j.block, lang);
  vars.payer = payNowWords(cardOn, lang);
  const { data: items } = await db.from('job_items').select('*').eq('job_id', j.id).is('deleted_at', null);
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
    const { data: inv } = await db.from('invoices').select('*').eq('job_id', j.id).neq('status', 'void').is('deleted_at', null).maybeSingle();
    const v = inv as Record<string, any> | null;
    if (!v || !v.total_cents) fail('nothing', 'La facture est vide : ajoute le travail d’abord.');
    const { data: pays } = await db.from('payments').select('amount_cents, invoice_id').eq('job_id', j.id).is('deleted_at', null);
    const paid = v!.status === 'draft' ? ((pays || []) as Record<string, any>[]).filter((p) => !p.invoice_id).reduce((t, p) => t + p.amount_cents, 0) : v!.paid_cents;
    vars.total = money(v!.total_cents, lang);
    vars.montant = money(Math.max(0, v!.total_cents - paid), lang);
  }
  if (kind === 'extras') {
    const prop = its.filter((i) => i.status === 'proposed');
    if (!prop.length) fail('nothing', 'Aucun travail proposé à faire approuver.');
    vars.montant = money(prop.reduce((t, i) => t + Math.round(Number(i.qty) * i.unit_cents), 0), lang);
    const { data: veh } = j.vehicle_id ? await db.from('vehicles').select('year, make, model').eq('id', j.vehicle_id).maybeSingle() : { data: null };
    vars.vehicule = veh ? [veh.year, veh.make, veh.model].filter(Boolean).join(' ') : (lang === 'en' ? 'vehicle' : 'véhicule');
  }
  if (kind === 'invoice' || kind === 'payment_reminder') {
    const { data: inv } = await db.from('invoices').select('*').eq('job_id', j.id).neq('status', 'void').is('deleted_at', null).maybeSingle();
    const v = inv as Record<string, any> | null;
    if (!v || v.status === 'draft') fail('invoice_first', 'Termine la facture avant de l’envoyer.');
    const prefix = s.billing?.invoice_prefix ?? 'F-', pad = Number(s.billing?.pad ?? 4);
    vars.numero = `${prefix}${String(v.number).padStart(pad, '0')}`;
    vars.total = money(v.total_cents, lang);
    vars.montant = money(Math.max(0, v.total_cents - v.paid_cents), lang);
    vars.date = longDay(String(v.issued_at).slice(0, 10), lang);
    if (kind === 'payment_reminder' && v.status === 'paid') fail('paid', 'Cette facture est déjà payée.');
  }
  vars.lien = await makeLink(j.id, null, c.id, baseOf(b.base), lang);
  const message = fill(tpl, vars);

  const quiet = cu.sms_ok === false || s.messages?.on?.[kind] === false;
  const res = quiet ? { status: 'quiet' as const } : await sendSms({ first: cu.first_name, last: cu.last_name, phone: cu.phone, email: cu.email }, message);
  await db.from('messages').insert({ job_id: j.id, customer_id: cu.id || null, staff_id: c.id, kind, channel: 'sms', to_addr: cu.phone || null, body: message,
    status: res.status === 'sent' ? 'sent' : res.status === 'error' ? 'failed' : 'skipped', provider_ref: (res as { id?: string }).id || null, error: (res as { error?: string }).error || res.status, created_by: c.id });
  if (res.status === 'sent' && (kind === 'booking' || kind === 'moved')) {
    await db.from('jobs').update({ confirm_sent_at: new Date().toISOString() }).eq('id', j.id);
  }
  if (res.status === 'sent' && kind === 'invoice') await db.from('invoices').update({ sent_at: new Date().toISOString() }).eq('job_id', j.id).neq('status', 'void');
  return json({ ok: res.status === 'sent', status: res.status, error: (res as { error?: string }).error, message, link: vars.lien, phone: cu.phone || null });
});
