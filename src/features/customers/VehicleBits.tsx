/* The VIN (typed, scanned with the camera, read by the server), and « Ajouter un véhicule ».
   « Scanner le NIV » works on every phone: the barcode of the door-jamb sticker live in the camera (the phone's own reader,
   or ZXing), or a photo of the printed VIN (windshield, registration) read on the phone (see vinScan.ts). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { ScanLine, Flashlight, FlashlightOff, CarFront, Check, Camera } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { today, isValidDay } from '../../lib/dates';
import { cleanVin, vinCheck, vinYear } from '../../lib/text';
import { decodeVin, errorMessage, saveVehicle } from '../../data/api';
import { isNetworkError } from '../../data/sync';
import type { Vehicle } from '../../data/types';
import { Button, Field, DateInput, InputWithButton, IconButton, Sheet, Seg, Banner, Spinner, run } from '../../ui';
import { engineLine, vinFromCode } from './vehicleText';
import { barcodeReader, hasCamera, readVinPhoto, type VinReading } from './vinScan';
import { CarPicker } from './CarPicker';
import './customers.css';
import { VinSeen } from './VinHistory';

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

/* ---------- can this phone scan? (always: the camera, or a photo) ---------- */
export const canScan = () => true;

/* ---------- the VIN field ---------- */
export function vinState(vin: string): 'empty' | 'short' | 'ok' | 'bad' | 'old' {
  if (!vin) return 'empty';
  if (vin.length === 17) return vinCheck(vin) === 'ok' ? 'ok' : 'bad';
  return vin.length >= 11 && vin.length < 17 ? 'old' : 'short';
}
/** a VIN the database takes: none, or 11 to 17 letters and digits (never I, O, Q) */
export const vinSavable = (vin: string) => !vin || (vin.length >= 11 && vin.length <= 17);

export function VinField(p: { value: string; onValue: (v: string) => void; onDecoded?: (car: Partial<CarFields>) => void; autoFocus?: boolean; error?: string | null; customerId?: string | null }) {
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
          button={<IconButton icon={<ScanLine />} label={t('vehicles.scan.button')} onClick={() => setScan(true)} data-testid="vin-scan" />} />
      </Field>
      {p.onDecoded && (
        <Button icon={<CarFront size={18} />} disabled={v.length !== 17} busy={busy} onClick={() => decode()} data-testid="vin-decode">{t('vehicles.vin.read')}</Button>
      )}
      {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
      {/* a car we already worked on (any owner): its visits, by the VIN */}
      {v.length === 17 && <VinSeen vin={v} customerId={p.customerId} />}
      {scan && <VinScanSheet onClose={() => setScan(false)} onVin={(vin) => { setScan(false); set(vin); if (p.onDecoded) void decode(vin); }} />}
    </div>
  );
}

/* ---------- the camera ---------- */
type ScanState = 'starting' | 'loading' | 'live' | 'denied' | 'nocam' | 'error' | 'reading' | 'notfound';
export function VinScanSheet(p: { onClose: () => void; onVin: (vin: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const reading = useRef<VinReading | null>(null);
  const onVin = useRef(p.onVin);
  onVin.current = p.onVin;
  const [state, setState] = useState<ScanState>('starting');
  const [torch, setTorch] = useState<boolean | null>(null);
  const [doubtful, setDoubtful] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const alive = useRef(true);
  const stopCamera = () => { stream.current?.getTracks().forEach((x) => x.stop()); stream.current = null; setTorch(null); };
  const found = (vin: string) => { try { navigator.vibrate?.(60); } catch { /* ignore */ } onVin.current(vin); };

  useEffect(() => {
    alive.current = true;
    let timer = 0;
    (async () => {
      try {
        if (!hasCamera()) throw Object.assign(new Error('none'), { name: 'NotFoundError' });
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!alive.current) { s.getTracks().forEach((x) => x.stop()); return; }
        stream.current = s;
        const el = video.current!;
        el.srcObject = s;
        await el.play().catch(() => undefined);
        const track = s.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() || {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);
        setState('loading');
        const { detector, native } = await barcodeReader();
        if (!alive.current) return;
        setState('live');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let last = '', seen = 0;
        const tick = async () => {
          if (!alive.current || !stream.current) return;
          try {
            if (el.readyState >= 2 && el.videoWidth) {
              let src: ImageBitmapSource | ImageData = el;
              if (!native && ctx) {
                // ZXing reads a still picture: the middle of the frame (where the code is aimed), at most 1280 px wide
                const w = el.videoWidth, h = el.videoHeight;
                const cw = Math.round(w * 0.9), ch = Math.round(h * 0.6);
                const k = Math.min(1, 1280 / cw);
                canvas.width = Math.round(cw * k); canvas.height = Math.round(ch * k);
                ctx.drawImage(el, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
                src = ctx.getImageData(0, 0, canvas.width, canvas.height);
              }
              for (const code of await detector.detect(src)) {
                const r = vinFromCode(code.rawValue);
                if (!r) continue;
                if (r.ok) { found(r.vin); return; }
                // a check digit that does not match (a car from outside North America, or a bad read): the same twice, then ask
                if (r.vin === last) { if (++seen >= 2) setDoubtful(r.vin); } else { last = r.vin; seen = 1; }
              }
            }
          } catch { /* a frame that could not be read */ }
          timer = window.setTimeout(tick, native ? 180 : 120);
        };
        void tick();
      } catch (e) {
        const n = (e as { name?: string })?.name;
        if (alive.current) setState(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'nocam' : 'error');
      }
    })();
    return () => { alive.current = false; clearTimeout(timer); stopCamera(); reading.current?.cancel(); };
  }, []);

  const flip = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch == null) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { setTorch(null); }
  };
  // a photo of the printed VIN, read on the phone
  const takePhoto = () => { photo.current?.click(); };
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    stopCamera();
    setDoubtful(null);
    setState('reading');
    setProgress(0);
    const r = readVinPhoto(file, (x) => { if (alive.current) setProgress(x); });
    reading.current = r;
    try {
      const out = await r.result;
      if (!alive.current) return;
      if (!out) { setState('notfound'); return; }
      if (out.ok) { found(out.vin); return; }
      setDoubtful(out.vin);
      setState('notfound');
    } catch {
      if (alive.current) setState('notfound');
    } finally {
      reading.current = null;
      if (photo.current) photo.current.value = '';
    }
  };
  const camera = state === 'starting' || state === 'loading' || state === 'live';
  return (
    <Sheet open onClose={p.onClose} title={t('vehicles.scan.title')} data-testid="vin-scan-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        {torch != null && camera && <Button icon={torch ? <FlashlightOff size={18} /> : <Flashlight size={18} />} onClick={flip}>{torch ? t('vehicles.scan.torchOff') : t('vehicles.scan.torchOn')}</Button>}
      </>}>
      <div class="stack">
        {camera && (
          <div class={`customers-scan${state === 'live' ? ' is-live' : ''}`}>
            <video ref={video} playsInline muted autoPlay aria-hidden="true" />
            <span class="customers-scan-frame" aria-hidden="true"><span class="customers-scan-line" /></span>
            {state !== 'live' && <span class="customers-scan-msg"><Spinner label={state === 'loading' ? t('vehicles.scan.loading') : t('vehicles.scan.starting')} /></span>}
          </div>
        )}
        {state === 'live' && <p class="muted" style={{ margin: 0 }}>{t('vehicles.scan.aim')}</p>}
        {state === 'denied' && <Banner kind="warn">{t('vehicles.scan.denied')}</Banner>}
        {state === 'nocam' && <Banner kind="info">{t('vehicles.scan.noCamera')}</Banner>}
        {state === 'error' && <Banner kind="warn">{t('vehicles.scan.failed')}</Banner>}
        {state === 'reading' && (
          <div class="stack" data-testid="vin-photo-reading">
            <p class="muted" style={{ margin: 0 }}>{t('vehicles.scan.reading')}</p>
            <div class="customers-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}
        {state === 'notfound' && !doubtful && <Banner kind="warn" data-testid="vin-photo-none">{t('vehicles.scan.notFound')}</Banner>}
        {doubtful && (
          <Banner kind="warn" title={t('vehicles.scan.doubt', { vin: doubtful })} action={<Button size="sm" variant="primary" icon={<Check size={16} />} onClick={() => p.onVin(doubtful)}>{t('vehicles.scan.keep')}</Button>}>
            {t('vehicles.vin.bad')}
          </Banner>
        )}
        <div class="customers-scan-photo">
          <p class="small muted" style={{ margin: 0 }}>{t('vehicles.scan.photoLead')}</p>
          <Button icon={<Camera size={18} />} onClick={takePhoto} disabled={state === 'reading'} data-testid="vin-photo">{t('vehicles.scan.photo')}</Button>
          <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto((e.currentTarget as HTMLInputElement).files?.[0])} data-testid="vin-photo-input" />
        </div>
      </div>
    </Sheet>
  );
}

/* ---------- a year the database takes ---------- */
export function yearOk(s: string): boolean {
  const y = Number(s);
  return /^\d{4}$/.test(s) && y >= 1950 && y <= new Date().getFullYear() + 2;
}

/* ---------- « Ajouter un véhicule » ---------- */
export interface AddDraft { year: string; make: string; model: string; vin: string; extra: Partial<CarFields>;
  /** « Dernier changement d’huile »: the day the customer says (for « Rappels d’huile ») */
  lastOil?: string }
export type AddMode = 'ymm' | 'vin';
export const EMPTY_CAR: AddDraft = { year: '', make: '', model: '', vin: '', extra: {} };
/** nothing typed yet (the car is optional on a new customer) */
export const carIsEmpty = (d: AddDraft) => !d.year.trim() && !d.make.trim() && !d.model.trim() && !d.vin;
/** what is wrong with the car typed (null: fine) */
export function carErrors(d: AddDraft, mode: AddMode): { year: string | null; model: string | null; vin: string | null } {
  return {
    year: d.year.trim() && !yearOk(d.year.trim()) ? t('vehicles.errors.year') : null,
    model: mode === 'ymm' && (!d.make.trim() || !d.model.trim()) ? t('vehicles.errors.model') : null,
    vin: mode === 'vin' && !vinSavable(d.vin) ? t('vehicles.errors.vin') : mode === 'vin' && !d.vin && !d.make.trim() ? t('vehicles.errors.vinOrModel') : null
  };
}
/** the car to save for a customer */
export function carRow(d: AddDraft, customerId: string): Partial<Vehicle> {
  return { ...d.extra, customer_id: customerId, year: d.year.trim() ? Number(d.year) : null, make: d.make.trim() || null, model: d.model.trim() || null, vin: d.vin || null,
    ...(d.lastOil && isValidDay(d.lastOil) && d.lastOil <= today() ? { last_oil_on: d.lastOil } : {}) };
}
/** the car's fields: year → make → model from the lists, or the VIN (typed or scanned).
    `onPatch` merges into the latest draft (the parent's setState with a function): the VIN's decoding arrives a moment after
    the VIN itself, and must not put back the draft as it was before */
export function CarForm(p: { value: AddDraft; onPatch: (patch: Partial<AddDraft>) => void; mode: AddMode; onMode: (m: AddMode) => void; tried: boolean; autoFocusVin?: boolean; customerId?: string | null }) {
  const d = p.value;
  const set = p.onPatch;
  const e = carErrors(d, p.mode);
  return (
    <div class="stack">
      <Seg value={p.mode} onValue={p.onMode} label={t('vehicles.add.how')} class="customers-seg" data-testid="vehicle-add-mode"
        options={[{ value: 'ymm', label: t('vehicles.add.byModel') }, { value: 'vin', label: t('vehicles.add.byVin') }]} />
      {p.mode === 'vin' && (
        <VinField value={d.vin} onValue={(vin) => set({ vin })} autoFocus={p.autoFocusVin} error={p.tried ? e.vin : null} customerId={p.customerId}
          onDecoded={(car) => set({ ...(car.year ? { year: String(car.year) } : {}), ...(car.make ? { make: car.make } : {}), ...(car.model ? { model: car.model } : {}), extra: car })} />
      )}
      {(p.mode === 'ymm' || d.make || d.model) && (
        <CarPicker value={{ year: d.year, make: d.make, model: d.model }} onValue={(c) => set({ year: c.year, make: c.make, model: c.model, extra: c.engine ? { ...d.extra, ...c.engine } : d.extra })} testid="vadd"
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
  const add = async () => {
    setTried(true);
    const e = carErrors(d, mode);
    if (e.year || e.model || e.vin) return;
    const id = await run(() => saveVehicle(carRow(d, p.customerId)), { ok: t('vehicles.add.added') });
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
