/* The VIN (typed, scanned with the camera, read by the server), and « Ajouter un véhicule ».
   The camera scan uses the browser's own barcode reader (BarcodeDetector): the button is hidden where there is none. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { ScanLine, Flashlight, FlashlightOff, CarFront, Check } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { cleanVin, vinCheck, vinYear } from '../../lib/text';
import { decodeVin, errorMessage, saveVehicle } from '../../data/api';
import { isNetworkError } from '../../data/sync';
import type { Vehicle } from '../../data/types';
import { Button, Field, Input, InputWithButton, IconButton, Sheet, Seg, Banner, Spinner, run } from '../../ui';
import { engineRef, ensureEngineRef, makeModel } from './engineRef';
import { engineLine, vinFromCode } from './vehicleText';
import { squash } from './search';
import './customers.css';

/* ---------- reading a VIN on the server ---------- */
export type CarFields = Pick<Vehicle, 'year' | 'make' | 'model' | 'trim' | 'engine' | 'displacement' | 'cylinders' | 'fuel' | 'drive'>;
export type VinResult = { ok: true; car: Partial<CarFields>; note: string | null } | { ok: false; message: string; offline: boolean };
const DRIVES = new Set(['fwd', 'rwd', 'awd', '4wd', '2wd']);
export async function readVin(vin: string): Promise<VinResult> {
  try {
    const r = await decodeVin(vin) as { ok?: boolean; vehicle?: Record<string, unknown>; code?: string; error?: string };
    if (!r || r.ok === false) return { ok: false, message: errorMessage(r), offline: false };
    const v = r.vehicle || {};
    const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; };
    const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
    const car: Partial<CarFields> = {};
    if (num(v.year)) car.year = num(v.year);
    if (str(v.make)) car.make = str(v.make);
    if (str(v.model)) car.model = str(v.model);
    if (str(v.trim)) car.trim = str(v.trim);
    if (num(v.displacement)) car.displacement = Math.round(Number(v.displacement) * 10) / 10;
    if (num(v.cylinders)) car.cylinders = num(v.cylinders);
    if (str(v.fuel)) car.fuel = str(v.fuel)!.toLowerCase();
    const drive = str(v.drive)?.toLowerCase();
    if (drive && DRIVES.has(drive)) car.drive = drive;
    const line = engineLine({ displacement: car.displacement, cylinders: car.cylinders, turbo: v.turbo === true, fuel: car.fuel, code: str(v.engine) }, engineWords());
    if (line) car.engine = line;
    if (!car.make && !car.model) return { ok: false, message: t('vehicles.vin.nothing'), offline: false };
    return { ok: true, car, note: str(v.error) };
  } catch (e) {
    if (isNetworkError(e)) return { ok: false, message: t('vehicles.vin.offline'), offline: true };
    return { ok: false, message: errorMessage(e), offline: false };
  }
}
export const engineWords = () => ({ turbo: t('vehicles.engine.turbo'), hybrid: t('vehicles.engine.hybrid'), diesel: t('vehicles.engine.diesel') });

/* ---------- can this phone scan? ---------- */
const FORMATS = ['code_39', 'code_128', 'data_matrix', 'qr_code'];
interface Detected { rawValue: string }
interface Detector { detect(src: CanvasImageSource): Promise<Detected[]> }
interface DetectorClass { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> }
const BD = (): DetectorClass | null => (typeof globalThis !== 'undefined' && (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector) || null;
export const scanSupport = signal<string[] | null>(null);
function detectScan() {
  if (scanSupport.value !== null) return;
  scanSupport.value = [];
  const cls = BD();
  if (!cls || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  cls.getSupportedFormats().then((f) => { scanSupport.value = FORMATS.filter((x) => f.includes(x)); }, () => { scanSupport.value = []; });
}
if (typeof window !== 'undefined') detectScan();
export const canScan = () => (scanSupport.value?.length || 0) > 0;

/* ---------- the VIN field ---------- */
export function vinState(vin: string): 'empty' | 'short' | 'ok' | 'bad' | 'old' {
  if (!vin) return 'empty';
  if (vin.length === 17) return vinCheck(vin) === 'ok' ? 'ok' : 'bad';
  return vin.length >= 11 && vin.length < 17 ? 'old' : 'short';
}
/** a VIN the database takes: none, or 11 to 17 letters and digits (never I, O, Q) */
export const vinSavable = (vin: string) => !vin || (vin.length >= 11 && vin.length <= 17);

export function VinField(p: { value: string; onValue: (v: string) => void; onDecoded?: (car: Partial<CarFields>) => void; autoFocus?: boolean; error?: string | null }) {
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'bad'; text: string } | null>(null);
  const v = p.value || '';
  const st = vinState(v);
  const set = (s: string) => {
    const c = cleanVin(s);
    p.onValue(c.length > 17 ? vinFromCode(c)?.vin ?? c.slice(0, 17) : c);
    setMsg(null);
  };
  const decode = async (vin = v) => {
    if (!p.onDecoded) return;
    setBusy(true);
    const r = await readVin(vin);
    setBusy(false);
    if (r.ok) {
      p.onDecoded(r.car);
      const name = [r.car.year, r.car.make, r.car.model, r.car.trim].filter(Boolean).join(' ');
      setMsg({ kind: 'ok', text: t('vehicles.vin.decoded', { car: name }) + (r.note ? ` ${t('vehicles.vin.partial')}` : '') });
    } else setMsg({ kind: r.offline ? 'warn' : 'bad', text: r.message });
  };
  const status = st === 'ok' ? t('vehicles.vin.ok') : st === 'bad' ? t('vehicles.vin.bad') : st === 'old' ? t('vehicles.vin.old', { n: v.length }) : st === 'short' ? t('vehicles.vin.count', { n: v.length }) : t('vehicles.vin.where');
  const year = v.length === 17 ? vinYear(v) : null;
  return (
    <div class="stack customers-vin">
      <Field label={t('vehicles.fields.vin')} error={p.error} hint={<span class={st === 'bad' ? 'customers-warn-text' : st === 'ok' ? 'customers-ok-text' : ''} data-testid="vin-status">{status}{st === 'ok' && year ? ` ${t('vehicles.vin.year', { year })}` : ''}</span>}>
        <InputWithButton class="input-vin" value={v} onValue={set} autoComplete="off" autoCapitalize="characters" spellcheck={false} autoFocus={p.autoFocus}
          inputMode="text" maxLength={24} placeholder="2HGFC2F59KH512345" invalid={!!p.error} data-testid="vin-input"
          button={canScan() ? <IconButton icon={<ScanLine />} label={t('vehicles.scan.button')} onClick={() => setScan(true)} data-testid="vin-scan" /> : null} />
      </Field>
      {p.onDecoded && (
        <Button icon={<CarFront size={18} />} disabled={v.length !== 17} busy={busy} onClick={() => decode()} data-testid="vin-decode">{t('vehicles.vin.read')}</Button>
      )}
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      {scan && <VinScanSheet onClose={() => setScan(false)} onVin={(vin) => { setScan(false); set(vin); if (p.onDecoded) void decode(vin); }} />}
    </div>
  );
}

/* ---------- the camera ---------- */
export function VinScanSheet(p: { onClose: () => void; onVin: (vin: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const onVin = useRef(p.onVin);
  onVin.current = p.onVin;
  const [state, setState] = useState<'starting' | 'live' | 'denied' | 'nocam' | 'error'>('starting');
  const [torch, setTorch] = useState<boolean | null>(null);
  const [doubtful, setDoubtful] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const cls = BD();
    (async () => {
      try {
        if (!cls) throw Object.assign(new Error('none'), { name: 'NotSupportedError' });
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive) { s.getTracks().forEach((x) => x.stop()); return; }
        stream.current = s;
        const el = video.current!;
        el.srcObject = s;
        await el.play().catch(() => undefined);
        const track = s.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() || {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);
        setState('live');
        const det = new cls({ formats: scanSupport.value?.length ? scanSupport.value : FORMATS });
        let last = '', seen = 0;
        const tick = async () => {
          if (!alive) return;
          try {
            if (el.readyState >= 2) {
              for (const code of await det.detect(el)) {
                const r = vinFromCode(code.rawValue);
                if (!r) continue;
                if (r.ok) { try { navigator.vibrate?.(60); } catch { /* ignore */ } onVin.current(r.vin); return; }
                // a check digit that does not match (a car from outside North America, or a bad read): the same twice, then ask
                if (r.vin === last) { if (++seen >= 2) setDoubtful(r.vin); } else { last = r.vin; seen = 1; }
              }
            }
          } catch { /* a frame that could not be read */ }
          timer = window.setTimeout(tick, 180);
        };
        void tick();
      } catch (e) {
        const n = (e as { name?: string })?.name;
        if (alive) setState(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'nocam' : 'error');
      }
    })();
    return () => { alive = false; clearTimeout(timer); stream.current?.getTracks().forEach((x) => x.stop()); stream.current = null; };
  }, []);
  const flip = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch == null) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { setTorch(null); }
  };
  return (
    <Sheet open onClose={p.onClose} title={t('vehicles.scan.title')} data-testid="vin-scan-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        {torch != null && <Button icon={torch ? <FlashlightOff size={18} /> : <Flashlight size={18} />} onClick={flip}>{torch ? t('vehicles.scan.torchOff') : t('vehicles.scan.torchOn')}</Button>}
      </>}>
      <div class="stack">
        <div class={`customers-scan${state === 'live' ? ' is-live' : ''}`}>
          <video ref={video} playsInline muted autoPlay aria-hidden="true" />
          <span class="customers-scan-frame" aria-hidden="true"><span class="customers-scan-line" /></span>
          {state === 'starting' && <span class="customers-scan-msg"><Spinner label={t('vehicles.scan.starting')} /></span>}
        </div>
        {state === 'live' && <p class="muted" style={{ margin: 0 }}>{t('vehicles.scan.aim')}</p>}
        {state === 'denied' && <Banner kind="warn">{t('vehicles.scan.denied')}</Banner>}
        {state === 'nocam' && <Banner kind="warn">{t('vehicles.scan.noCamera')}</Banner>}
        {state === 'error' && <Banner kind="warn">{t('vehicles.scan.failed')}</Banner>}
        {doubtful && (
          <Banner kind="warn" title={t('vehicles.scan.doubt', { vin: doubtful })} action={<Button size="sm" variant="primary" icon={<Check size={16} />} onClick={() => p.onVin(doubtful)}>{t('vehicles.scan.keep')}</Button>}>
            {t('vehicles.vin.bad')}
          </Banner>
        )}
      </div>
    </Sheet>
  );
}

/* ---------- makes and models (suggestions while typing) ---------- */
export const MAKES = ['Acura', 'Alfa Romeo', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat', 'Ford', 'Genesis', 'GMC', 'Honda', 'Hyundai',
  'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan', 'Polestar', 'Porsche', 'RAM',
  'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'];
export function modelsOf(make: string): string[] {
  const mk = makeModel(make, '').make;
  if (!mk) return [];
  const set = new Set<string>();
  for (const r of engineRef.value.rows) if (squash(r.make) === mk) set.add(r.model);
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}
export function MakeModelLists(p: { make: string; ids: { make: string; model: string } }) {
  useEffect(() => { void ensureEngineRef(); }, []);
  const models = modelsOf(p.make);
  return (
    <>
      <datalist id={p.ids.make}>{MAKES.map((m) => <option key={m} value={m} />)}</datalist>
      <datalist id={p.ids.model}>{models.map((m) => <option key={m} value={m} />)}</datalist>
    </>
  );
}
export function yearOk(s: string): boolean {
  const y = Number(s);
  return /^\d{4}$/.test(s) && y >= 1950 && y <= new Date().getFullYear() + 2;
}

/* ---------- « Ajouter un véhicule » ---------- */
interface AddDraft { year: string; make: string; model: string; vin: string; extra: Partial<CarFields> }
export function VehicleAddSheet(p: { customerId: string; onClose: () => void; onAdded: (id: string) => void }) {
  const [mode, setMode] = useState<'ymm' | 'vin'>('ymm');
  const [d, setD] = useState<AddDraft>({ year: '', make: '', model: '', vin: '', extra: {} });
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<AddDraft>) => setD((x) => ({ ...x, ...patch }));
  const ids = { make: `vadd-make-${p.customerId}`, model: `vadd-model-${p.customerId}` };
  const errYear = d.year.trim() && !yearOk(d.year.trim()) ? t('vehicles.errors.year') : null;
  const errModel = mode === 'ymm' && (!d.make.trim() || !d.model.trim()) ? t('vehicles.errors.model') : null;
  const errVin = mode === 'vin' && !vinSavable(d.vin) ? t('vehicles.errors.vin') : mode === 'vin' && !d.vin && !d.make.trim() ? t('vehicles.errors.vinOrModel') : null;
  const add = async () => {
    setTried(true);
    if (errYear || errModel || errVin) return;
    const id = await run(() => saveVehicle({
      ...d.extra, customer_id: p.customerId, year: d.year.trim() ? Number(d.year) : null, make: d.make.trim() || null, model: d.model.trim() || null,
      vin: d.vin || null
    }), { ok: t('vehicles.add.added') });
    if (id) p.onAdded(id);
  };
  return (
    <Sheet open onClose={p.onClose} title={t('vehicles.add.title')} data-testid="vehicle-add"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={add} data-testid="vehicle-add-ok">{t('vehicles.add.ok')}</Button>
      </>}>
      <div class="stack">
        <Seg value={mode} onValue={setMode} label={t('vehicles.add.how')} class="customers-seg" data-testid="vehicle-add-mode"
          options={[{ value: 'ymm', label: t('vehicles.add.byModel') }, { value: 'vin', label: t('vehicles.add.byVin') }]} />
        {mode === 'vin' && (
          <VinField value={d.vin} onValue={(vin) => set({ vin })} autoFocus error={tried ? errVin : null}
            onDecoded={(car) => set({ year: car.year ? String(car.year) : d.year, make: car.make || d.make, model: car.model || d.model, extra: car })} />
        )}
        {(mode === 'ymm' || d.make || d.model) && (
          <div class="customers-ymm">
            <Field label={t('vehicles.fields.year')} error={tried ? errYear : null}>
              <Input value={d.year} onValue={(year) => set({ year: year.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" autoComplete="off" placeholder={String(new Date().getFullYear() - 5)} autoFocus={mode === 'ymm'} invalid={tried && !!errYear} data-testid="vadd-year" />
            </Field>
            <Field label={t('vehicles.fields.make')} error={tried && errModel && !d.make.trim() ? errModel : null}>
              <Input value={d.make} onValue={(make) => set({ make })} list={ids.make} autoComplete="off" autoCapitalize="words" placeholder="Honda" invalid={tried && !!errModel && !d.make.trim()} data-testid="vadd-make" />
            </Field>
            <Field label={t('vehicles.fields.model')} error={tried && errModel && d.make.trim() && !d.model.trim() ? errModel : null}>
              <Input value={d.model} onValue={(model) => set({ model })} list={ids.model} autoComplete="off" autoCapitalize="words" placeholder="Civic" invalid={tried && !!errModel && !d.model.trim()} data-testid="vadd-model" />
            </Field>
            <MakeModelLists make={d.make} ids={ids} />
          </div>
        )}
        {mode === 'ymm' && <p class="small muted" style={{ margin: 0 }}>{t('vehicles.add.later')}</p>}
      </div>
    </Sheet>
  );
}
