/* « Changements non enregistrés »: what a section shows is the saved value with the person's own changes on top.
   - A draft holds ONLY the fields the person changed, exactly as typed (a space or a new line being typed is kept:
     settings-team-st-1). Every other field follows the saved value, so a change made meanwhile on another device shows
     here and is never written back from an old copy (settings-team-01).
   - A field leaves the draft when it is the saved value to the letter, when the saved value catches up with it (saved
     here, or the same value saved elsewhere), or when it is no longer part of the section (a text whose kind is hidden).
   - What counts as a change (the bar, the dot of the list, what is saved): spaces around words, an empty text and a
     missing value do not; key order does not; the order of a list does.
   Pure functions (draft.test.ts). */

export function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') { const s = v.trim(); return s === '' ? undefined : s; }
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (Array.isArray(v)) return v.map((x) => { const n = normalize(x); return n === undefined ? null : n; });
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const n = normalize((v as Record<string, unknown>)[k]);
      if (n !== undefined) out[k] = n;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
export function isDirty(saved: unknown, draft: unknown): boolean {
  return !sameValue(saved, draft);
}

/** the same value to the letter (no trimming): what decides whether a typed field stays in the draft */
export function sameRaw(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
/** the fields of `next` that differ from `saved` as a change (empty = nothing to save): the bar, the dot, the save */
export function changesOf<T extends object>(saved: T, next: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(next) as (keyof T)[]) if (!sameValue(saved[k], next[k])) out[k] = next[k];
  return out;
}
/** the fields of `next` the person typed, exactly as typed: the draft to keep (only the fields of the section) */
export function editsOf<T extends object>(saved: T, next: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(next) as (keyof T)[]) if (k in saved && !sameRaw(saved[k], next[k])) out[k] = next[k];
  return out;
}
/** the draft still to keep against the saved value now. `before`: the saved value the draft was last seen with; a field
    whose saved value moved since and now says the same (saved here, or elsewhere) leaves the draft. */
export function pruneDraft<T extends object>(saved: T, kept: Partial<T>, before?: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(kept) as (keyof T)[]) {
    if (!(k in saved)) continue;
    const v = kept[k];
    if (sameRaw(saved[k], v)) continue;
    if (before && !sameRaw(before[k], saved[k]) && sameValue(saved[k], v)) continue;
    out[k] = v as T[keyof T];
  }
  return out;
}
/** what the screen shows: the saved value, with the person's changes on top */
export function withChanges<T extends object>(saved: T, changes: Partial<T> | null | undefined): T {
  return changes ? { ...saved, ...changes } : saved;
}
/** true when the two drafts name the same fields with the same values to the letter (nothing to write back to the store) */
export function sameChanges(a: object, b: object): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && sameRaw((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** a text ready to store: trimmed, null when empty */
export function cleanText(s: string | null | undefined): string | null {
  const v = String(s ?? '').trim();
  return v ? v : null;
}
/** the next version of the waiver when its text changed ("1" → "2"; "1.2" → "1.3"; anything else → "2") */
export function nextVersion(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  const m = /^(.*?)(\d+)$/.exec(s);
  if (!m) return '2';
  return `${m[1]}${Number(m[2]) + 1}`;
}
