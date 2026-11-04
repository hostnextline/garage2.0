/* Reading a receipt: the text the photo reader (OCR) gives becomes a vendor, a date and the amounts. These are
   only proposals: the form stays editable, and the person checks them.
   - Amounts always go through parseMoney (whole cents), never parseFloat: « 1,234.56 » stays 1 234,56 $ (the old app
     read 234,56) and « 1 234,56 » too. A receipt amount always has two decimals, which keeps the TPS/TVQ registration
     numbers (« 123456789 RT0001 »), the rates (« 9,975 % ») and the litres (« 45,123 L ») out of the amounts.
   - Québec taxes: TPS 5 % and TVQ 9,975 %, both on the price before taxes, rounded to the cent (like lib/money). */
import { parseMoney, roundCents, totals, QC_TAXES, type Cents, type TaxRates } from '../../lib/money';
import { addDays, daysBetween, isValidDay, type Day } from '../../lib/dates';

export interface Amounts { subtotal: Cents | null; tps: Cents | null; tvq: Cents | null; total: Cents | null }
export interface ReceiptGuess extends Amounts { vendor: string | null; day: Day | null }
export interface Split { subtotal: Cents; tps: Cents; tvq: Cents; total: Cents }

/* ---------- taxes ---------- */

/** the taxes on a price before taxes (the same rounding as an invoice) */
export function splitFromSubtotal(subtotal: Cents, rates: TaxRates = QC_TAXES): Split {
  const sign = subtotal < 0 ? -1 : 1;
  const t = totals([{ qty: 1, unitCents: Math.abs(subtotal) }], { ...rates, enabled: true });
  return { subtotal, tps: sign * t.tps, tvq: sign * t.tvq, total: sign * t.total };
}

/** the price before taxes and the taxes inside a total paid. The store computed tps = round(S × 5 %) and
    tvq = round(S × 9,975 %) on a subtotal S: we look for that S (it is unique when it exists). When no S gives this
    exact total (rounding gaps), the cent left over goes to the subtotal, so the three parts always add up. */
export function splitFromTotal(total: Cents, rates: TaxRates = QC_TAXES): Split {
  const sign = total < 0 ? -1 : 1;
  const T = Math.abs(total);
  const tax = (s: number) => roundCents(s * rates.tps) + roundCents(s * rates.tvq);
  const s0 = Math.round(T / (1 + rates.tps + rates.tvq));
  for (const d of [0, -1, 1, -2, 2, -3, 3]) {
    const s = s0 + d;
    if (s >= 0 && s + tax(s) === T) {
      return { subtotal: sign * s, tps: sign * roundCents(s * rates.tps), tvq: sign * roundCents(s * rates.tvq), total };
    }
  }
  const tps = roundCents(s0 * rates.tps), tvq = roundCents(s0 * rates.tvq);
  return { subtotal: sign * (T - tps - tvq), tps: sign * tps, tvq: sign * tvq, total };
}

/** fills what a receipt did not show from what it did, and drops what cannot be right */
export function completeAmounts(a: Amounts, rates: TaxRates = QC_TAXES): Amounts & { consistent: boolean } {
  let { subtotal, tps, tvq, total } = a;
  if (total != null && total <= 0) total = null;
  if (subtotal != null && subtotal <= 0) subtotal = null;
  if (total != null && subtotal != null && subtotal > total) subtotal = null;
  if (tps != null && (tps < 0 || (total != null && tps >= total))) tps = null;
  if (tvq != null && (tvq < 0 || (total != null && tvq >= total))) tvq = null;

  if (total == null && subtotal != null && tps != null && tvq != null) total = subtotal + tps + tvq;
  if (subtotal == null && total != null && tps != null && tvq != null && total - tps - tvq > 0) subtotal = total - tps - tvq;
  if (subtotal != null && total != null && (tps == null || tvq == null)) {
    const diff = total - subtotal;
    if (tps == null && tvq == null) {
      if (diff === 0) { tps = 0; tvq = 0; }
      else {
        const s = splitFromSubtotal(subtotal, rates);
        if (Math.abs(s.total - total) <= 2) { tps = s.tps; tvq = s.tvq + (total - s.total); }
      }
    } else if (tps == null && diff - (tvq as number) >= 0) tps = diff - (tvq as number);
    else if (tvq == null && diff - (tps as number) >= 0) tvq = diff - (tps as number);
  }
  if (total != null && subtotal == null && (tps == null) !== (tvq == null)) {
    // one tax read: the split from the total tells the rest when it agrees with it
    const s = splitFromTotal(total, rates);
    if ((tps != null && Math.abs(s.tps - tps) <= 1) || (tvq != null && Math.abs(s.tvq - tvq) <= 1)) {
      tps ??= s.tps; tvq ??= s.tvq;
      subtotal = total - tps - tvq;
    }
  }
  const consistent = subtotal != null && tps != null && tvq != null && total != null && subtotal + tps + tvq === total;
  return { subtotal, tps, tvq, total, consistent };
}

/* ---------- text helpers ---------- */

/** lower case without accents, one character for one character (positions stay the same) */
export function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const base = ch.normalize('NFD')[0] || ch;
    const low = base.toLowerCase();
    out += low.length === 1 ? low : base;
  }
  return out;
}
function cleanText(text: string): string[] {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[    \t]/g, ' ')
    .replace(/[−‒–—]/g, '-')
    .replace(/[‘’ʼ]/g, '’')
    .split('\n')
    // two spaces or more is a gap between columns: kept as two, so « 4   762,10 » is never read as 4 762,10
    .map((l) => l.replace(/ {2,}/g, '  ').trim());
}

/* amounts: two decimals, not glued to another number, not a percentage */
const AMOUNT = /(?<![\d.,])(-\s?)?\$?\s?(\d{1,3}(?:[ .,]\d{3})+|\d+)([.,])(\d{2})(?!\d)(?!\s?%)/g;
export function amountsIn(s: string): Cents[] {
  const out: Cents[] = [];
  for (const m of s.matchAll(AMOUNT)) {
    const c = parseMoney(`${m[1] ? '-' : ''}${m[2]}${m[3]}${m[4]}`);
    if (c != null) out.push(c);
  }
  return out;
}

/* ---------- dates ---------- */
const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, janvier: 1, january: 1, feb: 2, fev: 2, fevr: 2, fevrier: 2, february: 2, mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, avril: 4, april: 4, mai: 5, may: 5, jun: 6, juin: 6, june: 6, jul: 7, juil: 7, juillet: 7, july: 7,
  aug: 8, aou: 8, aout: 8, august: 8, sep: 9, sept: 9, septembre: 9, september: 9, oct: 10, octobre: 10, october: 10,
  nov: 11, novembre: 11, november: 11, dec: 12, decembre: 12, december: 12
};
const D_ISO = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
const D_NUM = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g;
const D_DMY = /\b(\d{1,2})(?:er|st|nd|rd|th)?[ .-]*([a-z]{3,9})\.?[ ,.-]*((?:20)?\d{2})\b/g;
const D_MDY = /\b([a-z]{3,9})\.?[ .-]*(\d{1,2})(?:st|nd|rd|th)?[ ,.-]+(20\d{2})\b/g;
const pad = (n: number) => String(n).padStart(2, '0');
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
function mk(y: number, m: number, d: number): Day | null {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return isValidDay(s) ? s : null;
}
/** a receipt is from the past (a day ahead at most, for a phone in another time zone), and recent */
function plausible(day: Day | null, ref: Day): day is Day {
  return !!day && day <= addDays(ref, 1) && daysBetween(day, ref) <= 3 * 366;
}
/** the dates written on a folded line; an ambiguous « 03/11/2026 » becomes the reading closest to today */
function datesIn(line: string, ref: Day): { day: Day; start: number; end: number }[] {
  const found: { day: Day; start: number; end: number }[] = [];
  const add = (m: RegExpMatchArray, options: (Day | null)[]) => {
    const ok = options.filter((d): d is Day => plausible(d, ref));
    if (!ok.length) return;
    ok.sort((a, b) => Math.abs(daysBetween(a, ref)) - Math.abs(daysBetween(b, ref)));
    found.push({ day: ok[0], start: m.index!, end: m.index! + m[0].length });
  };
  const taken = (i: number) => found.some((f) => i >= f.start && i < f.end);
  for (const m of line.matchAll(D_ISO)) add(m, [mk(Number(m[1]), Number(m[2]), Number(m[3]))]);
  for (const m of line.matchAll(D_NUM)) {
    if (taken(m.index!)) continue;
    const a = Number(m[1]), b = Number(m[2]), y = year(m[3]);
    const opts = [mk(y, b, a), mk(y, a, b)];
    if (m[3].length === 2) opts.push(mk(2000 + a, b, Number(m[3])));   // 26-11-03
    add(m, opts);
  }
  for (const m of line.matchAll(D_DMY)) {
    if (taken(m.index!) || !MONTHS[m[2]]) continue;
    add(m, [mk(year(m[3]), MONTHS[m[2]], Number(m[1]))]);
  }
  for (const m of line.matchAll(D_MDY)) {
    if (taken(m.index!) || !MONTHS[m[1]]) continue;
    add(m, [mk(Number(m[3]), MONTHS[m[1]], Number(m[2]))]);
  }
  return found;
}
/** the date of the purchase: the latest plausible date on the receipt (a « member since » date is older,
    a « returns until » date is in the future) */
export function receiptDate(text: string, ref: Day): Day | null {
  let best: Day | null = null;
  for (const l of cleanText(text)) for (const d of datesIn(fold(l), ref)) if (!best || d.day > best) best = d.day;
  return best;
}

/* ---------- the labels of a receipt ---------- */
type Kind = 'sub' | 'skip' | 'tps' | 'tvq' | 'total' | 'pay';
const KW = new RegExp([
  '(?<sub>\\b(?:sous[ -]?total|s[ ./-]total|sub[ -]?total|total partiel|montant avant taxes?|(?:avant|before|hors|sans|excl\\.?|excluding|pre)[ -]+(?:les |la )?(?:taxes?|tps|tvq|gst|qst)\\b))',
  '(?<skip>\\btotal (?:des |de |du |of )?(?:taxes?|economies?|epargnes?|savings?|saved|rabais|escomptes?|remises?|articles?|items?|qtes?|qty|points?|pts|unites?)\\b|\\b(?:monnaie|change|rendu|remis)\\b)',
  '(?<tps>\\b(?:t\\.?p\\.?s|g\\.?s\\.?t|h\\.?s\\.?t)\\b\\.?)',
  '(?<tvq>\\b(?:t\\.?v\\.?q|q\\.?s\\.?t|t\\.?v\\.?p|p\\.?s\\.?t|tvo|tv0)\\b\\.?)',
  '(?<total>\\b(?:grand total|total a payer|total du|total due|montant (?:total|du|a payer)|amount due|balance due|net a payer|a payer|total)\\b)',
  '(?<pay>\\b(?:debit|credit|visa|mastercard|master card|amex|american express|interac|comptant|cash|paiement|payment)\\b)'
].join('|'), 'g');
const KINDS: Kind[] = ['sub', 'skip', 'tps', 'tvq', 'total', 'pay'];
const HAS_KW = new RegExp(KW.source);

/** what each label of the receipt says, in the order of the receipt */
function labelled(lines: string[], ref: Day): { kind: Kind; amounts: Cents[] }[] {
  const out: { kind: Kind; amounts: Cents[] }[] = [];
  const folded = lines.map((l) => {
    let f = fold(l);
    for (const d of datesIn(f, ref)) f = f.slice(0, d.start) + ' '.repeat(d.end - d.start) + f.slice(d.end);
    return f;
  });
  folded.forEach((line, li) => {
    const marks = [...line.matchAll(KW)].map((m) => ({ kind: KINDS.find((k) => m.groups?.[k]) as Kind, start: m.index!, end: m.index! + m[0].length }));
    marks.forEach((mk, i) => {
      let amounts = amountsIn(line.slice(mk.end, marks[i + 1]?.start ?? line.length));
      // the amount alone on the next line (a receipt read column by column)
      if (!amounts.length && i === marks.length - 1) {
        const next = folded[li + 1];
        if (next && !HAS_KW.test(next) && /^[-$\s\d.,]+\$?$/.test(next)) amounts = amountsIn(next);
      }
      out.push({ kind: mk.kind, amounts });
    });
  });
  return out;
}

/* ---------- the vendor ---------- */
const GREETING = /^(?:\*+\s*)?(?:bienvenue|welcome|bonjour|hello)(?:\s+(?:chez|a|au|aux|to|at))?\b[\s,!.:-]*/i;
const GENERIC = /\b(?:recu|receipt|facture|invoice|copie|copy|client|customer|merci|thank|thanks|you|caisse|register|transaction|caissier|cashier|vendeur|commis|magasin|store|succursale|succ|branch|no|numero|date|heure|time|original|duplicata|achat|purchase|vente|sale)\b/g;
const STREET = /\b(?:rue|av|ave|avenue|boul|boulevard|blvd|ch|chemin|street|st|road|rd|place|pl|montee|rang|route|autoroute|cote|suite|bureau|local)\b/;
const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'a', 'au', 'aux', 'en', 'sur', 'of', 'the', 'and', 'chez', 'pour']);
function titleCase(s: string): string {
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (!letters || letters !== letters.toUpperCase()) return s;           // written by hand: keep it
  return s.split(' ').map((w, i) => {
    const low = w.toLowerCase();
    if (i > 0 && (SMALL.has(low) || /^[dl]['’]/.test(low))) return low;
    if (w.replace(/[^\p{L}]/gu, '').length <= 3 && !SMALL.has(low)) return w;   // IGA, BMR, SAQ
    return low.replace(/(^|[-’'.])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
  }).join(' ');
}
/** the name of the store: the first line at the top that is not an address, a phone, a date or a greeting */
export function receiptVendor(text: string): string | null {
  const lines = cleanText(text).filter(Boolean).slice(0, 8);
  for (const raw of lines) {
    let l = raw.replace(GREETING, '').trim();
    const f = fold(l);
    if (!l) continue;
    if (/\d{3}[\s.)-]*\d{3}[\s.-]?\d{4}/.test(f)) continue;                                 // phone
    if (/\b[a-z]\d[a-z]\s?\d[a-z]\d\b/.test(f)) continue;                                   // postal code
    if (/(?:www\.|https?:|@|\.com\b|\.ca\b|\btel\b|\bfax\b)/.test(f)) continue;
    if (/^\d+[\s,-]/.test(f) || (/\d/.test(f) && STREET.test(f))) continue;                   // address
    if (/\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}/.test(f)) continue;                                  // date
    const words = f.replace(GENERIC, ' ').replace(/[^a-z’'&\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (words.replace(/[^a-z]/g, '').length < 3) continue;
    const letters = (l.match(/\p{L}/gu) || []).length;
    if (letters / l.replace(/\s/g, '').length < 0.5) continue;
    l = l.replace(/\s*(?:#|no\.?|n°|magasin|store|succ\.?|succursale)\s*\d+\b.*$/i, '')
      .replace(/[\s*=_.,:;#-]+$/, '').replace(/^[\s*=_.,:;#-]+/, '').replace(/\s+/g, ' ').trim();
    if (l.replace(/[^\p{L}]/gu, '').length < 3) continue;
    return titleCase(l).slice(0, 60);
  }
  return null;
}

/* ---------- the whole receipt ---------- */
const last = (xs: Cents[]) => (xs.length ? xs[xs.length - 1] : null);
/** vendor, date and amounts read on a receipt (each may be null). `ref` is today. */
export function parseReceipt(text: string, ref: Day, rates: TaxRates = QC_TAXES): ReceiptGuess & { consistent: boolean } {
  const lines = cleanText(text);
  const marks = labelled(lines, ref);
  const pick = (k: Kind) => marks.filter((m) => m.kind === k).map((m) => last(m.amounts)).filter((x): x is Cents => x != null);
  const totalsRead = pick('total').filter((c) => c > 0);
  const paid = pick('pay').filter((c) => c > 0);
  const raw: Amounts = {
    subtotal: last(pick('sub')),
    tps: last(pick('tps')),
    tvq: last(pick('tvq')),
    // the amount paid is the largest « total » (a store may print several); without one, what the card paid
    total: totalsRead.length ? Math.max(...totalsRead) : paid.length ? Math.max(...paid) : null
  };
  return { vendor: receiptVendor(text), day: receiptDate(text, ref), ...completeAmounts(raw, rates) };
}

/* ---------- the category ---------- */
const RULES: [RegExp, string[]][] = [
  [/petro|shell|esso|ultramar|irving|couche|sonic|crevier|harnois|pioneer|olco|essence|carburant|\bgaz\b|fuel/, ['carburant', 'fuel']],
  [/lordco|napa|carquest|partsource|uni-?select|pieces|auto parts|princess auto|rockauto|pneus|tire/, ['pieces', 'parts']],
  [/castrol|valvoline|mobil 1|huile|lave-glace|antigel|liquide/, ['huile et liquides', 'oil and fluids']],
  [/home depot|rona|\bbmr\b|reno-depot|canac|snap-on|mac tools|matco|outil|tool/, ['outils et equipement', 'tools and equipment']],
  [/\bbell\b|videotron|fizz|rogers|telus|koodo|virgin|freedom|cogeco|ebox/, ['telephone et internet', 'phone and internet']],
  [/tim hortons|mcdonald|subway|a&w|restaurant|resto|cafe|pizza|st-hubert|bistro|starbucks|poulet/, ['repas', 'meals']],
  [/assurance|insurance|intact|belair|promutuel|la capitale/, ['assurances', 'insurance']],
  [/facebook|meta|google ads|kijiji|publicite|vistaprint|imprimerie/, ['publicite', 'advertising']],
  [/frais bancaires|banque|bank fee/, ['frais bancaires', 'bank fees']]
];
/** the category to propose for a vendor: the one used last time for the same vendor, else a known kind of store.
    Only a category of the garage's own list is ever proposed. */
export function guessCategory(vendor: string | null | undefined, categories: string[], history: { vendor: string | null; category: string }[] = []): string | null {
  const v = fold(String(vendor || '').trim());
  if (!v) return null;
  const inList = (c: string) => categories.find((x) => fold(x) === fold(c)) || null;
  for (const h of history) if (h.vendor && fold(h.vendor.trim()) === v) { const c = inList(h.category); if (c) return c; }
  for (const [re, names] of RULES) if (re.test(v)) for (const n of names) { const c = inList(n); if (c) return c; }
  return null;
}
