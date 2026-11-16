/* « Modifier » a car: the VIN (type, scan, « Lire le NIV »), Année / Marque / Modèle, version, engine, plate, km, colour,
   tires, last oil change, notes; « Retirer ce véhicule » (two taps, its history stays). Only the fields that changed are
   sent; leaving with changes asks first. The rules are vehicleDraft.ts. */
import { useMemo, useState } from 'preact/hooks';
import { Trash2 } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { saveVehicle } from '../../data/api';
import type { Vehicle } from '../../data/types';
import { Button, Sheet, Field, Input, Select, Textarea, Banner, ask, attempt, whenHistorySettled } from '../../ui';
import { VinField, LastOilField, type CarFields } from '../../shared/vehicles/VehicleBits';
import { CarPicker } from '../../shared/vehicles/CarPicker';
import { km, sampleNumber } from '../../shared/vehicles/vehicleText';
import { decodedDraft, diffOf, draftOf, errorsOf, patchOf, specLinkPatch, type VDraft, type VErrors } from './vehicleDraft';

const FUELS = ['essence', 'diesel', 'hybride', 'electrique', 'e85', 'gnc'];
const DRIVES = ['fwd', 'rwd', 'awd', '4wd', '2wd'];
export function VehicleEditSheet(p: { v: Vehicle; onClose: () => void; onLeaving: (on: boolean) => void; onRemoved: () => void }) {
  const [d, setD] = useState<VDraft>(() => draftOf(p.v));
  const [tried, setTried] = useState(false);
  const before = useMemo(() => patchOf(draftOf(p.v)), []);
  const set = (patch: Partial<VDraft>) => setD((x) => ({ ...x, ...patch }));
  const errs = errorsOf(d);
  const bad = Object.values(errs).some(Boolean);
  const after = patchOf(d);
  const diff = diffOf(before, after);
  const dirty = Object.keys(diff).length > 0;
  // applied to the draft as it is when the answer comes (a field typed meanwhile is kept)
  const decoded = (car: Partial<CarFields>) => set(decodedDraft(car));
  const close = async () => {
    if (dirty && !(await ask({ title: t('customers.file.leave.title'), text: t('customers.file.leave.text'), ok: t('customers.file.leave.ok'), danger: true }))) return;
    whenHistorySettled(p.onClose);
  };
  const save = async () => {
    setTried(true);
    if (bad) return;
    if (!dirty) { p.onClose(); return; }
    const v = p.v;
    if (await attempt(() => saveVehicle({ id: v.id, ...diff, ...specLinkPatch(v, diff) }), { ok: t('vehicles.screen.saved') })) p.onClose();
  };
  const remove = async () => {
    // the car leaves the device inside saveVehicle: the screen knows it is leaving before that
    p.onLeaving(true);
    if (await attempt(() => saveVehicle({ id: p.v.id, deleted_at: new Date().toISOString() }), { ok: t('vehicles.screen.removed') })) p.onRemoved();
    else p.onLeaving(false);
  };
  const err = (k: keyof VErrors) => (tried ? errs[k] : null);
  return (
    <Sheet open onClose={() => void close()} title={t('vehicles.screen.editTitle')} wide data-testid="vehicle-edit-sheet"
      footer={<>
        <Button onClick={() => close()}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={save} data-testid="vehicle-save">{t('common.save')}</Button>
      </>}>
      <div class="stack-lg">
        {tried && bad && <Banner kind="bad">{t('customers.form.fix')}</Banner>}
        <VinField value={d.vin} onValue={(vin) => set({ vin })} onDecoded={decoded} error={err('vin')} customerId={p.v.customer_id} />
        <section class="stack">
          <h3 class="divider-title">{t('vehicles.screen.groupCar')}</h3>
          <CarPicker value={{ year: d.year, make: d.make, model: d.model }} onValue={(c) => set({ year: c.year, make: c.make, model: c.model, ...(c.engine ? { engine: c.engine.engine, displacement: c.engine.displacement ? c.engine.displacement.toFixed(1) : d.displacement, cylinders: c.engine.cylinders ? String(c.engine.cylinders) : d.cylinders, fuel: c.engine.fuel || d.fuel } : {}) })} testid="ve" errors={{ year: err('year') }} />
          <Field label={t('vehicles.fields.trim')} optional><Input value={d.trim} onValue={(trim) => set({ trim })} autoComplete="off" placeholder="LX" /></Field>
        </section>
        <section class="stack">
          <h3 class="divider-title">{t('vehicles.screen.groupEngine')}</h3>
          <Field label={t('vehicles.fields.engine')} optional><Input value={d.engine} onValue={(engine) => set({ engine })} autoComplete="off" placeholder={t('vehicles.fields.enginePlaceholder')} data-testid="ve-engine" /></Field>
          <div class="grid-2">
            <Field label={t('vehicles.fields.displacement')} optional error={err('displacement')}>
              <Input value={d.displacement} onValue={(x) => set({ displacement: x })} inputMode="decimal" autoComplete="off" placeholder={sampleNumber(2, 1, lang.value)} invalid={!!err('displacement')} />
            </Field>
            <Field label={t('vehicles.fields.cylinders')} optional error={err('cylinders')}>
              <Input value={d.cylinders} onValue={(x) => set({ cylinders: x.replace(/\D/g, '').slice(0, 2) })} inputMode="numeric" autoComplete="off" placeholder="4" invalid={!!err('cylinders')} />
            </Field>
            <Field label={t('vehicles.fields.fuel')} optional>
              <Select value={d.fuel} onValue={(fuel) => set({ fuel })} aria-label={t('vehicles.fields.fuel')}
                options={[{ value: '', label: t('vehicles.unknown') }, ...FUELS.map((f) => ({ value: f, label: t(`vehicles.fuel.${f}`) })), ...(d.fuel && !FUELS.includes(d.fuel) ? [{ value: d.fuel, label: d.fuel }] : [])]} />
            </Field>
            <Field label={t('vehicles.fields.drive')} optional>
              <Select value={d.drive} onValue={(drive) => set({ drive })} aria-label={t('vehicles.fields.drive')}
                options={[{ value: '', label: t('vehicles.unknown') }, ...DRIVES.map((x) => ({ value: x, label: t(`vehicles.drive.${x}`) })), ...(d.drive && !DRIVES.includes(d.drive) ? [{ value: d.drive, label: d.drive }] : [])]} />
            </Field>
          </div>
        </section>
        <section class="stack">
          <h3 class="divider-title">{t('vehicles.screen.groupKeep')}</h3>
          <div class="grid-2">
            <Field label={t('vehicles.fields.plate')} optional><Input value={d.plate} onValue={(plate) => set({ plate })} autoComplete="off" autoCapitalize="characters" placeholder="FHX 4821" data-testid="ve-plate" /></Field>
            <Field label={t('vehicles.fields.odometer')} optional error={err('odometer')}>
              <Input value={d.odometer} onValue={(odometer) => set({ odometer })} inputMode="numeric" autoComplete="off" placeholder={km(84200, lang.value).replace(/\s?km$/, '')} invalid={!!err('odometer')} data-testid="ve-km" />
            </Field>
            <Field label={t('vehicles.fields.color')} optional><Input value={d.color} onValue={(color) => set({ color })} autoComplete="off" /></Field>
            <Field label={t('vehicles.fields.tires')} optional><Input value={d.tire_size} onValue={(tire_size) => set({ tire_size })} autoComplete="off" placeholder={t('vehicles.fields.tiresPlaceholder')} /></Field>
          </div>
          <LastOilField value={d.lastOil} onValue={(lastOil) => set({ lastOil })} />
          <Field label={t('vehicles.fields.notes')} optional><Textarea value={d.notes} onValue={(notes) => set({ notes })} rows={2} /></Field>
        </section>
        <div class="customers-danger">
          <p class="small muted" style={{ margin: 0 }}>{t('vehicles.screen.removeHint')}</p>
          <Button variant="danger" icon={<Trash2 size={18} />} confirm={t('vehicles.screen.removeConfirm')} onClick={remove} data-testid="vehicle-remove">{t('vehicles.screen.remove')}</Button>
        </div>
      </div>
    </Sheet>
  );
}
