import { describe, it, expect } from 'vitest';
import { today as frToday } from '../../i18n/fr/today';
import { today as enToday } from '../../i18n/en/today';
import { jobs as frJobs } from '../../i18n/fr/jobs';
import { jobs as enJobs } from '../../i18n/en/jobs';

/** every leaf of a dictionary, with its text (plural forms joined) */
function leaves(d: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('one' in o && 'other' in o) out[p] = Object.values(o).join(' ');
      else Object.assign(out, leaves(v, p));
    } else out[p] = String(v);
  }
  return out;
}
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().filter((x, i, a) => a.indexOf(x) === i);

describe.each([['today', frToday, enToday], ['jobs', frJobs, enJobs]])('the %s words', (_name, fr, en) => {
  const f = leaves(fr), e = leaves(en);
  it('have the same keys in French and English', () => {
    expect(Object.keys(e).sort()).toEqual(Object.keys(f).sort());
  });
  it('have the same {placeholders} in both languages', () => {
    for (const k of Object.keys(f)) expect([k, holes(e[k] || '')]).toEqual([k, holes(f[k])]);
  });
  it('follow the writing rules: no « A · B » strings, no arrows, no exclamation marks, nothing empty', () => {
    for (const [k, s] of [...Object.entries(f), ...Object.entries(e)]) {
      expect([k, /·|→|->|!/.test(s)]).toEqual([k, false]);
      expect([k, s.trim().length > 0]).toEqual([k, true]);
    }
  });
  it('French uses typographic apostrophes and spaces before « : »', () => {
    for (const [k, s] of Object.entries(f)) {
      expect([k, s.includes("'")]).toEqual([k, false]);
      expect([k, /\S:(\s|$)/.test(s.replace(/https?:\/\/\S+/g, ''))]).toEqual([k, false]);
    }
  });
});
