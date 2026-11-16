/* « Ajouter un véhicule »: the car's form (year → make → model from the lists, or the VIN), the last oil change, and
   the sheet that saves it for a customer. The rules are in domain/vehicles/carDraft.ts. */
import { useRef, useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { today } from '../../lib/dates';
import { saveVehicle } from '../../data/api';
import { carErrors, carRow, withChoice, withMode, EMPTY_CAR, type AddDraft, type AddMode } from '../../domain/vehicles/carDraft';
import { Button, Field, DateInput, Sheet, Seg, run } from '../../ui';
import { CarPicker } from './CarPicker';
import { VinField } from './VinField';
import '../places/customers.css';

/** the car's fields: year → make → model from the lists, or the VIN (typed or scanned).
    `onPatch` merges into the latest draft (the parent's setState with a function): the VIN's decoding arrives a moment after
    the VIN itself, and must not put back the draft as it was before */
export function CarForm(p: { value: AddDraft; onPatch: (patch: Partial<AddDraft>) => void; mode: AddMode; onMode: (m: AddMode) => void; tried: boolean; autoFocusVin?: boolean; customerId?: string | null }) {
  const d = p.value;
  const set = p.onPatch;
  const e = carErrors(d, p.mode);
  const switchMode = (m: AddMode) => {
    const patch = withMode(d, m);
    if (patch) set(patch);
    p.onMode(m);
  };
  return (
    <div class="stack">
      <Seg value={p.mode} onValue={switchMode} label={t('vehicles.add.how')} class="customers-seg" data-testid="vehicle-add-mode"
        options={[{ value: 'ymm', label: t('vehicles.add.byModel') }, { value: 'vin', label: t('vehicles.add.byVin') }]} />
      {p.mode === 'vin' && (
        <VinField value={d.vin} onValue={(vin) => set({ vin })} autoFocus={p.autoFocusVin} error={p.tried ? e.vin : null} customerId={p.customerId}
          onDecoded={(car) => set({ ...(car.year ? { year: String(car.year) } : {}), ...(car.make ? { make: car.make } : {}), ...(car.model ? { model: car.model } : {}), extra: car })} />
      )}
      {(p.mode === 'ymm' || d.make || d.model) && (
        <CarPicker value={{ year: d.year, make: d.make, model: d.model }} onValue={(c) => set(withChoice(d, c))} testid="vadd"
          errors={{ year: p.tried ? e.year : null, make: p.tried && e.model && !d.make.trim() ? e.model : null, model: p.tried && e.model && d.make.trim() && !d.model.trim() ? e.model : null }} />
      )}
      {p.mode === 'ymm' && <p class="small muted" style={{ margin: 0 }}>{t('vehicles.add.later')}</p>}
      <LastOilField value={d.lastOil || ''} onValue={(lastOil) => set({ lastOil })} />
    </div>
  );
}

/** « Dernier changement d’huile »: the day the customer says their oil was last changed; « Rappels d’huile » counts 6 months from it */
export function LastOilField(p: { value: string; onValue: (v: string) => void }) {
  return (
    <Field label={t('vehicles.fields.lastOil')} hint={t('vehicles.fields.lastOilHint')} optional>
      <span data-testid="car-last-oil"><DateInput value={p.value} onValue={p.onValue} max={today()} aria-label={t('vehicles.fields.lastOil')} /></span>
    </Field>
  );
}

export function VehicleAddSheet(p: { customerId: string; onClose: () => void; onAdded: (id: string) => void }) {
  const [mode, setMode] = useState<AddMode>('ymm');
  const [d, setD] = useState<AddDraft>(EMPTY_CAR);
  const [tried, setTried] = useState(false);
  // the draft as it is now, for the save (a decoding may have patched it after this render)
  const latest = useRef(d);
  latest.current = d;
  const add = async () => {
    setTried(true);
    const draft = latest.current;
    const e = carErrors(draft, mode);
    if (e.year || e.model || e.vin) return;
    const id = await run(() => saveVehicle(carRow(draft, p.customerId)), { ok: t('vehicles.add.added') });
    if (id) p.onAdded(id);
  };
  return (
    <Sheet open onClose={p.onClose} title={t('vehicles.add.title')} data-testid="vehicle-add"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={add} data-testid="vehicle-add-ok">{t('vehicles.add.ok')}</Button>
      </>}>
      <CarForm value={d} onPatch={(patch) => setD((x) => ({ ...x, ...patch }))} mode={mode} onMode={setMode} tried={tried} autoFocusVin customerId={p.customerId} />
    </Sheet>
  );
}
