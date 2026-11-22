/* The shortcut menu of an appointment: a right-click on a computer, a long press on a phone. The same everywhere an
   appointment is listed with it: the agenda (features/agenda/actions.tsx re-exports it) and the lists of a truck's stops
   (Carte, Vue d'ensemble, Aujourd'hui). Open it, copy it, fix it, move it, change its truck; the customer (file, text,
   call, directions, a new car, an estimate, a new appointment); its invoice. Each shortcut shows only to the people who
   may use it (the screen it opens checks again, as always).
   `onMove`: « Déplacer » opens the move sheet on the screen itself (the lists of stops); without it (the agenda), the
   appointment's screen opens with its sheet (`?do=move`), as before. */
import { Copy, ExternalLink, CalendarClock, ReceiptText, Truck, Pencil } from 'lucide-preact';
import type { Job } from '../../data/types';
import { t } from '../../lib/i18n';
import { may } from '../../domain/rights';
import { navigate } from '../../platform/router';
import { customer as customerRow, invoiceOf, windowsOn } from '../../data/select';
import { toast } from '../../ui';
import { customerActions } from '../customers/shortcuts';
import { jobRights, mayChangeTruck, mayEditJob } from '../../domain/jobs/rights';
import { jobPerson } from '../../domain/jobs/words';
import { openMenu, openMenuAt, pressProps, type MenuAction } from '../../ui/ContextMenu';
import { copyJob } from './copy';
import { mayMove } from './moving';
import { noteMenuOpener } from './MoveHost';

export interface JobMenuOptions {
  /** « Déplacer » opens the move sheet here (a list of stops); else the appointment's screen opens with it */
  onMove?: (j: Job) => void;
}

const go = (path: string) => () => navigate(path);
const icon = (I: typeof Copy) => <I size={18} aria-hidden="true" />;

/** the shortcuts of an appointment, in groups: the appointment, its customer, the money */
export function jobActions(j: Job, o: JobMenuOptions = {}): { title: string; actions: MenuAction[] } {
  const name = jobPerson(j) || `#${j.number}`;
  const c = customerRow(j.customer_id);
  const r = jobRights(j);
  const a: MenuAction[] = [];
  const add = (x: MenuAction | false | null | undefined) => { if (x) a.push(x); };
  const group = () => { if (a.length) a[a.length] = undefined as never; };   // marks where the next group starts
  // the appointment
  add({ key: 'open', label: t('agenda.menu.open'), icon: icon(ExternalLink), run: go(`/job/${j.id}`), testid: 'menu-open' });
  add(may.book() && !!j.customer_id && { key: 'copy', label: t('agenda.menu.copy'), icon: icon(Copy), testid: 'menu-copy-job',
    // from a list of stops (no block to paste on there): the words say it is pasted in the agenda
    run: () => { copyJob(j.id); toast(t(o.onMove ? (windowsOn.value ? 'agenda.copy.copiedListDay' : 'agenda.copy.copiedList') : windowsOn.value ? 'agenda.copy.copiedDay' : 'agenda.copy.copied', { name }), { kind: 'ok' }); } });
  add(mayEditJob(j, r) && { key: 'edit', label: t('jobs.edit.menu'), icon: icon(Pencil), run: go(`/job/${j.id}?do=edit`), testid: 'menu-edit' });
  // booked, « Réserver », and no move of it still kept on the phone: no second one queued behind it (agenda-14)
  const onMove = o.onMove;
  add(mayMove(j) && { key: 'move', label: t('agenda.menu.move'), icon: icon(CalendarClock), run: onMove ? () => onMove(j) : go(`/job/${j.id}?do=move`), testid: 'menu-move' });
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
export function jobMenu(e: MouseEvent, j: Job, o: JobMenuOptions = {}) {
  const m = jobActions(j, o);
  openMenu(e, m.actions, m.title);
}
/** the long press on an appointment (phone) */
export function jobPress(j: Job, o: JobMenuOptions = {}) {
  return pressProps((x, y) => { const m = jobActions(j, o); openMenuAt(x, y, m.actions, m.title); });
}
/** what an element listing an appointment spreads to get its menu: right-click and long press (a plain tap does what it
    did). No job (a stop this phone does not hold): nothing, the browser's own menu stays. */
export function menuProps(j: Job | null | undefined, o: JobMenuOptions = {}) {
  if (!j) return {};
  // the row the menu opened from gets the focus back once the move sheet closes (computer, keyboard)
  return { onContextMenu: (e: MouseEvent) => { noteMenuOpener(e.target ?? e.currentTarget); jobMenu(e, j, o); }, ...jobPress(j, o) };
}
