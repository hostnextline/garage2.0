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

/** a line as the database keeps it (job_items, invoices.lines): numbers may come as strings from JSON */
export interface DbLine { qty?: number | string | null; unit_cents?: number | string | null; kind?: string | null }
/** What a line is worth before taxes, exactly as the database counts it (invoice_totals): quantity × price rounded to the
    cent, a half away from zero; a discount always counts down, whatever sign it was stored with; any other line keeps its
    sign (a credit typed as a negative price stays a credit). No quantity = 1, no price = 0, not a number = 0.
    The one TS rule of x-money-06: every screen that adds up lines asks this one. */
export function lineWorth(l: DbLine): Cents {
  const q = l.qty == null || l.qty === '' ? 1 : Number(l.qty);
  const u = l.unit_cents == null || l.unit_cents === '' ? 0 : Number(l.unit_cents);
  if (!Number.isFinite(q) || !Number.isFinite(u)) return 0;
  const q100 = Math.round(q * 100);
  let t: number;
  if (Math.abs(q * 100 - q100) < 1e-6 && Number.isInteger(u)) {
    // a quantity of two decimals (numeric(10,2)) and a price in whole cents: exact in hundredths of a cent, no 1,15 × 1000 slip
    const p = q100 * u;
    t = Math.sign(p) * Math.floor((Math.abs(p) + 50) / 100);
  } else {
    t = roundCents(q * u);
  }
  if (l.kind === 'discount' && t > 0) t = -t;
  return t || 0; // never -0
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

// the language of the person using the app, for parseMoney without a language. lib/i18n keeps it in step with its `lang`
// (money.ts imports nothing, so the customer page, which reads amounts but not the team's dictionaries, stays light).
let uiLang = 'fr';
/** the language parseMoney follows when it is not given one (set by lib/i18n each time the language changes) */
export function setMoneyLang(l: string): void { uiLang = l === 'en' ? 'en' : 'fr'; }

/** the largest amount the database keeps (a Postgres integer of cents) */
const MAX_CENTS = 2147483647;

/** "59,99", "59.99", "59 $", "$59.99", "1 234,50", ",50" → whole cents ; null when it is not an amount.
    One comma or point followed by exactly three digits and nothing else is refused: in Québec French the comma is the
    decimal mark, so « 59,999 » is a slip (a doubled key with gloves on), not 59 999 $ (core-data-20). In English
    (`lang` 'en') « 1,000 » keeps meaning a thousand. Thousands written with a space, or a group followed by decimals
    (« 1.234,50 », « 1,234.50 »), are read as before. Without `lang`, the team's current language decides (lib/i18n tells
    it through setMoneyLang), so a form typed in English keeps « 1,000 » = 1 000 $. */
export function parseMoney(input: string, lang?: string): Cents | null {
  const l = lang ?? uiLang;
  if (input == null) return null;
  let s = String(input).trim().replace(/[\s\u00a0\u202f]/g, '').replace(/\$/g, '').replace(/CAD$/i, '');
  if (!s) return null;
  const neg = s.startsWith('-') || s.startsWith('−');
  s = s.replace(/^[-−]/, '');
  // "1.234,50" or "1,234.50": the last separator is the decimal one when followed by 0-2 digits ("5," while typing),
  // and it must differ from the thousands separator ("12,345,6" is refused)
  const m = /^(\d{1,3}(?:([.,])\d{3})*|\d*)(?:([.,])(\d{0,2}))?$/.exec(s);
  if (!m || !/\d/.test(s)) return null;
  const [, whole, group, dec, frac] = m;
  if (group && dec && group === dec) return null;
  // a lone separator before three digits: thousands only for an English comma
  const groups = whole.split(/[.,]/).length - 1;
  if (groups === 1 && !dec && !(l === 'en' && group === ',')) return null;
  const c = Number(whole.replace(/[.,]/g, '') || '0') * 100 + (frac ? Number(frac.padEnd(2, '0')) : 0);
  if (!Number.isFinite(c) || c > MAX_CENTS) return null;
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
