/* « Changements non enregistrés »: a section is dirty when what is on screen differs from what is saved.
   An empty text, a missing value and spaces around words do not count as a change; key order does not matter;
   the order of a list does. Pure functions (draft.test.ts). */

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
/** the names of the top-level fields that changed (to mark them on screen) */
export function changedKeys(saved: Record<string, unknown> | null | undefined, draft: Record<string, unknown> | null | undefined): string[] {
  const keys = new Set([...Object.keys(saved || {}), ...Object.keys(draft || {})]);
  return [...keys].filter((k) => !sameValue(saved?.[k], draft?.[k])).sort();
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
