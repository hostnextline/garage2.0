/* « Ajouter du travail »: the price list (ServicePicker, custom lines allowed, in the customer's language). Once on site, a
   mechanic's added work is an extra the customer must accept (then the answer sheet opens for it); the owner, the office,
   or anyone before the visit adds planned work. Before the visit, « Allonger le rendez-vous » gives the truck the time. */
import { useRef, useState } from 'preact/hooks';
import type { Job } from '../../../data/types';
import { Button, Sheet, Check as CheckBox, attempt } from '../../../ui';
import { t, lang } from '../../../lib/i18n';
import { duration } from '../../../lib/dates';
import { addItem, setJobDuration } from '../../../data/api';
import { uuid } from '../../../data/sync';
import { ServicePicker } from '../../../shared/moment/ServicePicker';
import { itemsDuration, type ItemDraft } from '../../../domain/moment/logic';
import { addsExtra } from '../../../domain/jobs/work';
import type { JobRights } from '../../../domain/jobs/rights';
import { wt } from '../../../shared/jobs/select';
import { customerLang } from '../WaiverSheet';

export function AddWorkSheet(p: { job: Job; rights: JobRights; open: boolean; onClose: () => void; onProposed: (id: string) => void }) {
  if (!p.open) return null;
  return <AddWorkOpen {...p} />;
}
function AddWorkOpen(p: { job: Job; rights: JobRights; onClose: () => void; onProposed: (id: string) => void }) {
  const { job: j, rights } = p;
  const [drafts, setDrafts] = useState<ItemDraft[]>([]);
  const [longer, setLonger] = useState(true);
  // each line keeps its id from the first try: tapped again after a failure halfway, the lines already added are not added twice
  const ids = useRef(new WeakMap<ItemDraft, string>());
  const idOf = (d: ItemDraft) => { let id = ids.current.get(d); if (!id) { id = uuid(); ids.current.set(d, id); } return id; };
  const extra = addsExtra(rights.office, j.status);
  const minutes = itemsDuration(drafts);
  const canLonger = j.status === 'booked' && rights.duration && minutes > 0;
  const n = drafts.length;
  const save = async () => {
    const added: string[] = [];
    const ok = await attempt(async () => {
      for (const d of drafts) {
        added.push(await addItem(j.id, { id: idOf(d), kind: d.kind, service_id: d.service_id, item_id: d.item_id ?? null, description: d.description, qty: d.qty, unit_cents: d.unit_cents,
          taxable: d.taxable, duration_min: d.duration_min, note: d.note ?? null, status: extra ? 'proposed' : 'planned' }));
      }
    }, { ok: extra ? t('jobs.work.proposed') : t('jobs.work.added', { n }) });
    if (!ok) return;
    if (canLonger && longer) await attempt(() => setJobDuration(j.id, j.duration_min + minutes), { ok: t('jobs.moment.durationSaved', { time: duration(j.duration_min + minutes, lang.value) }) });
    p.onClose();
    if (extra && added[0]) p.onProposed(added[0]);
  };
  return (
    <Sheet open onClose={p.onClose} title={t('jobs.work.addTitle')} sub={extra ? t('jobs.work.addAsExtra') : undefined} wide data-testid="add-work-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!n} onClick={save} data-testid="add-work-ok">{n ? t(extra ? 'jobs.work.proposeButton' : 'jobs.work.addButton', { n }) : t('jobs.work.add')}</Button>
      </>}>
      <div class="stack">
        <ServicePicker value={drafts} onValue={setDrafts} lang={customerLang(j)} allowCustom />
        {minutes > 0 && !canLonger && <p class="small muted" style={{ margin: 0 }}>{t('jobs.work.addMinutes', { time: duration(minutes, lang.value) })}</p>}
        {canLonger && <CheckBox checked={longer} onChange={setLonger} label={t('jobs.work.longer', { time: duration(minutes, lang.value) })} hint={wt(p.job, 'jobs.work.longerHint')} />}
      </div>
    </Sheet>
  );
}
