/* What the work of a week takes, and what to buy: oil by grade (litres), filters by part number, new tires by size and
   season, the other parts a service uses (wipers, plugs, battery…) and the fixed parts of the stock (service_parts),
   for the appointments still to do that week; compared with the stock (allocate.ts): what is missing.
   A service says what it uses (Réglages → Services → « Ce que ça prend »); when it was never said, it is guessed from
   its name (« Changement d'huile » → oil and an oil filter, « Pneus neufs d'hiver » → 4 winter tires). A line typed by
   hand with no service counts when its words say an oil change (the same rule as « Rappels d'huile »).
   What depends on the car comes from its engine sheet (confirmed by a mechanic), else from the engine list (« à
   confirmer »); when nothing says it (no car on the appointment, a car not in the list), the line says « à confirmer »
   and the appointment is listed so someone completes it. Pure: no screen, no server (tested in needs.test.ts). */
import type { Day } from '../../lib/dates';
import { addDays, dow, weekStart } from '../../lib/dates';
import { fold } from '../../lib/text';
import type { EngineSpec, InventoryItem, Job, JobItem, Need, NeedKind, Service, ServicePart, SpecData, TireSeason, Vehicle } from '../../data/types';
import { matchEngine, type EngineRow } from '../vehicles/engineRef';
import { oilWords } from '../oil/due';
import { alnum, litresIn, oilGrade, partRef, seasonOf, tireSize } from './refs';
import { allocateStock, DEFAULT_OIL_L } from './allocate';
import { round2 } from './stock';

export { oilGrade, partRef, tireSize, seasonOf, litresIn } from './refs';
export { litresPerUnit, DEFAULT_OIL_L } from './allocate';

export const NEED_KINDS: NeedKind[] = ['oil', 'oil_filter', 'air_filter', 'cabin_filter', 'wipers', 'plugs', 'battery', 'tires'];

/* ---------- what a service uses ---------- */
/* topping up or checking the oil is not an oil change; tires the customer brings are not tires to buy */
const OIL_CHECK = /niveau d.?huile|oil level|verification de l.?huile|oil check/;
const TIRES_BROUGHT = /client fourni|fourni(?:s|es)? par le client|le client fournit|customer.?s? (?:own|supplied)|provided by (?:the )?customer/;
/** what a service uses, guessed from its name and what it includes (never said for this service) */
export function guessNeeds(s: Pick<Service, 'name_fr' | 'name_en' | 'includes'>): Need[] {
  const parts = [s.name_fr, s.name_en, ...(s.includes || []).flatMap((i) => [i.fr, i.en])].filter(Boolean) as string[];
  const text = fold(parts.join(' | '));
  const out: Need[] = [];
  // an oil change: the same reading of the words as the oil reminders (domain/oil), each piece of the name read alone
  if (oilWords(parts.join(' | ')) && !OIL_CHECK.test(text)) out.push({ kind: 'oil' }, { kind: 'oil_filter' });
  // « filtre à air d'habitacle » is the cabin filter, not the engine's air filter
  if (/filtre a air(?! d.?habitacle)|(?<!cabin )air filter/.test(text)) out.push({ kind: 'air_filter' });
  if (/habitacle|cabin/.test(text)) out.push({ kind: 'cabin_filter' });
  if (/essuie|wiper/.test(text)) out.push({ kind: 'wipers' });
  if (/bougie|spark plug/.test(text)) out.push({ kind: 'plugs' });
  if (/batterie|battery/.test(text) && /rempla|neuve|nouvelle|new|install/.test(text)) out.push({ kind: 'battery' });
  if (/pneus? neufs?|vente de pneus|pneus a vendre|new tires?|tires? sale|sale of tires/.test(text) && !TIRES_BROUGHT.test(text)) out.push({ kind: 'tires', qty: 4, season: seasonOf(text) });
  return out;
}
/** what a service uses: said in its settings, else guessed */
export function needsOf(s: Pick<Service, 'name_fr' | 'name_en' | 'includes' | 'needs'>): { needs: Need[]; guessed: boolean } {
  return Array.isArray(s.needs) ? { needs: s.needs.filter((n) => NEED_KINDS.includes(n.kind)), guessed: false } : { needs: guessNeeds(s), guessed: true };
}
/** a line typed by hand (no service): an oil change when its own words say so. Only a line of work (« service »,
    « labour ») with no part of the stock: a part typed by hand (« Filtre à huile Fram PH7317 », « Huile supplémentaire 1 L »)
    is not a whole oil change. Counted once per appointment, and not at all when a service of the appointment already takes
    the oil (`oilDone`). */
const OIL_CHANGE: Need[] = [{ kind: 'oil' }, { kind: 'oil_filter' }];
const HAND_WORK: ReadonlySet<string> = new Set(['service', 'labour']);
function needsOfLine(it: JobItem, s: Service | undefined, oilDone: boolean): Need[] {
  if (s) return needsOf(s).needs;
  if (oilDone || it.item_id || !HAND_WORK.has(it.kind)) return [];
  return oilWords(it.description) ? OIL_CHANGE : [];
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
  /** what the stock still had for it when its turn came (same unit); null when no part of the stock can be counted */
  stock: number | null;
  /** the stock items that match it (counted or not) */
  stockItems: string[];
  toBuy: number;
  /** oil: the size of a jug (from the stock, else 5 L), to say how many to buy */
  jugL: number | null;
}
/** what an appointment lacks for the week's needs: no car, or a fact the engine sheet must say */
export type MissingWhat = 'car' | 'oil_visc' | 'oil_filter' | 'tires';
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

/** the appointments whose work is still to come */
export const COMING: ReadonlySet<string> = new Set(['booked', 'en_route', 'on_site']);
const TO_DO = new Set(['planned', 'approved']);
/** new tires: a line with a quantity of 2 or more counts its tires one by one (priced each); otherwise it is a set */
const tiresOf = (perSet: number, times: number) => (times >= 2 ? times : perSet * times);

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
  // the same car on several appointments of the week: its facts are worked out once
  const factsCache = new Map<string, CarFacts>();
  const factsOf = (v: Vehicle | undefined) => {
    if (!v) return carFacts(undefined, undefined, x.refRows);
    let f = factsCache.get(v.id);
    if (!f) { f = carFacts(v, x.spec(v.spec_key), x.refRows); factsCache.set(v.id, f); }
    return f;
  };

  for (const j of jobs) {
    const v = x.vehicle(j.vehicle_id);
    const facts = factsOf(v);
    const car = facts.label;
    const val = (k: Fact) => facts.values[k];
    const sheet = (k: Fact) => facts.from[k] === 'sheet' || facts.from[k] === 'car';
    const todo = x.itemsOf(j.id).filter((it) => !it.deleted_at && TO_DO.has(it.status));
    // a service of the appointment already takes the oil: a line typed by hand that says it too is the same oil change
    let oilDone = todo.some((it) => {
      const s = it.item_id && it.kind !== 'service' ? undefined : x.service(it.service_id);
      return !!s && needsOf(s).needs.some((n) => n.kind === 'oil');
    });
    for (const it of todo) {
      const times = Number(it.qty) > 0 ? Number(it.qty) : 1;
      // a part of the stock sold on the appointment
      if (it.item_id && it.kind !== 'service') {
        add(j, car, { key: `item|${it.item_id}`, kind: 'item', ref: null, spec: null, season: null, itemId: it.item_id, unit: 'unit' }, times, true);
        continue;
      }
      const s = x.service(it.service_id);
      // the fixed parts of the service
      if (s) {
        for (const sp of x.partsOf(s.id)) {
          if (sp.deleted_at) continue;
          add(j, car, { key: `item|${sp.item_id}`, kind: 'item', ref: null, spec: null, season: null, itemId: sp.item_id, unit: 'unit' }, Number(sp.qty) * times, true);
        }
      }
      const name = s ? s.name_fr : it.description;
      // what depends on the car
      const needs = needsOfLine(it, s, oilDone);
      if (!s && needs.length) oilDone = true;
      for (const n of needs) {
        if (!v) lack(j, '', 'car');
        if (n.kind === 'oil') {
          const g = oilGrade(String(val('oil_visc') ?? ''));
          const litres = Number(val('oil_l')) > 0 ? Number(val('oil_l')) : litresIn(name) ?? DEFAULT_OIL_L;
          if (v && !g.grade) lack(j, car, 'oil_visc');
          add(j, car, { key: `oil|${g.grade ?? '?'}|${alnum(g.spec)}`, kind: 'oil', ref: g.grade, spec: g.grade ? g.spec : null, season: null, itemId: null, unit: 'L' },
            litres * times, !!g.grade && sheet('oil_visc') && sheet('oil_l'));
        } else if (n.kind === 'tires') {
          const size = tireSize(String(val('tires') ?? ''));
          const season = n.season ?? seasonOf(name) ?? null;
          if (v && !size) lack(j, car, 'tires');
          add(j, car, { key: `tires|${size ?? '?'}|${season ?? '?'}`, kind: 'tires', ref: size, spec: null, season, itemId: null, unit: 'tire' },
            tiresOf(n.qty && n.qty > 0 ? n.qty : 4, times), !!size && sheet('tires'));
        } else {
          const k = n.kind as Fact;
          const ref = partRef(String(val(k) ?? ''));
          const per = n.qty && n.qty > 0 ? n.qty : n.kind === 'plugs' ? facts.cylinders || 4 : n.kind === 'wipers' ? 2 : 1;
          if (v && !ref && n.kind === 'oil_filter') lack(j, car, 'oil_filter');
          add(j, car, { key: `${n.kind}|${ref ? alnum(ref) : '?'}`, kind: n.kind, ref, spec: null, season: null, itemId: null, unit: 'unit' }, per * times, !!ref && sheet(k));
        }
      }
    }
  }

  const out = [...lines.values()];
  allocateStock(out, x.inventory);
  out.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || Number(a.ref == null) - Number(b.ref == null) || b.qty - a.qty || String(a.ref).localeCompare(String(b.ref)));
  const withWork = new Set(out.flatMap((l) => l.jobs.map((y) => y.jobId)));
  return { from: x.from, to: x.to, jobs: jobs.length, lines: out, missing: [...missing.values()].filter((m) => withWork.has(m.jobId)) };
}
const ORDER: (NeedKind | 'item')[] = ['oil', 'oil_filter', 'air_filter', 'cabin_filter', 'tires', 'wipers', 'plugs', 'battery', 'item'];
const kindOrder = (k: NeedKind | 'item') => ORDER.indexOf(k);

/** the week to prepare: from Thursday, the next one (it starts on Sunday); on Sunday, this one; else none */
export function shoppingWeek(day: Day): Day | null {
  const d = dow(day);
  if (d === 0) return day;
  if (d >= 4) return addDays(day, 7 - d);
  return null;
}
/** the week to open by default: this one, or from Thursday the coming one when something is booked in it */
export function defaultWeekOf(today: Day, jobs: Pick<Job, 'day' | 'status'>[]): Day {
  const now = weekStart(today);
  const next = shoppingWeek(today);
  if (!next || next === now) return now;
  const end = addDays(next, 6);
  return jobs.some((j) => j.day >= next && j.day <= end && COMING.has(j.status)) ? next : now;
}

/* ---------- « Ajouter à l'inventaire »: the lines the stock does not have yet, as new items (quantity 0) ---------- */
export interface NewItem { name: string; sku: string | null; category: string; unit: string; min_qty: number }
/** each line with a known grade, part number or size and NO item of the stock for it: an item to create (one per key).
    A line whose item exists but cannot be counted (a jug with no litres) is not offered: creating another would not help */
export function itemsToCreate(lines: NeedLine[], name: (l: NeedLine) => string, cat: (k: 'oil' | 'filters' | 'tires' | 'parts') => string): NewItem[] {
  const fam = (k: NeedLine['kind']): 'oil' | 'filters' | 'tires' | 'parts' => (k === 'oil' ? 'oil' : k === 'tires' ? 'tires' : /filter/.test(k) ? 'filters' : 'parts');
  return lines
    .filter((l) => l.kind !== 'item' && l.ref && l.stock == null && !l.stockItems.length)
    .map((l) => ({
      name: name(l).slice(0, 120),
      sku: l.kind === 'oil' || l.kind === 'tires' ? null : l.ref,
      category: cat(fam(l.kind)),
      unit: l.kind === 'oil' ? 'L' : l.kind === 'tires' ? 'pneu' : 'unité',
      min_qty: Math.max(1, Math.ceil(l.qty))
    }));
}
