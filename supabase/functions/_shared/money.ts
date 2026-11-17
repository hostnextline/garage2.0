// The one way the server adds up lines (the same rule as the database's invoice_totals): each line rounded to the cent
// like the database does, a discount line counts negative, taxes (TPS, TVQ from Réglages) on the taxable part only, each
// tax rounded on its own. Used by the customer's page (client), the texts (notify) and online booking (book).
// The value of ONE line lives in texts.ts (lineCents: the texts list each line with its price, and texts.ts is read by the
// app's own tests, so it imports nothing): the same rule for a line everywhere.
import { lineCents } from './texts.ts';
export { lineCents };
export interface Line { qty?: number | string | null; unit_cents?: number | string | null; taxable?: boolean | null; kind?: string | null }
export interface Totals { subtotal: number; tps: number; tvq: number; total: number }

export function sumLines(lines: Line[], settings: Record<string, any>): Totals {
  let subtotal = 0, taxable = 0;
  for (const l of lines) {
    const t = lineCents(l);
    subtotal += t;
    if (l.taxable !== false) taxable += t;
  }
  const tx = settings?.taxes || {};
  const on = tx.enabled !== false && taxable > 0;
  const tps = on ? Math.round(taxable * Number(tx.tps ?? 0.05)) : 0;
  const tvq = on ? Math.round(taxable * Number(tx.tvq ?? 0.09975)) : 0;
  return { subtotal, tps, tvq, total: subtotal + tps + tvq };
}
