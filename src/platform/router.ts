/* Screens are addressed by the part after « # »: #/agenda/2026-11-04, #/job/<id>, #/book?customer=<id>.
   Links are plain <a href="#/…">; code calls navigate('/…'). Retour goes back in the app's own history when there
   is some, else to the screen given as fallback.
   - A new screen starts at the top; a change of the query only (a tab, a filter, a search) never moves the page.
   - Going to another screen closes the open sheets first and removes their history steps (platform/history), so
     « Retour » never meets a dead step.
   - setQuery replaces the entry and keeps the open sheets' steps in it. */
import { signal } from '@preact/signals';
import { whenHistorySettled, closeLayersForNavigation, stackOf } from './history';

export interface Route { path: string; parts: string[]; query: URLSearchParams }
export interface ScreenProps { params: Record<string, string>; query: URLSearchParams }
export type QueryPatch = Record<string, string | number | null | undefined | false>;

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
export function href(path: string, query?: QueryPatch): string {
  let q = '';
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v != null && v !== false && v !== '') sp.set(k, String(v));
    const s = sp.toString();
    if (s) q = '?' + s;
  }
  return '#' + (path.startsWith('/') ? path : '/' + path) + q;
}

const toHash = (to: string) => (to.startsWith('#') ? to : '#' + (to.startsWith('/') ? to : '/' + to));

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  whenHistorySettled(() => {
    const target = toHash(to);
    const url = location.pathname + location.search + target;
    const samePath = parseHash(target).path === route.value.path;
    // another screen: the sheets open on this one close first, and their steps go (else « Retour » meets them)
    if ((!opts.replace || !samePath) && closeLayersForNavigation() > 0) { whenHistorySettled(() => navigate(to, opts)); return; }
    if (opts.replace) {
      // the same screen (a tab, a filter): the open sheets keep their steps, the page does not move
      const sheets = stackOf(history.state);
      history.replaceState(sheets.length ? { d: depthOf(), sheets } : { d: depthOf() }, '', url);
      sync();
      if (!samePath) window.scrollTo({ top: 0 });
      return;
    }
    if (target === location.hash) { sync(); return; }
    history.pushState({ d: depthOf() + 1 }, '', url);
    sync();
    if (!samePath) window.scrollTo({ top: 0 });
  });
}
/** « Retour »: one step back in the app, or the fallback screen when the app was opened right here */
export function goBack(fallback = '/') {
  whenHistorySettled(() => {
    if (depthOf() > 0) history.back();
    else navigate(fallback, { replace: true });
  });
}
/** the query of the current screen with `patch` applied ('' / null / false remove a key) */
export function patchQuery(query: URLSearchParams, patch: QueryPatch): string {
  const sp = new URLSearchParams(query);
  for (const [k, v] of Object.entries(patch)) { if (v == null || v === false || v === '') sp.delete(k); else sp.set(k, String(v)); }
  return sp.toString();
}
/** change the query of the current screen without a new history step (filters, tabs, the day shown): never scrolls */
export function setQuery(patch: QueryPatch) {
  const r = route.value;
  const s = patchQuery(r.query, patch);
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
