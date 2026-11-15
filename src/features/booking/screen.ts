/* The booking screen's own width rule: with « Plages d'arrivée » the time calendar sits beside the form only when
   there is room for both (≥ 1200 px); under that it takes the whole width, under the form. */
import { signal } from '@preact/signals';

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1200px)') : null;
/** wide enough for the form and the time calendar side by side */
export const broad = signal<boolean>(!!mq?.matches);
mq?.addEventListener?.('change', (e) => { broad.value = e.matches; });
