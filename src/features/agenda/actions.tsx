/* What the right-click (computer) or the long press (phone) offers in the agenda: on an appointment « Copier » and
   « Ouvrir »; on a block, once something is copied, « Coller ici ». Only for the people who book (the booking screen
   checks the rest, as always). */
import { Copy, ClipboardPaste, ExternalLink } from 'lucide-preact';
import type { Job } from '../../data/types';
import type { BlockKey, Day } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { may } from '../../app/routes';
import { navigate } from '../../app/router';
import { toast } from '../../ui';
import { blockPhrase } from '../booking/when';
import { today as todayOf } from '../../lib/dates';
import { jobPerson } from './move';
import { copiedJob, copyJob, pasteHref } from './copy';
import { openMenu, openMenuAt, pressProps, type MenuAction } from './ContextMenu';

/** a block takes a paste when it has not started and is open (a full block: the booking screen offers « quand même ») */
export const mayPaste = (v: { started: boolean; open: boolean }) => may.book() && !!copiedJob.value && !v.started && v.open;

function jobActions(j: Job): { title: string; actions: MenuAction[] } {
  const name = jobPerson(j) || `#${j.number}`;
  const actions: MenuAction[] = [];
  if (may.book() && j.customer_id) {
    actions.push({ key: 'copy', label: t('agenda.copy.copy'), icon: <Copy size={18} aria-hidden="true" />, testid: 'menu-copy-job',
      run: () => { copyJob(j.id); toast(t('agenda.copy.copied', { name }), { kind: 'ok' }); } });
  }
  actions.push({ key: 'open', label: t('agenda.copy.open'), icon: <ExternalLink size={18} aria-hidden="true" />, run: () => navigate(`/job/${j.id}`) });
  return { title: name, actions };
}
export function jobMenu(e: MouseEvent, j: Job) {
  const m = jobActions(j);
  openMenu(e, m.actions, m.title);
}
/** the long press on an appointment (phone) */
export function jobPress(j: Job) {
  return pressProps((x, y) => { const m = jobActions(j); openMenuAt(x, y, m.actions, m.title); });
}

function pasteAction(day: Day, block: BlockKey): MenuAction {
  return { key: 'paste', label: t('agenda.copy.paste'), icon: <ClipboardPaste size={18} aria-hidden="true" />, testid: 'menu-paste',
    run: () => navigate(pasteHref(day, block).slice(1)) };
}
export function blockMenu(e: MouseEvent, day: Day, block: BlockKey, v: { started: boolean; open: boolean }) {
  if (!mayPaste(v)) return;   // nothing to offer here: the browser's own menu
  openMenu(e, [pasteAction(day, block)], blockPhrase(day, block, todayOf(), lang.value));
}
/** the long press on a block (phone): « Coller ici » once something is copied; otherwise nothing happens */
export function blockPress(day: Day, block: BlockKey, v: { started: boolean; open: boolean }) {
  return pressProps((x, y) => {
    if (!mayPaste(v)) return false;
    openMenuAt(x, y, [pasteAction(day, block)], blockPhrase(day, block, todayOf(), lang.value));
  });
}
