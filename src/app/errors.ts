/* When the app breaks on a phone, nobody used to know. This tells the server (report_error, Part 26): an error nobody
   caught, a promise refused with nobody listening, a content-security-policy violation (the page's rules, see
   ops/vercel/vercel.json). Quietly: never a message to the person, never twice the same error in a row, at most a few
   per visit, nothing when there is no network (the error is dropped: a queue of errors would be one more thing to break). */
import { sb } from '../data/auth';
import { APP_VERSION } from '../lib/config';

const MAX_PER_VISIT = 12;
let sent = 0;
let last = '';
let started = false;

/** one line for the error: its kind and message, or the value itself when it is not an Error */
export function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 500);
  if (typeof e === 'string') return e.slice(0, 500);
  try { return JSON.stringify(e).slice(0, 500); } catch { return String(e).slice(0, 500); }
}
/** the browser, in a few words (the full user agent says little more and is long) */
export function shortAgent(ua: string = navigator.userAgent): string {
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'autre';
  const b = /CriOS\/(\d+)/.exec(ua) ? `Chrome ${/CriOS\/(\d+)/.exec(ua)![1]}` : /Chrome\/(\d+)/.exec(ua) && !/Edg\//.test(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}`
    : /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}` : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
    : /Version\/(\d+).*Safari/.test(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)![1]}` : 'navigateur';
  return `${os} ${b}`.slice(0, 200);
}
/** errors not worth a report: the network (the app says so itself), a script loading failure after an update */
export function ignorable(message: string): boolean {
  return /Failed to fetch|NetworkError|Load failed|network error|TypeError: cancelled|dynamically imported module|Importing a module script failed|ResizeObserver loop/i.test(message);
}

/** tells the server; false when nothing was sent (repeat, quota, offline, no session) */
export async function report(message: string, stack: string | null = null): Promise<boolean> {
  if (!message || ignorable(message) || message === last || sent >= MAX_PER_VISIT) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  last = message; sent++;
  try {
    const { error } = await sb.rpc('report_error', {
      p_message: message, p_stack: stack ? stack.slice(0, 4000) : null, p_page: (location.hash || '#/').slice(0, 200),
      p_version: APP_VERSION, p_agent: shortAgent()
    });
    return !error;
  } catch { return false; }
}

/** installs the listeners once (window error, unhandled promise, CSP violation) */
export function startErrors() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('error', (e) => {
    const err = e.error as unknown;
    void report(err ? describe(err) : String(e.message || 'Erreur'), err instanceof Error ? err.stack || null : `${e.filename || ''}:${e.lineno || 0}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown;
    void report(describe(r), r instanceof Error ? r.stack || null : null);
  });
  // the page's security rules (report-only at first): what the rule would have blocked, so the rule is fixed before it bites
  window.addEventListener('securitypolicyviolation', (e) => {
    void report(`CSP: ${e.violatedDirective} ← ${e.blockedURI || 'inline'}`, `${e.sourceFile || ''}:${e.lineNumber || 0}${e.disposition === 'report' ? ' (report-only)' : ''}`);
  });
}
