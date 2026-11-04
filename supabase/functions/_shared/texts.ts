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
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k]))).replace(/\s{2,}/g, ' ').trim();
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
