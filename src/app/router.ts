/* Screens are addressed by the part after « # »: #/agenda/2026-11-04, #/job/<id>, #/book?customer=<id>.
   Links are plain <a href="#/…">; code calls navigate('/…'). Retour goes back in the app's own history when there
   is some, else to the screen given as fallback. */
import { signal } from '@preact/signals';
import { whenHistorySettled } from '../ui/Sheet';

export interface Route { path: string; parts: string[]; query: URLSearchParams }

export function parseHash(hash: string): Route {
  let h = String(hash || '').replace(/^#/, '');
  // links from texts and e-mails: #invite=…, #t=…  are not screens
  if (!h.startsWith('/')) h = '/';
  const [path, qs = ''] = h.split('?');
  const clean = ('/' + path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } }).join('/')).replace(/\/+$/, '') || '/';
  return { path: clean, parts: clean.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

export const route = signal<Route>(parseHash(typeof location !== 'undefined' ? location.hash : ''));
const depthOf = (): number => Number((history.state as { d?: number } | null)?.d || 0);

function sync() {
  const next = parseHash(location.hash);
  const cur = route.value;
  if (next.path !== cur.path || next.query.toString() !== cur.query.toString()) route.value = next;
}
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', sync);
  window.addEventListener('popstate', sync);
}

/** '#/job/abc' for an href */
export function href(path: string, query?: Record<string, string | number | null | undefined | false>): string {
  let q = '';
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v != null && v !== false && v !== '') sp.set(k, String(v));
    const s = sp.toString();
    if (s) q = '?' + s;
  }
  return '#' + (path.startsWith('/') ? path : '/' + path) + q;
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  whenHistorySettled(() => {
    const target = to.startsWith('#') ? to : '#' + (to.startsWith('/') ? to : '/' + to);
    if (target === location.hash && !opts.replace) { sync(); return; }
    const url = location.pathname + location.search + target;
    if (opts.replace) history.replaceState({ d: depthOf() }, '', url);
    else history.pushState({ d: depthOf() + 1 }, '', url);
    sync();
    window.scrollTo({ top: 0 });
  });
}
/** « Retour »: one step back in the app, or the fallback screen when the app was opened right here */
export function goBack(fallback = '/') {
  whenHistorySettled(() => {
    if (depthOf() > 0) history.back();
    else navigate(fallback, { replace: true });
  });
}
/** change the query of the current screen without a new history step (filters, tabs, the day shown) */
export function setQuery(patch: Record<string, string | number | null | undefined | false>) {
  const r = route.value;
  const sp = new URLSearchParams(r.query);
  for (const [k, v] of Object.entries(patch)) { if (v == null || v === false || v === '') sp.delete(k); else sp.set(k, String(v)); }
  const s = sp.toString();
  navigate(r.path + (s ? '?' + s : ''), { replace: true });
}

/** '/job/:id' against '/job/abc' → { id: 'abc' } ; null when it doesn't match */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean), b = path.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i];
    const opt = seg.endsWith('?');
    const name = seg.replace(/^:/, '').replace(/\?$/, '');
    if (b[i] == null) { if (opt) continue; return null; }
    if (seg.startsWith(':')) params[name] = b[i];
    else if (seg !== b[i]) return null;
  }
  if (b.length > a.length) return null;
  return params;
}
