import { describe, it, expect } from 'vitest';
import { invoices as frInvoices } from '../../i18n/fr/invoices';
import { invoices as enInvoices } from '../../i18n/en/invoices';
import { quotes as frQuotes } from '../../i18n/fr/quotes';
import { quotes as enQuotes } from '../../i18n/en/quotes';

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

describe('the billed line of a paid invoice (jobs’ item sheet, review invoices-r2-2)', () => {
  // the sheet shows reopen.itemPaid right above « Modifier la facture », which a paid invoice of an open job has (R42):
  // the words lead to the button, they no longer say the line never changes
  it('says how to change the line: open the invoice again, as for a finished one', () => {
    expect(frInvoices.reopen.itemPaid).toBe('La facture est payée. Pour retirer cette ligne ou changer son prix, rouvre-la :');
    expect(enInvoices.reopen.itemPaid).toBe('The invoice is paid. To remove this line or change its price, open it again:');
    for (const s of [frInvoices.reopen.itemPaid, enInvoices.reopen.itemPaid]) expect(s).not.toMatch(/ne change plus|no longer changes/);
  });
  it('a line no one here may reopen (paid too much, or not this person’s invoice): ask the office', () => {
    expect(frInvoices.reopen.itemLocked).toBe('La facture est terminée : pour changer cette ligne, demande au bureau.');
    expect(enInvoices.reopen.itemLocked).toBe('The invoice is finished: to change this line, ask the office.');
  });
});

describe.each([['invoices', frInvoices, enInvoices], ['quotes', frQuotes, enQuotes]])('the %s words', (_name, fr, en) => {
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
  it('French: typographic apostrophes, a no-break space before « : » and inside « »', () => {
    for (const [k, s] of Object.entries(f)) {
      expect([k, s.includes("'")]).toEqual([k, false]);
      expect([k, /\S:(\s|$)/.test(s) || / :/.test(s)]).toEqual([k, false]);
      expect([k, /« | »/.test(s)]).toEqual([k, false]);
    }
  });
});
