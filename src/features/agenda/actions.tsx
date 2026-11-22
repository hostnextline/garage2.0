/* The shortcut menu of the agenda: a right-click on a computer, a long press on a phone.
   On an appointment: open it, copy it, move it; the customer (file, text, call, directions, a new car, an estimate, a
   new appointment); its invoice. On a block: paste the appointment copied, book in this block, see the day, its map.
   Each shortcut shows only to the people who may use it (the screen it opens checks again, as always). */
import { ClipboardPaste, CalendarPlus, CalendarDays, ListOrdered, Map as MapIcon } from 'lucide-preact';
import { clock, today as todayOf, type BlockKey, type Day } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { may } from '../../domain/rights';
import { navigate, href } from '../../platform/router';
import { wide } from '../../platform/media';
import { windowOf } from '../../data/select';
import { blockPhrase } from '../../domain/moment/words';
import { dayWords } from './layout';
import { copiedRow, pasteHref, bookHref } from './copy';
import { dropWindowStart } from '../../domain/moment/grid';
import { openMenu, openMenuAt, pressProps, type MenuAction } from '../../ui/ContextMenu';
import { openDayOrder } from '../../shared/jobs/DayOrderHost';
import { mayOrderDay } from '../../domain/jobs/dayOrder';

/* the shortcuts of an appointment are shared with the lists of a truck's stops (Carte, Vue d'ensemble, Aujourd'hui):
   shared/jobs/shortcuts.tsx. The agenda uses them from here, as before (« Déplacer » opens the appointment's screen). */
export { jobActions, jobMenu, jobPress } from '../../shared/jobs/shortcuts';

/** a block takes a paste when it has not started and is open (a full block: the booking screen offers « quand même »),
    while the appointment copied is still on this phone (else the booking screen would open empty) */
export const mayPaste = (v: { started: boolean; open: boolean }) => may.book() && !!copiedRow() && !v.started && v.open;

const go = (path: string) => () => navigate(path);
const icon = (I: typeof CalendarPlus) => <I size={18} aria-hidden="true" />;

/** the window that goes with a time of the grid, as the booking screen reads it (`&win=`); a day of blocks has none */
export function unitWin(block: BlockKey, minute: number): number | null {
  return block === 'day' ? dropWindowStart(minute, windowOf) : null;
}
/** the booking screen for a unit of the time grid: that day, the window that goes with that arrival time */
export function unitBookHref(day: Day, block: BlockKey, minute: number): string { return bookHref(day, block, unitWin(block, minute)); }
/** the shortcuts of a block (or of a whole day, block 'day', with « Plages d'arrivée »): paste, book here, the day,
    « Réorganiser la journée » (computer), its map.
    `at`: a unit of the time grid (minutes of the day): paste and book go with the window of that arrival time. */
export function blockActions(day: Day, block: BlockKey, v: { started: boolean; open: boolean; room?: boolean }, at: number | null = null): MenuAction[] {
  const a: MenuAction[] = [];
  const win = at == null ? null : unitWin(block, at);
  const time = at == null ? '' : clock(at, lang.value);
  if (mayPaste(v)) a.push({ key: 'paste', label: at == null ? t('agenda.copy.paste') : t('agenda.menu.pasteAt', { time }), icon: icon(ClipboardPaste), testid: 'menu-paste', run: go(pasteHref(day, block, undefined, win).slice(1)) });
  if (may.book() && v.open && !v.started) a.push({ key: 'bookHere', label: at != null ? t('agenda.menu.bookAt', { time }) : t(block === 'day' ? 'agenda.menu.bookDay' : 'agenda.menu.bookHere'), icon: icon(CalendarPlus), testid: 'menu-book-here', run: go(bookHref(day, block, win).slice(1)) });
  // on the computer's week: the day on its own; everywhere: the day's map
  if (wide.value) a.push({ key: 'day', label: t('agenda.menu.day'), icon: icon(CalendarDays), sep: a.length > 0, testid: 'menu-day', run: go(href(`/agenda/${day}`, { view: 'day' }).slice(1)) });
  // the computer's week: « Réorganiser la journée » of that day (Part 28), on the agenda itself
  if (wide.value && mayOrderDay(day)) a.push({ key: 'reorg', label: t('reorg.open'), icon: icon(ListOrdered), testid: 'menu-reorg-day', run: () => openDayOrder(day) });
  if (may.map()) a.push({ key: 'map', label: t('agenda.menu.map'), icon: icon(MapIcon), sep: a.length > 0 && !wide.value, testid: 'menu-map', run: go(href('/map', { day }).slice(1)) });
  return a;
}
/** the place in words: « Demain matin »; a whole day (« Plages d'arrivée »): « Demain », « Jeudi 19 novembre » */
export function placeWords(day: Day, block: BlockKey): string {
  return block === 'day' ? dayWords(day, todayOf(), lang.value) : blockPhrase(day, block, todayOf(), lang.value);
}
export function blockMenu(e: MouseEvent, day: Day, block: BlockKey, v: { started: boolean; open: boolean; room?: boolean }) {
  openMenu(e, blockActions(day, block, v), placeWords(day, block));   // nothing to offer: the browser's own menu
}
/** right-click on a unit of the time grid: « Coller ici », « Réserver ici » at that time, the day, its map */
export function unitMenu(e: MouseEvent, day: Day, block: BlockKey, v: { started: boolean; open: boolean; room?: boolean }, minute: number) {
  openMenu(e, blockActions(day, block, v, minute), `${placeWords(day, block)}, ${clock(minute, lang.value)}`);
}
/** the long press on a block (phone) */
export function blockPress(day: Day, block: BlockKey, v: { started: boolean; open: boolean; room?: boolean }) {
  return pressProps((x, y) => {
    const a = blockActions(day, block, v);
    if (!a.length) return false;
    openMenuAt(x, y, a, placeWords(day, block));
  });
}
