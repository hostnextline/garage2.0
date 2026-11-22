/* Two small helpers of the job sheet: opening something after a sheet closed, and scrolling to a piece of the sheet. */
import { whenHistorySettled } from '../../ui';

/** opens something after a closing sheet gave back its history step (else the step back would close the new one) */
export function afterSheet(fn: () => void) { setTimeout(() => whenHistorySettled(fn), 0); }

/** brings a piece of the sheet into view; at once (no glide) under « Réduire les animations » */
export function calmScroll(el: Element | null | undefined, block: ScrollLogicalPosition = 'start') {
  if (!el) return;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block });
}
