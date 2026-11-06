/* Where the garage's database lives. The publishable key is public by design (the database's own access rules protect
   the data); the tests build the app against a local copy with VITE_SUPABASE_URL / VITE_SUPABASE_KEY. */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || 'https://wyxvizxabqgvsiiemvfw.supabase.co';
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_Pzvp2qqc8Y52meAZkczSSg_trH2ZTTA';
/** realtime is off in the local test copy (it has no realtime server): the app then refreshes on its own */
export const REALTIME: boolean = import.meta.env.VITE_REALTIME !== 'off';
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev';
declare const __BUILT_AT__: string | undefined;
/** when this version was made (ISO time; the commit's time for the published app) */
export const BUILT_AT: string = typeof __BUILT_AT__ === 'string' ? __BUILT_AT__ : '';
/** the app's home on the web (Vercel). Links sent to customers and to the team point here. */
export const HOME_URL = 'https://mecanique-mobile-his.vercel.app/';
/** on the app's old address (GitHub Pages, still working), the address it lives at now; null everywhere else */
export function movedTo(href: string = location.href): string | null {
  try {
    return /(^|\.)github\.io$/i.test(new URL(href).hostname) ? HOME_URL : null;
  } catch {
    return null;
  }
}
/** the address this copy of the app runs at */
export function appBase(): string {
  const u = new URL('./', location.href);
  u.hash = ''; u.search = '';
  return u.toString();
}
