/* Number formats of the calm charts (dashboard, treasury, inventory): percent, compact money for chart labels, plain
   decimals, and money split in its whole part and its cents (the cents are written smaller). Formatters are made once
   per language and kept. */
const nfs = new Map<string, Intl.NumberFormat>();
function nf(key: string, make: () => Intl.NumberFormat): Intl.NumberFormat {
  let f = nfs.get(key);
  if (!f) { f = make(); nfs.set(key, f); }
  return f;
}
const loc = (lang: string) => (lang === 'en' ? 'en-CA' : 'fr-CA');
/** 0.123 → "12 %" / "12%" */
export function pct(x: number | null | undefined, lang: string, digits = 0): string {
  if (x == null || !Number.isFinite(x)) return '';
  return nf(`p${lang}${digits}`, () => new Intl.NumberFormat(loc(lang), { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: 0 })).format(x);
}
/** 1234567 → "12,3 k $" / "$12.3K" (chart labels; the table below gives the exact amount) */
export function compactMoney(cents: number, lang: string, digits = 1): string {
  return nf(`c${lang}${digits}`, () => new Intl.NumberFormat(loc(lang), { style: 'currency', currency: 'CAD', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: digits }))
    .format(cents / 100).replace(/CA\$/, '$');
}
export function decimal(x: number | null | undefined, lang: string, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '';
  return nf(`d${lang}${digits}`, () => new Intl.NumberFormat(loc(lang), { maximumFractionDigits: digits, minimumFractionDigits: 0 })).format(x);
}
/** "12 345" and ",67 $" (fr) / "$12,345" and ".67" (en) */
export function moneyParts(cents: number, lang: string): { main: string; minor: string } {
  const parts = nf(`m${lang}`, () => new Intl.NumberFormat(loc(lang), { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 })).formatToParts(cents / 100);
  let main = '', minor = '', inMinor = false;
  for (const p of parts) {
    if (p.type === 'decimal') inMinor = true;
    const v = p.type === 'currency' ? p.value.replace(/^CA\$$/, '$') : p.value;
    if (inMinor) minor += v; else main += v;
  }
  return { main: main.trim(), minor: minor.replace(/^\s+$/, '') };
}
