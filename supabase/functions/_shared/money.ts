// The one way the server adds up lines (the same rule as the database's invoice_totals): each line rounded to the cent
// like the database does, a discount line counts negative, taxes (TPS, TVQ from Réglages) on the taxable part only, each
// tax rounded on its own. Used by the customer's page (client), the texts (notify) and online booking (book).
// No import: plain calculation.
export interface Line { qty?: number | string | null; unit_cents?: number | string | null; taxable?: boolean | null; kind?: string | null }
export interface Totals { subtotal: number; tps: number; tvq: number; total: number }

/** quantity × price to the cent, exactly as the database rounds it (a quantity has two decimals; a half goes away from
    zero): never a cent off the invoice because of how a computer writes 1,15 */
export function lineCents(l: Line): number {
  const q = Number(l.qty || 1), u = Number(l.unit_cents || 0);
  if (!Number.isFinite(q) || !Number.isFinite(u)) return 0;
  const p = Math.round(q * 100) * Math.round(u);          // an exact whole number: hundredths of a cent
  let t = Math.sign(p) * Math.floor((Math.abs(p) + 50) / 100);
  if (l.kind === 'discount' && t > 0) t = -t;
  return t || 0;
}
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
