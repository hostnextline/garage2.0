/* « Pièces utilisées »: when the job is finished, the parts it was expected to take, each with its quantity to confirm
   (or change), and what is left on the shelf. The confirmed list goes with « Terminer la job » (job_step finish,
   p_data.parts); the server takes exactly those off the inventory. Asked like a question (confirmParts → a promise) and
   drawn by one host (hosts.ts). */
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { Package } from 'lucide-preact';
import type { Job } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { Sheet, Button, Banner, Stepper } from '../../ui';
import { formatQty, unitWord } from '../../domain/stock/stock';
import { qtyStep, stepQty, qtyFloor, type PlannedPart, type UsedPart } from '../../domain/jobs/parts';
import { useHostTurn } from './hosts';

interface Ask { job: Job; planned: PlannedPart[]; resolve: (v: UsedPart[] | null) => void }
const asking = signal<Ask | null>(null);
/** the question is dropped (null = the person stepped back): another one replaced it, or no screen shows it any more */
function drop() { const a = asking.value; asking.value = null; a?.resolve(null); }

/** asks the person to confirm the parts used; resolves the list (maybe empty), or null when they step back */
export function confirmParts(job: Job, planned: PlannedPart[]): Promise<UsedPart[] | null> {
  if (asking.value) drop();
  return new Promise((resolve) => { asking.value = { job, planned, resolve }; });
}

export function PartsHost() {
  const mine = useHostTurn('parts', drop);
  const a = asking.value;
  if (!a || !mine) return null;
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
            const step = qtyStep(x.unit);
            return (
              <div key={x.item_id} role="listitem" class="row-item jobs-part" data-testid={`part-${x.item_id}`}>
                <span class="quick-icon" aria-hidden="true"><Package size={20} /></span>
                <div class="grow">
                  <b>{x.name}</b>
                  <p class="small muted" style={{ margin: 0 }}>
                    {t('jobs.parts.planned', { q: label(x, x.qty) })} · {t('jobs.parts.onHand', { q: label(x, x.onHand) })}
                  </p>
                </div>
                {/* along the step's grid: a planned 4.7 L goes to 4.5 or 5, and down to 0 */}
                <Stepper value={q} min={qtyFloor(q, step)} step={step} label={x.name} format={(v) => formatQty(v, l)}
                  onValue={(v) => setQty((s) => ({ ...s, [x.item_id]: stepQty(q, v > q, step) }))} />
              </div>
            );
          })}
        </div>
        {short.length > 0 && <Banner kind="warn">{t('jobs.parts.short', { names: short.map((x) => x.name).join(', ') })}</Banner>}
      </div>
    </Sheet>
  );
}
