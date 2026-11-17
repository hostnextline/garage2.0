/* The invoices' stylesheet does not lean on another screen's (R128). shared/stock/needs.css (loaded with the card of
   « La journée ») styled three class names that « Inventaire » shares with the invoices' screens. Two are copied in
   invoices.css with the same declarations (.inv-summary, .inv-qty), so nothing moves when « Inventaire » takes its own
   names; the third (.inv-filters: a column for « Inventaire ») is out-ranked on « Factures », where it stacked the
   search into a 240 px box and the period into a 220 px one, and the invoices' own rules no longer reach « Inventaire »
   (they gave its search a 240 px box). Measured in a browser with the built stylesheets, in both load orders.
   The declarations needs.css had are written here (NEEDS), not read from it: the stock side may rename its classes
   (stock-*) without turning this suite red (review invoices-r2-5). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mine = readFileSync(join(__dirname, 'invoices.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** what shared/stock/needs.css set on the shared names when « Factures » stopped leaning on it (2026-11-16) */
const NEEDS: Record<'.inv-summary' | '.inv-qty' | '.inv-filters', string[]> = {
  '.inv-summary': ['display: flex', 'flex-wrap: wrap', 'align-items: flex-end', 'justify-content: space-between', 'gap: var(--sp-4)'],
  '.inv-qty': ['font-size: var(--t-md)', 'white-space: nowrap'],
  '.inv-filters': ['display: flex', 'flex-direction: column', 'gap: var(--sp-3)']
};
/** the declarations of a selector's rules (in the order of the file), as a list of « property: value » */
function rule(css: string, selector: string): string[][] {
  const out: string[][] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(selector)) out.push(m[2].split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean));
  }
  return out;
}

describe('the invoices stylesheet without shared/stock/needs.css (R128)', () => {
  it('.inv-summary and .inv-qty: the declarations « Factures » always had (those of needs.css), in the invoices own file', () => {
    for (const sel of ['.inv-summary', '.inv-qty'] as const) {
      expect([sel, rule(mine, sel)[0]]).toEqual([sel, NEEDS[sel]]);
    }
    // the invoice line's own rule (text-align) is kept, on the invoice editor only
    expect(rule(mine, '.inv-editor .inv-qty')[0]).toEqual(['text-align: right']);
  });
  it('the filters of « Factures »: one row, by a rule that out-ranks a one-class .inv-filters column whatever loads last', () => {
    const own = rule(mine, '.inv-filters.inv-list-filters')[0];
    expect(own).toContain('flex-direction: row');
    // every property needs.css set on .inv-filters is set again by the stronger rule (two classes against one)
    for (const d of NEEDS['.inv-filters']) {
      const prop = d.split(':')[0];
      expect([prop, own.some((x) => x.startsWith(`${prop}:`))]).toEqual([prop, true]);
    }
  });
  it('no rule of the invoices reaches « Inventaire », which uses .inv-filters and .inv-qty too', () => {
    const selectors = [...mine.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
    const reaching = selectors.filter((x) => /(^|\s)\.inv-filters(\s|$)/.test(x) || /(^|\s)\.inv-qty(\s|$|\.)/.test(x) && x.split(/\s+/).length === 1);
    // only the copy of needs.css's own declarations (identical, so nothing changes there)
    expect(reaching).toEqual(['.inv-qty']);
  });
  it('reads no other package’s stylesheet: the stock side may rename its classes freely', () => {
    const me = readFileSync(join(__dirname, 'styles.test.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(me).not.toMatch(/['"]stock['"]|needs\.css['"]/);
  });
});
