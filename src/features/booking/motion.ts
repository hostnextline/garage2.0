/* Scrolling done by the booking screen (to the moment refused, to the field to fix): smooth, unless the phone asks
   for less motion. */
export function calmScroll(el: Element | null | undefined): void {
  if (!el || typeof el.scrollIntoView !== 'function') return;
  const still = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
}
