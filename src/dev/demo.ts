/* DEV ONLY — the demo: npm run dev, then open http://localhost:5173/?demo (owner), ?demo=mechanic (Saleh),
   ?demo=adam, ?demo=office, ?demo=treasurer. &fenetres=1 for « Plages d'arrivée » already switched on (demo-windows.ts);
   the language is the browser's (Réglages → Langue). The whole data layer runs as usual against the pretend server in
   fake-server.ts (changes made in the demo are lost when the page reloads); the person on screen reads only the rows
   and does only what the database would let them (demo-rules.ts). */
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { installFakeServer, db, registerRpc, resetOps } from './fake-server';
import { loadDemoData, ME } from './demo-data';
import './demo-rpc';
import { installWindows } from './demo-windows';
import { can, isOwner, myTruckIds } from './demo-rules';
import { find } from './fake-server';
import { sb, access, authState, session } from '../data/auth';
import { startSync, syncOptions } from '../data/sync';
import { RIGHTS, type Access, type Right, type Role } from '../data/types';

const extras = import.meta.glob('./demo-extra/*.ts', { eager: true }) as Record<string, { load?: () => void }>;

/** what my_access answers for this person: the rights by the database's rule (right_of), the vehicles they drive */
export function accessOf(staffId: string): Access {
  const s = find('staff', staffId) as unknown as { id: string; full_name: string; short_name: string | null; email: string | null; phone: string | null; roles: Role[]; lang: 'fr' | 'en'; prefs: Record<string, unknown>; color: string | null };
  const owner = s.roles.includes('owner');
  const rights = {} as Record<Right, boolean>;
  for (const r of RIGHTS) rights[r] = can(r, staffId);
  const trucks = myTruckIds(staffId);
  const pretend = (globalThis as { __demoServices?: { card?: boolean; texts?: boolean } }).__demoServices || {};
  return { id: s.id, full_name: s.full_name, short_name: s.short_name, email: s.email, phone: s.phone, roles: s.roles, owner, lang: s.lang, prefs: s.prefs || {}, color: s.color, rights, trucks, card_online: pretend.card ?? false, texts_online: pretend.texts ?? false };
}

export type DemoWho = 'owner' | 'mechanic' | 'office' | 'treasurer' | 'adam';
/** ?demo=… → who is on screen (any other value: the owner, as before) */
export function demoWho(search: string): { who: DemoWho; id: string } {
  const who = (/[?&]demo=(\w+)/.exec(search)?.[1] || 'owner') as DemoWho;
  const id = who === 'mechanic' ? ME.saleh : who === 'adam' ? ME.adam : who === 'office' ? ME.office : who === 'treasurer' ? ME.treasurer : ME.owner;
  return { who, id };
}

/** the pretend garage in memory, for this person: the seed, every section's extras, the window mode, my_access */
export function loadDemo(id: string) {
  for (const k of Object.keys(db)) delete db[k];
  resetOps();
  (globalThis as { __demoUser?: string }).__demoUser = id;
  loadDemoData();
  for (const m of Object.values(extras)) m.load?.();
  // « Plages d'arrivée »: wraps the booking operations registered above (the block demo is unchanged while the mode is off)
  try { installWindows(); } catch (e) { console.warn('demo: fenêtres', e); }
  registerRpc('my_access', () => accessOf(id));
  // « Voir l'app comme… »: the owner only, like the database
  registerRpc('access_of', (a) => (isOwner() && find('staff', a.p_staff) ? accessOf(String(a.p_staff)) : null));
}

/* Nothing of the demo leaves for the real server (demo-03): every request to its address is answered in memory, the
   session kept on this browser is not renewed (and not lost) meanwhile, and no live socket opens (the screens that
   listen for calls and texts ask the pretend tables instead, as they do without realtime).
   The person on screen is the demo's, never the session kept on this browser: asking for the session answers « none »
   at once, without reading or touching his.auth (demo-r2-1). Before, an expired session kept there was renewed against
   the pretend server, whose « try later » supabase-js asks again for about 25 s: every request of the demo (the
   database's, « Je pars », texts, Branchements, VIN) waited behind it. Renewing answers « no session », which the
   engine reads as « wait » and supabase-js does not take as a sign-out. */
export function sealDemo() {
  try { void sb.auth.stopAutoRefresh(); } catch { /* nothing to stop */ }
  sb.auth.getSession = async () => ({ data: { session: null }, error: null });
  sb.auth.refreshSession = async () => ({ data: { user: null, session: null }, error: new AuthSessionMissingError() });
  try { sb.realtime.connect = () => undefined; } catch { /* no realtime client */ }
}

export async function startDemo() {
  installFakeServer();
  sealDemo();
  const { who, id } = demoWho(location.search);
  loadDemo(id);
  session.value = null;
  access.value = accessOf(id);
  syncOptions.realtime = false;
  // a fresh demo every time: forget what an earlier demo left on this browser
  await new Promise((r) => { const q = indexedDB.deleteDatabase(`his-garage-demo-${id}`); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
  await startSync(sb, `demo-${id}`);
  authState.value = 'ready';
  document.documentElement.dataset.demo = who;
}
