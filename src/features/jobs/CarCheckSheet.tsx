/* « La voiture »: right after « Je suis arrivé », the km on the dashboard (kept on this visit, like Serti) and the VIN when the
   car has none yet (typed or scanned: the car's history follows it, « Historique du véhicule »). Never blocking: « Plus tard ».
   Also opened from the job sheet (the km of the visit, to note or fix). Asked like a question (askCar → a promise), hosted once
   on « Ma journée » and on the job sheet; saveCar sends what was given (the visit's km, the car's VIN). */
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import type { Job, Vehicle } from '../../data/types';
import { t, lang } from '../../lib/i18n';
import { Sheet, Button, Banner, Field, Input, attempt } from '../../ui';
import { updateJob, saveVehicle } from '../../data/api';
import { VinField, vinSavable } from '../customers/VehicleBits';
import { km, parseKm } from '../customers/vehicleText';
import { vehicleLabel } from '../../data/select';

export interface CarAnswer { km: number | null; vin: string | null }
interface Ask { job: Job; car: Vehicle; resolve: (v: CarAnswer | null) => void }
const asking = signal<Ask | null>(null);

/** asks the km (and the VIN when the car has none); resolves what was given, or null for « Plus tard » */
export function askCar(job: Job, car: Vehicle): Promise<CarAnswer | null> {
  return new Promise((resolve) => { asking.value = { job, car, resolve }; });
}

/** what the sheet accepts: a km of 0 to 3 000 000, a VIN of 11 to 17 characters; at least one of them */
export function carErrors(d: { km: string; vin: string }): { km: string | null; vin: string | null; empty: boolean } {
  const n = parseKm(d.km);
  return {
    km: n != null && (Number.isNaN(n) || n > 3000000) ? t('vehicles.errors.km') : null,
    vin: !vinSavable(d.vin) ? t('vehicles.errors.vin') : null,
    empty: n == null && !d.vin
  };
}

/** sends the answer: the visit's km (the car's km follows on the server), the VIN on a car that has none. Says how it went. */
export async function saveCar(job: Job, car: Vehicle, a: CarAnswer): Promise<boolean> {
  return attempt(async () => {
    if (a.vin && !car.vin) await saveVehicle({ id: car.id, vin: a.vin });
    if (a.km != null && a.km !== job.odometer_km) await updateJob(job.id, { odometer_km: a.km });
  }, { ok: t('jobs.car.saved') });
}

export function CarCheckHost() {
  const a = asking.value;
  if (!a) return null;
  return <CarCheckOpen key={a.job.id} ask={a} />;
}

function CarCheckOpen(p: { ask: Ask }) {
  const { job, car } = p.ask;
  const l = lang.value;
  const needVin = !car.vin;
  const [d, setD] = useState({ km: job.odometer_km != null ? String(job.odometer_km) : '', vin: '' });
  const [tried, setTried] = useState(false);
  const errs = carErrors(d);
  const n = parseKm(d.km);
  const lower = n != null && !Number.isNaN(n) && car.odometer_km != null && n < car.odometer_km && job.odometer_km == null;
  const done = (v: CarAnswer | null) => { asking.value = null; p.ask.resolve(v); };
  const ok = () => {
    setTried(true);
    if (errs.km || errs.vin || errs.empty) return;
    done({ km: n, vin: d.vin || null });
  };
  return (
    <Sheet open onClose={() => done(null)} title={t('jobs.car.title')} sub={vehicleLabel(car) || undefined} data-testid="car-check"
      footer={<>
        <Button onClick={() => done(null)} data-testid="car-check-later">{t('jobs.car.later')}</Button>
        <Button variant="primary" onClick={ok} disabled={errs.empty} data-testid="car-check-save">{t('jobs.car.save')}</Button>
      </>}>
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{needVin ? t('jobs.car.helpVin') : t('jobs.car.help')}</p>
        <Field label={t('jobs.car.km')} optional error={tried ? errs.km : null}
          hint={car.odometer_km != null ? t('jobs.car.kmLast', { km: km(car.odometer_km, l) }) : undefined}>
          <Input value={d.km} onValue={(v) => setD((x) => ({ ...x, km: v }))} inputMode="numeric" autoComplete="off"
            placeholder={car.odometer_km != null ? String(car.odometer_km) : '84200'} invalid={tried && !!errs.km} data-testid="car-check-km" />
        </Field>
        {lower && <Banner kind="warn">{t('jobs.car.kmLower', { km: km(car.odometer_km, l) })}</Banner>}
        {needVin && <VinField value={d.vin} onValue={(vin) => setD((x) => ({ ...x, vin }))} customerId={car.customer_id} error={tried ? errs.vin : null} />}
      </div>
    </Sheet>
  );
}
