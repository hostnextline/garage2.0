/* A tap on the alert of a text while the app is open (public/push-sw.js posts « his-texto-open » with the number): the
   conversation of that number opens (comms-guide-14). An older worker posts nothing: the app is brought to the front, as
   before. Returns what stops listening. */
export type Listen = { addEventListener: (k: 'message', f: (e: MessageEvent) => void) => void; removeEventListener: (k: 'message', f: (e: MessageEvent) => void) => void };

export function phoneOfAlert(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { type?: unknown; phone?: unknown };
  if (d.type !== 'his-texto-open' || typeof d.phone !== 'string') return null;
  const p = d.phone.trim();
  // a number, nothing else (the tag is the server's, but a message is still data)
  return /^\+?[0-9][0-9 ()-]{5,24}$/.test(p) ? p : null;
}

export function openFromAlert(open: (phone: string) => void, on: Listen | null = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null): () => void {
  if (!on) return () => undefined;
  const f = (e: MessageEvent) => { const p = phoneOfAlert(e.data); if (p) open(p); };
  on.addEventListener('message', f);
  return () => on.removeEventListener('message', f);
}
