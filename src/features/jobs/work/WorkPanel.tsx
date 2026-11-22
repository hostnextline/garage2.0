/* « Le travail »: what is planned, done, proposed on site and the customer's answers, with the job's total.
   - A planned line becomes « Fait » with one tap; any line opens a short sheet (fait, pas fait, remettre…).
   - « Modifier le travail »: every line gets « Changer » and « Retirer »; « Ajouter du travail » next to it.
   - « Proposer un travail »: a line written on the spot, then the customer's answer.
   - Work on no line of the finished invoice (whenever it came: the server refuses « Terminé » for it) is said here, like on
     the red button. */
import { useState } from 'preact/hooks';
import { Check, Plus, PenLine, Hourglass, CircleCheck, Circle, X, Minus, Pencil, Trash2 } from 'lucide-preact';
import type { Job, JobItem, ItemStatus } from '../../../data/types';
import { Panel, Button, IconButton, Money, Totals, Banner, attempt, toast } from '../../../ui';
import { t, lang } from '../../../lib/i18n';
import { money } from '../../../lib/money';
import { itemsOf, jobTotals, settings, invoiceOf } from '../../../data/select';
import { updateItem, removeItem } from '../../../data/api';
import { upsertLocal } from '../../../data/store';
import { isBilled, isFinished, isOpen, lineCents, unbilledWork } from '../../../domain/jobs/billing';
import { withAnswer } from '../../../domain/jobs/pending';
import { mayRemove, removal, mayAnswer } from '../../../domain/jobs/work';
import type { JobRights } from '../../../domain/jobs/rights';
import { pendingJobs } from '../../../shared/jobs/pending';
import { itemStatusText, qtyText } from './words';

function StatusIcon(p: { s: ItemStatus }) {
  const Icon = p.s === 'done' || p.s === 'approved' ? CircleCheck : p.s === 'proposed' ? Hourglass : p.s === 'declined' ? X : p.s === 'removed' ? Minus : Circle;
  return <span class={`jobs-item-icon is-${p.s}`} aria-hidden="true"><Icon size={18} /></span>;
}

/** takes a line off: on site it stays as « Pas fait »; before, it leaves the job, and the toast can put it back (one tap of
    a gloved finger on the trash must not lose a price, a quantity and a note for good) */
export async function takeOff(j: Job, i: JobItem): Promise<boolean> {
  if (removal(j.status, i) === 'not_done') return attempt(() => updateItem(i.id, { status: 'removed' }), { ok: t('jobs.work.removedLine', { what: i.description }) });
  const ok = await attempt(() => removeItem(i.id));
  // « Annuler »: the line comes back on screen at once (with its price, quantity and note) and on the server when it is sent
  const putBack = () => attempt(() => { upsertLocal('job_items', [{ ...i, deleted_at: null }], { force: true }); return updateItem(i.id, { deleted_at: null }); });
  if (ok) toast(t('jobs.work.removedLine', { what: i.description }), { kind: 'ok', action: { label: t('common.cancel'), run: putBack } });
  return ok;
}

export interface WorkPanelProps {
  job: Job; rights: JobRights;
  onItem: (id: string) => void; onAnswer: (id: string) => void; onAdd: () => void; onPropose: () => void;
}
export function WorkPanel(p: WorkPanelProps) {
  const { job: j, rights } = p;
  const answers = pendingJobs().answers;
  const items = itemsOf(j.id);
  const tot = jobTotals(j.id);
  const pending = items.filter((i) => withAnswer(i, answers).status === 'proposed').reduce((n, i) => n + lineCents(i), 0);
  const canEdit = rights.act && isOpen(j.status);
  const l = lang.value;
  /* « Modifier le travail »: every line gets its « Retirer » and « Changer » buttons; adding is there too */
  const [editing, setEditing] = useState(false);
  const inv = invoiceOf(j.id);
  const finished = isFinished(inv);
  const missing = isOpen(j.status) ? unbilledWork(items.map((i) => withAnswer(i, answers)), inv) : [];
  return (
    <Panel title={t('jobs.work.title')} help={t('jobs.work.help')} data-tour="job-work" class="jobs-work" data-testid="job-work">
      {items.length ? (
        <div class="rows jobs-items" role="list">
          {items.map((raw) => {
            // the customer's answer kept on the phone (no signal) shows as given
            const i = withAnswer(raw, answers);
            const waiting = i !== raw;
            const off = i.status === 'declined' || i.status === 'removed';
            const qty = qtyText(i);
            return (
              <div key={i.id} class={`row-item jobs-item${off ? ' is-off' : ''}`} role="listitem" data-testid="job-item">
                <StatusIcon s={i.status} />
                <button type="button" class="jobs-item-main" onClick={() => p.onItem(i.id)}>
                  <span class="row-title">{i.description}</span>
                  <span class="row-sub">{itemStatusText(i, waiting)}{qty ? `, ${qty}` : ''}</span>
                </button>
                <Money cents={lineCents(i)} class={`jobs-item-price${off ? ' faint' : ''}`} />
                <span class="jobs-item-act">
                  {canEdit && editing && (
                    <>
                      <IconButton icon={<Pencil />} label={t('jobs.work.changeLine', { what: i.description })} onClick={() => p.onItem(i.id)} data-testid="item-edit" />
                      {mayRemove(i, isBilled(inv, i.id)) && <IconButton icon={<Trash2 />} label={t('jobs.work.removeLine', { what: i.description })} onClick={() => takeOff(j, i)} data-testid="item-remove-line" />}
                      {i.status === 'removed' && <Button size="sm" onClick={() => attempt(() => updateItem(i.id, { status: 'planned' }))} data-testid="item-back">{t('jobs.work.setBack')}</Button>}
                    </>
                  )}
                  {canEdit && !editing && j.status === 'on_site' && i.status === 'planned' && (
                    <Button size="sm" icon={<Check />} label={t('jobs.work.markDoneLabel', { what: i.description })} onClick={() => attempt(() => updateItem(i.id, { status: 'done' }))} data-testid="item-done">{t('jobs.work.markDone')}</Button>
                  )}
                  {mayAnswer(rights.act, j.status, i) && (
                    <Button size="sm" icon={<PenLine />} onClick={() => p.onAnswer(i.id)} data-testid="item-answer">{t('jobs.work.answer')}</Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : <p class="muted" style={{ margin: 0 }}>{t('jobs.work.none')}</p>}
      {tot.total > 0 && (
        <div class="jobs-totals">
          <Totals subtotal={tot.subtotal} tps={tot.tps} tvq={tot.tvq} total={tot.total} taxesOn={settings.value.taxes.enabled} />
        </div>
      )}
      {pending > 0 && <p class="small jobs-pending">{t('jobs.work.pendingTotal', { amount: money(pending, l) })}</p>}
      {missing.length > 0 && (
        <Banner kind="warn" data-testid="work-unbilled">
          {t(inv!.status === 'paid' ? 'jobs.work.unbilledPaid' : 'jobs.work.unbilled', { what: missing.map((i) => i.description).join(', ') })}
        </Banner>
      )}
      {canEdit && editing && finished && <p class="small muted" style={{ margin: 'var(--sp-2) 0 0' }} data-testid="work-edit-billed">{t('jobs.work.editBilled')}</p>}
      {canEdit && (
        <div class="jobs-work-actions">
          {!editing && <Button icon={<Pencil />} onClick={() => setEditing(true)} data-testid="work-edit">{t('jobs.work.edit')}</Button>}
          {editing && <Button icon={<Plus />} onClick={p.onAdd} data-testid="work-add">{t('jobs.work.add')}</Button>}
          <Button icon={<PenLine />} onClick={p.onPropose} data-tour="job-extra" data-testid="work-propose">{t('jobs.work.propose')}</Button>
          {editing && <Button variant="primary" icon={<Check />} onClick={() => setEditing(false)} data-testid="work-edit-done">{t('jobs.work.editDone')}</Button>}
        </div>
      )}
    </Panel>
  );
}
