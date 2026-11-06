/* What the work of a week takes, and what to buy: oil by grade (litres), filters by part number, new tires by size and
   season, the other parts a service uses (wipers, plugs, battery…) and the fixed parts of the stock (service_parts),
   for the appointments still to do that week; compared with the stock: what is missing.
   A service says what it uses (Réglages → Services → « Ce que ça prend »); when it was never said, it is guessed from
   its name (« Changement d'huile » → oil and an oil filter, « Pneus neufs d'hiver » → 4 winter tires).
   What depends on the car comes from its engine sheet (confirmed by a mechanic), else from the engine list (« à
   confirmer »); when nothing says it (no car on the appointment, a car not in the list), the line says « à confirmer »
   and the appointment is listed so someone completes it. Pure: no screen, no server (tested in needs.test.ts). */
import type { Day } from '../../lib/dates';
import { addDays, dow } from '../../lib/dates';
import type { EngineSpec, InventoryItem, Job, JobItem, Need, NeedKind, Service, ServicePart, SpecData, TireSeason, Vehicle } from '../../data/types';
import { matchEngine, type EngineRow } from '../customers/engineRef';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const alnum = (s: string | null | undefined) => fold(String(s || '')).replace(/[^a-z0-9]/g, '');
export const NEED_KINDS: NeedKind[] = ['oil', 'oil_filter', 'air_filter', 'cabin_filter', 'wipers', 'plugs', 'battery', 'tires'];
export const DEFAULT_OIL_L = 5;

/* ---------- reading references ---------- */
/** « 5W-30 », « 5w30 », « SAE 5W-30 synthétique » → 5W-30; the approval in brackets is kept apart (« VW 502 00 ») */
export function oilGrade(text: string | null | undefined): { grade: string | null; spec: string | null } {
  const s = String(text || '');
  const m = /(\d{1,2})\s*w\s*-?\s*(\d{2})/i.exec(s);
  const spec = /\(([^)]+)\)/.exec(s)?.[1]?.trim() || null;
  return { grade: m ? `${Number(m[1])}W-${m[2]}` : null, spec };
}
/** a part number to compare: « 06K 115 562 (06L 115 562 B from 04/2018) » → « 06K 115 562 » */
export function partRef(text: string | null | undefined): string | null {
  const s = String(text || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return alnum(s).length >= 3 ? s : null;
}
/** « 225/65R17 », « P225/65 R 17 », « 225 65 17 » → 225/65R17 */
export function tireSize(text: string | null | undefined): string | null {
  const m = /(\d{3})\s*[/\s-]\s*(\d{2})\s*(?:Z?R|-|\s)\s*(\d{2}(?:[.,]5)?)/i.exec(String(text || ''));
  return m ? `${m[1]}/${m[2]}R${m[3].replace(',', '.')}` : null;
}
/** the season said in words: « hiver », « été », « 4 saisons » */
export function seasonOf(text: string | null | undefined): TireSeason | null {
  const s = fold(String(text || ''));
  if (/hiver|winter|neige|snow/.test(s)) return 'winter';
  if (/4\s*saisons|quatre saisons|toutes saisons|all.?season/.test(s)) return 'all';
  if (/\bete\b|summer/.test(s)) return 'summer';
  return null;
}
/** litres written in a name: « Changement d'huile (5 L) » → 5, « Bidon 4,4 L » → 4.4, « 946 ml » → 0.946 */
export function litresIn(text: string | null | undefined): number | null {
  const s = String(text || '');
  const ml = /(\d{2,4})\s*ml\b/i.exec(s);
  if (ml) return Number(ml[1]) / 1000;
  const l = /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:l|litres?|liters?)\b/i.exec(s);
  return l ? Number(l[1].replace(',', '.')) : null;
}

/* ---------- what a service uses ---------- */
/** what a service uses, guessed from its name and what it includes (never said for this service) */
export function guessNeeds(s: Pick<Service, 'name_fr' | 'name_en' | 'includes'>): Need[] {
  const text = fold([s.name_fr, s.name_en, ...(s.includes || []).flatMap((i) => [i.fr, i.en])].filter(Boolean).join(' | '));
  const out: Need[] = [];
  if (/\bhuile\b|\boil\b/.test(text) && !/fuite|leak|transmission|differentiel|differential|direction|steering|hydraulique/.test(text)) out.push({ kind: 'oil' }, { kind: 'oil_filter' });
  if (/filtre a air|air filter/.test(text)) out.push({ kind: 'air_filter' });
  if (/habitacle|cabin/.test(text)) out.push({ kind: 'cabin_filter' });
  if (/essuie|wiper/.test(text)) out.push({ kind: 'wipers' });
  if (/bougie|spark plug/.test(text)) out.push({ kind: 'plugs' });
  if (/batterie|battery/.test(text) && /rempla|neuve|nouvelle|new|install/.test(text)) out.push({ kind: 'battery' });
  if (/pneus? neufs?|vente de pneus|pneus a vendre|new tires?|tires? sale|sale of tires/.test(text)) out.push({ kind: 'tires', qty: 4, season: seasonOf(text) });
  return out;
}
/** what a service uses: said in its settings, else guessed */
export function needsOf(s: Pick<Service, 'name_fr' | 'name_en' | 'includes' | 'needs'>): { needs: Need[]; guessed: boolean } {
  return Array.isArray(s.needs) ? { needs: s.needs.filter((n) => NEED_KINDS.includes(n.kind)), guessed: false } : { needs: guessNeeds(s), guessed: true };
}

/* ---------- what is known about a car ---------- */
type Fact = 'oil_l' | 'oil_visc' | 'oil_filter' | 'air_filter' | 'cabin_filter' | 'wipers' | 'plugs' | 'battery' | 'tires';
export interface CarFacts {
  /** « 2015 Volkswagen Golf »; '' when the appointment has no car */
  label: string;
  values: Partial<Record<Fact, string | number>>;
  /** where each value comes from: the confirmed engine sheet, the car itself (tire size), or the engine list (to confirm) */
  from: Partial<Record<Fact, 'sheet' | 'car' | 'list'>>;
  cylinders: number | null;
}
export function carFacts(v: Vehicle | undefined, spec: EngineSpec | undefined, refRows: EngineRow[]): CarFacts {
  const f: CarFacts = { label: v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : '', values: {}, from: {}, cylinders: v?.cylinders ?? null };
  if (!v) return f;
  const put = (k: Fact, val: unknown, from: 'sheet' | 'car' | 'list') => {
    if (f.values[k] != null || val == null || val === '' || (typeof val === 'number' && !(val > 0))) return;
    f.values[k] = val as string | number; f.from[k] = from;
  };
  const d: SpecData = spec?.data || {};
  (['oil_l', 'oil_visc', 'oil_filter', 'air_filter', 'cabin_filter', 'wipers', 'plugs', 'battery'] as Fact[]).forEach((k) => put(k, (d as Record<string, unknown>)[k], 'sheet'));
  put('tires', v.tire_size, 'car');
  put('tires', d.tires, 'sheet');
  if (refRows.length) {
    // the engine list: only what all the likeliest engines agree on
    const best = matchEngine(v, refRows).best;
    const same = <T,>(get: (r: EngineRow) => T): T | null => (best.length && best.every((r) => get(r) === get(best[0])) ? get(best[0]) : null);
    put('oil_l', same((r) => r.oil_l), 'list');
    put('oil_visc', same((r) => r.oil_visc), 'list');
    put('oil_filter', same((r) => r.oil_filter), 'list');
    put('plugs', same((r) => r.plugs), 'list');
    if (f.cylinders == null) f.cylinders = same((r) => r.cylinders) || null;
  }
  return f;
}

/* ---------- the week ---------- */
export interface NeedJob { jobId: string; number: number; day: Day; car: string; qty: number; sure: boolean }
export interface NeedLine {
  /** oil|5W-30|, oil_filter|ph7317, tires|225/65R17|winter, item|<id> */
  key: string;
  kind: NeedKind | 'item';
  /** the grade, part number or tire size; null = to confirm */
  ref: string | null;
  spec: string | null;
  season: TireSeason | null;
  /** a part of the stock (fixed parts of a service, parts sold) */
  itemId: string | null;
  /** litres (oil), tires, or units */
  unit: 'L' | 'tire' | 'unit';
  qty: number;
  /** every quantity comes from confirmed engine sheets (or the stock itself) */
  sure: boolean;
  jobs: NeedJob[];
  /** what the stock has for it (same unit); null when no part of the stock matches */
  stock: number | null;
  stockItems: string[];
  toBuy: number;
  /** oil: the size of a jug (from the stock, else 5 L), to say how many to buy */
  jugL: number | null;
}
export type MissingWhat = 'car' | Fact;
export interface Missing { jobId: string; number: number; day: Day; car: string; what: MissingWhat[] }
export interface WeekNeeds { from: Day; to: Day; jobs: number; lines: NeedLine[]; missing: Missing[] }
export interface NeedsInput {
  from: Day; to: Day;
  jobs: Job[];
  itemsOf: (jobId: string) => JobItem[];
  service: (id: string | null) => Service | undefined;
  partsOf: (serviceId: string) => ServicePart[];
  vehicle: (id: string | null) => Vehicle | undefined;
  spec: (key: string | null) => EngineSpec | undefined;
  refRows: EngineRow[];
  inventory: InventoryItem[];
}

const COMING = new Set(['booked', 'en_route', 'on_site']);
const TO_DO = new Set(['planned', 'approved']);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function weekNeeds(x: NeedsInput): WeekNeeds {
  const lines = new Map<string, NeedLine>();
  const missing = new Map<string, Missing>();
  const jobs = x.jobs.filter((j) => !j.deleted_at && j.day >= x.from && j.day <= x.to && COMING.has(j.status))
    .sort((a, b) => a.day.localeCompare(b.day) || a.number - b.number);

  const add = (j: Job, car: string, base: Omit<NeedLine, 'qty' | 'jobs' | 'stock' | 'stockItems' | 'toBuy' | 'jugL' | 'sure'>, qty: number, sure: boolean) => {
    if (!(qty > 0)) return;
    let l = lines.get(base.key);
    if (!l) { l = { ...base, qty: 0, sure: true, jobs: [], stock: null, stockItems: [], toBuy: 0, jugL: null }; lines.set(base.key, l); }
    l.qty = round2(l.qty + qty);
    l.sure = l.sure && sure;
    const had = l.jobs.find((y) => y.jobId === j.id);
    if (had) { had.qty = round2(had.qty + qty); had.sure = had.sure && sure; } else l.jobs.push({ jobId: j.id, number: j.number, day: j.day, car, qty: round2(qty), sure });
  };
  const lack = (j: Job, car: string, what: MissingWhat) => {
    const m = missing.get(j.id) || { jobId: j.id, number: j.number, day: j.day, car, what: [] };
    if (!m.what.includes(what)) m.what.push(what);
    missing.set(j.id, m);
  };

  for (const j of jobs) {
    const v = x.vehicle(j.vehicle_id);
    const facts = carFacts(v, v ? x.spec(v.spec_key) : undefined, x.refRows);
    const car = facts.label;
    for (const it of x.itemsOf(j.id)) {
      if (it.deleted_at || !TO_DO.has(it.status)) continue;
      const times = Number(it.qty) > 0 ? Number(it.qty) : 1;
      // a part of the stock sold on the appointment
      if (it.item_id && it.kind !== 'service') {
        add(j, car, { key: `item|${it.item_id}`, kind: 'item', ref: null, spec: null, season: null, itemId: it.item_id, unit: 'unit' }, times, true);
        continue;
      }
      const s = x.service(it.service_id);
      if (!s) continue;
      // the fixed parts of the service
      for (const sp of x.partsOf(s.id)) {
        if (sp.deleted_at) continue;
        add(j, car, { key: `item|${sp.item_id}`, kind: 'item', ref: null, spec: null, season: null, itemId: sp.item_id, unit: 'unit' }, Number(sp.qty) * times, true);
      }
      // what depends on the car
      for (const n of needsOf(s).needs) {
        if (!v) lack(j, '', 'car');
        const val = (k: Fact) => facts.values[k];
        const sheet = (k: Fact) => facts.from[k] === 'sheet' || facts.from[k] === 'car';
        if (n.kind === 'oil') {
          const g = oilGrade(String(val('oil_visc') ?? ''));
          const litres = Number(val('oil_l')) > 0 ? Number(val('oil_l')) : litresIn(s.name_fr) ?? DEFAULT_OIL_L;
          if (v && !g.grade) lack(j, car, 'oil_visc');
          add(j, car, { key: `oil|${g.grade ?? '?'}|${alnum(g.spec)}`, kind: 'oil', ref: g.grade, spec: g.grade ? g.spec : null, season: null, itemId: null, unit: 'L' },
            litres * times, !!g.grade && sheet('oil_visc') && sheet('oil_l'));
        } else if (n.kind === 'tires') {
          const size = tireSize(String(val('tires') ?? ''));
          const season = n.season ?? seasonOf(s.name_fr) ?? null;
          if (v && !size) lack(j, car, 'tires');
          add(j, car, { key: `tires|${size ?? '?'}|${season ?? '?'}`, kind: 'tires', ref: size, spec: null, season, itemId: null, unit: 'tire' },
            (n.qty && n.qty > 0 ? n.qty : 4) * times, !!size && sheet('tires'));
        } else {
          const k = n.kind as Fact;
          const ref = partRef(String(val(k) ?? ''));
          const per = n.qty && n.qty > 0 ? n.qty : n.kind === 'plugs' ? facts.cylinders || 4 : n.kind === 'wipers' ? 2 : 1;
          if (v && !ref && n.kind === 'oil_filter') lack(j, car, k);
          add(j, car, { key: `${n.kind}|${ref ? alnum(ref) : '?'}`, kind: n.kind, ref, spec: null, season: null, itemId: null, unit: 'unit' }, per * times, !!ref && sheet(k));
        }
      }
    }
  }

  const out = [...lines.values()];
  for (const l of out) withStock(l, x.inventory);
  out.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || Number(a.ref == null) - Number(b.ref == null) || b.qty - a.qty || String(a.ref).localeCompare(String(b.ref)));
  const withWork = new Set(out.flatMap((l) => l.jobs.map((y) => y.jobId)));
  return { from: x.from, to: x.to, jobs: jobs.length, lines: out, missing: [...missing.values()].filter((m) => withWork.has(m.jobId)) };
}
const ORDER: (NeedKind | 'item')[] = ['oil', 'oil_filter', 'air_filter', 'cabin_filter', 'tires', 'wipers', 'plugs', 'battery', 'item'];
const kindOrder = (k: NeedKind | 'item') => ORDER.indexOf(k);

/* ---------- the stock ---------- */
const itemText = (i: InventoryItem) => [i.name, i.sku, i.category, i.notes].filter(Boolean).join(' ');
const LITRE_UNIT = /^(l|litre|litres|liter|liters)$/i;
/** litres in one unit of a stock item: its unit is the litre, or its name says the jug (« 5 L ») */
export function litresPerUnit(i: InventoryItem): number | null {
  const u = String(i.unit || '').trim();
  if (LITRE_UNIT.test(u)) return 1;
  if (/^ml$/i.test(u)) return 0.001;
  return litresIn(`${i.name} ${i.sku || ''}`);
}
const SETS = /^(jeu|jeux|ensemble|ensembles|set|sets)$/i;
function withStock(l: NeedLine, inv: InventoryItem[]) {
  const active = inv.filter((i) => i.active !== false && !i.deleted_at);
  let items: InventoryItem[] = [];
  let stock: number | null = null;
  if (l.kind === 'item') {
    const i = active.find((y) => y.id === l.itemId) || inv.find((y) => y.id === l.itemId);
    if (i) { items = [i]; stock = Math.max(0, Number(i.qty)); }
  } else if (l.ref) {
    if (l.kind === 'oil') {
      const g = alnum(l.ref);
      items = active.filter((i) => alnum(itemText(i)).includes(g) && /huile|oil/i.test(fold(itemText(i))));
      const per = items.map(litresPerUnit);
      if (items.length && per.every((p) => p != null)) stock = round2(items.reduce((n, i, k) => n + Math.max(0, Number(i.qty)) * (per[k] as number), 0));
      const jug = per.find((p) => p != null && p >= 1);
      l.jugL = jug ?? DEFAULT_OIL_L;
    } else if (l.kind === 'tires') {
      const size = alnum(l.ref);
      items = active.filter((i) => alnum(itemText(i)).includes(size) && (!l.season || !seasonOf(itemText(i)) || seasonOf(itemText(i)) === l.season));
      if (items.length) stock = items.reduce((n, i) => n + Math.max(0, Number(i.qty)) * (SETS.test(String(i.unit || '').trim()) ? 4 : 1), 0);
    } else {
      const ref = alnum(l.ref);
      items = active.filter((i) => alnum(i.sku) === ref || alnum(itemText(i)).includes(ref));
      if (items.length) stock = items.reduce((n, i) => n + Math.max(0, Number(i.qty)), 0);
    }
  } else if (l.kind === 'oil') l.jugL = DEFAULT_OIL_L;
  l.stock = stock;
  l.stockItems = items.map((i) => i.id);
  l.toBuy = round2(Math.max(0, l.qty - (stock ?? 0)));
}

/** the week to prepare: from Thursday, the next one (it starts on Sunday); on Sunday, this one; else none */
export function shoppingWeek(day: Day): Day | null {
  const d = dow(day);
  if (d === 0) return day;
  if (d >= 4) return addDays(day, 7 - d);
  return null;
}
