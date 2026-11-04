/* Money is always whole cents (integers). Taxes are computed once, on the taxable subtotal, and rounded to the cent,
   the way Revenu Québec shows them on an invoice: TPS 5 % and TVQ 9,975 % (both on the price before taxes). */

export type Cents = number;

export interface TaxRates { enabled: boolean; tps: number; tvq: number }
export const QC_TAXES: TaxRates = { enabled: true, tps: 0.05, tvq: 0.09975 };

export interface Line { qty: number; unitCents: Cents; taxable?: boolean }

/** round half away from zero, to the cent */
export function roundCents(x: number): Cents {
  const s = x < 0 ? -1 : 1;
  return s * Math.round(Math.abs(x) + 1e-9);
}

export function lineTotal(l: Line): Cents {
  return roundCents(l.qty * l.unitCents);
}

export interface Totals { subtotal: Cents; taxable: Cents; tps: Cents; tvq: Cents; total: Cents }

export function totals(lines: Line[], rates: TaxRates = QC_TAXES): Totals {
  let subtotal = 0, taxable = 0;
  for (const l of lines) {
    const t = lineTotal(l);
    subtotal += t;
    if (l.taxable !== false) taxable += t;
  }
  const on = rates.enabled && taxable > 0;
  const tps = on ? roundCents(taxable * rates.tps) : 0;
  const tvq = on ? roundCents(taxable * rates.tvq) : 0;
  return { subtotal, taxable, tps, tvq, total: subtotal + tps + tvq };
}

/** "59,99", "59.99", "59 $", "$59.99", "1 234,50" → 5999 ; returns null when it is not an amount */
export function parseMoney(input: string): Cents | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/[\s  ]/g, '').replace(/\$/g, '').replace(/CAD$/i, '');
  if (!s) return null;
  const neg = s.startsWith('-') || s.startsWith('−');
  s = s.replace(/^[-−]/, '');
  // "1.234,50" or "1,234.50": the last separator is the decimal one when followed by 1-2 digits,
  // and it must differ from the thousands separator ("12,345,6" is refused)
  const m = /^(\d{1,3}(?:([.,])\d{3})*|\d+)(?:([.,])(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  if (m[2] && m[3] && m[2] === m[3]) return null;
  const whole = Number(m[1].replace(/[.,]/g, ''));
  const frac = m[4] ? Number(m[4].padEnd(2, '0')) : 0;
  if (!Number.isFinite(whole)) return null;
  const c = whole * 100 + frac;
  return neg ? -c : c;
}

const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(lang: string, digits: number): Intl.NumberFormat {
  const k = lang + digits;
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: digits, maximumFractionDigits: digits });
    fmtCache.set(k, f);
  }
  return f;
}

/** 5999 → "59,99 $" (fr) / "$59.99" (en). whole=true drops ",00" on round amounts. */
export function money(c: Cents | null | undefined, lang: string = 'fr', opts: { whole?: boolean } = {}): string {
  if (c == null || !Number.isFinite(c)) return '';
  const digits = opts.whole && c % 100 === 0 ? 0 : 2;
  return nf(lang, digits).format(c / 100).replace(/^CA\$/, '$');
}

/** for inputs: 5999 → "59,99" (fr) / "59.99" (en) */
export function moneyInput(c: Cents | null | undefined, lang: string = 'fr'): string {
  if (c == null) return '';
  const s = (Math.abs(c) / 100).toFixed(2);
  return (c < 0 ? '-' : '') + (lang === 'en' ? s : s.replace('.', ','));
}
