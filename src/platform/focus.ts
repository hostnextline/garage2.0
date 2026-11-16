/* The frame draws the screen again when the address changes (another day, another truck): the button that was
   pressed is a new element. Keyboard and screen reader users keep their place: the screen focuses it again. */
let pending: string | null = null;
/** a CSS selector to focus once the next screen is drawn */
export function focusAfterNav(selector: string) { pending = selector; }
export function restoreFocus() {
  if (!pending) return;
  const sel = pending;
  pending = null;
  requestAnimationFrame(() => {
    try { document.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true }); } catch { /* a selector that no longer matches */ }
  });
}
