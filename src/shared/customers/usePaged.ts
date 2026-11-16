/* A long list drawn 60 rows at a time: more rows when the end of the list comes within 600 px (or with « Voir plus »).
   How far a list was grown is remembered in memory per list (its key says which list and which search), so « Retour »
   from a row far down comes back to the same rows and the browser can put the scroll back where it was. */
import { useEffect, useRef, useState } from 'preact/hooks';

export const PAGE = 60;
const kept = new Map<string, number>();
const KEEP_LISTS = 20;

function remember(key: string, n: number) {
  kept.delete(key);
  kept.set(key, n);
  // only the last lists matter: the oldest one is forgotten first
  while (kept.size > KEEP_LISTS) kept.delete(kept.keys().next().value as string);
}

export function usePaged(key: string, total: number, page = PAGE) {
  const [state, setState] = useState(() => ({ key, limit: kept.get(key) || page }));
  // another search or order: its own count (the first page when it was never grown)
  const limit = state.key === key ? state.limit : kept.get(key) || page;
  const more = () => setState((s) => {
    const n = (s.key === key ? s.limit : kept.get(key) || page) + page;
    remember(key, n);
    return { key, limit: n };
  });
  const hasMore = total > limit;
  const sentinel = useRef<HTMLDivElement>(null);
  const moreRef = useRef(more);
  moreRef.current = more;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) moreRef.current(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, key]);
  return { limit, hasMore, more, sentinel, left: Math.max(0, total - limit) };
}
