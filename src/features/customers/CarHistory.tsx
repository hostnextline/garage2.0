/* « Historique de l’auto »: one button, wherever a car is shown (the job's car card, the customer's cars, the car's file).
   With a VIN of 17 characters: every visit made with us on that car, whoever owned it then (the server, vin_history: never
   the other owner's name or prices). Without a VIN, or with no network: the visits of this car's own file, from the phone. */
import { useState } from 'preact/hooks';
import { History } from 'lucide-preact';
import type { Vehicle } from '../../data/types';
import { t } from '../../lib/i18n';
import { allJobs } from '../../data/select';
import { Banner, Button, Sheet, Skeleton } from '../../ui';
import { JobTicket } from '../jobs/JobTicket';
import { carName } from './bits';
import { jobOrder } from './facts';
import { useVinHistory, VinVisits } from './VinHistory';

export function CarHistoryButton(p: { car: Vehicle; size?: 'sm' | 'md'; variant?: 'secondary' | 'ghost'; class?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={p.size} variant={p.variant} class={p.class} icon={<History size={18} />} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }} data-testid="car-history">{t('vehicles.vinHistory.button')}</Button>
      {open && <CarHistorySheet car={p.car} onClose={() => setOpen(false)} />}
    </>
  );
}

function CarHistorySheet(p: { car: Vehicle; onClose: () => void }) {
  const v = p.car;
  const full = !!v.vin && v.vin.length === 17;
  const h = useVinHistory(full ? v.vin : null, v.customer_id ?? null);
  const local = allJobs.value.filter((j) => j.vehicle_id === v.id).sort((a, b) => jobOrder(b, a));
  // the server's answer when it has visits; else what this phone holds for this car's file
  const fromServer = h.state === 'ok' && (h.visits.length > 0 || !local.length);
  return (
    <Sheet open onClose={p.onClose} title={t('vehicles.vinHistory.title')} sub={[carName(v), v.vin].filter(Boolean).join(', ')} data-testid="car-history-sheet"
      footer={<Button onClick={p.onClose}>{t('common.close')}</Button>}>
      <div class="stack">
        {full && h.state === 'loading' && <div aria-busy="true"><Skeleton h={20} lines={4} /></div>}
        {fromServer && <p class="small muted" style={{ margin: 0 }}>{t('vehicles.vinHistory.sub')}</p>}
        {fromServer && (h.visits.length ? <VinVisits visits={h.visits} owners /> : <p class="muted" style={{ margin: 0 }}>{t('vehicles.vinHistory.none')}</p>)}
        {!fromServer && h.state !== 'loading' && (
          <>
            {h.state !== 'ok' && <Banner kind="info">{full ? t('vehicles.vinHistory.offline') : t('vehicles.vinHistory.noVin')}</Banner>}
            {local.length
              ? <div class="stack" data-testid="car-history-local">{local.map((j) => <JobTicket key={j.id} job={j} showDay />)}</div>
              : <p class="muted" style={{ margin: 0 }}>{t('vehicles.screen.historyNone')}</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
