// The one way the server adds up lines (the same rule as the database's invoice_totals): each line rounded to the cent
// like the database does, a discount line counts negative, taxes (TPS, TVQ from Réglages) on the taxable part only, each
// tax rounded on its own. Used by the customer's page (client), the texts (notify) and online booking (book).
// No import: plain calculation.
export interface Line { qty?: number | string | null; unit_cents?: number | string | null; taxable?: boolean | null; kind?: string | null }
export interface Totals { subtotal: number; tps: number; tvq: number; total: number }

/** a number written exactly in decimal (what the database's numeric holds): its digits and how many of them are
    decimals; null for anything not a finite number */
function decimal(x: number): { digits: bigint; scale: number } | null {
  if (!Number.isFinite(x)) return null;
  let t = String(Math.abs(x)), exp = 0;
  const e = t.indexOf('e');
  if (e >= 0) { exp = Number(t.slice(e + 1)); t = t.slice(0, e); }
  const dot = t.indexOf('.');
  let digits = dot >= 0 ? t.slice(0, dot) + t.slice(dot + 1) : t;
  let scale = (dot >= 0 ? t.length - dot - 1 : 0) - exp;
  if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
  return { digits: BigInt(digits) * (x < 0 ? -1n : 1n), scale };
}
/** quantity × price to the cent, exactly as the database rounds it: round(coalesce(qty, 1) × unit_cents), the quantity
    as written (1,333 h stays 1,333; 0 stays 0: an option at 0 costs nothing; nothing written = 1), a half going away
    from zero; never a cent off the invoice because of how a computer writes 1,15 */
export function lineCents(l: Line): number {
  const q = decimal(l.qty === null || l.qty === undefined || l.qty === '' ? 1 : Number(l.qty));
  const u = decimal(l.unit_cents === null || l.unit_cents === undefined || l.unit_cents === '' ? 0 : Number(l.unit_cents));
  if (!q || !u) return 0;
  const p = q.digits * u.digits, unit = 10n ** BigInt(q.scale + u.scale);
  const a = p < 0n ? -p : p;
  let cents = a / unit;
  if ((a % unit) * 2n >= unit) cents += 1n;
  let t = Number(p < 0n ? -cents : cents);
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
