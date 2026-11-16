/* Errors in words: what kind of trouble it is (no signal, a session to renew, a real refusal, our own bug), and the
   message to show a person. The kind is read from the HTTP status and the database's code, never from the server's
   sentence: a 503 while the server reloads, a statement timeout or a deadlock are « try again », not « refused ».
   No app knowledge here: the data layer keeps exporting these names, the design kit reads them from here. */
import { t, lang } from './i18n';

/** network: try again later (no signal, timeout, the server is unwell); auth: the session must be renewed first;
    refusal: the server said no (tell the person); bug: something nobody planned (kept and shown, never dropped) */
export type ErrorKind = 'network' | 'auth' | 'refusal' | 'bug';

export class AppError extends Error {
  kind: ErrorKind;
  /** offline | timeout | server | busy | expired | none | account | rule | rights | duplicate | invalid | gone | preview | update | storage | unknown */
  sub: string;
  code?: string;
  hint?: string;
  details?: string;
  status?: number;
  constructor(kind: ErrorKind, sub: string, message: string, o: { code?: string; hint?: string; details?: string; status?: number } = {}) {
    super(message);
    this.kind = kind; this.sub = sub;
    this.code = o.code; this.hint = o.hint; this.details = o.details; this.status = o.status;
  }
}

/** a refusal made on this device (« Voir l'app comme… », a missing row): same shape as the server's own refusals */
export class Refused extends AppError {
  constructor(code: string, message: string) { super('refusal', code === 'preview' ? 'preview' : 'rule', message, { code, hint: code }); }
}

/** the codes our own transport puts on a request it refused to send (client.ts): never a server answer */
export const NO_SESSION = 'his_no_session';
export const OTHER_ACCOUNT = 'his_other_account';

type Raw = { code?: unknown; status?: unknown; message?: unknown; name?: unknown; hint?: unknown; details?: unknown; error?: unknown } | null | undefined;

// what the browser says when the request never got an answer (the only place a message is read: there is no status)
const FETCH_FAILED = /Failed to fetch|NetworkError|Load failed|network|fetch failed|ECONN|ETIMEDOUT|aborted|AbortError|TimeoutError/i;
// SQLSTATE classes and PostgREST codes that mean « the server could not do it right now »
const RETRY_CODE = /^(PGRST00[0-3]|08...|53...|57014|57P0[1-3]|40001|40P01|55P03)$/;
// the server does not know this function or column: an app older or newer than the database
const UPDATE_CODE = /^(PGRST202|PGRST204|42883|42703)$/;

/** sorts any error (a PostgREST answer, a fetch failure, a server function's { ok: false, code }, one of ours) into its kind */
export function classify(e: unknown, status?: number): AppError {
  if (e instanceof AppError) return e;
  const err = (e && typeof e === 'object' ? e : { message: e == null ? '' : String(e) }) as Raw;
  const code = String(err?.code ?? '');
  const st = typeof status === 'number' ? status : typeof err?.status === 'number' ? (err.status as number) : undefined;
  const message = String(err?.message || err?.error || err?.name || code || 'erreur');
  const hint = err?.hint == null ? undefined : String(err.hint);
  const o = { code: code || undefined, hint, details: err?.details == null ? undefined : String(err.details), status: st };
  const name = String(err?.name || '');
  if (code === 'timeout' || name === 'AbortError' || name === 'TimeoutError') return new AppError('network', 'timeout', message, o);
  if (code === NO_SESSION) return new AppError('auth', 'none', message, o);
  if (code === OTHER_ACCOUNT) return new AppError('auth', 'account', message, o);
  if (st === 0) return new AppError('network', 'offline', message, o);
  if (st === 429) return new AppError('network', 'busy', message, o);
  if (st === 408 || st === 425 || (st !== undefined && st >= 500) || RETRY_CODE.test(code)) return new AppError('network', 'server', message, o);
  if (st === 401 || code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303') return new AppError('auth', 'expired', message, o);
  if (UPDATE_CODE.test(code)) return new AppError('bug', 'update', message, o);
  if (code === 'P0001' || /^[a-z][a-z_]*$/.test(code)) return new AppError('refusal', 'rule', message, o);
  if (code === '42501' || st === 403) return new AppError('refusal', 'rights', message, o);
  if (code === '23505') return new AppError('refusal', 'duplicate', message, o);
  if (/^2[23]...$/.test(code) || code === 'PGRST116' || (st !== undefined && st >= 400)) return new AppError('refusal', 'invalid', message, o);
  // no status and no code: a transport failure tells itself only by the browser's words
  if (st === undefined && !code && FETCH_FAILED.test(message) && !/permission|policy|violates/i.test(message)) return new AppError('network', 'offline', message, o);
  return new AppError('bug', 'unknown', message, o);
}

/** network trouble (try again later) vs. a real refusal (tell the person) */
export function isNetworkError(e: unknown): boolean {
  if (!e) return false;
  return classify(e).kind === 'network';
}

/** the message to show a person for an error (the server's own words, translated when we know the case) */
export function errorMessage(e: unknown): string {
  if (!e) return t('common.genericError', { msg: '' }).replace(/\s*:\s*$/, '');
  if (typeof e === 'string') return e;
  const c = classify(e);
  const err = e as { hint?: string; code?: string; message?: string; error?: string };
  if (c.kind === 'network') return c.sub === 'server' || c.sub === 'busy' ? t('errors.server') : t('common.networkError');
  // our own refusals carry a short code (database: hint; server functions: code) and a French sentence
  const hinted = /^[a-z][a-z_]*$/.test(String(err.hint || '')) ? String(err.hint) : '';
  const own = hinted || (/^[a-z_]+$/.test(String(err.code || '')) ? String(err.code) : '');
  const said = String(err.error || err.message || '');
  if (own) {
    // « server » is our transport's own code for an answer that was not JSON: its words are an HTTP status, not a sentence
    if (lang.value === 'fr' && said && own !== 'server') return said;
    const k = `errors.${own}`; const tr = t(k);
    if (tr !== k) return tr;
    return said || t('common.genericError', { msg: own });
  }
  if (err.code === '42501' || /row-level security|permission denied/i.test(said)) return lang.value === 'fr' && /[éèàù’]/.test(said) ? said : t('common.notAllowed');
  if (!said) return t('common.genericError', { msg: '' }).replace(/\s*:\s*$/, '');
  return t('common.genericError', { msg: said });
}

/** a refusal as it is kept with a change the server refused: the words to show, in the person's language now */
export function errorText(e: unknown): string {
  return errorMessage(e).slice(0, 300);
}

/** what a refused change keeps: `error`, the words in the person's language at the moment of the refusal (read as they
    are by anything that shows the entry, the previous version of the app too), and under `err` the refusal's code with
    the server's own sentence (`said`), so that the « refusé » list can say it again in another language: words kept in
    English could not be turned back into the server's French sentence once the person switches to French. */
export function keptRefusal(e: AppError): { error: string; err: { kind: string; sub: string; code?: string; hint?: string; status?: number; said?: string } } {
  return { error: errorText(e), err: { kind: e.kind, sub: e.sub, code: e.code, hint: e.hint, status: e.status, said: e.message ? e.message.slice(0, 300) : undefined } };
}
