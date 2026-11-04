/* DEV ONLY — pretend answers of the « team » server function for Équipe, Réglages (Branchements) and Mon compte:
   pending invitations, links, the keys of outside services, removing someone, leaving. Registered in load() (after
   demo-rpc.ts) so they replace its basic ones. Nothing here can throw: a mistake answers { ok: false } instead. */
import { registerFn, put, find, table, nowIso } from '../fake-server';

type Obj = Record<string, unknown>;
const DAY = 86400000;
const st = { ghl: false, ghlEnd: null as string | null, ghlLoc: null as string | null, stripe: false, test: false, stripeEnd: null as string | null, invites: [] as Obj[] };
const me = () => (globalThis as { __demoUser?: string }).__demoUser || 'u-hassan';
const fail = (code: string, error: string) => ({ ok: false, code, error });
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');
const digits = (p: unknown) => String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const owners = () => table('staff').filter((s) => !s.deleted_at && s.active !== false && (s.roles as string[] | undefined)?.includes('owner'));

function deliver(how: string, phone: unknown, name: string, reset: boolean) {
  const link = `${location.origin}${location.pathname}#invite=${token()}`;
  const intro = reset ? `Bonjour ${name}, voici ton lien pour choisir un nouveau mot de passe dans l’app de Mécanique Mobile H.I.S.` : `Bonjour ${name}, tu es invité dans l’app de Mécanique Mobile H.I.S. Touche le lien pour choisir ton mot de passe.`;
  const message = { subject: reset ? 'Nouveau mot de passe — Mécanique Mobile H.I.S' : 'Ton accès à l’app de Mécanique Mobile H.I.S', text: `${intro}\n${link}`, sms: `${intro} ${link}` };
  if (how !== 'email' && how !== 'sms') return { link, sent: 'none', channel: 'none', message };
  if (!st.ghl) return { link, sent: 'off', channel: how, message };
  if (how === 'sms' && digits(phone).length !== 10) return { link, sent: 'no_phone', channel: how, message };
  return { link, sent: 'sent', channel: how, message };
}

function team(b: Obj): Obj {
  const a = String(b.action || '');
  if (a === 'leave') {
    const self = find('staff', me());
    if ((self?.roles as string[] | undefined)?.includes('owner') && owners().length <= 1) return fail('last_owner', 'Tu es le seul propriétaire : nomme un autre propriétaire avant de supprimer ton compte.');
    put('staff', { id: me(), active: false, deleted_at: nowIso() });
    return { ok: true };
  }
  if (!(find('staff', me())?.roles as string[] | undefined)?.includes('owner')) return fail('not_allowed', 'Seul le propriétaire gère l’équipe.');
  switch (a) {
    case 'list':
      return { ok: true, invitations: st.invites.filter((i) => !i.used_at),
        sign_ins: Object.fromEntries(table('staff').map((s) => [s.id, { last_sign_in_at: (s.last_seen_at as string) || null, banned: s.active === false }])) };
    case 'invite': {
      const email = String(b.email || '').trim().toLowerCase();
      const full_name = String(b.full_name || '').trim();
      const roles = Array.isArray(b.roles) ? b.roles.map(String) : [];
      if (!full_name) return fail('name', 'Écris le nom de la personne.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('email', 'Ce courriel n’a pas l’air bon.');
      if (!roles.length) return fail('roles', 'Coche au moins un rôle.');
      if (table('staff').some((s) => String(s.email || '').toLowerCase() === email && s.active !== false && !s.deleted_at)) return fail('exists', 'Cette personne a déjà un compte.');
      if (b.truck_id && !find('trucks', b.truck_id)) return fail('truck', 'Ce camion n’existe plus.');
      for (const i of st.invites) if (i.email === email) i.used_at = nowIso();
      const inv = { id: crypto.randomUUID(), email, full_name, roles, kind: 'invite', truck_id: (b.truck_id as string) || null, expires_at: iso(7 * DAY), used_at: null, created_at: nowIso() };
      st.invites.unshift(inv);
      return { ok: true, id: inv.id, ...deliver(String(b.send || 'none'), b.phone, full_name.split(' ')[0], false) };
    }
    case 'reset-link': {
      const s = find('staff', b.staff_id);
      if (!s || s.deleted_at) return fail('not_found', 'Cette personne n’existe plus.');
      return { ok: true, ...deliver(String(b.send || 'none'), s.phone, String(s.full_name).split(' ')[0], true) };
    }
    case 'invite-cancel':
      for (const i of st.invites) if (i.id === b.id) i.used_at = nowIso();
      return { ok: true };
    case 'remove': {
      const id = String(b.staff_id || '');
      if (id === me()) return fail('self', 'Pour ton propre compte, utilise « Supprimer mon compte ».');
      if (!find('staff', id)) return fail('not_found', 'Cette personne n’existe plus.');
      for (const tr of table('trucks')) if (tr.driver_id === id) put('trucks', { id: tr.id, driver_id: null });
      put('staff', { id, active: false, deleted_at: nowIso() });
      return { ok: true };
    }
    case 'secrets':
      return { ok: true, ghl: { on: st.ghl, token_end: st.ghlEnd, location: st.ghlLoc }, stripe: { on: st.stripe, test: st.test, end: st.stripeEnd, webhook: st.stripe } };
    case 'secrets-set': {
      if ('ghl_token' in b || 'ghl_location' in b) {
        const tk = b.ghl_token == null ? null : String(b.ghl_token).trim(), loc = b.ghl_location == null ? null : String(b.ghl_location).trim();
        if (tk === '' && loc === '') { st.ghl = false; st.ghlEnd = null; st.ghlLoc = null; }
        else {
          if (tk && !/^pit-[A-Za-z0-9-]{10,}$/.test(tk)) return fail('ghl_token', 'La clé GoHighLevel commence par « pit- ».');
          if (loc && !/^[A-Za-z0-9]{8,40}$/.test(loc)) return fail('ghl_location', 'Le numéro du compte GoHighLevel (Location ID) n’a pas l’air bon.');
          if (tk) st.ghlEnd = tk.slice(-4);
          if (loc) st.ghlLoc = `${loc.slice(0, 4)}…`;
          st.ghl = !!(st.ghlEnd && st.ghlLoc);
        }
      }
      if ('stripe_key' in b) {
        const k = b.stripe_key == null ? '' : String(b.stripe_key).trim();
        if (!k) { st.stripe = false; st.test = false; st.stripeEnd = null; }
        else {
          if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(k)) return fail('stripe_key', 'La clé Stripe commence par « sk_live_ », « sk_test_ » ou « rk_ ».');
          st.stripe = true; st.test = /_test_/.test(k); st.stripeEnd = k.slice(-4);
        }
      }
      return { ok: true };
    }
    case 'sms-test':
      if (digits(b.phone).length !== 10) return fail('phone', 'Écris un numéro à 10 chiffres.');
      return st.ghl ? { ok: true, sent: 'sent' } : { ok: false, sent: 'off' };
    default:
      return fail('action', 'Action inconnue.');
  }
}

export function load() {
  try {
    st.invites = [
      { id: 'inv-karim', email: 'karim@example.com', full_name: 'Karim Benali', roles: ['mechanic'], kind: 'invite', truck_id: 't-trois', expires_at: iso(6 * DAY), used_at: null, created_at: iso(-DAY) },
      { id: 'inv-lea', email: 'lea@example.com', full_name: 'Léa Gendron', roles: ['office'], kind: 'invite', truck_id: null, expires_at: iso(-2 * DAY), used_at: null, created_at: iso(-9 * DAY) }
    ];
    registerFn('team', (b) => { try { return team(b || {}); } catch (e) { return fail('server', String((e as Error)?.message || e)); } });
  } catch { /* never break another section's demo */ }
}
