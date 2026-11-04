/* The address of the customer's page: client.html#t=<token>[&l=en][&retour=paye] or client.html#suivi=<token>[&l=en].
   Also remembers, on this phone only, the two links the customer opened (the appointment and the truck tracking), so
   each page can point to the other one. */
import { isLang, type CLang } from './i18n';

export interface Link { kind: 't' | 'suivi' | null; token: string; l: CLang | null; retour: string | null }

export function parseLink(hash: string | null | undefined): Link {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const t = p.get('t'), s = p.get('suivi');
  const kind = t != null ? 't' : s != null ? 'suivi' : null;
  // texting apps sometimes glue a period or a bracket to the end of a link: tokens never contain those
  const token = String(t ?? s ?? '').trim().replace(/[^A-Za-z0-9_-]+$/, '');
  const l = p.get('l');
  return { kind, token, l: isLang(l) ? l : null, retour: p.get('retour') };
}

export function linkHash(kind: 't' | 'suivi', token: string, l?: CLang | null, extra: Record<string, string> = {}): string {
  const parts = [`${kind}=${token}`];
  if (l) parts.push(`l=${l}`);
  for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${encodeURIComponent(v)}`);
  return '#' + parts.join('&');
}

/** changes the address without a new step in the browser's history */
export function replaceHash(hash: string) {
  try { history.replaceState(history.state, '', location.pathname + location.search + hash); } catch { /* ignore */ }
}

const KEY = { t: 'his.client.t', suivi: 'his.client.suivi' } as const;
const KEEP = { t: 45 * 24 * 3600 * 1000, suivi: 5 * 3600 * 1000 } as const;
export function remember(kind: 't' | 'suivi', token: string) {
  try { localStorage.setItem(KEY[kind], JSON.stringify({ token, at: Date.now() })); } catch { /* private mode */ }
}
/** the other link opened on this phone lately (the tracking link only lives a few hours) */
export function recall(kind: 't' | 'suivi', now: number = Date.now()): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY[kind]) || 'null') as { token?: string; at?: number } | null;
    if (!v?.token || !v.at || now - v.at > KEEP[kind] || !/^[A-Za-z0-9_-]{4,120}$/.test(v.token)) return null;
    return v.token;
  } catch { return null; }
}
export function forget(kind: 't' | 'suivi') {
  try { localStorage.removeItem(KEY[kind]); } catch { /* ignore */ }
}

/** the garage's name and phone from the last good answer: an error page can still say whom to call */
export interface KnownGarage { name: string | null; phone: string | null }
export function rememberGarage(g: { name?: string | null; phone?: string | null } | null | undefined) {
  if (!g || (!g.name && !g.phone)) return;
  try { localStorage.setItem('his.client.garage', JSON.stringify({ name: g.name || null, phone: g.phone || null })); } catch { /* ignore */ }
}
export function recallGarage(): KnownGarage | null {
  try {
    const v = JSON.parse(localStorage.getItem('his.client.garage') || 'null') as KnownGarage | null;
    return v && (v.name || v.phone) ? { name: v.name || null, phone: v.phone || null } : null;
  } catch { return null; }
}
