/* The agenda's own width rule: the time grid (15-minute units) needs room, so it is drawn from 760 px; under that
   (phones) the day stays a list per truck. */
import { signal } from '@preact/signals';

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 760px)') : null;
/** wide enough for the time grid (≥ 760 px) */
export const roomy = signal<boolean>(!!mq?.matches);
mq?.addEventListener?.('change', (e) => { roomy.value = e.matches; });
