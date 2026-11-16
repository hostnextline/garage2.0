/* Hermes: one person's conversation, dropped when the account changes (comms-guide-01, confirmed), and the small
   send / stop defects (comms-guide-17). */
import { describe, it, expect, beforeEach } from 'vitest';
import { access } from '../../data/auth';
import { t } from '../../lib/i18n';
import type { Access } from '../../data/types';
import { hermesOpen } from '../../services/bubbles';
import { chat, draft, hermesBusy, offNote, askHermes, stopHermes, restartHermes, sessionId, type Ask } from './session';

const person = (id: string) => ({ id, roles: ['owner'], owner: true, prefs: {}, rights: {}, trucks: [] }) as unknown as Access;
const ctx = () => 'context';
const answer = (text: string): Ask => async () => ({ ok: true, text });
function waiting() {
  let done!: (v: { ok: boolean; text?: string }) => void;
  const bodies: Record<string, unknown>[] = [];
  const ask: Ask = (b) => { bodies.push(b); return new Promise((r) => { done = r; }); };
  return { ask, bodies, answer: (text: string) => done({ ok: true, text }) };
}

beforeEach(() => { access.value = person('owner-1'); restartHermes(); draft.value = ''; });

describe('Hermes: the conversation belongs to the person signed in', () => {
  it('sign-out and another person signing in: nothing of the owner is left, the panel is closed, a new session', async () => {
    await askHermes('Résume les factures pas encore payées', ctx, answer('4 200 $ à recevoir'));
    expect(chat.value).toHaveLength(2);
    const before = sessionId();
    hermesOpen.value = true;
    draft.value = 'et les dépenses';
    access.value = null;                 // afterSignOut
    expect(chat.value).toEqual([]);
    expect(draft.value).toBe('');
    expect(hermesOpen.value).toBe(false);
    access.value = person('mechanic-1');
    const w = waiting();
    const p = askHermes('Quoi apporter ?', ctx, w.ask);
    expect((w.bodies[0].messages as unknown[]).length).toBe(1);
    expect(w.bodies[0].session).not.toBe(before);
    w.answer('Des filtres'); await p;
  });
  it('an answer still on its way at sign-out is never shown to the next person, and « thinking » stops at once', async () => {
    const w = waiting();
    const p = askHermes('Le chiffre du mois ?', ctx, w.ask);
    expect(hermesBusy.value).toBe(true);
    access.value = person('office-1');   // signed in as someone else without a reload
    expect(hermesBusy.value).toBe(false);
    w.answer('12 000 $');
    expect((await p).kind).toBe('dropped');
    expect(chat.value).toEqual([]);
  });
  it('the same person (a refreshed access) keeps the conversation', async () => {
    await askHermes('Bonjour', ctx, answer('Salut'));
    access.value = { ...person('owner-1'), full_name: 'Hassan' } as Access;
    expect(chat.value).toHaveLength(2);
  });
});

describe('Hermes: sending and stopping', () => {
  it('the whole conversation goes with each question', async () => {
    await askHermes('Un', ctx, answer('1'));
    const w = waiting();
    const p = askHermes('Deux', ctx, w.ask);
    expect(w.bodies[0].messages).toEqual([{ role: 'user', content: 'Un' }, { role: 'assistant', content: '1' }, { role: 'user', content: 'Deux' }]);
    expect(w.bodies[0].context).toBe('context');
    w.answer('2'); await p;
  });
  it('a second question while one is on its way is not sent', async () => {
    const w = waiting();
    const p = askHermes('Un', ctx, w.ask);
    expect((await askHermes('Deux', ctx, w.ask)).kind).toBe('dropped');
    expect(w.bodies).toHaveLength(1);
    w.answer('1'); await p;
  });
  it('a failure: the question leaves the conversation and comes back in the box, even with the panel closed', async () => {
    const r = await askHermes('Quoi faire ?', ctx, async () => ({ ok: false, code: 'busy', error: 'Trop de questions' }));
    expect(r).toEqual({ kind: 'failed', message: 'Trop de questions' });
    expect(chat.value).toEqual([]);
    expect(draft.value).toBe('Quoi faire ?');
  });
  it('no signal: the network words, not « erreur du serveur »', async () => {
    const r = await askHermes('Quoi faire ?', ctx, async () => { throw new TypeError('Failed to fetch'); });
    expect(r.kind).toBe('failed');
    expect(r.kind === 'failed' && r.message).toBe(t('common.networkError'));
  });
  it('Hermes switched off: the server’s words as a banner, no toast', async () => {
    const r = await askHermes('Allo', ctx, async () => ({ ok: false, code: 'hermes_off', error: 'Hermes est fermé ce soir' }));
    expect(r).toEqual({ kind: 'failed', message: null });
    expect(offNote.value).toBe('Hermes est fermé ce soir');
    await askHermes('Allo', ctx, answer('Ouvert'));
    expect(offNote.value).toBeNull();
  });
  it('« Arrêter »: the question goes back in the box, the late answer is dropped, the next question is not sent after an unanswered one', async () => {
    const w = waiting();
    const p = askHermes('Long calcul', ctx, w.ask);
    stopHermes();
    expect(hermesBusy.value).toBe(false);
    expect(chat.value).toEqual([]);
    expect(draft.value).toBe('Long calcul');
    w.answer('trop tard');
    expect((await p).kind).toBe('dropped');
    expect(chat.value).toEqual([]);
  });
  it('« Nouvelle conversation »: empty, a new session', async () => {
    await askHermes('Un', ctx, answer('1'));
    const s = sessionId();
    restartHermes();
    expect(chat.value).toEqual([]);
    expect(sessionId()).not.toBe(s);
  });
});
