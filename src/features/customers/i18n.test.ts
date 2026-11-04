import { describe, it, expect } from 'vitest';
import { customers as frC } from '../../i18n/fr/customers';
import { customers as enC } from '../../i18n/en/customers';
import { vehicles as frV } from '../../i18n/fr/vehicles';
import { vehicles as enV } from '../../i18n/en/vehicles';

function walk(o: unknown, path = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof o === 'string') out[path] = o;
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k, out);
  return out;
}
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('customers and vehicles dictionaries', () => {
  for (const [name, fr, en] of [['customers', frC, enC], ['vehicles', frV, enV]] as const) {
    it(`${name}: the same keys and the same {placeholders} in French and English`, () => {
      const f = walk(fr), e = walk(en);
      expect(Object.keys(e).sort()).toEqual(Object.keys(f).sort());
      // plural forms may drop {n} in one language ("1 rappel" / "one call back"), never add an unknown one
      for (const k of Object.keys(f)) {
        const plural = /\.(zero|one|other)$/.test(k);
        if (plural) expect(vars(e[k]).split(',').filter(Boolean).every((v) => ['n', ...vars(f[k]).split(',')].includes(v)), k).toBe(true);
        else expect(vars(e[k]), k).toBe(vars(f[k]));
      }
    });
    it(`${name}: writing rules (no ALL-CAPS words, no « · » lists, no arrows, no exclamation marks)`, () => {
      for (const [k, s] of Object.entries({ ...walk(fr), ...walk(en) })) {
        expect(/\s·\s/.test(s), `${k}: ${s}`).toBe(false);
        expect(/[→←⟶➜]/.test(s), `${k}: ${s}`).toBe(false);
        expect(/!/.test(s), `${k}: ${s}`).toBe(false);
        expect(/\b[A-ZÀ-Ý]{4,}\b/.test(s.replace(/\b(NIV|VIN|ATF|AWD|FWD|RWD|GHL|HCF|MTF|DOT)\b/g, '')), `${k}: ${s}`).toBe(false);
      }
    });
  }
});
