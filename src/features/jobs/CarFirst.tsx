/* « Le véhicule d'abord » (the mechanic, first thing on the job): the car in big letters (year, make, model, engine,
   plate), the oil it takes (grade, litres, filter: from the confirmed engine sheet, else the engine list « à confirmer »),
   then the work to do, right under it. Shared: the job screen and the next stop of « Ma journée ». */
import { useEffect } from 'preact/hooks';
import { Car, Droplet, Wrench } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { vehicle as vehicleRow, specByKey, itemsOf } from '../../data/select';
import type { Job } from '../../data/types';
import { engineRef, ensureEngineRef } from '../customers/engineRef';
import { carFacts } from '../inventory/needs';
import { carLine, oilLine, workLines } from './carWords';
import './jobs.css';

export function CarFirst(p: { job: Job; compact?: boolean }) {
  const j = p.job;
  useEffect(() => { void ensureEngineRef().catch(() => undefined); }, []);
  const v = vehicleRow(j.vehicle_id);
  const facts = carFacts(v, specByKey(v?.spec_key), engineRef.value.rows);
  const car = carLine(v);
  const oil = oilLine(facts, lang.value);
  const work = workLines(itemsOf(j.id), j.problem);
  return (
    <section class={`panel glass jobs-carfirst${p.compact ? ' is-compact' : ''}`} data-testid="job-carfirst" aria-label={t('jobs.carFirst.label')}>
      <div class="jobs-cf-car">
        <Car aria-hidden="true" />
        <div>
          <b class="jobs-cf-name" data-testid="carfirst-car">{car.name || t('jobs.head.noCar')}</b>
          {(car.detail || v?.plate) && <span class="jobs-cf-detail">{[car.detail, v?.plate].filter(Boolean).join(', ')}</span>}
        </div>
      </div>
      <div class={`jobs-cf-oil${oil.known ? '' : ' is-unknown'}`} data-testid="carfirst-oil">
        <Droplet aria-hidden="true" />
        <div>
          <b>{oil.known ? oil.main : t('jobs.carFirst.oilUnknown')}</b>
          {oil.sub && <span class="jobs-cf-detail">{oil.sub}</span>}
          {oil.toConfirm && <span class="jobs-cf-confirm">{t('jobs.carFirst.toConfirm')}</span>}
        </div>
      </div>
      {work.length > 0 && (
        <div class="jobs-cf-work" data-testid="carfirst-work">
          <Wrench aria-hidden="true" />
          <ul>{work.slice(0, p.compact ? 3 : 12).map((w, i) => <li key={i}>{w}</li>)}{p.compact && work.length > 3 && <li class="muted">{t('jobs.carFirst.more', { n: work.length - 3 })}</li>}</ul>
        </div>
      )}
    </section>
  );
}
