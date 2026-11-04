import { describe, it, expect } from 'vitest';
import { treasury as frT } from '../../i18n/fr/treasury';
import { treasury as enT } from '../../i18n/en/treasury';
import { inventory as frI } from '../../i18n/fr/inventory';
import { inventory as enI } from '../../i18n/en/inventory';
import { dashboard as frD } from '../../i18n/fr/dashboard';
import { dashboard as enD } from '../../i18n/en/dashboard';

function flat(o: unknown, p = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o as Record<string, unknown>)) Object.assign(out, typeof v === 'string' ? { [p + k]: v } : flat(v, `${p}${k}.`));
  return out;
}
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe.each([['treasury', frT, enT], ['inventory', frI, enI], ['dashboard', frD, enD]])('the %s words', (_name, fr, en) => {
  const f = flat(fr), e = flat(en);
  it('the same keys in French and English', () => expect(Object.keys(e).sort()).toEqual(Object.keys(f).sort()));
  it('the same {placeholders} in both languages, no empty text', () => {
    for (const k of Object.keys(f)) {
      expect(f[k].trim(), k).not.toBe('');
      expect(e[k]?.trim(), k).not.toBe('');
      // a plural form may leave the number out (« Aucune facture »)
      if (!/\.(zero|one)$/.test(k)) expect(vars(e[k] || ''), k).toBe(vars(f[k]));
    }
  });
  it('no arrows in the words, no « A · B · C »', () => {
    for (const s of [...Object.values(f), ...Object.values(e)]) {
      expect(s).not.toMatch(/[→←⟶]/);
      expect(s).not.toMatch(/ · /);
    }
  });
});
