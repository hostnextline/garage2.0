// Links sent to customers and team members always point to the garage's own site (never elsewhere): the app's home on
// Vercel. The old address (GitHub Pages) still works, but a page there gets links to the new one.
import { env } from './http.ts';
export const DEFAULT_BASES = ['https://mecanique-mobile-his.vercel.app/'];
export function allowedBases(): string[] {
  const v = env('APP_BASE_URLS');
  return (v ? v.split(',') : DEFAULT_BASES).map((s) => s.trim()).filter(Boolean).map((s) => (s.endsWith('/') ? s : s + '/'));
}
/** the base the app says it runs at, if it is one of ours; else the first one */
export function baseOf(asked?: unknown): string {
  const list = allowedBases();
  if (typeof asked === 'string') {
    try {
      const u = new URL(asked);
      const b = `${u.origin}${u.pathname.replace(/[^/]*$/, '')}`;
      if (list.includes(b)) return b;
    } catch { /* not a URL */ }
  }
  return list[0];
}
export function clientLink(base: string, token: string, lang: string): string {
  return `${base}client.html#t=${token}${lang === 'en' ? '&l=en' : ''}`;
}
export function trackLink(base: string, token: string, lang: string): string {
  return `${base}client.html#suivi=${token}${lang === 'en' ? '&l=en' : ''}`;
}
export function inviteLink(base: string, token: string, lang: string): string {
  return `${base}#invite=${token}${lang === 'en' ? '&l=en' : ''}`;
}
