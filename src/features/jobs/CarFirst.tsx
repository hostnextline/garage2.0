/* « Le véhicule d'abord » (the mechanic, first thing on the job): the car in big letters (year, make, model, engine,
   plate), the oil it takes (grade, litres, filter: from the confirmed engine sheet, else the engine list « à confirmer »),
   then the work to do, right under it. Shared: the job screen and the next stop of « Ma journée ». */
import { useEffect, useState } from 'preact/hooks';
import { Car, Droplet, Wrench, Pencil } from 'lucide-preact';
import { Button, Sheet, Banner } from '../../ui';
import { isField } from '../../app/routes';
import { SpecPanel } from '../customers/SpecPanel';
import { CarHistoryButton } from '../customers/CarHistory';
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
  const [filling, setFilling] = useState(false);
  const mayFill = isField();
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
        {v && <CarHistoryButton car={v} size="sm" class="jobs-cf-history" />}
      </div>
      <div class={`jobs-cf-oil${oil.known ? '' : ' is-unknown'}`} data-testid="carfirst-oil">
        <Droplet aria-hidden="true" />
        <div>
          <b>{oil.known ? oil.main : t('jobs.carFirst.oilUnknown')}</b>
          {oil.sub && <span class="jobs-cf-detail">{oil.sub}</span>}
          {oil.toConfirm && <span class="jobs-cf-confirm">{t('jobs.carFirst.toConfirm')}</span>}
          {v && oil.missing.length > 0 && <span class="jobs-cf-missing" data-testid="carfirst-missing">{t('jobs.carFirst.missing', { what: oil.missing.map((k) => t(`jobs.carFirst.piece.${k}`)).join(', ') })}</span>}
          {!v && <span class="jobs-cf-missing">{t('jobs.carFirst.noCar')}</span>}
        </div>
        {v && mayFill && (oil.missing.length > 0 || oil.toConfirm) && (
          <Button size="sm" icon={<Pencil />} onClick={() => setFilling(true)} data-testid="carfirst-fill">{oil.missing.length ? t('jobs.carFirst.fill') : t('jobs.carFirst.confirm')}</Button>
        )}
      </div>
      {v && filling && (
        <Sheet open onClose={() => setFilling(false)} title={t('jobs.carFirst.fillTitle')} sub={car.name} data-testid="carfirst-sheet"
          footer={<Button onClick={() => setFilling(false)}>{t('common.close')}</Button>}>
          {!(v.year && v.make && v.model)
            ? <Banner kind="warn" title={t('jobs.carFirst.needCar')} action={<Button size="sm" href={`#/vehicle/${v.id}`}>{t('jobs.carFirst.openCar')}</Button>}>{t('jobs.carFirst.needCarText')}</Banner>
            : <SpecPanel v={v} canEdit />}
        </Sheet>
      )}
      {work.length > 0 && (
        <div class="jobs-cf-work" data-testid="carfirst-work">
          <Wrench aria-hidden="true" />
          <ul>{work.slice(0, p.compact ? 3 : 12).map((w, i) => <li key={i}>{w}</li>)}{p.compact && work.length > 3 && <li class="muted">{t('jobs.carFirst.more', { n: work.length - 3 })}</li>}</ul>
        </div>
      )}
    </section>
  );
}

/** one line for the booking screen: the oil the chosen car takes (grade, litres, filter), or what is missing with a link to fill it */
export function OilHint(p: { vehicleId: string | null }) {
  useEffect(() => { void ensureEngineRef().catch(() => undefined); }, []);
  const v = vehicleRow(p.vehicleId);
  if (!v) return null;
  const oil = oilLine(carFacts(v, specByKey(v.spec_key), engineRef.value.rows), lang.value);
  return (
    <p class={`small jobs-oilhint${oil.missing.length ? ' is-missing' : ''}`} data-testid="book-oil">
      <Droplet size={16} aria-hidden="true" />
      <span>
        {[oil.known ? oil.main : '', oil.sub].filter(Boolean).join(', ')}
        {oil.missing.length > 0 && <>{oil.known || oil.sub ? '. ' : ''}{t('jobs.carFirst.missing', { what: oil.missing.map((k) => t(`jobs.carFirst.piece.${k}`)).join(', ') })} <a href={`#/vehicle/${v.id}`}>{t('jobs.carFirst.fill')}</a></>}
        {oil.toConfirm && !oil.missing.length ? ` (${t('jobs.carFirst.toConfirm').toLowerCase()})` : ''}
      </span>
    </p>
  );
}
