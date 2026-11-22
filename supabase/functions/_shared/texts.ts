// Words of the messages sent to customers, in their language (French Québec or English).
export type Lang = 'fr' | 'en';
export function money(cents: number, lang: Lang): string {
  const v = (cents / 100).toFixed(2);
  return lang === 'en' ? `$${v.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` : `${v.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d),)/g, ' ')} $`;
}
export function clock(min: number, lang: Lang): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  if (lang === 'en') { const ap = h < 12 ? 'a.m.' : 'p.m.'; const h12 = h % 12 === 0 ? 12 : h % 12; return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`; }
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
export function longDay(day: string, lang: Lang): string {
  const [y, mo, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-CA' : 'fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dt);
}
export function fill(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  // the lines of the text stay (the list of services); spaces left by an empty word are tidied (« Bonjour , » for a
  // customer with no first name, a company: « Bonjour, »; a comma never has a space before it, in French or English)
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])))
    .split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+,/g, ',').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
interface Line { description?: string | null; qty?: number | string | null; unit_cents?: number | string | null; status?: string | null; kind?: string | null }
const COUNTED = ['planned', 'done', 'approved'];
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
export function lineCents(l: { qty?: number | string | null; unit_cents?: number | string | null; kind?: string | null }): number {
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
/** the work of an appointment, one line each: « • Vidange d’huile : 79,99 $ » (no price yet: « selon le travail sur place ») */
export function servicesList(lines: Line[], lang: Lang): string {
  return lines.filter((l) => COUNTED.includes(String(l.status || 'planned')) && String(l.description || '').trim())
    .map((l) => {
      const c = lineCents(l);
      const q = Number(l.qty || 1);
      const what = `${q !== 1 ? `${String(q).replace('.', lang === 'en' ? '.' : ',')} × ` : ''}${String(l.description).trim()}`;
      // « Promo : pneus… » keeps its own words: the separator is added after the name, never searched inside it
      return `• ${what}${lang === 'en' ? ': ' : '\u00a0: '}${c !== 0 ? money(c, lang) : lang === 'en' ? 'according to the work on site' : 'selon le travail sur place'}`;
    }).join('\n');
}
/** the total before taxes of the work counted */
export function subtotalOf(lines: Line[]): number {
  return lines.filter((l) => COUNTED.includes(String(l.status || 'planned'))).reduce((n, l) => n + lineCents(l), 0);
}
/** the total in the booking text: « 159,98 $ + tx »; work by the hour too: « 79,99 $ + tx, plus le travail à l’heure »;
    nothing priced yet: « selon le travail sur place » (never « 0,00 $ ») */
export function subtotalWords(lines: Line[], lang: Lang): string {
  const counted = lines.filter((l) => COUNTED.includes(String(l.status || 'planned')) && String(l.description || '').trim());
  const sub = subtotalOf(counted);
  const hourly = counted.some((l) => lineCents(l) === 0);
  if (sub <= 0) return lang === 'en' ? 'according to the work on site' : 'selon le travail sur place';
  return `${money(sub, lang)} + tx${hourly ? (lang === 'en' ? ', plus the work by the hour' : ', plus le travail à l’heure') : ''}`;
}
/** the block in a sentence: « le matin » / « in the morning » */
export function blockWords(key: string, lang: Lang): string {
  const fr: Record<string, string> = { am: 'le matin', pm: 'l’après-midi', eve: 'le soir' };
  const en: Record<string, string> = { am: 'in the morning', pm: 'in the afternoon', eve: 'in the evening' };
  return (lang === 'en' ? en : fr)[key] || '';
}
/* ---------- « Plages d’arrivée »: a job of the block 'day' is told its 4-hour window, or « flexible » ---------- */
export interface WhenJob { day: string; block: string; win_start?: number | string | null; win_end?: number | string | null; win_flex?: boolean | null }
/** the window promised to the customer ([start, end] in minutes of the day); null for a block job and for a job without one yet */
export function jobWindow(j: WhenJob): [number, number] | null {
  if (j.block !== 'day' || j.win_start == null || j.win_end == null) return null;
  const a = Number(j.win_start), z = Number(j.win_end);
  return Number.isFinite(a) && Number.isFinite(z) ? [a, z] : null;
}
/** « entre 14 h et 18 h » / “between 2 p.m. and 6 p.m.” */
export function betweenWords(start: number, end: number, lang: Lang): string {
  return lang === 'en' ? `between ${clock(start, lang)} and ${clock(end, lang)}` : `entre ${clock(start, lang)} et ${clock(end, lang)}`;
}
/** a flexible booking: no window yet */
export function flexWords(lang: Lang): string {
  return lang === 'en' ? 'during the day; we confirm a 4-hour window the day before' : 'dans la journée ; nous vous confirmons la veille une plage de 4 heures';
}
/** the moment of a job in a sentence: « le matin » (block), « entre 14 h et 18 h » (window), « dans la journée ; … » (flexible) */
export function momentWords(j: WhenJob, lang: Lang): string {
  if (j.block !== 'day') return blockWords(j.block, lang);
  const w = jobWindow(j);
  return w ? betweenWords(w[0], w[1], lang) : flexWords(lang);
}
/** the text sent when a flexible booking gets its window (kind « window »), when the settings have no text for it */
export const WINDOW_TEXT: Record<Lang, string> = {
  fr: 'Bonjour {prenom}, votre plage d’arrivée est confirmée : {garage} vient {jour}, {plage}. Pour changer : {telephone}',
  en: 'Hello {prenom}, your arrival window is confirmed: {garage} comes on {jour}, {plage}. To change: {telephone}'
};
const BLOC_AT = /[ \t]*,?[ \t]*\{bloc\}/g;
/** The words of the day and the hours of a job ({jour}, {bloc}, {debut}, {fin}, {plage}) and the text they go in.
    {plage} is the hours in words whatever the job: « entre 12 h et 16 h » (a block's or a window's), or the flexible words.
    A block job (am / pm / eve): the text as it is and the block's words and hours, as always.
    A 'day' job: the same texts must say the window instead of a block, so the text is adapted:
      window    « {jour}, {bloc} (entre {debut} et {fin}) » → « {jour}, entre {debut} et {fin} »
                (a text that never says the hours: {bloc} = « entre 14 h et 18 h »)
      flexible  « {bloc} (entre {debut} et {fin}) » and « entre {debut} et {fin} » → « dans la journée ; nous vous
                confirmons la veille une plage de 4 heures » */
export function whenText(tpl: string, j: WhenJob, blocks: { key: string; start: number; end: number }[] | null | undefined, lang: Lang):
  { tpl: string; vars: { jour: string; bloc: string; debut: string; fin: string; plage: string } } {
  const jour = longDay(j.day, lang);
  if (j.block !== 'day') {
    const b = (blocks || []).find((x) => x.key === j.block) || { start: 480, end: 720 };
    return { tpl, vars: { jour, bloc: blockWords(j.block, lang), debut: clock(b.start, lang), fin: clock(b.end, lang), plage: betweenWords(b.start, b.end, lang) } };
  }
  // « {bloc} (entre {debut} et {fin}) »: the hours come out of the brackets
  let t = tpl.replace(/\{bloc\}\s*\(([^()]*\{debut\}[^()]*\{fin\}[^()]*)\)/g, '$1');
  const tidy = (x: string) => x.replace(/^[ \t]*,[ \t]*/gm, '');
  const w = jobWindow(j);
  if (w) {
    const hours = t.includes('{debut}') && t.includes('{fin}');
    if (hours) t = tidy(t.replace(BLOC_AT, ''));
    // “… and 6 p.m.” already ends with a period: the sentence's own is not written twice
    if (lang === 'en') t = t.replace(/\{(fin|plage|bloc)\}\.(?![\w.])/g, '{$1}');
    const between = betweenWords(w[0], w[1], lang);
    return { tpl: t, vars: { jour, bloc: hours ? '' : between, debut: clock(w[0], lang), fin: clock(w[1], lang), plage: between } };
  }
  t = t.replace(/(?:\b(?:entre|between|de|from)\s+)?\{debut\}[^{}\n]{0,12}\{fin\}/gi, '{bloc}');
  // said once
  let said = false;
  t = tidy(t.replace(BLOC_AT, (m) => { if (said) return ''; said = true; return m; }));
  return { tpl: t, vars: { jour, bloc: flexWords(lang), debut: '', fin: '', plage: flexWords(lang) } };
}
/** « pay now » in the confirmation, only when card payment is on */
export function payNowWords(on: boolean, lang: Lang): string {
  return on ? (lang === 'en' ? ' (and pay now if you wish)' : ' (et la payer maintenant si vous le voulez)') : '';
}
export function first(name?: string | null): string { return String(name || '').trim().split(/\s+/)[0] || ''; }
/** the day (YYYY-MM-DD) of a moment in Montréal: an invoice finished at 19 h 30 is that evening's, not the next day's */
export function localDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
/** minutes after midnight, Montréal time, of a moment */
export function localMinute(d: Date): number {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d);
  const h = Number(p.find((x) => x.type === 'hour')?.value || 0), m = Number(p.find((x) => x.type === 'minute')?.value || 0);
  return (h % 24) * 60 + m;
}
