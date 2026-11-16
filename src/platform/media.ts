/* The width of the screen, for the few things that change between phone and computer (week vs day…).
   Layout itself is done in CSS. */
import { signal } from '@preact/signals';

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 960px)') : null;
/** a computer or a large tablet (≥ 960 px) */
export const wide = signal<boolean>(!!mq?.matches);
mq?.addEventListener?.('change', (e) => { wide.value = e.matches; });

const coarse = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
/** a finger rather than a mouse */
export const touch = signal<boolean>(!!coarse?.matches);
coarse?.addEventListener?.('change', (e) => { touch.value = e.matches; });
