/* « Questions de l'équipe »: a refusal of the server is said in the person's language (R145). */
import { describe, it, expect, vi, afterEach } from 'vitest';

const answer = vi.hoisted(() => ({ r: {} as Record<string, unknown> }));
vi.mock('../../data/auth', async (orig) => ({ ...(await orig<typeof import('../../data/auth')>()), callFn: async () => answer.r }));
import { readLog } from './TeamLog';
import { t, setLang } from '../../lib/i18n';

afterEach(() => setLang('fr'));

describe('Questions de l’équipe — a refusal in words', () => {
  it('English: the code in English, not the server’s French sentence', async () => {
    setLang('en');
    answer.r = { ok: false, code: 'hermes_error', error: 'Hermes a un problème. Réessaie dans un instant.' };
    expect(await readLog('')).toEqual({ ok: false, error: t('errors.hermes_error') });
  });
  it('French: the server’s sentence as before; no code and no words: « erreur du serveur »', async () => {
    setLang('fr');
    answer.r = { ok: false, code: 'hermes_error', error: 'Hermes a un problème. Réessaie dans un instant.' };
    expect(await readLog('')).toEqual({ ok: false, error: 'Hermes a un problème. Réessaie dans un instant.' });
    answer.r = { ok: false };
    expect(await readLog('')).toEqual({ ok: false, error: t('errors.server') });
  });
});
