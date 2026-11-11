/* « Historique du véhicule »: the car has its own file, found by its VIN (like Serti at the dealers). Every visit made on a car
   with that VIN, whoever owned it then (a car bought used, or entered twice): the day, the job, the work. Never the other
   owner's name or prices (the server, vin_history). Shown on the car's screen, and as soon as a VIN is typed or scanned. */
import { useEffect, useState } from 'preact/hooks';
import { History } from 'lucide-preact';
import { vinHistory, type VinVisit } from '../../data/api';
import { net } from '../../data/sync';
import { t, lang } from '../../lib/i18n';
import { shortDate, today } from '../../lib/dates';
import { Banner, Button, Sheet, Pill } from '../../ui';

export type VinState = { state: 'none' } | { state: 'loading' } | { state: 'error' } | { state: 'ok'; visits: VinVisit[] };

/** the visits of this VIN (asked again when the VIN or the network changes); nothing for a VIN that is not 17 characters */
export function useVinHistory(vin: string | null | undefined, customerId: string | null = null): VinState {
  const v = (vin || '').toUpperCase();
  const [st, setSt] = useState<VinState>({ state: 'none' });
  const online = net.value.online;
  useEffect(() => {
    if (v.length !== 17) { setSt({ state: 'none' }); return; }
    let alive = true;
    setSt({ state: 'loading' });
    const timer = setTimeout(() => {
      vinHistory(v, customerId).then((visits) => { if (alive) setSt({ state: 'ok', visits }); }, () => { if (alive) setSt({ state: 'error' }); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [v, customerId, online]);
  return st;
}

/** one line per visit, the newest first */
export function VinVisits(p: { visits: VinVisit[]; owners: boolean }) {
  const l = lang.value;
  const now = today();
  return (
    <div class="rows" role="list" data-testid="vin-visits">
      {p.visits.map((x) => {
        const coming = x.status === 'booked' || x.day > now;
        const body = (
          <>
            <span class="row-title">
              {shortDate(x.day, l)}<span class="muted">, {t('vehicles.vinHistory.job', { n: x.number })}</span>
            </span>
            <span class="row-sub">{x.work.length ? x.work.join(', ') : t('vehicles.vinHistory.noWork')}</span>
            <span class="row-wrap">
              {coming && <Pill tone="booked" dot={false}>{t('vehicles.vinHistory.coming')}</Pill>}
              {x.status === 'en_route' || x.status === 'on_site' ? <Pill tone="on_site" dot={false}>{t('vehicles.vinHistory.now')}</Pill> : null}
              {p.owners && !x.here && <Pill tone="warn" dot={false}>{t('vehicles.vinHistory.otherOwner')}</Pill>}
            </span>
          </>
        );
        return x.open
          ? <a key={x.job_id} class="row-item customers-vin-visit" role="listitem" href={`#/job/${x.job_id}`} data-testid="vin-visit"><span class="grow customers-vin-visit-body">{body}</span></a>
          : <div key={x.job_id} class="row-item customers-vin-visit" role="listitem" data-testid="vin-visit"><span class="grow customers-vin-visit-body">{body}</span></div>;
      })}
    </div>
  );
}

/** under the VIN being typed: « Déjà venu chez nous : 3 visites, la dernière le 12 mars (Freins avant) » + the list */
export function VinSeen(p: { vin: string; customerId?: string | null }) {
  const h = useVinHistory(p.vin, p.customerId ?? null);
  const [open, setOpen] = useState(false);
  if (h.state !== 'ok' || !h.visits.length) return null;
  const last = h.visits.find((x) => x.status === 'done') || h.visits[0];
  const owners = !!p.customerId;
  const others = owners && h.visits.some((x) => !x.here);
  return (
    <>
      <Banner kind="info" title={t('vehicles.vinHistory.seen', { n: h.visits.length })} data-testid="vin-seen"
        action={<Button icon={<History size={18} />} onClick={() => setOpen(true)} data-testid="vin-seen-open">{t('vehicles.vinHistory.see')}</Button>}>
        {t('vehicles.vinHistory.last', { day: shortDate(last.day, lang.value), work: last.work.join(', ') || t('vehicles.vinHistory.noWork') })}
        {others ? ` ${t('vehicles.vinHistory.otherOwnerNote')}` : ''}
      </Banner>
      {open && (
        <Sheet open onClose={() => setOpen(false)} title={t('vehicles.vinHistory.title')} sub={p.vin} data-testid="vin-history-sheet"
          footer={<Button onClick={() => setOpen(false)}>{t('common.close')}</Button>}>
          <VinVisits visits={h.visits} owners={owners} />
        </Sheet>
      )}
    </>
  );
}
