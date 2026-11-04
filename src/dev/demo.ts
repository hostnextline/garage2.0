/* DEV ONLY — the demo: npm run dev, then open http://localhost:5173/?demo (owner), ?demo=mechanic (Saleh),
   ?demo=office, ?demo=treasurer. Add &l=en for English. The whole data layer runs as usual against the pretend
   server in fake-server.ts (changes made in the demo are lost when the page reloads). */
import { installFakeServer, db, find, registerRpc } from './fake-server';
import { loadDemoData, ME } from './demo-data';
import './demo-rpc';
import { sb, access, authState, session } from '../data/auth';
import { startSync, syncOptions } from '../data/sync';
import { RIGHTS, type Access, type Right, type Role } from '../data/types';

const DEFAULTS: Record<Exclude<Role, 'owner'>, Right[]> = {
  office: ['agenda', 'book', 'clients', 'invoices', 'edit_invoices', 'money', 'inventory', 'map', 'hours'],
  mechanic: ['clients', 'invoices', 'inventory', 'map'],
  treasurer: ['treasury', 'clients', 'invoices', 'money', 'inventory', 'map']
};
export function accessOf(staffId: string): Access {
  const s = find('staff', staffId) as unknown as { id: string; full_name: string; short_name: string | null; email: string | null; phone: string | null; roles: Role[]; lang: 'fr' | 'en'; prefs: Record<string, unknown>; color: string | null; rights: Partial<Record<Right, boolean>> };
  const rules = (find('settings', '1') as unknown as { role_rights: Record<string, Partial<Record<Right, boolean>>> }).role_rights || {};
  const owner = s.roles.includes('owner');
  const rights = {} as Record<Right, boolean>;
  for (const r of RIGHTS) {
    rights[r] = owner || s.roles.some((role) => role !== 'owner' && (rules[role]?.[r] ?? DEFAULTS[role as Exclude<Role, 'owner'>].includes(r)));
    if (s.rights?.[r] != null && !owner) rights[r] = !!s.rights[r];
  }
  const trucks = (db.trucks || []).filter((t) => t.driver_id === staffId && !t.deleted_at).map((t) => t.id);
  return { id: s.id, full_name: s.full_name, short_name: s.short_name, email: s.email, phone: s.phone, roles: s.roles, owner, lang: s.lang, prefs: s.prefs || {}, color: s.color, rights, trucks };
}

export async function startDemo() {
  installFakeServer();
  loadDemoData();
  const extras = import.meta.glob('./demo-extra/*.ts', { eager: true }) as Record<string, { load?: () => void }>;
  for (const m of Object.values(extras)) m.load?.();
  const who = (/[?&]demo=(\w+)/.exec(location.search)?.[1] || 'owner') as 'owner' | 'mechanic' | 'office' | 'treasurer' | 'adam';
  const id = who === 'mechanic' ? ME.saleh : who === 'adam' ? ME.adam : who === 'office' ? ME.office : who === 'treasurer' ? ME.treasurer : ME.owner;
  registerRpc('my_access', () => accessOf(id));
  registerRpc('access_of', (a) => accessOf(String(a.p_staff)));
  (globalThis as { __demoUser?: string }).__demoUser = id;
  session.value = null;
  access.value = accessOf(id);
  syncOptions.realtime = false;
  // a fresh demo every time: forget what an earlier demo left on this browser
  await new Promise((r) => { const q = indexedDB.deleteDatabase(`his-garage-demo-${id}`); q.onsuccess = q.onerror = q.onblocked = () => r(null); });
  await startSync(sb, `demo-${id}`);
  authState.value = 'ready';
  document.documentElement.dataset.demo = who;
}
