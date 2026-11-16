/* The car and the place: a known customer's cars (each with its own work) and the address of this appointment; for a
   new caller, the address and the car(s) typed during the call. */
import { RotateCcw, Plus, Trash2 } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { uuid } from '../../data/sync';
import { vehicle as vehicleRow, vehicleLabel } from '../../data/select';
import { Panel, Field, Input, Button, Banner } from '../../ui';
import { VehiclePicker } from '../../shared/vehicles/VehiclePicker';
import { AddressField, type PlaceValue } from '../../shared/places/AddressField';
import { CarForm, carIsEmpty } from '../../shared/vehicles/VehicleBits';
import { OilHint } from '../../shared/jobs/CarFirst';
import { carDraftLabel } from '../../domain/moment/logic';
import { NO_CAR, workCount, type Action, type CallCar, type Draft, type PlannedCar } from './draft';

type Act = (a: Action) => void;
const samePlace = (a: PlaceValue, b: PlaceValue) => (a.address || '').trim() === (b.address || '').trim() && (a.unit || '') === (b.unit || '');

/** a car's name: its file, else what is typed, else « Voiture 2 » */
export function carName(id: string, callCars: CallCar[]): string {
  const i = callCars.findIndex((c) => c.id === id);
  return vehicleLabel(vehicleRow(id)) || (i >= 0 ? carDraftLabel(callCars[i].draft) || t('booking.call.carN', { n: i + 1 }) : '') || '—';
}

/** the address of this appointment (it may differ from the file) and its unit */
function PlaceFields(p: { place: PlaceValue; act: Act }) {
  return (
    <>
      <AddressField label={t('booking.vehicle.address')} value={p.place} onValue={(v) => p.act({ t: 'place', place: v })} />
      <Field label={t('booking.vehicle.unit')} optional class="book-unit">
        <Input value={p.place.unit} onValue={(v) => p.act({ t: 'place', place: { ...p.place, unit: v || null } })} autoComplete="address-line2" maxLength={20} />
      </Field>
    </>
  );
}

/** a known customer: which car (the other cars with work are listed as « Aussi : … »), and where */
export function VehiclePanel(p: { d: Draft; others: PlannedCar[]; filePlace: PlaceValue; fileHasAddress: boolean; quoteCar: string | null; act: Act }) {
  const { d } = p;
  const choose = (key: string | null) => p.act({ t: 'car', key, mint: uuid() });
  return (
    <Panel title={t('booking.vehicle.title')} data-tour="book-vehicle">
      {!d.customerId ? <p class="muted" style={{ margin: 0 }}>{t('booking.vehicle.firstCustomer')}</p> : (
        <div class="stack">
          <Field label={t('booking.vehicle.vehicle')} group>
            <VehiclePicker customerId={d.customerId} value={d.car === NO_CAR ? null : d.car} onPick={choose} />
            <OilHint vehicleId={d.car || null} />
            {p.others.length > 0 && (
              <div class="book-cars" data-testid="book-cars">
                <span class="small muted">{t('booking.cars.also')}</span>
                {p.others.map((o) => (
                  <button key={o.key} type="button" class="chip" onClick={() => choose(o.key)} data-testid={`book-car-${o.key}`}>
                    {t('booking.cars.chip', { car: carName(o.key, d.callCars), n: workCount(o.work) })}
                  </button>
                ))}
              </div>
            )}
          </Field>
          {p.quoteCar && d.car === NO_CAR && <p class="faint small" style={{ margin: 0 }}>{t('booking.quote.vehicle', { text: p.quoteCar })}</p>}
          <PlaceFields place={d.place} act={p.act} />
          {!d.place.address.trim() && <p class="faint small" style={{ margin: 0 }}>{t('booking.vehicle.noAddress')}</p>}
          {p.fileHasAddress && !samePlace(d.place, p.filePlace) && (
            <div><Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => p.act({ t: 'placeFile', place: p.filePlace })}>{t('booking.vehicle.reset')}</Button></div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** « Appel entrant »: where (the best moments are found with it) */
export function CallAddressPanel(p: { place: PlaceValue; act: Act }) {
  return (
    <Panel title={t('booking.call.addressTitle')} sub={t('booking.call.addressSub')} data-testid="call-address">
      <div class="stack"><PlaceFields place={p.place} act={p.act} /></div>
    </Panel>
  );
}

/** « Appel entrant »: the car(s) of the call; each has its own work, one appointment each in the same moment */
export function CallCarPanel(p: { d: Draft; bad: (id: string) => boolean; act: Act }) {
  const { d } = p;
  const cars = d.callCars;
  const cur = cars.find((c) => c.id === d.car) || cars[0];
  if (!cur) return null;
  const several = cars.length > 1;
  return (
    <Panel title={several ? t('booking.call.carsTitle', { n: cars.length }) : t('booking.call.carTitle')} sub={several ? t('booking.call.carsSub') : t('booking.call.carSub')} data-testid="call-car">
      <div class="stack">
        {several && (
          <div class="book-cars" data-testid="call-cars">
            {cars.map((c, i) => (
              <button key={c.id} type="button" class="chip" aria-pressed={c.id === cur.id} onClick={() => p.act({ t: 'car', key: c.id, mint: uuid() })} data-testid={`call-car-tab-${i + 1}`}>
                {t('booking.cars.chip', { car: carName(c.id, cars), n: workCount(d.work[c.id]) })}
              </button>
            ))}
          </div>
        )}
        <CarForm key={cur.id} value={cur.draft} onPatch={(patch) => p.act({ t: 'callCar', patch })} mode={cur.mode} onMode={(mode) => p.act({ t: 'callCar', mode })} tried={d.tried} />
        {d.tried && several && carIsEmpty(cur.draft) && p.bad(cur.id) && <Banner kind="bad" data-testid="call-car-need">{t('booking.call.needCar')}</Banner>}
        <div class="row-wrap">
          <Button size="sm" icon={<Plus />} onClick={() => p.act({ t: 'addCallCar', id: uuid(), mint: uuid() })} data-testid="call-car-add">{t('booking.call.addCar')}</Button>
          {several && <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => p.act({ t: 'removeCallCar' })} data-testid="call-car-remove">{t('booking.call.removeCar')}</Button>}
        </div>
      </div>
    </Panel>
  );
}
