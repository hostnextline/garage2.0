/* « Changements non enregistrés »: what a section shows is the saved value with the person's own changes on top.
   - A draft holds ONLY the fields the person changed. Every other field follows the saved value, so a change made
     meanwhile on another device shows here and is never written back from an old copy (settings-team-01).
   - A field leaves the draft as soon as it equals the saved value again (typed back, or saved elsewhere).
   - What counts as a change: spaces around words, an empty text and a missing value do not; key order does not;
     the order of a list does.
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

/** the fields of `next` that differ from `saved`: the draft to keep (empty = nothing to save) */
export function changesOf<T extends object>(saved: T, next: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(next) as (keyof T)[]) if (!sameValue(saved[k], next[k])) out[k] = next[k];
  return out;
}
/** what the screen shows: the saved value, with the person's changes on top */
export function withChanges<T extends object>(saved: T, changes: Partial<T> | null | undefined): T {
  return changes ? { ...saved, ...changes } : saved;
}
/** true when the two drafts name the same fields with the same values (nothing to write back to the store) */
export function sameChanges(a: object, b: object): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
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
