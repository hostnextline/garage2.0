/* « Modifier » a customer's file: the same fields as the new customer page; only the fields that changed are sent (two
   people may change the same file at the same time); leaving a changed sheet asks first. A new address is also offered
   to the coming appointments still at the old one (followAddress.ts). « Supprimer ce client »: DeleteZone.tsx. */
import { useMemo } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { allJobs } from '../../data/select';
import { saveCustomer, updateJob } from '../../data/api';
import type { Customer } from '../../data/types';
import { Button, Sheet, Banner, ask, attempt, toast, whenHistorySettled } from '../../ui';
import { CustomerFields } from '../../shared/customers/CustomerFields';
import { changed, customerPatch, draftOf, movesAddress } from '../../shared/customers/draft';
import { useCustomerDraft } from '../../shared/customers/useCustomerDraft';
import { positioned } from '../../shared/customers/create';
import { currentDay } from '../../domain/oil/clock';
import { DeleteZone } from './DeleteZone';
import { addressPatch, jobsAtOldAddress } from './followAddress';

export function EditSheet(p: { c: Customer; onClose: () => void; onLeaving: (on: boolean) => void; onDeleted: () => void }) {
  const f = useCustomerDraft(() => draftOf(p.c), p.c.phone);
  const before = useMemo(() => customerPatch(draftOf(p.c)), []);
  const diff = changed(before, customerPatch(f.draft));
  const dirty = Object.keys(diff).length > 0;
  const close = async () => {
    if (dirty && !(await ask({ title: t('customers.file.leave.title'), text: t('customers.file.leave.text'), ok: t('customers.file.leave.ok'), danger: true }))) return;
    whenHistorySettled(p.onClose);
  };
  // the appointments to offer the new address to, read before the file changes
  const follow = (d: typeof diff) => movesAddress(d) && 'address' in d ? jobsAtOldAddress(allJobs.value, p.c.id, { address: before.address ?? null }, currentDay.value) : [];
  const save = () => f.once(async () => {
    if (!f.ready()) return;
    if (!dirty) { p.onClose(); return; }
    // a new address saved right after typing: its position first (R163), else the file and its appointments lose it
    const draft = movesAddress(diff) ? await positioned(f.draft) : f.draft;
    const sent = draft === f.draft ? diff : changed(before, customerPatch(draft));
    const jobs = follow(sent);
    if (!(await attempt(() => saveCustomer({ id: p.c.id, ...sent }), { ok: t('customers.file.saved') }))) return;
    if (jobs.length && await ask({ title: t('customers.follow.title'), text: t('customers.follow.text', { n: jobs.length }), ok: t('customers.follow.ok'), cancel: t('customers.follow.no') })) {
      const place = addressPatch(customerPatch(draft));
      let moved = 0;
      for (const j of jobs) if (await attempt(() => updateJob(j.id, place))) moved++;
      if (moved) toast(t('customers.follow.done', { n: moved }), { kind: 'ok' });
    }
    p.onClose();
  });
  return (
    <Sheet open onClose={() => void close()} title={t('customers.file.editTitle')} data-testid="customer-edit-sheet"
      footer={<>
        <Button onClick={() => { void close(); }}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={save} data-testid="customer-save">{t('common.save')}</Button>
      </>}>
      <div class="stack-lg">
        {f.bad && <Banner kind="bad">{t('customers.form.fix')}</Banner>}
        <CustomerFields draft={f.draft} set={f.set} errors={f.errors} exceptId={p.c.id}
          dupAction={(o) => <Button size="sm" href={`#/customer/${o.id}`} data-testid="dup-open">{t('customers.dup.open')}</Button>} />
        <DeleteZone c={p.c} onLeaving={p.onLeaving} onDeleted={p.onDeleted} />
      </div>
    </Sheet>
  );
}
