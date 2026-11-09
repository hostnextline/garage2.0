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
  // the lines of the text stay (the list of services); spaces left by an empty word are tidied
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])))
    .split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
interface Line { description?: string | null; qty?: number | string | null; unit_cents?: number | string | null; status?: string | null; kind?: string | null }
const COUNTED = ['planned', 'done', 'approved'];
const lineCents = (l: Line) => { const c = Math.round(Number(l.qty || 1) * Number(l.unit_cents || 0)); return l.kind === 'discount' ? -Math.abs(c) : c; };
/** the work of an appointment, one line each: « • Vidange d’huile : 79,99 $ » (no price yet: « selon le travail sur place ») */
export function servicesList(lines: Line[], lang: Lang): string {
  return lines.filter((l) => COUNTED.includes(String(l.status || 'planned')) && String(l.description || '').trim())
    .map((l) => {
      const c = lineCents(l);
      const q = Number(l.qty || 1);
      const what = `${q !== 1 ? `${String(q).replace('.', lang === 'en' ? '.' : ',')} × ` : ''}${String(l.description).trim()}`;
      return `• ${what} : ${c !== 0 ? money(c, lang) : lang === 'en' ? 'according to the work on site' : 'selon le travail sur place'}`.replace(' : ', lang === 'en' ? ': ' : '\u00a0: ');
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
/** « pay now » in the confirmation, only when card payment is on */
export function payNowWords(on: boolean, lang: Lang): string {
  return on ? (lang === 'en' ? ' (and pay now if you wish)' : ' (et la payer maintenant si vous le voulez)') : '';
}
export function first(name?: string | null): string { return String(name || '').trim().split(/\s+/)[0] || ''; }
/** minutes after midnight, Montréal time, of a moment */
export function localMinute(d: Date): number {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d);
  const h = Number(p.find((x) => x.type === 'hour')?.value || 0), m = Number(p.find((x) => x.type === 'minute')?.value || 0);
  return (h % 24) * 60 + m;
}
