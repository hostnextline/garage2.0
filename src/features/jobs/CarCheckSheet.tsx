/* « La voiture »: right after « Je suis arrivé », the km on the dashboard (kept on this visit, like Serti) and the car's VIN.
   The VIN is needed before the work starts (`need`: the red button stays « Le NIV de l’auto »): scanned, typed, or one of the
   customer's cars that already has one, chosen from the list; « NIV illisible » (two taps) lets the job go on without it.
   A job with no car gets one: the car picked, the customer's car with that VIN, or a new car made from the VIN.
   Once the car has its VIN the sheet only asks the km, and « Plus tard » skips it. Also opened from the job sheet (the km of
   the visit, to note or fix). Asked like a question (askCar → a promise), hosted once on « Ma journée » and on the job sheet;
   saveCar sends what was given (the visit's km, the car's VIN, the job's car). */
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import type { Job, Vehicle } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { Sheet, Button, Banner, Field, Input, Rows, RowItem, attempt } from '../../ui';
import { updateJob, saveVehicle } from '../../data/api';
import { Car } from 'lucide-preact';
import { VinField, vinSavable, type CarFields } from '../customers/VehicleBits';
import { carName } from '../customers/bits';
import { carsWithVin, skipVin } from './vinStep';
import { km, parseKm } from '../customers/vehicleText';
import { vehicleLabel, vehiclesOf } from '../../data/select';

export interface CarAnswer {
  km: number | null; vin: string | null;
  /** what the VIN says about the car (year, make, model…), for a car made or completed from it */
  decoded?: Partial<CarFields>;
  /** a car of the customer that already has its VIN, chosen instead of scanning */
  pick?: string;
  /** « NIV illisible »: the job goes on without it */
  skip?: boolean;
}
interface Ask { job: Job; car: Vehicle | null; need: boolean; resolve: (v: CarAnswer | null) => void }
const asking = signal<Ask | null>(null);

/** asks the km (and the VIN when the car has none); resolves what was given, or null for « Plus tard » */
export function askCar(job: Job, car: Vehicle | null, need = false): Promise<CarAnswer | null> {
  return new Promise((resolve) => { asking.value = { job, car, need: need || !car, resolve }; });
}

/** what the sheet accepts: a km of 0 to 3 000 000, a VIN of 11 to 17 characters; at least one of them (the VIN when it is needed) */
export function carErrors(d: { km: string; vin: string }, need = false): { km: string | null; vin: string | null; empty: boolean } {
  const n = parseKm(d.km);
  return {
    km: n != null && (Number.isNaN(n) || n > 3000000) ? t('vehicles.errors.km') : null,
    vin: !vinSavable(d.vin) ? t('vehicles.errors.vin') : null,
    empty: need ? !d.vin : n == null && !d.vin
  };
}

/** what to do with a VIN given for a job: the customer's car that already has it becomes the job's car; else it goes on the
    job's car (which has none); else (no car on the job) a new car is made from it. Pure (tested). */
export function vinPlan(vin: string, car: Pick<Vehicle, 'id' | 'vin'> | null, customerCars: Pick<Vehicle, 'id' | 'vin' | 'deleted_at'>[]): { kind: 'link'; id: string } | { kind: 'set'; id: string } | { kind: 'new' } | { kind: 'none' } {
  const same = customerCars.find((v) => !v.deleted_at && !!v.vin && v.vin.toUpperCase() === vin.toUpperCase());
  if (same) return same.id === car?.id ? { kind: 'none' } : { kind: 'link', id: same.id };
  if (car && !car.vin) return { kind: 'set', id: car.id };
  return car ? { kind: 'none' } : { kind: 'new' };
}

/** sends the answer: the visit's km (the car's km follows on the server), the VIN on a car that has none. Says how it went. */
export async function saveCar(job: Job, car: Vehicle | null, a: CarAnswer): Promise<boolean> {
  return attempt(async () => {
    const patch: Record<string, unknown> = {};
    if (a.skip) skipVin(job.id);
    if (a.pick) patch.vehicle_id = a.pick;
    else if (a.vin) {
      const plan = vinPlan(a.vin, car, job.customer_id ? vehiclesOf(job.customer_id) : []);
      const said = a.decoded || {};
      if (plan.kind === 'link') patch.vehicle_id = plan.id;
      else if (plan.kind === 'set') {
        // the VIN, and what it says of the car where the file says nothing yet
        const fill = Object.fromEntries(Object.entries(said).filter(([k, v]) => v != null && v !== '' && (car as unknown as Record<string, unknown>)?.[k] == null));
        await saveVehicle({ ...fill, id: plan.id, vin: a.vin });
      } else if (plan.kind === 'new') patch.vehicle_id = await saveVehicle({ ...said, customer_id: job.customer_id, vin: a.vin });
    }
    if (a.km != null && a.km !== job.odometer_km) patch.odometer_km = a.km;
    if (Object.keys(patch).length) await updateJob(job.id, patch);
  }, { ok: a.skip && a.km == null ? t('jobs.car.skipped') : t('jobs.car.saved') });
}

export function CarCheckHost() {
  const a = asking.value;
  if (!a) return null;
  return <CarCheckOpen key={a.job.id} ask={a} />;
}

function CarCheckOpen(p: { ask: Ask }) {
  const { job, car, need } = p.ask;
  const l = lang.value;
  const needVin = !car?.vin;
  const [d, setD] = useState({ km: job.odometer_km != null ? String(job.odometer_km) : '', vin: '' });
  const [decoded, setDecoded] = useState<Partial<CarFields> | undefined>(undefined);
  const [tried, setTried] = useState(false);
  const errs = carErrors(d, need);
  const n = parseKm(d.km);
  const kmOk = n != null && !Number.isNaN(n) && n <= 3000000 ? n : null;
  const lower = !!car && kmOk != null && car.odometer_km != null && kmOk < car.odometer_km && job.odometer_km == null;
  // the customer's cars that already have their VIN: one tap instead of scanning
  const known = need && job.customer_id ? carsWithVin(vehiclesOf(job.customer_id), car?.id) : [];
  const done = (v: CarAnswer | null) => { asking.value = null; p.ask.resolve(v); };
  const ok = () => {
    setTried(true);
    if (errs.km || errs.vin || errs.empty) return;
    done({ km: n, vin: d.vin || null, decoded });
  };
  return (
    <Sheet open onClose={() => done(null)} title={need ? t('jobs.car.needTitle') : t('jobs.car.title')} sub={(car && vehicleLabel(car)) || undefined} data-testid="car-check"
      footer={<>
        {need
          ? <Button variant="ghost" confirm={t('jobs.car.skipConfirm')} onClick={() => done({ km: kmOk, vin: null, skip: true })} data-testid="car-check-skip">{t('jobs.car.skip')}</Button>
          : <Button onClick={() => done(null)} data-testid="car-check-later">{t('jobs.car.later')}</Button>}
        <Button variant="primary" onClick={ok} disabled={errs.empty} data-testid="car-check-save">{t('jobs.car.save')}</Button>
      </>}>
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{need ? t('jobs.car.needHelp') : needVin ? t('jobs.car.helpVin') : t('jobs.car.help')}</p>
        {needVin && <VinField value={d.vin} onValue={(vin) => setD((x) => ({ ...x, vin }))} onDecoded={setDecoded} customerId={job.customer_id} error={tried ? errs.vin : null} />}
        {known.length > 0 && (
          <Field label={t('jobs.car.pick')} hint={t('jobs.car.pickHint')} group>
            <Rows>
              {known.map((v) => (
                <RowItem key={v.id} onClick={() => done({ km: kmOk, vin: null, pick: v.id })} chevron data-testid="car-check-pick"
                  start={<Car size={20} aria-hidden="true" />} title={carName(v)} sub={t('vehicles.vinTail', { tail: String(v.vin).slice(-6) })} />
              ))}
            </Rows>
          </Field>
        )}
        <Field label={t('jobs.car.km')} optional error={tried ? errs.km : null}
          hint={car?.odometer_km != null ? t('jobs.car.kmLast', { km: km(car.odometer_km, l) }) : undefined}>
          <Input value={d.km} onValue={(v) => setD((x) => ({ ...x, km: v }))} inputMode="numeric" autoComplete="off"
            placeholder={car?.odometer_km != null ? String(car.odometer_km) : '84200'} invalid={tried && !!errs.km} data-testid="car-check-km" />
        </Field>
        {lower && <Banner kind="warn">{t('jobs.car.kmLower', { km: km(car?.odometer_km ?? 0, l) })}</Banner>}
      </div>
    </Sheet>
  );
}
