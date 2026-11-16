/* The gate screens' words: the invitation link kept on a network failure (app-shell-10) and the sign-in answer. */
import { describe, it, expect } from 'vitest';
import { t } from '../../lib/i18n';
import { signInWords, linkTrouble } from './words';
import { auth as fr } from '../../i18n/fr/auth';
import { auth as en } from '../../i18n/en/auth';

describe('before the app', () => {
  it('signIn’s answer in words: a key is translated, the server’s sentence stays', () => {
    expect(signInWords('auth.wrong')).toBe(t('auth.wrong'));
    expect(signInWords('common.networkError')).toBe(t('common.networkError'));
    expect(signInWords('Email not confirmed')).toBe('Email not confirmed');
  });
  it('no signal or the 40 s limit: the link is kept (try again); a refusal: to the sign-in screen', () => {
    expect(linkTrouble(new TypeError('Failed to fetch'))).toBe('network');
    expect(linkTrouble(Object.assign(new Error('timeout'), { code: 'timeout' }))).toBe('network');
    expect(linkTrouble({ ok: false, code: 'expired', error: 'Ce lien a expiré.' })).toBe('refused');
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
