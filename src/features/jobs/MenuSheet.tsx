/* « … » of the job sheet: the shortcuts this person gets (domain/jobs/menu.ts decides which, in their order). The rows are
   built only while the sheet is open. */
import type { ComponentChildren } from 'preact';
import { Navigation, Truck, Pencil, CalendarClock, Send, Link2, Undo2, UserX, Ban, RotateCcw, Vault, ListOrdered, ChevronsUp } from 'lucide-preact';
import type { Job } from '../../data/types';
import { Sheet, Rows, RowItem, toast, jobStatusWord } from '../../ui';
import { t } from '../../lib/i18n';
import { truckLabel, invoiceOf, windowsOn, jobTotals } from '../../data/select';
import { isFinished } from '../../domain/jobs/billing';
import { jobMenu, type MenuKey } from '../../domain/jobs/menu';
import { mayChangeTruck, type JobRights } from '../../domain/jobs/rights';
import { jobName, wt } from '../../shared/jobs/select';
import { clientLinkOf } from '../../shared/jobs/links';
import { sendText, sendTracking } from '../../shared/jobs/texts';
import { doBack, doCancel, doNoShow, doReopen, backTo, drives } from '../../shared/jobs/actions';
import { copyText } from '../../shared/jobs/TextOutcome';
import { openDayOrder } from '../../shared/jobs/DayOrderHost';
import { afterSheet } from './scroll';

interface MenuSheetProps {
  job: Job; rights: JobRights; open: boolean; onClose: () => void;
  onMove: () => void; onOrder: () => void; onCoffre?: () => void; onTruck?: () => void; onEdit?: () => void;
}
export function MenuSheet(p: MenuSheetProps) {
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('jobs.menu.title')} sub={jobName(p.job)} data-testid="job-menu-sheet">
      <MenuRows {...p} />
    </Sheet>
  );
}
const icon = (i: ComponentChildren) => <span class="quick-icon">{i}</span>;
function MenuRows(p: MenuSheetProps) {
  const { job: j, rights } = p;
  const link = clientLinkOf(j);
  const inv = invoiceOf(j.id);
  const keys = jobMenu(j, rights, {
    edit: !!p.onEdit, link: !!link, truck: !!p.onTruck && mayChangeTruck(j, rights), coffre: !!p.onCoffre,
    invoiceDone: isFinished(inv), invoicePaid: inv?.status === 'paid', arrivalText: !j.coffre_id && jobTotals(j.id).total > 0
  });
  // a row that opens something closes the menu first, then opens it once the menu's history step is given back
  const then = (fn: () => unknown) => () => { p.onClose(); afterSheet(() => { void fn(); }); };
  const back = backTo(j.status);
  const row: Record<MenuKey, () => ComponentChildren> = {
    edit: () => <RowItem key="e" start={icon(<Pencil size={20} />)} title={t('jobs.edit.menu')} sub={t('jobs.edit.menuSub')} onClick={then(p.onEdit!)} data-testid="menu-edit" />,
    resend: () => <RowItem key="b" start={icon(<Send size={20} />)} title={t('jobs.menu.resendBooking')} sub={wt(j, 'jobs.menu.resendBookingSub')} onClick={then(() => sendText('booking', j, { resend: true }))} data-testid="menu-resend" />,
    tracking: () => <RowItem key="t" start={icon(<Navigation size={20} />)} title={t('jobs.menu.sendTracking')} sub={t('jobs.menu.sendTrackingSub')} onClick={then(() => sendTracking(j, { resend: true, driving: drives(j, rights) }))} />,
    arrived: () => <RowItem key="a" start={icon(<Send size={20} />)} title={t('jobs.menu.sendArrived')} sub={t('jobs.menu.sendArrivedSub')} onClick={then(() => sendText('arrived', j, { resend: true, okText: t('jobs.did.arriveInvoice', { name: jobName(j) }) }))} data-testid="menu-send-arrived" />,
    link: () => <RowItem key="l" start={icon(<Link2 size={20} />)} title={t('jobs.menu.copyLink')} sub={t('jobs.menu.copyLinkSub')}
      onClick={async () => { const ok = await copyText(link!); toast(ok ? t('jobs.text.linkCopied') : t('jobs.text.copyFail'), { kind: ok ? 'ok' : 'bad' }); if (ok) p.onClose(); }} data-testid="menu-link" />,
    // « Mettre en premier » opens « Réorganiser la journée » with this stop already first (in the draft, not saved: Part 28)
    first: () => <RowItem key="f" start={icon(<ChevronsUp size={20} />)} title={t('jobs.order.firstMenu')} sub={wt(j, 'jobs.order.firstMenuSub')} onClick={then(() => openDayOrder(j.day, { truck: j.truck_id, job: j.id, first: true }))} data-testid="menu-first" />,
    order: () => <RowItem key="o" start={icon(<ListOrdered size={20} />)} title={t('reorg.open')} sub={t('reorg.openSub')} onClick={then(p.onOrder)} data-testid="menu-order" />,
    move: () => <RowItem key="m" start={icon(<CalendarClock size={20} />)} title={t('jobs.menu.move')} sub={wt({ block: windowsOn.value ? 'day' : 'am' }, 'jobs.menu.moveSub')} onClick={then(p.onMove)} />,
    truck: () => <RowItem key="tk" start={icon(<Truck size={20} />)} title={t('jobs.truck.menu')} sub={wt(j, 'jobs.truck.menuSub', { truck: truckLabel(j.truck_id) || t('jobs.truck.noneYet') })} onClick={then(p.onTruck!)} data-testid="menu-truck" />,
    back: () => <RowItem key="u" start={icon(<Undo2 size={20} />)} title={t('jobs.menu.back')} sub={t('jobs.menu.backSub', { status: jobStatusWord(back!) })} onClick={then(() => doBack(j))} data-testid="menu-back" />,
    noshow: () => <RowItem key="n" class="jobs-danger" start={icon(<UserX size={20} />)} title={t('jobs.menu.noShow')} sub={t('jobs.menu.noShowSub')} onClick={then(() => doNoShow(j))} data-testid="menu-noshow" />,
    cancel: () => <RowItem key="c" class="jobs-danger" start={icon(<Ban size={20} />)} title={t('jobs.menu.cancel')} sub={wt(j, 'jobs.menu.cancelSub')} onClick={then(() => doCancel(j))} data-testid="menu-cancel" />,
    coffre: () => <RowItem key="k" start={icon(<Vault size={20} />)} title={t('coffre.job.menu')} sub={t('coffre.job.menuSub')} onClick={then(p.onCoffre!)} data-testid="menu-coffre" />,
    reopen: () => <RowItem key="r" start={icon(<RotateCcw size={20} />)} title={t('jobs.menu.reopen')} sub={wt(j, 'jobs.menu.reopenSub')} onClick={then(() => doReopen(j))} data-testid="menu-reopen" />
  };
  return keys.length ? <Rows>{keys.map((k) => row[k]())}</Rows> : <p class="muted">{t('jobs.menu.nothing')}</p>;
}
