/* A car (#/vehicle/:id): what it is (year, make, model, version, engine, VIN, plate, odometer, colour, tires, notes),
   its « Fiche technique » and its job history. « Lire le NIV » fills the fields from the VIN; « Scanner le NIV » reads
   the barcode with the camera where the phone can. */
import type { ComponentChildren } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { Pencil, ScanLine, Trash2, Car, UserRound } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { isField } from '../../app/routes';
import { navigate } from '../../app/router';
import { t, lang } from '../../lib/i18n';
import { vinCheck } from '../../lib/text';
import { vehicle, customer, customerName, allJobs } from '../../data/select';
import { saveVehicle } from '../../data/api';
import { net } from '../../data/sync';
import type { Vehicle } from '../../data/types';
import { Page, Panel, Kv, Button, Sheet, Field, Input, Select, Textarea, Banner, Empty, Skeleton, Pill, ask, attempt, whenHistorySettled } from '../../ui';
import { JobTicket } from '../jobs/JobTicket';
import { jobOrder } from './facts';
import { SpecPanel } from './SpecPanel';
import { VinField, VinScanSheet, LastOilField, canScan, readVin, vinSavable, yearOk, type CarFields } from './VehicleBits';
import { lastOil } from '../oil/select';
import { dateShort } from './bits';
import { today, isValidDay } from '../../lib/dates';
import { CarPicker } from './CarPicker';
import { useVinHistory, VinVisits } from './VinHistory';
import { specKeyOf } from './engineRef';
import { km, parseKm, engineLine, sampleNumber } from './vehicleText';
import { Plate, carName } from './bits';
import './customers.css';

const FUELS = ['essence', 'diesel', 'hybride', 'electrique', 'e85', 'gnc'];
const DRIVES = ['fwd', 'rwd', 'awd', '4wd', '2wd'];
const word = (group: 'fuel' | 'drive', v: string | null | undefined) => {
  if (!v) return null;
  const k = `vehicles.${group}.${v}`;
  const s = t(k);
  return s === k ? v : s;
};

export default function VehicleScreen({ params }: ScreenProps) {
  const [editing, setEditing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const gone = useRef(false);
  const v = vehicle(params.id);
  // (asked before any early return: the same hooks on every render)
  const byVin = useVinHistory(v?.vin, v?.customer_id ?? null);
  if (!v) {
    if (gone.current) return null;
    return (
      <Page class="customers-page" title={t('vehicles.title')} back="/customers">
        {net.value.ready
          ? <Panel><Empty icon={<Car />} title={t('vehicles.screen.notFound.title')} text={t('vehicles.screen.notFound.text')} action={<Button variant="primary" href="#/customers">{t('vehicles.screen.notFound.action')}</Button>} /></Panel>
          : <Panel><div aria-busy="true"><Skeleton h={22} lines={5} /></div></Panel>}
      </Page>
    );
  }
  const owner = customer(v.customer_id);
  const canEdit = isField();
  const jobs = allJobs.value.filter((j) => j.vehicle_id === v.id).sort((a, b) => jobOrder(b, a));
  const check = v.vin && v.vin.length === 17 ? vinCheck(v.vin) : null;
  const engine = v.engine || engineLine({ displacement: v.displacement, cylinders: v.cylinders });
  const oil = lastOil(v);
  const items: [ComponentChildren, ComponentChildren][] = [
    [t('vehicles.fields.trim'), v.trim],
    [t('vehicles.fields.engine'), engine || null],
    [t('vehicles.fields.fuel'), word('fuel', v.fuel)],
    [t('vehicles.fields.drive'), word('drive', v.drive)],
    [t('vehicles.fields.vin'), v.vin && <span class="row-wrap"><span class="customers-vin-text">{v.vin}</span>{check === 'bad' && <Pill tone="warn" dot={false}>{t('vehicles.vin.check')}</Pill>}</span>],
    [t('vehicles.fields.odometer'), v.odometer_km != null ? km(v.odometer_km, lang.value) : null],
    [t('vehicles.fields.lastOil'), oil && <span data-testid="vehicle-last-oil">{oil.ours ? t('vehicles.fields.lastOilOurs', { day: dateShort(oil.day) }) : dateShort(oil.day)}</span>],
    [t('vehicles.fields.color'), v.color],
    [t('vehicles.fields.tires'), v.tire_size],
    [t('vehicles.fields.notes'), v.notes && <span class="customers-prewrap">{v.notes}</span>]
  ];
  const empty = items.every(([, x]) => x == null || x === '' || x === false);
  // a VIN read by the camera: kept, and what it tells fills what the file does not say yet
  const scanned = async (vin: string) => {
    setScanning(false);
    const r = await readVin(vin);
    const fill: Partial<Vehicle> = {};
    if (r.ok) for (const [k, val] of Object.entries(r.car)) if (val != null && (v as unknown as Record<string, unknown>)[k] == null) (fill as Record<string, unknown>)[k] = val;
    await attempt(() => saveVehicle({ id: v.id, vin, ...fill }), { ok: r.ok ? t('vehicles.scan.savedFilled') : t('vehicles.scan.saved') });
  };
  return (
    <Page class="customers-page" title={carName(v)} back={owner ? `/customer/${owner.id}` : '/customers'} data-testid="vehicle-screen"
      sub={<span class="customers-line">{owner && <a class="customers-link customers-owner" href={`#/customer/${owner.id}`}><UserRound size={16} aria-hidden="true" />{customerName(owner)}</a>}<Plate plate={v.plate} /></span>}
      actions={canEdit && <Button icon={<Pencil size={18} />} onClick={() => setEditing(true)} data-testid="vehicle-edit">{t('common.edit')}</Button>}>
      <div class="customers-file">
        <div class="customers-side">
          <Panel title={t('vehicles.screen.details')} data-testid="vehicle-details"
            action={canEdit && !v.vin && canScan() && <Button icon={<ScanLine size={18} />} onClick={() => setScanning(true)} data-testid="vehicle-scan">{t('vehicles.scan.button')}</Button>}>
            {empty ? <p class="muted" style={{ margin: 0 }}>{t('vehicles.screen.empty')}</p> : <Kv items={items} class="customers-kv" />}
          </Panel>
          <SpecPanel v={v} canEdit={canEdit} />
        </div>
        <div class="customers-main">
          {byVin.state === 'ok' ? (
            /* the car's own file: every visit of this VIN, whoever owned it then */
            <Panel title={t('vehicles.vinHistory.title')} sub={t('vehicles.vinHistory.sub')} data-testid="vehicle-history">
              {byVin.visits.length ? <VinVisits visits={byVin.visits} owners /> : <p class="muted" style={{ margin: 0 }}>{t('vehicles.vinHistory.none')}</p>}
            </Panel>
          ) : (
            <Panel title={t('vehicles.screen.history')} sub={jobs.length ? t('customers.jobs.count', { n: jobs.length }) : undefined} data-testid="vehicle-history">
              <div class="stack">
                {jobs.length ? <div class="stack">{jobs.map((j) => <JobTicket key={j.id} job={j} showDay />)}</div> : <p class="muted" style={{ margin: 0 }}>{t('vehicles.screen.historyNone')}</p>}
                {byVin.state === 'none' && <p class="small muted" style={{ margin: 0 }}>{t('vehicles.vinHistory.noVin')}</p>}
                {byVin.state === 'error' && <p class="small muted" style={{ margin: 0 }}>{t('vehicles.vinHistory.offline')}</p>}
              </div>
            </Panel>
          )}
        </div>
      </div>
      {scanning && <VinScanSheet onClose={() => setScanning(false)} onVin={(vin) => void scanned(vin)} />}
      {editing && <VehicleEditSheet v={v} onClose={() => setEditing(false)}
        onRemoved={() => { gone.current = true; setEditing(false); setTimeout(() => navigate(owner ? `/customer/${owner.id}` : '/customers', { replace: true }), 0); }} />}
    </Page>
  );
}

/* ---------- « Modifier » ---------- */
interface VDraft { year: string; make: string; model: string; trim: string; engine: string; displacement: string; cylinders: string; fuel: string; drive: string; vin: string; plate: string; odometer: string; color: string; tire_size: string; notes: string; lastOil: string }
const s = (x: unknown) => (x == null ? '' : String(x));
function draftOf(v: Vehicle): VDraft {
  return { year: s(v.year), make: s(v.make), model: s(v.model), trim: s(v.trim), engine: s(v.engine), displacement: v.displacement ? Number(v.displacement).toFixed(1) : '', cylinders: s(v.cylinders),
    fuel: s(v.fuel), drive: s(v.drive), vin: s(v.vin), plate: s(v.plate), odometer: s(v.odometer_km), color: s(v.color), tire_size: s(v.tire_size), notes: s(v.notes), lastOil: s(v.last_oil_on) };
}
function patchOf(d: VDraft): Partial<Vehicle> {
  const txt = (x: string) => x.trim() || null;
  const disp = Number(d.displacement.replace(',', '.'));
  return {
    year: d.year.trim() ? Number(d.year) : null, make: txt(d.make), model: txt(d.model), trim: txt(d.trim), engine: txt(d.engine),
    displacement: d.displacement.trim() && Number.isFinite(disp) ? Math.round(disp * 10) / 10 : null, cylinders: d.cylinders.trim() ? Number(d.cylinders) : null,
    fuel: txt(d.fuel), drive: txt(d.drive), vin: txt(d.vin), plate: d.plate.trim() ? d.plate.trim().toUpperCase().replace(/\s+/g, ' ') : null,
    odometer_km: parseKm(d.odometer), color: txt(d.color), tire_size: d.tire_size.trim() ? d.tire_size.trim().toUpperCase() : null, notes: txt(d.notes),
    last_oil_on: isValidDay(d.lastOil) && d.lastOil <= today() ? d.lastOil : null
  };
}
function errorsOf(d: VDraft) {
  const disp = Number(d.displacement.replace(',', '.'));
  const cyl = Number(d.cylinders);
  const odo = parseKm(d.odometer);
  return {
    year: d.year.trim() && !yearOk(d.year.trim()) ? t('vehicles.errors.year') : null,
    vin: !vinSavable(d.vin) ? t('vehicles.errors.vin') : null,
    displacement: d.displacement.trim() && !(disp > 0.5 && disp < 10) ? t('vehicles.errors.displacement') : null,
    cylinders: d.cylinders.trim() && !(Number.isInteger(cyl) && cyl >= 2 && cyl <= 16) ? t('vehicles.errors.cylinders') : null,
    odometer: odo != null && (Number.isNaN(odo) || odo > 3000000) ? t('vehicles.errors.km') : null
  };
}

function VehicleEditSheet(p: { v: Vehicle; onClose: () => void; onRemoved: () => void }) {
  const [d, setD] = useState<VDraft>(() => draftOf(p.v));
  const [tried, setTried] = useState(false);
  const before = useMemo(() => patchOf(draftOf(p.v)), []);
  const set = (patch: Partial<VDraft>) => setD((x) => ({ ...x, ...patch }));
  const errs = errorsOf(d);
  const bad = Object.values(errs).some(Boolean);
  const after = patchOf(d);
  const diff: Partial<Vehicle> = {};
  for (const [k, val] of Object.entries(after)) if ((before as Record<string, unknown>)[k] !== val) (diff as Record<string, unknown>)[k] = val;
  const dirty = Object.keys(diff).length > 0;
  const decoded = (car: Partial<CarFields>) => set({
    year: car.year ? String(car.year) : d.year, make: car.make || d.make, model: car.model || d.model, trim: car.trim || d.trim, engine: car.engine || d.engine,
    displacement: car.displacement ? Number(car.displacement).toFixed(1) : d.displacement, cylinders: car.cylinders ? String(car.cylinders) : d.cylinders,
    fuel: car.fuel || d.fuel, drive: car.drive || d.drive
  });
  const close = async () => {
    if (dirty && !(await ask({ title: t('customers.file.leave.title'), text: t('customers.file.leave.text'), ok: t('customers.file.leave.ok'), danger: true }))) return;
    whenHistorySettled(p.onClose);
  };
  const save = async () => {
    setTried(true);
    if (bad) return;
    if (!dirty) { p.onClose(); return; }
    // the engine changed: the sheet linked by its key no longer fits
    const v = p.v;
    const unlink = v.spec_key && v.spec_key === specKeyOf(v) && specKeyOf({ ...v, ...after }) !== v.spec_key ? { spec_key: null } : {};
    if (await attempt(() => saveVehicle({ id: v.id, ...diff, ...unlink }), { ok: t('vehicles.screen.saved') })) p.onClose();
  };
  const remove = async () => {
    if (await attempt(() => saveVehicle({ id: p.v.id, deleted_at: new Date().toISOString() }), { ok: t('vehicles.screen.removed') })) p.onRemoved();
  };
  const err = (k: keyof ReturnType<typeof errorsOf>) => (tried ? errs[k] : null);
  return (
    <Sheet open onClose={() => void close()} title={t('vehicles.screen.editTitle')} wide data-testid="vehicle-edit-sheet"
      footer={<>
        <Button onClick={() => void close()}>{t('common.cancel')}</Button>
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
