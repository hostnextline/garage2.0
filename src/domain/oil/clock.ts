/* The day of today as a signal, so a list worked out from the data also changes at midnight (and when the phone wakes
   up) and not only when a row changes: the office computer left open overnight shows today's « À appeler », not
   yesterday's. Checked once a minute and when the page shows again; nothing runs outside a browser. */
import { signal } from '@preact/signals';
import { today, type Day } from '../../lib/dates';

export const currentDay = signal<Day>(today());

const check = () => { const d = today(); if (d !== currentDay.value) currentDay.value = d; };
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  setInterval(check, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
