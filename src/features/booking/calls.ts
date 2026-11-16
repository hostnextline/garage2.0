/* « Appel entrant »: the pure rules of the call screen and of the banner of a ringing call (calls.test.ts). */
import { phoneDigits } from '../../lib/text';
import { t, type Lang } from '../../lib/i18n';
import { windowWords } from '../../domain/moment/words';
import type { Customer, Job } from '../../data/types';
import type { IncomingCall } from '../../services/bubbles';
import { searchList, type SearchDoc } from '../../shared/customers/search';

/** what a new caller talks about first: the booking screen opens its panels in that order */
export type CallStart = 'address' | 'car' | 'job';
export const CALL_STARTS: CallStart[] = ['address', 'car', 'job'];
/** the booking screen for a new caller, starting with what they talk about first */
export const callHref = (start: CallStart, phone: string, name = ''): string =>
  `#/book?call=1&start=${start}${phone.trim() ? `&phone=${encodeURIComponent(phone.trim())}` : ''}${name.trim() ? `&name=${encodeURIComponent(name.trim())}` : ''}`;

/** the customers whose number has these digits (3 at least), the best first, 5 at most */
export function callMatches(all: Customer[], typed: string, docOf: (c: Customer) => SearchDoc | undefined): Customer[] {
  const d = phoneDigits(typed) || typed.replace(/\D/g, '');
  return d.length >= 3 ? searchList(all, d, docOf).slice(0, 5) : [];
}

/** the moment of a coming appointment in words: its block, or booked by window its window, or flexible */
export function nextWhen(j: Pick<Job, 'block' | 'win_start' | 'win_end' | 'win_flex'>, l: Lang): string {
  if (j.block === 'day' && j.win_start != null && j.win_end != null) return windowWords([j.win_start, j.win_end], l);
  if (j.block === 'day' && j.win_flex) return windowWords(null, l);
  return t(`common.blocks.${j.block}`, undefined, l).toLowerCase();
}

/** a ringing call stays on screen this long */
export const CALL_SHOWN_MS = 3 * 60 * 1000;
/** the newest call still worth showing (not closed by the person, not too old) */
export function callToShow(list: IncomingCall[], closed: Set<string>, now: number): IncomingCall | null {
  return list.filter((c) => !closed.has(c.id) && now - Date.parse(c.at) < CALL_SHOWN_MS).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
}
