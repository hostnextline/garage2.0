/* The shortcut menu of the agenda: a right-click on a computer, a long press on a phone.
   On an appointment: open it, copy it, move it; the customer (file, text, call, directions, a new car, an estimate, a
   new appointment); its invoice. On a block: paste the appointment copied, book in this block, see the day, its map.
   Each shortcut shows only to the people who may use it (the screen it opens checks again, as always). */
import { Copy, ClipboardPaste, ExternalLink, CalendarPlus, CalendarClock, ReceiptText, CalendarDays, Map as MapIcon, Truck, Pencil } from 'lucide-preact';
import type { Job } from '../../data/types';
import type { BlockKey, Day } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { may } from '../../app/routes';
import { navigate, href } from '../../app/router';
import { wide } from '../../app/media';
import { customer as customerRow, invoiceOf } from '../../data/select';
import { toast } from '../../ui';
import { blockPhrase } from '../booking/when';
import { today as todayOf } from '../../lib/dates';
import { customerActions } from '../customers/shortcuts';
import { jobRights } from '../jobs/select';
import { mayChangeTruck } from '../jobs/JobParts';
import { mayEditJob } from '../jobs/JobEdit';
import { jobPerson } from './move';
import { copiedJob, copyJob, pasteHref } from './copy';
import { openMenu, openMenuAt, pressProps, type MenuAction } from './ContextMenu';

/** a block takes a paste when it has not started and is open (a full block: the booking screen offers « quand même ») */
export const mayPaste = (v: { started: boolean; open: boolean }) => may.book() && !!copiedJob.value && !v.started && v.open;

const go = (path: string) => () => navigate(path);
const icon = (I: typeof Copy) => <I size={18} aria-hidden="true" />;

/** the shortcuts of an appointment, in groups: the appointment, its customer, the money */
export function jobActions(j: Job): { title: string; actions: MenuAction[] } {
  const name = jobPerson(j) || `#${j.number}`;
  const c = customerRow(j.customer_id);
  const r = jobRights(j);
  const a: MenuAction[] = [];
  const add = (x: MenuAction | false | null | undefined) => { if (x) a.push(x); };
  const group = () => { if (a.length) a[a.length] = undefined as never; };   // marks where the next group starts
  // the appointment
  add({ key: 'open', label: t('agenda.menu.open'), icon: icon(ExternalLink), run: go(`/job/${j.id}`), testid: 'menu-open' });
  add(may.book() && !!j.customer_id && { key: 'copy', label: t('agenda.menu.copy'), icon: icon(Copy), testid: 'menu-copy-job',
    run: () => { copyJob(j.id); toast(t('agenda.copy.copied', { name }), { kind: 'ok' }); } });
  add(mayEditJob(j, r) && { key: 'edit', label: t('jobs.edit.menu'), icon: icon(Pencil), run: go(`/job/${j.id}?do=edit`), testid: 'menu-edit' });
  add(j.status === 'booked' && r.move && { key: 'move', label: t('agenda.menu.move'), icon: icon(CalendarClock), run: go(`/job/${j.id}?do=move`), testid: 'menu-move' });
  add(mayChangeTruck(j, r) && { key: 'truck', label: t('jobs.truck.menu'), icon: icon(Truck), run: go(`/job/${j.id}?do=truck`), testid: 'menu-truck' });
  // the customer (the same shortcuts as in the list of customers; directions to the appointment's own address)
  if (c) {
    group();
    for (const x of customerActions(c, { place: j.address ? { address: j.address, unit: j.unit, postal_code: j.postal_code, lat: j.lat, lng: j.lng } : undefined })) add(x);
  }
  // the money
  const inv = invoiceOf(j.id);
  if (inv && inv.status !== 'void' && may.invoices()) {
    group();
    add({ key: 'invoice', label: t('agenda.menu.invoice'), icon: icon(ReceiptText), run: go(`/invoice/${inv.id}`), testid: 'menu-invoice' });
  }
  // the groups: a thin line above the first shortcut of each
  const out: MenuAction[] = [];
  let sep = false;
  for (const x of a) { if (!x) { sep = true; continue; } out.push(sep ? { ...x, sep: true } : x); sep = false; }
  return { title: name, actions: out };
}
export function jobMenu(e: MouseEvent, j: Job) {
  const m = jobActions(j);
  openMenu(e, m.actions, m.title);
}
/** the long press on an appointment (phone) */
export function jobPress(j: Job) {
  return pressProps((x, y) => { const m = jobActions(j); openMenuAt(x, y, m.actions, m.title); });
}

/** the shortcuts of a block: paste, book here, the day, its map */
export function blockActions(day: Day, block: BlockKey, v: { started: boolean; open: boolean; room?: boolean }): MenuAction[] {
  const a: MenuAction[] = [];
  if (mayPaste(v)) a.push({ key: 'paste', label: t('agenda.copy.paste'), icon: icon(ClipboardPaste), testid: 'menu-paste', run: go(pasteHref(day, block).slice(1)) });
  if (may.book() && v.open && !v.started) a.push({ key: 'bookHere', label: t('agenda.menu.bookHere'), icon: icon(CalendarPlus), testid: 'menu-book-here', run: go(href('/book', { day, block }).slice(1)) });
  // on the computer's week: the day on its own; everywhere: the day's map
  if (wide.value) a.push({ key: 'day', label: t('agenda.menu.day'), icon: icon(CalendarDays), sep: a.length > 0, testid: 'menu-day', run: go(href(`/agenda/${day}`, { view: 'day' }).slice(1)) });
  if (may.map()) a.push({ key: 'map', label: t('agenda.menu.map'), icon: icon(MapIcon), sep: a.length > 0 && !wide.value, testid: 'menu-map', run: go(href('/map', { day }).slice(1)) });
  return a;
}
export function blockMenu(e: MouseEvent, day: Day, block: BlockKey, v: { started: boolean; open: boolean; room?: boolean }) {
  openMenu(e, blockActions(day, block, v), blockPhrase(day, block, todayOf(), lang.value));   // nothing to offer: the browser's own menu
}
/** the long press on a block (phone) */
export function blockPress(day: Day, block: BlockKey, v: { started: boolean; open: boolean; room?: boolean }) {
  return pressProps((x, y) => {
    const a = blockActions(day, block, v);
    if (!a.length) return false;
    openMenuAt(x, y, a, blockPhrase(day, block, todayOf(), lang.value));
  });
}
