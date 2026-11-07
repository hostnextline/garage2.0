/* The old app's engine list (public/data/engine-ref.json): which engine a car may have, with its oil, filter and
   fluids. Read once and kept in memory (the service worker keeps the file for offline use). The values are only
   suggestions « à confirmer »: the mechanic checks them on the engine before they become the car's sheet. */
import { signal } from '@preact/signals';
import type { SpecData } from '../../data/types';
import { norm, squash } from './search';

export interface EngineRow {
  make: string; model: string; aliases: string[]; year_from: number; year_to: number; displacement: number; cylinders: number;
  turbo: boolean; fuel: string; engine: string; oil_l: number | null; oil_visc: string; oil_filter: string; drain_torque: string;
  coolant: string; trans: string; brake: string; plugs: string;
}
export interface CarLike {
  year?: number | null; make?: string | null; model?: string | null; trim?: string | null; engine?: string | null;
  displacement?: number | null; cylinders?: number | null; fuel?: string | null;
}

/* ---------- reading the file ---------- */
export function parseEngineRef(json: unknown): EngineRow[] {
  const d = json as { columns?: string[]; rows?: unknown[][] } | null;
  if (!d || !Array.isArray(d.columns) || !Array.isArray(d.rows)) return [];
  const at = (name: string) => d.columns!.indexOf(name);
  const I = Object.fromEntries(['make', 'model', 'aliases', 'year_from', 'year_to', 'displacement', 'cylinders', 'turbo', 'fuel', 'engine', 'oil_l', 'oil_visc', 'oil_filter', 'drain_torque', 'coolant', 'trans', 'brake', 'plugs'].map((k) => [k, at(k)]));
  const s = (r: unknown[], k: string) => (I[k] >= 0 && r[I[k]] != null ? String(r[I[k]]).trim() : '');
  const n = (r: unknown[], k: string) => { const x = I[k] >= 0 ? Number(r[I[k]]) : NaN; return Number.isFinite(x) && x !== 0 ? x : null; };
  const out: EngineRow[] = [];
  for (const r of d.rows) {
    if (!Array.isArray(r)) continue;
    const make = s(r, 'make'), model = s(r, 'model');
    const yf = n(r, 'year_from'), yt = n(r, 'year_to');
    if (!make || !model || yf == null) continue;
    out.push({
      make, model, aliases: s(r, 'aliases').split('|').map((x) => x.trim()).filter(Boolean),
      year_from: yf, year_to: yt ?? yf, displacement: n(r, 'displacement') ?? 0, cylinders: n(r, 'cylinders') ?? 0,
      turbo: n(r, 'turbo') === 1, fuel: s(r, 'fuel') || 'gas', engine: s(r, 'engine'), oil_l: n(r, 'oil_l'),
      oil_visc: s(r, 'oil_visc'), oil_filter: s(r, 'oil_filter'), drain_torque: s(r, 'drain_torque'), coolant: s(r, 'coolant'),
      trans: s(r, 'trans'), brake: s(r, 'brake'), plugs: s(r, 'plugs')
    });
  }
  return out;
}

export interface RefState { status: 'idle' | 'loading' | 'ready' | 'error'; rows: EngineRow[] }
/** the list, once read (screens re-render when it arrives) */
export const engineRef = signal<RefState>({ status: 'idle', rows: [] });
let loading: Promise<void> | null = null;
/** reads the list the first time it is needed; again after a failure */
export function ensureEngineRef(): Promise<void> {
  if (engineRef.value.status === 'ready') return Promise.resolve();
  if (loading) return loading;
  engineRef.value = { status: 'loading', rows: [] };
  loading = fetch('./data/engine-ref.json')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((j) => { engineRef.value = { status: 'ready', rows: parseEngineRef(j) }; })
    .catch(() => { engineRef.value = { status: 'error', rows: [] }; })
    .finally(() => { loading = null; });
  return loading;
}

/* ---------- reading a car ---------- */
/** "2.0 L 4 cyl." → 2.0 ; "3.5 L V6 EcoBoost" → 3.5 ; "1.5T" → 1.5 */
export function parseDisplacement(text: string | null | undefined): number | null {
  const s = String(text || '');
  const m = /(\d{1,2}(?:[.,]\d)?)\s*(?:l|litres?|liters?)\b/i.exec(s) || /\b(\d[.,]\d)(?:\s*t\b|t\b|\b)/i.exec(s);
  if (!m) return null;
  const x = Number(m[1].replace(',', '.'));
  return x > 0.5 && x < 10 ? Math.round(x * 10) / 10 : null;
}
/** "V6" → 6 ; "4 cyl." → 4 ; "I4" → 4 */
export function parseCylinders(text: string | null | undefined): number | null {
  const s = String(text || '');
  const m = /\b[VW](6|8|10|12)\b/i.exec(s) || /\b[ILH](3|4|5|6)\b/.exec(s) || /\b(\d{1,2})\s*-?\s*cyl/i.exec(s);
  const n = m ? Number(m[1]) : NaN;
  return n >= 2 && n <= 16 ? n : null;
}
export function fuelKind(f: string | null | undefined): 'gas' | 'hybrid' | 'diesel' | 'electric' | null {
  const s = norm(f);
  if (!s) return null;
  if (/hybri/.test(s)) return 'hybrid';
  if (/diesel/.test(s)) return 'diesel';
  if (/electri/.test(s)) return 'electric';
  if (/essence|gas|petrol|regular|e85|flex/.test(s)) return 'gas';
  return null;
}
const turboHint = (s: string) => /turbo|ecoboost|\b\d[.,]\dt\b|\btsi\b|\btfsi\b|\bdit\b/i.test(s);

const MAKE_ALIAS: Record<string, string> = { chevy: 'chevrolet', vw: 'volkswagen', volks: 'volkswagen', mercedes: 'mercedesbenz', hyunday: 'hyundai', toyta: 'toyota' };
/** make and model the way the list writes them (« Dodge Ram 1500 » is a RAM 1500) */
export function makeModel(make: string | null | undefined, model: string | null | undefined): { make: string; model: string } {
  let mk = squash(make);
  mk = MAKE_ALIAS[mk] || mk;
  let md = String(model || '').trim();
  if (mk === 'dodge' && /^ram\b/i.test(md)) { mk = 'ram'; md = md.replace(/^ram\s*/i, ''); }
  return { make: mk, model: md };
}

/* ---------- matching ---------- */
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
const hasDigit = (t: string) => /\d/.test(t);
/** words of an alias that only say the body (same engines) */
const BODY = new Set(['sedan', 'coupe', 'koup', 'hatchback', 'hatch', 'wagon', 'sportwagen', 'door', 'convertible', 'cab', 'crew', 'crewcab', 'regular',
  'extended', 'double', 'quad', 'supercab', 'supercrew', 'van', 'cargo', 'passenger', 'xl', 'unlimited', 'liftback', 'lwb', 'swb']);

interface RowInfo { modelKey: string; aliasKeys: string[]; variants: Set<string>; variantOnly: boolean; codes: string[] }
const infoCache = new WeakMap<EngineRow, RowInfo>();
function info(r: EngineRow): RowInfo {
  let i = infoCache.get(r);
  if (i) return i;
  const mt = tokens(r.model);
  const variants = new Set<string>();
  let real = 0, allVariant = true;
  for (const a of r.aliases) {
    const at = tokens(a);
    if (!at.includes(mt[0])) continue;              // another name for the same car (CRV, F150, i30, Voyager…)
    real++;
    const extra = at.filter((t) => !mt.includes(t) && !hasDigit(t) && !BODY.has(t));
    extra.forEach((t) => variants.add(t));
    if (!extra.length) allVariant = false;
  }
  const codes = tokens(r.engine).filter((t) => t.length >= 3 && /[a-z]/.test(t) && /\d/.test(t));
  i = { modelKey: squash(r.model), aliasKeys: r.aliases.map(squash), variants, variantOnly: real > 0 && allVariant, codes };
  infoCache.set(r, i);
  return i;
}

export interface EngineMatch { best: EngineRow[]; others: EngineRow[] }
/** the engines this car may have: `best` are the likeliest (one when the car is fully known), `others` follow */
export function matchEngine(car: CarLike, rows: EngineRow[]): EngineMatch {
  const year = Number(car.year);
  const { make, model } = makeModel(car.make, car.model);
  if (!make || !model || !Number.isFinite(year) || year < 1950) return { best: [], others: [] };
  const vm = squash(model);
  const vmt = squash(`${model} ${car.trim || ''}`);
  const text = `${model} ${car.trim || ''} ${car.engine || ''}`;
  const disp = car.displacement != null && Number(car.displacement) > 0 ? Number(car.displacement) : parseDisplacement(car.engine) ?? parseDisplacement(car.trim);
  const cyl = car.cylinders != null && Number(car.cylinders) > 0 ? Number(car.cylinders) : parseCylinders(car.engine);
  const fuel = fuelKind(car.fuel) === 'hybrid' || /hybri/i.test(text) ? 'hybrid' : fuelKind(car.fuel);
  const carTokens = new Set(tokens(`${model} ${car.trim || ''}`));
  if (fuel === 'hybrid') carTokens.add('hybrid');
  const engineKey = squash(car.engine);

  const found: { row: EngineRow; score: number }[] = [];
  for (const r of rows) {
    if (squash(makeModel(r.make, r.model).make) !== make) continue;
    if (year < r.year_from || year > r.year_to) continue;
    const ri = info(r);
    let score: number;
    if (vm === ri.modelKey || ri.modelKey === make + vm || vm === make + ri.modelKey) score = 20;
    else if (ri.aliasKeys.includes(vm)) score = 22;
    else if (car.trim && ri.aliasKeys.includes(vmt)) score = 22;
    else continue;
    if (car.trim && ri.aliasKeys.includes(vmt)) score += 10;
    if (disp != null) { if (Math.abs(r.displacement - disp) > 0.051) continue; score += 10; }
    if (cyl != null && r.cylinders) { if (cyl !== r.cylinders) continue; score += 2; }
    if (turboHint(text)) score += r.turbo ? 4 : -4;
    if (fuel === 'hybrid' || fuel === 'diesel') score += r.fuel === fuel ? 6 : -8;
    else if (fuel === 'gas') score += r.fuel === 'gas' ? 2 : -6;
    if (ri.codes.some((c) => engineKey.includes(c))) score += 15;
    const hit = [...ri.variants].some((t) => carTokens.has(t));
    if (ri.variantOnly) score += hit ? 8 : -15;
    else if (hit) score += 5;
    found.push({ row: r, score });
  }
  // the car names a version (Si, Sport, Type R…) that some engines are for: the others step back
  const allVariants = new Set<string>();
  for (const f of found) info(f.row).variants.forEach((t) => allVariants.add(t));
  const named = [...carTokens].filter((t) => allVariants.has(t));
  if (named.length) for (const f of found) if (!named.some((t) => info(f.row).variants.has(t))) f.score -= 6;

  found.sort((a, b) => b.score - a.score || a.row.displacement - b.row.displacement || (a.row.year_to - a.row.year_from) - (b.row.year_to - b.row.year_from));
  if (!found.length) return { best: [], others: [] };
  const top = found[0].score;
  return { best: found.filter((f) => f.score === top).map((f) => f.row), others: found.filter((f) => f.score !== top).map((f) => f.row) };
}

/** the sheet's values from a line of the list */
export function specFromRow(r: EngineRow): SpecData {
  const d: SpecData = {};
  if (r.oil_l != null) d.oil_l = r.oil_l;
  if (r.oil_visc) d.oil_visc = r.oil_visc;
  if (r.oil_filter) d.oil_filter = r.oil_filter;
  if (r.drain_torque) d.drain_torque = r.drain_torque;
  if (r.coolant) d.coolant = r.coolant;
  if (r.trans) d.trans = r.trans;
  if (r.brake) d.brake = r.brake;
  if (r.plugs) d.plugs = r.plugs;
  return d;
}

/** the key of an engine sheet: 'honda|civic|2019|2.0' (make, model, year, displacement), shared by every car alike */
export function specKeyOf(car: CarLike): string | null {
  const { make, model } = makeModel(car.make, car.model);
  const m = squash(model);
  if (!make || !m || !car.year) return null;
  const disp = car.displacement != null && Number(car.displacement) > 0 ? Number(car.displacement) : parseDisplacement(car.engine);
  return [make, m, String(car.year), ...(disp ? [disp.toFixed(1)] : [])].join('|');
}

/* ---------- the engines to choose from (« Choisir le véhicule », step Moteur) ---------- */
export interface EngineChoice { key: string; displacement: number | null; cylinders: number | null; turbo: boolean; fuel: string; code: string; oil_visc: string; oil_filter: string; oil_l: number | null }
/** the engines this make and model had (that year when known), one line each, with their oil and filter */
export function enginesFor(make: string, model: string, year: number | null, rows: EngineRow[]): EngineChoice[] {
  let list: EngineRow[];
  if (year) { const m = matchEngine({ make, model, year }, rows); list = [...m.best, ...m.others]; }
  else {
    const mm = makeModel(make, model), vm = squash(mm.model);
    list = rows.filter((r) => squash(makeModel(r.make, r.model).make) === mm.make && (info(r).modelKey === vm || info(r).aliasKeys.includes(vm)));
  }
  const seen = new Map<string, EngineChoice>();
  for (const r of list) {
    const key = [r.displacement, r.cylinders, r.turbo ? 't' : '', r.fuel, squash(r.engine)].join('|');
    if (!seen.has(key)) seen.set(key, { key, displacement: r.displacement || null, cylinders: r.cylinders || null, turbo: r.turbo, fuel: r.fuel, code: r.engine,
      oil_visc: r.oil_visc, oil_filter: r.oil_filter, oil_l: r.oil_l });
  }
  return [...seen.values()].sort((a, b) => (a.displacement ?? 0) - (b.displacement ?? 0) || (a.cylinders ?? 0) - (b.cylinders ?? 0) || Number(a.turbo) - Number(b.turbo));
}
