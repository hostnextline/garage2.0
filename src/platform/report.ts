/* Errors nobody planned for: a screen that throws while drawing, a promise that fails with no catch, a script error.
   They used to vanish (a blank screen, a frozen one, nothing in any log). Now each one is written to the console,
   counted, kept in a short list for this visit, and handed to whoever listens (the data layer can send them to the
   server). Never throws: reporting an error must not become a second error. */

export type ErrorKind = 'render' | 'error' | 'rejection' | 'chunk' | 'boot' | 'action';
export interface ErrorReport {
  at: string;
  kind: ErrorKind;
  /** where it happened: 'root', 'screen:/job/:id', 'host:hermes', 'button'… */
  where: string;
  message: string;
  stack?: string;
  /** the screen's address without its ids (no customer data leaves in a report) */
  route: string;
  /** how many times this same error came within the quiet window */
  count: number;
}

/* no signal here: the customer's page loads this (through the Button) and stays light */
let counted = 0;
/** how many unexpected errors this visit met (the same one within the quiet window counts once) */
export function errorCount(): number { return counted; }

const KEEP = 20;
/** the same error again within this window is counted on the first report, not reported again */
export const QUIET_MS = 60_000;
const recent: ErrorReport[] = [];
const lastSeen = new Map<string, { at: number; report: ErrorReport }>();
const sinks = new Set<(r: ErrorReport) => void>();

/** the message and stack of anything thrown (an Error, a string, a server answer { message }) */
export function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message || err.name || 'Error', stack: err.stack ? String(err.stack).slice(0, 1500) : undefined };
  if (typeof err === 'string') return { message: err };
  const o = err as { message?: unknown; error?: unknown } | null;
  if (o && typeof o === 'object') return { message: String(o.message ?? o.error ?? safeJson(o)) };
  return { message: String(err) };
}
function safeJson(o: unknown): string {
  try { return JSON.stringify(o).slice(0, 300); } catch { return Object.prototype.toString.call(o); }
}

/** noise a browser sends that says nothing about the app */
export function isNoise(message: string): boolean {
  return /ResizeObserver loop|^AbortError|The operation was aborted|Script error\.?$/i.test(message);
}

/** a lazy screen or part whose file could not be downloaded (offline, or the app was updated meanwhile) */
export function isChunkError(err: unknown): boolean {
  const m = describe(err).message;
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(m);
}

/** '/job/0b6f…' → '/job/:id': the address names the screen, never the customer */
export function routeShape(hash: string): string {
  const path = String(hash || '').replace(/^#/, '').split('?')[0] || '/';
  return path.split('/').map((p) => (/^[0-9a-f]{8}-|^[0-9]{4}-[0-9]{2}-[0-9]{2}$|^[a-z]-[\w-]+$|^\d+$/i.test(p) ? ':id' : p)).join('/') || '/';
}

export function reportError(err: unknown, where: string, kind: ErrorKind = 'error', now = Date.now()): void {
  try {
    const { message, stack } = describe(err);
    if (isNoise(message)) return;
    const key = `${kind}|${where}|${message}`;
    const seen = lastSeen.get(key);
    if (seen && now - seen.at < QUIET_MS) { seen.report.count++; return; }
    const report: ErrorReport = {
      at: new Date(now).toISOString(), kind, where, message, stack,
      route: typeof location !== 'undefined' ? routeShape(location.hash) : '/', count: 1
    };
    lastSeen.set(key, { at: now, report });
    if (lastSeen.size > 200) lastSeen.delete(lastSeen.keys().next().value as string);
    recent.push(report);
    if (recent.length > KEEP) recent.shift();
    counted++;
    try { console.error(`[H.I.S] ${kind} @ ${where}: ${message}`, err); } catch { /* a console that refuses */ }
    for (const sink of sinks) { try { sink(report); } catch { /* one listener's failure is not the app's */ } }
  } catch { /* reporting must never throw */ }
}

/** listens to every new report (returns the way to stop listening) */
export function onErrorReport(sink: (r: ErrorReport) => void): () => void {
  sinks.add(sink);
  return () => { sinks.delete(sink); };
}
/** the last reports of this visit, oldest first */
export function recentErrors(): ErrorReport[] { return recent.slice(); }

/** for tests: forget everything */
export function resetReports() { recent.length = 0; lastSeen.clear(); sinks.clear(); counted = 0; }

let installed = false;
/** window 'error' (a script error) and 'unhandledrejection' (a promise nobody caught): reported, never lost */
export function installGlobalErrorHandlers(w: Window | undefined = typeof window !== 'undefined' ? window : undefined): void {
  if (installed || !w) return;
  installed = true;
  w.addEventListener('error', (e: ErrorEvent) => {
    // a picture or a script tag that failed has no error object and no message worth keeping
    if (!e.error && !e.message) return;
    reportError(e.error ?? e.message, e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : 'window', 'error');
  });
  w.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    reportError(e.reason, 'promise', isChunkError(e.reason) ? 'chunk' : 'rejection');
  });
}
