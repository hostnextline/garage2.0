/* The lists for « Année → Marque → Modèle » (no typing): the years, the makes seen in Québec (the most common first),
   and the models of a make for a year from NHTSA's public list (vPIC: passenger cars, SUVs/minivans, pickups).
   A list already seen is kept on the phone (and by the service worker) so it opens again without signal; without
   signal the first time, the old app's engine list gives the common models. */
import { engineRef, ensureEngineRef } from './engineRef';
import { squash } from './search';

/** the makes, the most common in Québec first */
export const POPULAR_MAKES = ['Toyota', 'Honda', 'Hyundai', 'Ford', 'Chevrolet', 'Nissan', 'Mazda', 'Kia', 'Volkswagen', 'Subaru', 'GMC', 'RAM', 'Jeep',
  'Dodge', 'Mitsubishi', 'Lexus', 'Acura', 'BMW', 'Mercedes-Benz', 'Audi', 'Tesla', 'Chrysler', 'Buick', 'Infiniti', 'Volvo', 'Cadillac', 'Lincoln', 'Mini'];
export const OTHER_MAKES = ['Alfa Romeo', 'Fiat', 'Genesis', 'Hummer', 'Jaguar', 'Land Rover', 'Maserati', 'Mercury', 'Oldsmobile', 'Polestar', 'Pontiac', 'Porsche',
  'Rivian', 'Saab', 'Saturn', 'Scion', 'Smart', 'Suzuki'];
export const ALL_MAKES = [...POPULAR_MAKES, ...OTHER_MAKES];

/** next year's models down to 1980 */
export function yearsList(now = new Date().getFullYear()): number[] {
  const out: number[] = [];
  for (let y = now + 1; y >= 1980; y--) out.push(y);
  return out;
}
/** the make as we write it (« MERCEDES-BENZ » → « Mercedes-Benz »), or the text as typed */
export function makeName(s: string): string {
  const k = squash(s);
  return ALL_MAKES.find((m) => squash(m) === k) || s.trim();
}

/* ---------- models ---------- */
const TYPES = ['car', 'mpv', 'truck'];
export const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const KEEP_MS = 90 * 24 * 3600 * 1000;
const memo = new Map<string, string[]>();
const keyOf = (make: string, year: number) => `his.models.${squash(make)}.${year}`;

function sortModels(list: string[]): string[] {
  const seen = new Map<string, string>();
  for (const m of list) {
    const name = String(m || '').replace(/\s+/g, ' ').trim();
    if (name && !seen.has(squash(name))) seen.set(squash(name), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' }));
}
/** the models in NHTSA's answers for this make (other makes with a similar name are left out) */
export function parseModels(answers: unknown[], make: string): string[] {
  const want = squash(make);
  const out: string[] = [];
  for (const a of answers) {
    const res = (a as { Results?: { Make_Name?: string; Model_Name?: string }[] } | null)?.Results;
    if (!Array.isArray(res)) continue;
    for (const r of res) if (squash(String(r.Make_Name || '')) === want && r.Model_Name) out.push(String(r.Model_Name));
  }
  return sortModels(out);
}
/** the common models of the engine list (for a year when given) */
export function refModels(make: string, year?: number | null): string[] {
  const k = squash(make);
  return sortModels(engineRef.value.rows.filter((r) => squash(r.make) === k && (!year || (r.year_from <= year && r.year_to >= year))).map((r) => r.model));
}
export function mergeModels(...lists: string[][]): string[] { return sortModels(lists.flat()); }

function remembered(make: string, year: number): string[] | null {
  try {
    const s = localStorage.getItem(keyOf(make, year));
    if (!s) return null;
    const o = JSON.parse(s) as { at: number; models: string[] };
    return Date.now() - o.at < KEEP_MS && Array.isArray(o.models) && o.models.length ? o.models : null;
  } catch { return null; }
}
function remember(make: string, year: number, models: string[]) {
  try { localStorage.setItem(keyOf(make, year), JSON.stringify({ at: Date.now(), models })); } catch { /* full: fine */ }
}

export interface ModelList { models: string[]; complete: boolean }
/** the models of a make for a year: NHTSA's list (with the common ones of the engine list), else the engine list alone.
    No year (not known): every model of the make. */
export async function modelsFor(make: string, year: number | null, fetchImpl: typeof fetch = fetch, timeoutMs = 9000): Promise<ModelList> {
  if (!year) return modelsAnyYear(make, fetchImpl, timeoutMs);
  const k = `${squash(make)}|${year}`;
  const known = memo.get(k) || remembered(make, year);
  void ensureEngineRef();
  if (known) { memo.set(k, known); return { models: mergeModels(known, refModels(make, year)), complete: true }; }
  const get = async (type: string) => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), timeoutMs);
    try {
      const r = await fetchImpl(`${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make.toLowerCase())}/modelyear/${year}/vehicletype/${type}?format=json`, ctl ? { signal: ctl.signal } : undefined);
      return r.ok ? await r.json() : null;
    } catch { return null; } finally { clearTimeout(timer); }
  };
  const answers = await Promise.all(TYPES.map(get));
  await ensureEngineRef().catch(() => undefined);
  if (answers.every((a) => a == null)) return { models: refModels(make, year).length ? refModels(make, year) : refModels(make), complete: false };
  const models = parseModels(answers, make);
  if (models.length) { memo.set(k, models); remember(make, year, models); }
  return { models: mergeModels(models, refModels(make, year)), complete: true };
}

/** every model of a make, any year (the year is not known): NHTSA's list for the make, with the engine list's */
async function modelsAnyYear(make: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<ModelList> {
  const k = `${squash(make)}|any`;
  const known = memo.get(k) || remembered(make, 0);
  void ensureEngineRef();
  if (known) { memo.set(k, known); return { models: mergeModels(known, refModels(make)), complete: true }; }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  let answer: unknown = null;
  try {
    const r = await fetchImpl(`${VPIC}/GetModelsForMake/${encodeURIComponent(make.toLowerCase())}?format=json`, ctl ? { signal: ctl.signal } : undefined);
    answer = r.ok ? await r.json() : null;
  } catch { answer = null; } finally { clearTimeout(timer); }
  await ensureEngineRef().catch(() => undefined);
  if (answer == null) return { models: refModels(make), complete: false };
  const models = parseModels([answer], make);
  if (models.length) { memo.set(k, models); remember(make, 0, models); }
  return { models: mergeModels(models, refModels(make)), complete: true };
}
