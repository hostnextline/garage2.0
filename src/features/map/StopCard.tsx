/* The stop chosen: name, address, status, truck and stop number, when it is planned (or the live trip's arrival and km),
   « Hors plage », « Ouvrir la job » and « Itinéraire » (Google Maps). */
import { Navigation, Check, X } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clock } from '../../lib/dates';
import { job as jobRow } from '../../data/select';
import type { JobStatus } from '../../data/types';
import { Button, IconButton, StatusPill, Pill } from '../../ui';
import { minuteOf, type Stop, type TruckRoute } from '../../shared/map/assemble';
import { whenOf, lateStop, fmtKm } from './stopWords';

export type ChosenStop = Stop & { color: string; truckName: string };

export function StopCard(p: { stop: ChosenStop; truck: TruckRoute | null; onClose: () => void; plain?: boolean }) {
  const s = p.stop;
  const l = lang.value;
  const row = jobRow(s.id);
  const trip = p.truck?.trip && p.truck.trip.jobId === s.id && !s.done ? p.truck.trip : null;
  const etaMin = trip ? minuteOf(trip.etaAt) : null;
  const dest = s.hasPos ? `${s.lat},${s.lng}` : s.address;
  return (
    <section class={`panel ${p.plain ? 'panel-plain' : 'glass'} map-card`} aria-live="polite" data-testid="map-card">
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <span class="map-n is-big" style={{ '--c': s.color }} aria-hidden="true">{s.done ? <Check size={18} strokeWidth={3} /> : s.truckId && p.truck ? s.n : '?'}</span>
        <div class="grow">
          <h3 class="map-card-title">{s.name}</h3>
          <p class="small muted" style={{ margin: '2px 0 0' }}>{s.address || t('map.stop.noAddress')}</p>
        </div>
        <IconButton icon={<X />} label={t('map.stop.close')} onClick={p.onClose} />
      </div>
      <div class="row-wrap map-card-meta">
        <StatusPill status={s.status as JobStatus} />
        <span class="small">{p.truck ? `${p.truck.name}, ${t('map.stop.number', { n: s.n }).toLowerCase()}` : t('map.stop.unplaced')}</span>
      </div>
      <p class="small" style={{ margin: 0 }}>
        {trip && etaMin != null
          ? (trip.km != null ? t('map.stop.etaKm', { time: clock(etaMin, l), km: fmtKm(trip.km, l) }) : t('map.stop.eta', { time: clock(etaMin, l) }))
          : whenOf(s, row)}
        {lateStop(s, row) && <> <Pill tone="warn">{t('common.window.late')}</Pill></>}
      </p>
      <div class="row-wrap">
        <Button variant="primary" href={`#/job/${encodeURIComponent(s.id)}`} data-testid="map-open-job">{t('map.stop.open')}</Button>
        {dest && <Button icon={<Navigation size={18} />} href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`} target="_blank">{t('map.stop.directions')}</Button>}
      </div>
    </section>
  );
}
