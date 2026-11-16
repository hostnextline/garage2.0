/* Pure comparisons and merges of row values (no IO).
   - sameValue: two values hold the same data (a server row that comes back unchanged must not redraw the screen).
   - merge3: a settings part saved whole (booking, billing, company…) is merged at the moment it is sent: every key the
     person changed on this device is set, every other key keeps what the server has now. Two people changing two
     booking settings no longer erase each other, and a save queued on a phone with an old copy no longer rewrites
     the whole part with that old copy (core-data-19). */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const y = b as unknown[];
    return a.length === y.length && a.every((v, i) => sameValue(v, y[i]));
  }
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const kx = Object.keys(x), ky = Object.keys(y);
  return kx.length === ky.length && kx.every((k) => Object.prototype.hasOwnProperty.call(y, k) && sameValue(x[k], y[k]));
}

/** prev: the part as the device showed it before the edit; mine: as the person saved it; theirs: the server's now.
    Objects merge key by key (recursively); arrays and plain values are one value each. */
export function merge3(prev: unknown, mine: unknown, theirs: unknown): unknown {
  if (!isObj(mine) || !isObj(theirs)) return sameValue(prev, mine) ? theirs : mine;
  const p = isObj(prev) ? prev : {};
  const out: Record<string, unknown> = { ...theirs };
  for (const k of new Set([...Object.keys(p), ...Object.keys(mine)])) {
    if (!(k in mine)) { if (k in p) delete out[k]; continue; }   // the person removed it
    if (sameValue(p[k], mine[k])) continue;                      // untouched here: the server's value stays
    out[k] = merge3(p[k], mine[k], theirs[k]);
  }
  return out;
}
