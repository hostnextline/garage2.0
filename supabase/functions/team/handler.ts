// « Équipe et accès »: invitations, activating an account, new password links, removing someone, the keys of the
// texting and card-payment services. Without an account: only invite-info and invite-accept (with the secret link).
import { serve, json, body, fail, env } from '../_shared/http.ts';
import { adminDb, caller, secret, setSecret, setSecrets, settings, type Caller } from '../_shared/db.ts';
import { newToken, sha256hex } from '../_shared/tokens.ts';
import { baseOf, inviteLink } from '../_shared/links.ts';
import { sendEmail, sendSms, e164 } from '../_shared/ghl.ts';
import { stripeCall } from '../_shared/stripe.ts';
import { first } from '../_shared/texts.ts';

const ROLES = ['owner', 'office', 'mechanic', 'treasurer'];
const DAYS7 = 7 * 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function owner(c: Caller) { if (!c.access.owner) fail('not_allowed', 'Seul le propriétaire gère l’équipe.', 403); }
function cleanRoles(r: unknown): string[] {
  const list = Array.isArray(r) ? r.filter((x) => ROLES.includes(String(x))).map(String) : [];
  return [...new Set(list)];
}
async function findUserByEmail(email: string) {
  const db = adminDb();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => (x.email || '').toLowerCase() === email.toLowerCase());
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}
function inviteText(lang: string, name: string, garage: string, link: string, reset: boolean) {
  const fr = reset
    ? { subject: `Nouveau mot de passe — ${garage}`, intro: `Bonjour ${name}, voici ton lien pour choisir un nouveau mot de passe dans l’app de ${garage}.` }
    : { subject: `Ton accès à l’app de ${garage}`, intro: `Bonjour ${name}, tu es invité dans l’app de ${garage}. Touche le lien pour choisir ton mot de passe.` };
  const en = reset
    ? { subject: `New password — ${garage}`, intro: `Hello ${name}, here is your link to choose a new password in the ${garage} app.` }
    : { subject: `Your access to the ${garage} app`, intro: `Hello ${name}, you are invited to the ${garage} app. Tap the link to choose your password.` };
  const t = lang === 'en' ? en : fr;
  const after = lang === 'en'
    ? 'The link works once, for 7 days. Then add the app to your home screen: iPhone, Share → Add to Home Screen; Android, ⋮ → Install app.'
    : 'Le lien marche une seule fois, pendant 7 jours. Ensuite, mets l’app sur ton écran d’accueil : iPhone, Partager → Sur l’écran d’accueil; Android, ⋮ → Installer l’app.';
  const text = `${t.intro}\n${link}\n${after}`;
  const html = `<p>${t.intro}</p><p><a href="${link}">${link}</a></p><p>${after}</p>`;
  return { subject: t.subject, text, html, sms: `${t.intro} ${link}` };
}

async function makeInvite(by: string, v: { email: string; full_name: string; short_name?: string | null; roles: string[]; rights?: Record<string, boolean>; lang: string; kind: 'invite' | 'reset'; user_id?: string | null; truck_id?: string | null }) {
  const db = adminDb();
  // a new link replaces the unused ones for the same person
  await db.from('invitations').update({ used_at: new Date().toISOString() }).eq('email', v.email.toLowerCase()).is('used_at', null);
  const token = newToken(24);
  const { data, error } = await db.from('invitations').insert({
    email: v.email.toLowerCase(), full_name: v.full_name, short_name: v.short_name || null, roles: v.roles, rights: v.rights || {}, lang: v.lang,
    token_hash: await sha256hex(token), kind: v.kind, user_id: v.user_id || null, truck_id: v.truck_id || null, expires_at: new Date(Date.now() + DAYS7).toISOString(), created_by: by
  }).select('id').single();
  if (error) throw error;
  return { token, id: (data as { id: string }).id };
}
async function deliver(send: string, person: { name: string; email: string; phone?: string | null; lang: string }, link: string, reset: boolean) {
  const s = await settings();
  const garage = s.company?.name || 'Mécanique Mobile H.I.S';
  const msg = inviteText(person.lang, first(person.name) || person.name, garage, link, reset);
  if (send === 'email') return { channel: 'email', ...(await sendEmail({ first: first(person.name), email: person.email }, msg.subject, msg.html, msg.text, 'equipe-garage')), message: msg };
  if (send === 'sms') return { channel: 'sms', ...(await sendSms({ first: first(person.name), phone: person.phone, email: person.email }, msg.sms, 'equipe-garage')), message: msg };
  return { channel: 'none', status: 'none', message: msg };
}

export const handler = serve(async (req) => {
  const b = await body(req);
  const action = String(b.action || '');
  const db = adminDb();

  /* ---------- without an account: the secret link ---------- */
  if (action === 'invite-info' || action === 'invite-accept') {
    const token = String(b.token || '');
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) fail('bad_link', 'Ce lien est incomplet. Demande-en un nouveau au propriétaire.');
    const { data: inv } = await db.from('invitations').select('*').eq('token_hash', await sha256hex(token)).maybeSingle();
    const i = inv as Record<string, any> | null;
    if (!i) fail('bad_link', 'Ce lien n’est pas valide. Demande-en un nouveau au propriétaire.');
    if (i.used_at) fail('used', 'Ce lien a déjà servi. Connecte-toi, ou demande un nouveau lien au propriétaire.');
    if (Date.parse(i.expires_at) < Date.now()) fail('expired', 'Ce lien a expiré (7 jours). Demande-en un nouveau au propriétaire.');
    const s = await settings();
    if (action === 'invite-info') {
      return json({ ok: true, name: first(i.full_name) || i.full_name, email: i.email, roles: i.roles, kind: i.kind, lang: i.lang, garage: s.company?.name || 'Mécanique Mobile H.I.S' });
    }
    const password = String(b.password || '');
    if (password.length < 8) fail('weak', 'Le mot de passe doit avoir au moins 8 caractères.');
    // the link is used only once, even if two taps arrive together
    const { data: claimed } = await db.from('invitations').update({ used_at: new Date().toISOString() }).eq('id', i.id).is('used_at', null).select('id');
    if (!claimed || !(claimed as unknown[]).length) fail('used', 'Ce lien vient d’être utilisé.');
    try {
      let uid: string;
      if (i.kind === 'reset') {
        uid = i.user_id;
        const { error } = await db.auth.admin.updateUserById(uid, { password, ban_duration: 'none' });
        if (error) throw error;
      } else {
        const existing = await findUserByEmail(i.email);
        if (existing) {
          uid = existing.id;
          const { error } = await db.auth.admin.updateUserById(uid, { password, email_confirm: true, ban_duration: 'none' });
          if (error) throw error;
        } else {
          const { data, error } = await db.auth.admin.createUser({ email: i.email, password, email_confirm: true, user_metadata: { full_name: i.full_name } });
          if (error) throw error;
          uid = data.user!.id;
        }
        const { error: e2 } = await db.from('staff').upsert({ id: uid, full_name: i.full_name, short_name: i.short_name, email: i.email, roles: i.roles,
          rights: i.rights || {}, lang: i.lang || 'fr', active: true, deleted_at: null, created_by: i.created_by });
        if (e2) throw e2;
        // invited with his truck: he drives it from now on
        if (i.truck_id) await db.from('trucks').update({ driver_id: uid }).eq('id', i.truck_id).is('deleted_at', null);
      }
      return json({ ok: true, email: i.email });
    } catch (e) {
      await db.from('invitations').update({ used_at: null }).eq('id', i.id);   // the person can try again
      throw e;
    }
  }

  /* ---------- « Mot de passe oublié » (no account needed). The answer is the same whether or not the address has an
     account; the link goes only to the e-mail (or phone) already on the person's file, at most 3 times an hour. ---------- */
  if (action === 'forgot') {
    const email = String(b.email || '').trim().toLowerCase();
    if (EMAIL_RE.test(email)) {
      const { data: s } = await db.from('staff').select('*').eq('email', email).eq('active', true).is('deleted_at', null).maybeSingle();
      const p = s as Record<string, any> | null;
      if (p) {
        const { count } = await db.from('invitations').select('id', { count: 'exact', head: true }).eq('email', email).eq('kind', 'reset')
          .gte('created_at', new Date(Date.now() - 3600 * 1000).toISOString());
        if ((count || 0) < 3) {
          const inv = await makeInvite(p.id, { email, full_name: p.full_name, roles: p.roles, lang: p.lang, kind: 'reset', user_id: p.id });
          const link = inviteLink(baseOf(b.base), inv.token, p.lang);
          const person = { name: p.full_name, email, phone: p.phone, lang: p.lang };
          try {
            const d = await deliver('email', person, link, true);
            if ((d as { status?: string }).status !== 'sent' && p.phone) await deliver('sms', person, link, true);
          } catch { /* nothing more to do: the owner can send a link from Équipe */ }
        }
      }
    }
    return json({ ok: true });
  }

  /* ---------- signed in ---------- */
  const c = await caller(req);

  if (action === 'leave') {
    // remove my own account (never the last owner)
    if (c.access.owner) {
      const { count } = await db.from('staff').select('id', { count: 'exact', head: true }).contains('roles', ['owner']).eq('active', true).is('deleted_at', null);
      if ((count || 0) <= 1) fail('last_owner', 'Tu es le seul propriétaire : nomme un autre propriétaire avant de supprimer ton compte.');
    }
    await removePerson(c.id);
    return json({ ok: true });
  }

  owner(c);
  switch (action) {
    case 'list': {
      const { data } = await db.from('invitations').select('id, email, full_name, roles, kind, truck_id, expires_at, used_at, created_at').is('used_at', null).order('created_at', { ascending: false }).limit(50);
      const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      const seen = Object.fromEntries((users?.users || []).map((u) => [u.id, { last_sign_in_at: u.last_sign_in_at, banned: !!(u as { banned_until?: string }).banned_until }]));
      return json({ ok: true, invitations: data || [], sign_ins: seen });
    }
    case 'invite': {
      const email = String(b.email || '').trim().toLowerCase();
      const full_name = String(b.full_name || '').trim();
      const roles = cleanRoles(b.roles);
      if (!full_name) fail('name', 'Écris le nom de la personne.');
      if (!EMAIL_RE.test(email)) fail('email', 'Ce courriel n’a pas l’air bon.');
      if (!roles.length) fail('roles', 'Coche au moins un rôle.');
      const { data: already } = await db.from('staff').select('id, active, deleted_at').eq('email', email).maybeSingle();
      if (already && (already as any).active && !(already as any).deleted_at) fail('exists', 'Cette personne a déjà un compte.');
      const lang = b.lang === 'en' ? 'en' : 'fr';
      let truck_id: string | null = null;
      if (b.truck_id) {
        const { data: tr } = await db.from('trucks').select('id').eq('id', String(b.truck_id)).is('deleted_at', null).maybeSingle();
        if (!tr) fail('truck', 'Ce camion n’existe plus.');
        truck_id = (tr as { id: string }).id;
      }
      const inv = await makeInvite(c.id, { email, full_name, short_name: (b.short_name as string) || null, roles, rights: (b.rights as Record<string, boolean>) || {}, lang, kind: 'invite', truck_id });
      const link = inviteLink(baseOf(b.base), inv.token, lang);
      const d = await deliver(String(b.send || 'none'), { name: full_name, email, phone: (b.phone as string) || null, lang }, link, false);
      return json({ ok: true, id: inv.id, link, sent: d.status, channel: d.channel, error: (d as { error?: string }).error, message: d.message });
    }
    case 'reset-link': {
      const { data: s } = await db.from('staff').select('*').eq('id', String(b.staff_id || '')).maybeSingle();
      const p = s as Record<string, any> | null;
      if (!p || p.deleted_at) fail('not_found', 'Cette personne n’existe plus.');
      const inv = await makeInvite(c.id, { email: p.email, full_name: p.full_name, roles: p.roles, lang: p.lang, kind: 'reset', user_id: p.id });
      const link = inviteLink(baseOf(b.base), inv.token, p.lang);
      const d = await deliver(String(b.send || 'none'), { name: p.full_name, email: p.email, phone: p.phone, lang: p.lang }, link, true);
      return json({ ok: true, link, sent: d.status, channel: d.channel, error: (d as { error?: string }).error, message: d.message });
    }
    case 'invite-cancel': {
      const { error } = await db.from('invitations').update({ used_at: new Date().toISOString() }).eq('id', String(b.id || '')).is('used_at', null);
      if (error) throw error;
      return json({ ok: true });
    }
    case 'remove': {
      const id = String(b.staff_id || '');
      if (id === c.id) fail('self', 'Pour ton propre compte, utilise « Supprimer mon compte ».');
      await removePerson(id);
      return json({ ok: true });
    }
    case 'secrets': {
      const [gt, gl, sk, wh] = await Promise.all([secret('ghl_token'), secret('ghl_location'), secret('stripe_key'), secret('stripe_webhook_id')]);
      return json({ ok: true,
        ghl: { on: !!(gt && gl), token_end: gt ? gt.slice(-4) : null, location: gl ? gl.slice(0, 4) + '…' : null },
        stripe: { on: !!sk, test: !!sk && /_test_/.test(sk), end: sk ? sk.slice(-4) : null, webhook: !!wh } });
    }
    case 'secrets-set': {
      if ('ghl_token' in b || 'ghl_location' in b) {
        const t = b.ghl_token == null ? null : String(b.ghl_token).trim(), l = b.ghl_location == null ? null : String(b.ghl_location).trim();
        if (t === '' && l === '') await setSecrets({ ghl_token: null, ghl_location: null }, c.id);
        else {
          if (t) { if (!/^pit-[A-Za-z0-9-]{10,}$/.test(t)) fail('ghl_token', 'La clé GoHighLevel commence par « pit- ».'); await setSecret('ghl_token', t, c.id); }
          if (l) { if (!/^[A-Za-z0-9]{8,40}$/.test(l)) fail('ghl_location', 'Le numéro du compte GoHighLevel (Location ID) n’a pas l’air bon.'); await setSecret('ghl_location', l, c.id); }
        }
      }
      if ('stripe_key' in b) {
        const k = b.stripe_key == null ? '' : String(b.stripe_key).trim();
        const old = await secret('stripe_key'), oldHook = await secret('stripe_webhook_id');
        if (!k) {
          if (old && oldHook) { try { await stripeCall(old, 'DELETE', `/webhook_endpoints/${encodeURIComponent(oldHook)}`); } catch { /* already gone */ } }
          await setSecrets({ stripe_key: null, stripe_webhook_secret: null, stripe_webhook_id: null }, c.id);
        } else {
          if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(k)) fail('stripe_key', 'La clé Stripe commence par « sk_live_ » ou « rk_live_ ».');
          // the app has one database (the real one): a test payment would mark a real invoice PAID, with no way to remove it.
          // Test keys only on a test copy of the server (its secrets have stripe_test_ok = 'on'; never on live).
          if (/_test_/.test(k) && (await secret('stripe_test_ok')) !== 'on') {
            fail('stripe_key', 'Clé de test refusée : l’app n’a qu’une seule base de données, un paiement test marquerait une vraie facture payée. Mets la clé « sk_live_ ».');
          }
          // the notice "payment done" comes to the garage's own function, signed with a secret only Stripe and the garage know
          const hook = await stripeCall(k, 'POST', '/webhook_endpoints', [
            ['url', `${env('SUPABASE_URL')}/functions/v1/stripe`],
            ['enabled_events[0]', 'checkout.session.completed'],
            ['enabled_events[1]', 'checkout.session.async_payment_succeeded'],
            ['enabled_events[2]', 'charge.refunded'],
            ['description', 'Mécanique Mobile H.I.S (app V2)']
          ]);
          if (old && oldHook) { try { await stripeCall(old, 'DELETE', `/webhook_endpoints/${encodeURIComponent(oldHook)}`); } catch { /* already gone */ } }
          // the three together: never a key without its webhook secret
          await setSecrets({ stripe_key: k, stripe_webhook_secret: hook.secret, stripe_webhook_id: hook.id }, c.id);
        }
      }
      return json({ ok: true });
    }
    case 'sms-test': {
      const phone = String(b.phone || '');
      if (!e164(phone)) fail('phone', 'Écris un numéro à 10 chiffres.');
      const r = await sendSms({ first: first(c.access.full_name), phone }, b.lang === 'en' ? 'H.I.S app test: automatic texts work.' : 'Test de l’app H.I.S : les textos automatiques marchent.', 'equipe-garage');
      return json({ ok: r.status === 'sent', sent: r.status, error: r.error });
    }
    default:
      fail('action', 'Action inconnue.');
  }
});

async function removePerson(id: string) {
  const db = adminDb();
  // the day closes, the truck is free, the account is inactive (one transaction: remove_member); jobs and invoices stay
  const { data: done, error } = await db.rpc('remove_member', { p_staff: id });
  if (error) throw error;
  if (done !== true) fail('not_found', 'Cette personne n’existe plus.');
  // and can no longer sign in
  const { error: e2 } = await db.auth.admin.updateUserById(id, { ban_duration: '876000h' });
  if (e2) throw e2;
}
