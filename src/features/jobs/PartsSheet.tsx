/* « Pièces utilisées »: when the job is finished, the parts it was expected to take, each with its quantity to confirm
   (or change), and what is left on the shelf. The confirmed list goes with « Terminer la job » (job_step finish,
   p_data.parts); the server takes exactly those off the inventory. Asked like a question (confirmParts → a promise),
   hosted once on « Ma journée » and on the job sheet. */
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { Package } from 'lucide-preact';
import type { Job } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { Sheet, Button, Banner, Stepper } from '../../ui';
import { formatQty, unitWord } from '../inventory/stock';
import type { PlannedPart, UsedPart } from './parts';

interface Ask { job: Job; planned: PlannedPart[]; resolve: (v: UsedPart[] | null) => void }
const asking = signal<Ask | null>(null);

/** asks the person to confirm the parts used; resolves the list (maybe empty), or null when they step back */
export function confirmParts(job: Job, planned: PlannedPart[]): Promise<UsedPart[] | null> {
  return new Promise((resolve) => { asking.value = { job, planned, resolve }; });
}

export function PartsHost() {
  const a = asking.value;
  if (!a) return null;
  return <PartsOpen key={a.job.id} ask={a} />;
}

function PartsOpen(p: { ask: Ask }) {
  const { planned } = p.ask;
  const l = lang.value;
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(planned.map((x) => [x.item_id, x.qty])));
  const done = (v: UsedPart[] | null) => { asking.value = null; p.ask.resolve(v); };
  const used = (): UsedPart[] => planned.map((x) => ({ item_id: x.item_id, qty: qty[x.item_id] || 0 })).filter((x) => x.qty > 0);
  const n = used().length;
  const short = planned.filter((x) => (qty[x.item_id] || 0) > x.onHand);
  const label = (x: PlannedPart, q: number) => `${formatQty(q, l)} ${unitWord(x.unit, q, l)}`;
  return (
    <Sheet open onClose={() => done(null)} title={t('jobs.parts.title')} sub={t('jobs.parts.sub')} data-testid="parts-sheet"
      footer={<>
        <Button onClick={() => done([])} data-testid="parts-none">{t('jobs.parts.none')}</Button>
        <Button variant="primary" onClick={() => done(used())} data-testid="parts-confirm">{n ? t('jobs.parts.confirm', { n }) : t('jobs.parts.confirmNone')}</Button>
      </>}>
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{t('jobs.parts.help')}</p>
        <div class="rows" role="list">
          {planned.map((x) => {
            const q = qty[x.item_id] || 0;
            const step = /^(L|l|kg|m)$/.test(x.unit) ? 0.5 : 1;
            return (
              <div key={x.item_id} role="listitem" class="row-item jobs-part" data-testid={`part-${x.item_id}`}>
                <span class="quick-icon" aria-hidden="true"><Package size={20} /></span>
                <div class="grow">
                  <b>{x.name}</b>
                  <p class="small muted" style={{ margin: 0 }}>
                    {t('jobs.parts.planned', { q: label(x, x.qty) })} · {t('jobs.parts.onHand', { q: label(x, x.onHand) })}
                  </p>
                </div>
                <Stepper value={q} min={0} step={step} onValue={(v) => setQty((s) => ({ ...s, [x.item_id]: v }))} label={x.name} format={(v) => formatQty(v, l)} />
              </div>
            );
          })}
        </div>
        {short.length > 0 && <Banner kind="warn">{t('jobs.parts.short', { names: short.map((x) => x.name).join(', ') })}</Banner>}
      </div>
    </Sheet>
  );
}
