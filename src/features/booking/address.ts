/* The address bar of the booking screen, read once (address.test.ts):
   #/book?customer=ID[&vehicle=ID] · ?day=YYYY-MM-DD&block=am|pm|eve (« Réserver dans ce bloc ») · ?quote=ID (an
   estimate becomes a job) · ?walkin=1 (the job starts now) · ?copy=JOB (« Coller » in the agenda)
   · ?call=1&start=address|car|job&phone=…&name=… (« Appel entrant », somebody new).
   « Plages d'arrivée »: ?day=…&block=day opens that day in the picker (&win=840 or &flex=1: already chosen). */
import { parseChoice } from '../../domain/moment/logic';
import type { BlockChoice } from '../../domain/moment/choice';
import type { CallStart } from './calls';
import type { Caller } from './draft';

export interface BookAddress {
  walkIn: boolean; quoteId: string | null; customerId: string | null; vehicleId: string | null; copyId: string | null;
  call: boolean; start: CallStart; caller: Caller;
  day: string | null; block: string | null; win: string | null; flex: string | null;
}
export function readAddress(q: URLSearchParams): BookAddress {
  const start = q.get('start');
  return {
    walkIn: q.get('walkin') === '1', quoteId: q.get('quote'), customerId: q.get('customer'), vehicleId: q.get('vehicle'), copyId: q.get('copy'),
    call: q.get('call') === '1', start: start === 'car' || start === 'job' ? start : 'address', caller: callerOf(q.get('name'), q.get('phone')),
    day: q.get('day'), block: q.get('block'), win: q.get('win'), flex: q.get('flex')
  };
}
/** the name GoHighLevel knows for this number (the « Appel entrant » banner): the first word is the first name */
export function callerOf(name: string | null, phone: string | null): Caller {
  const n = (name || '').trim().split(/\s+/).filter(Boolean);
  return { first: n[0] || '', last: n.slice(1).join(' '), phone: phone || '' };
}

/** the moment the address says: a block, unless it has started meanwhile; with « Plages d'arrivée » a day and its
    window (&win=) or « flexible ». A day alone, and a copy (its window is decided once the copied job is read), open in
    the picker without a choice. */
export function barChoice(a: BookAddress, o: { windows: boolean; len: number; today: string; started: (day: string, block: 'am' | 'pm' | 'eve') => boolean }): BlockChoice | null {
  const c = a.walkIn ? null : parseChoice(a.day, a.block, { windows: o.windows, win: a.win, flex: a.flex, len: o.len });
  if (!c) return null;
  if (c.block === 'day') return c.day >= o.today && (c.win_start != null || c.win_flex) && !a.copyId ? c : null;
  return o.started(c.day, c.block) ? null : c;
}
/** « Plages d'arrivée »: the day the address says, opened in the picker */
export function openDayOf(a: BookAddress, windows: boolean): string | null {
  return windows && !a.walkIn ? parseChoice(a.day, a.block, { windows: true })?.day ?? null : null;
}
/** where « Retour » goes when there is no history */
export function backOf(a: BookAddress, quoteId: string | null): string {
  return quoteId ? `/quote/${quoteId}` : a.customerId ? `/customer/${a.customerId}` : a.walkIn ? '/' : a.call ? '/call' : '/agenda';
}
