/* Errors in words: network trouble or a real refusal, and the message to show a person.
   No app knowledge here: the data layer (api.ts, sync.ts) keeps exporting these names, the design kit reads them from here. */
import { t, lang } from './i18n';

/** network trouble (try again later) vs. a real refusal (tell the person) */
export function isNetworkError(e: unknown): boolean {
  const err = e as { code?: string; status?: number; message?: string; name?: string } | null;
  if (!err) return false;
  if (err.code === 'timeout') return true;
  // the database asked to try again (two changes at the same instant): not a refusal
  if (err.code === '40P01' || err.code === '40001' || err.code === '55P03') return true;
  if (typeof err.status === 'number' && (err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500)) return true;
  const m = String(err.message || err.name || '');
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|ECONN|ETIMEDOUT|aborted|AbortError/i.test(m) && !/permission|policy|violates/i.test(m);
}
export function errorText(e: unknown): string {
  const err = e as { message?: string; details?: string; hint?: string } | null;
  return String(err?.message || err || 'erreur').slice(0, 300);
}

export class Refused extends Error {
  constructor(public code: string, message: string) { super(message); }
}
/** the message to show a person for an error (the server's own words, translated when we know the case) */
export function errorMessage(e: unknown): string {
  if (!e) return t('common.genericError', { msg: '' });
  if (typeof e === 'string') return e;
  const err = e as { hint?: string; code?: string; message?: string; error?: string };
  if (isNetworkError(err)) return t('common.networkError');
  // our own refusals carry a short code (database: hint; server functions: code) and a French sentence
  const own = String(err.hint || (/^[a-z_]+$/.test(String(err.code || '')) ? err.code : '') || '');
  const said = String(err.error || err.message || '');
  if (own) {
    if (lang.value === 'fr' && said) return said;
    const k = `errors.${own}`; const tr = t(k);
    if (tr !== k) return tr;
    return said || t('common.genericError', { msg: own });
  }
  if (err.code === '42501' || /row-level security|permission denied/i.test(said)) return lang.value === 'fr' && /[éèàù’]/.test(said) ? said : t('common.notAllowed');
  return t('common.genericError', { msg: said });
}
