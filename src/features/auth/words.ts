/* Before the app: what the gate screens say. Pure: tested in words.test.ts. */
import { t } from '../../lib/i18n';
import { isNetworkError } from '../../lib/errors';

/** signIn() answers a dictionary key (« auth.wrong », « common.networkError ») or the server's own sentence */
export function signInWords(r: string): string {
  return /^[a-z]+\.[a-zA-Z_.]+$/.test(r) ? t(r) : r;
}

/** why an invitation (or a new-password) link could not be read: no signal (keep the link, try again) or a real refusal
    (expired, already used: only the sign-in screen is left) */
export function linkTrouble(e: unknown): 'network' | 'refused' {
  return isNetworkError(e) ? 'network' : 'refused';
}
