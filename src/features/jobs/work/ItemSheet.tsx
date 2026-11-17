/* One line of work, tapped: its price, quantity and why; « Changer le prix »; on site « Fait » / « Remettre à faire » /
   « Pas fait »; before the visit « Retirer de la job » (two taps); a proposal: get the answer, or withdraw it. Work billed on
   a finished invoice changes only once the invoice is opened again (« Modifier la facture », right here). */
import { useState } from 'preact/hooks';
import { Check, PenLine, X, Minus, Tag } from 'lucide-preact';
import type { Job, JobItem, ItemStatus } from '../../../data/types';
import { Button, Sheet, Field, MoneyInput, Money, Kv, attempt } from '../../../ui';
import { t, lang } from '../../../lib/i18n';
import { money } from '../../../lib/money';
import { invoiceOf } from '../../../data/select';
import { me } from '../../../data/auth';
import { updateItem, removeItem, setItemPrice } from '../../../data/api';
import { isBilled, isFinished, isOpen, lineCents } from '../../../domain/jobs/billing';
import { mayReprice } from '../../../domain/jobs/work';
import type { JobRights } from '../../../domain/jobs/rights';
import { ReopenButton, mayReopen } from '../../../shared/invoices/InvoicePanel';
import { itemStatusText, qtyText } from './words';

export function ItemSheet(p: { job: Job; item: JobItem | undefined; rights: JobRights; onClose: () => void; onAnswer: (id: string) => void }) {
  const i = p.item;
  if (!i) return null;
  const inv = invoiceOf(p.job.id);
  const billed = isBilled(inv, i.id);
  const open = isOpen(p.job.status);
  const canEdit = p.rights.act && open;
  const onSite = p.job.status === 'on_site';
  const set = (status: ItemStatus) => async () => { if (await attempt(() => updateItem(i.id, { status }), { ok: t('jobs.work.changed') })) p.onClose(); };
  return (
    <Sheet open onClose={p.onClose} title={i.description} sub={itemStatusText(i)} data-testid="item-sheet"
      footer={<Button onClick={p.onClose}>{t('common.close')}</Button>}>
      <div class="stack">
        <Kv items={[
          [t('common.price'), <Money cents={lineCents(i)} />],
          [t('common.qty'), qtyText(i) || null],
          [t('jobs.work.why'), i.note]
        ]} />
        {billed && open ? (
          <div class="stack" data-testid="item-locked">
            {/* « rouvre-la : » only when the button follows; else (paid more than its total, no right on its invoice) the office */}
            <p class="small muted" style={{ margin: 0 }}>{t(!mayReopen(inv, p.job) ? 'invoices.reopen.itemLocked' : inv!.status === 'paid' ? 'invoices.reopen.itemPaid' : 'invoices.reopen.item')}</p>
            <ReopenButton inv={inv!} job={p.job} block />
          </div>
        ) : <PriceEdit job={p.job} item={i} locked={isFinished(inv)} />}
        {canEdit && (
          <div class="stack">
            {/* on site: what was done, or not (not billed); before that, the plan only changes */}
            {onSite && i.status === 'planned' && <Button variant="primary" block icon={<Check />} onClick={set('done')}>{t('jobs.work.setDone')}</Button>}
            {onSite && i.status === 'done' && <Button block onClick={set('planned')}>{t('jobs.work.setPlanned')}</Button>}
            {onSite && !billed && (i.status === 'planned' || i.status === 'done' || i.status === 'approved') && <Button block variant="danger" icon={<Minus />} onClick={set('removed')} data-testid="item-not-done">{t('jobs.work.setRemoved')}</Button>}
            {i.status === 'removed' && <Button block onClick={set('planned')}>{t('jobs.work.setBack')}</Button>}
            {!onSite && !billed && (i.status === 'planned' || i.status === 'approved') && (
              <Button block variant="danger" icon={<X />} confirm={t('jobs.work.removeConfirm')}
                onClick={async () => { if (await attempt(() => removeItem(i.id), { ok: t('jobs.work.removedFromJob') })) p.onClose(); }} data-testid="item-remove">{t('jobs.work.removeFromJob')}</Button>
            )}
            {i.status === 'proposed' && <Button variant="primary" block icon={<PenLine />} onClick={() => p.onAnswer(i.id)}>{t('jobs.work.getAnswer')}</Button>}
            {i.status === 'proposed' && (
              <Button block variant="danger" icon={<X />} confirm={t('jobs.work.withdrawConfirm')}
                onClick={async () => { if (await attempt(() => removeItem(i.id), { ok: t('jobs.work.withdrawn') })) p.onClose(); }}>{t('jobs.work.withdraw')}</Button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* « Changer le prix »: everyone on the team, while the appointment is coming or under way and its invoice is not finished
   (the server says the same, job_item_price, and keeps the old and new prices) */
function PriceEdit(p: { job: Job; item: JobItem; locked: boolean }) {
  const i = p.item;
  const [open, setOpen] = useState(false);
  const [cents, setCents] = useState<number | null>(Math.abs(i.unit_cents));
  if (!me.value || !mayReprice(p.job.status, i)) return null;
  if (p.locked) return <p class="small muted" style={{ margin: 0 }}>{t('jobs.price.locked')}</p>;
  if (!open) return <Button block icon={<Tag />} onClick={() => { setCents(Math.abs(i.unit_cents)); setOpen(true); }} data-testid="item-price-edit">{t('jobs.price.change')}</Button>;
  const save = async () => {
    if (cents == null || cents < 0) return;
    if (cents === Math.abs(i.unit_cents)) { setOpen(false); return; }
    const ok = await attempt(() => setItemPrice(i.id, cents), { ok: t(p.job.confirm_sent_at ? 'jobs.price.doneResend' : 'jobs.price.done', { price: money(cents, lang.value) }) });
    if (ok) setOpen(false);
  };
  return (
    <div class="stack jobs-price-edit" data-testid="item-price-form">
      <Field label={Number(i.qty) !== 1 ? t('jobs.price.unitLabel') : t('jobs.price.label')} hint={t('jobs.price.hint')}>
        <MoneyInput cents={cents} onCents={setCents} aria-label={t('jobs.price.label')} />
      </Field>
      <div class="row-wrap">
        <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={save} disabled={cents == null} data-testid="item-price-save">{t('jobs.price.save')}</Button>
      </div>
    </div>
  );
}
