/* The gate screens' words: the invitation link kept on a network failure (app-shell-10) and the sign-in answer. */
import { describe, it, expect } from 'vitest';
import { t } from '../../lib/i18n';
import { signInWords, linkTrouble, forgotSent } from './words';
import { auth as fr } from '../../i18n/fr/auth';
import { auth as en } from '../../i18n/en/auth';

describe('before the app', () => {
  it('signIn’s answer in words: a key is translated, the server’s sentence stays', () => {
    expect(signInWords('auth.wrong')).toBe(t('auth.wrong'));
    expect(signInWords('common.networkError')).toBe(t('common.networkError'));
    expect(signInWords('Some other sentence')).toBe('Some other sentence');
  });
  it('the auth server’s English for too many tries or an account never activated: said in the person’s words (R141)', () => {
    expect(signInWords('Email not confirmed')).toBe(t('auth.notConfirmed'));
    expect(signInWords('Request rate limit reached')).toBe(t('auth.tooMany'));
    expect(signInWords('For security purposes, you can only request this after 60 seconds. Too many requests')).toBe(t('auth.tooMany'));
    expect(fr.tooMany).toMatch(/Trop d’essais/);
    expect(fr.notConfirmed).toMatch(/pas encore activé/);
  });
  it('no signal or the 40 s limit: the link is kept (try again); a refusal: to the sign-in screen', () => {
    expect(linkTrouble(new TypeError('Failed to fetch'))).toBe('network');
    expect(linkTrouble(Object.assign(new Error('timeout'), { code: 'timeout' }))).toBe('network');
    expect(linkTrouble({ ok: false, code: 'expired', error: 'Ce lien a expiré.' })).toBe('refused');
  });
  it('« Mot de passe oublié »: a refusal without a code is not « sent » (R143)', () => {
    expect(forgotSent({ ok: true })).toBe(true);
    expect(forgotSent({ ok: false, code: 'not_found' })).toBe(true);
    expect(forgotSent({ ok: false })).toBe(false);
    expect(forgotSent({ ok: false, code: 'server' })).toBe(false);
  });
  it('every word exists in French and English', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });
  it('signing out with changes waiting: they are kept on this phone and leave at the next sign-in here, never « lost » (R139)', () => {
    for (const w of [fr.signOutPending.one, fr.signOutPending.other]) {
      expect(w).not.toMatch(/perdu/);
      expect(w).toMatch(/rest(e|ent) sur ce téléphone/);
      expect(w).toMatch(/prochaine connexion ici/);
    }
    for (const w of [en.signOutPending.one, en.signOutPending.other]) {
      expect(w).not.toMatch(/lost/);
      expect(w).toMatch(/stays? on this phone/);
    }
    expect(fr.signOutPending.other).toContain('{n}');
    expect(en.signOutPending.other).toContain('{n}');
  });
});
