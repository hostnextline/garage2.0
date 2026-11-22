/* Before the app: what the gate screens say. Pure: tested in words.test.ts. */
import { t } from '../../lib/i18n';
import { isNetworkError } from '../../lib/errors';

/** signIn() answers a dictionary key (« auth.wrong », « common.networkError ») or the server's own sentence, in English:
    the two the team can meet (too many tries, an account never activated) are said in the person's words (R141) */
export function signInWords(r: string): string {
  if (/^[a-z]+\.[a-zA-Z_.]+$/.test(r)) return t(r);
  if (/rate limit|too many|over_request/i.test(r)) return t('auth.tooMany');
  if (/email not confirmed|not confirmed/i.test(r)) return t('auth.notConfirmed');
  return r;
}

/** why an invitation (or a new-password) link could not be read: no signal (keep the link, try again) or a real refusal
    (expired, already used: only the sign-in screen is left) */
export function linkTrouble(e: unknown): 'network' | 'refused' {
  return isNetworkError(e) ? 'network' : 'refused';
}

/** « Mot de passe oublié »: the server answers { ok: true } whatever the address (it never says who is on the team);
    any other answer is a trouble to say under the field, a refusal without a code too: it used to read « C'est parti »
    while nothing had left (R143). « not_found » stays « sent », as before (an older server's answer for an unknown address). */
export function forgotSent(r: { ok: boolean; code?: string }): boolean {
  return r.ok || r.code === 'not_found';
}
