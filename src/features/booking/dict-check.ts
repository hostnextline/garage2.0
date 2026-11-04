/* Test helper: two dictionaries have the same keys and the same {placeholders} in every string. Returns the problems. */
export function sameShape(a: unknown, b: unknown, path = ''): string[] {
  const out: string[] = [];
  if (typeof a === 'string' || typeof b === 'string') {
    if (typeof a !== 'string' || typeof b !== 'string') return [`${path}: not both text`];
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    if (vars(a) !== vars(b)) out.push(`${path}: {${vars(a)}} ≠ {${vars(b)}}`);
    if (!b.trim()) out.push(`${path}: empty`);
    return out;
  }
  const ka = Object.keys((a || {}) as object).sort(), kb = Object.keys((b || {}) as object).sort();
  for (const k of ka) if (!kb.includes(k)) out.push(`${path}.${k}: missing`);
  for (const k of kb) if (!ka.includes(k)) out.push(`${path}.${k}: extra`);
  for (const k of ka) if (kb.includes(k)) out.push(...sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  return out;
}
