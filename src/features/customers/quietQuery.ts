/* The search typed in the list kept in the address (#/customers?q=…), so « Retour » from a file comes back to it,
   written WITHOUT moving the page: the router's setQuery scrolls to the top, which threw someone scrolling the results
   back up 600 ms after the last key. Same history entry, same route signal; only the page does not move.
   (A `setQuery(patch, { keepScroll })` in the router would replace this: asked for in the rebuild's requests.) */
import { parseHash, route } from '../../platform/router';
import { whenHistorySettled } from '../../platform/history';

export function queryWithout(path: string, query: URLSearchParams, patch: Record<string, string | null>): string {
  const sp = new URLSearchParams(query);
  for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') sp.delete(k); else sp.set(k, v); }
  const s = sp.toString();
  return '#' + path + (s ? '?' + s : '');
}

export function setQueryQuietly(patch: Record<string, string | null>) {
  whenHistorySettled(() => {
    const r = route.value;
    const target = queryWithout(r.path, r.query, patch);
    if (target === location.hash) return;
    history.replaceState(history.state, '', location.pathname + location.search + target);
    route.value = parseHash(location.hash);
  });
}
