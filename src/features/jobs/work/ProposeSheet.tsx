/* « Proposer un travail »: a line written on the spot (what, price, why), then the customer's answer sheet opens for it. */
import { useRef, useState } from 'preact/hooks';
import type { Job } from '../../../data/types';
import { Button, Sheet, Field, Input, Textarea, MoneyInput, attempt } from '../../../ui';
import { t } from '../../../lib/i18n';
import { addItem } from '../../../data/api';
import { uuid } from '../../../data/sync';

export function ProposeSheet(p: { job: Job; open: boolean; onClose: () => void; onProposed: (id: string) => void }) {
  if (!p.open) return null;
  return <ProposeOpen {...p} />;
}
function ProposeOpen(p: { job: Job; onClose: () => void; onProposed: (id: string) => void }) {
  const [what, setWhat] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [tried, setTried] = useState(false);
  // the line's id is made with the form: sent again after a failure, it is the same line
  const id = useRef(uuid());
  const whatErr = tried && !what.trim() ? t('jobs.work.whatMissing') : null;
  const priceErr = tried && price == null ? t('jobs.work.priceMissing') : null;
  const save = async () => {
    setTried(true);
    if (!what.trim() || price == null) return;
    const ok = await attempt(() => addItem(p.job.id, { id: id.current, kind: 'labour', service_id: null, description: what.trim().slice(0, 300), qty: 1, unit_cents: Math.max(0, price), taxable: true, status: 'proposed', note: why.trim() || null }));
    if (!ok) return;
    p.onClose();
    p.onProposed(id.current);
  };
  return (
    <Sheet open onClose={p.onClose} title={t('jobs.work.proposeTitle')} sub={t('jobs.work.proposeLead')} data-testid="propose-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={save} data-testid="propose-ok">{t('jobs.work.proposeOk')}</Button>
      </>}>
      <div class="stack">
        <Field label={t('jobs.work.what')} error={whatErr}>
          <Input value={what} onValue={setWhat} placeholder={t('jobs.work.whatPlaceholder')} maxLength={300} invalid={!!whatErr} data-testid="propose-what" />
        </Field>
        <Field label={t('jobs.work.price')} error={priceErr}>
          <MoneyInput cents={price} onCents={setPrice} invalid={!!priceErr} aria-label={t('jobs.work.price')} />
        </Field>
        <Field label={t('jobs.work.why')} hint={t('jobs.work.whyHint')} optional>
          <Textarea value={why} onValue={setWhy} rows={2} maxLength={500} />
        </Field>
      </div>
    </Sheet>
  );
}
