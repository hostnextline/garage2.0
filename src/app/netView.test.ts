/* The frame's reading of the data layer's `net`, with the shapes the rebuilt data layer really sends (data/net.ts
   NetState, data/local.ts OutboxEntry): a session being renewed is not a lost one, a stuck change is an object, a
   refusal keeps its code under `err`. */
import { describe, it, expect, afterEach } from 'vitest';
import { readNet, refusalText } from './netView';
import { t, lang } from '../lib/i18n';

/** NetState as data/net.ts starts it */
const START = {
  online: true, realtime: false, pending: 0, failed: [], sending: false, lastPull: null, ready: false, storageBroken: false,
  session: 'ok', storage: 'ok', stuck: null, firstPull: 'no'
};
/** an OutboxEntry the server refused, as data/local.ts keeps it */
const refused = (err: Record<string, unknown>, error = 'new row violates row-level security policy for table "jobs"') => ({
  seq: 7, op: 'op-1', kind: 'update', table: 'jobs', id: 'j1', label: 'Réservation de Jean Tremblay', at: '2026-11-16T12:00:00Z',
  tries: 1, state: 'failed', error, v: 2, err
});

afterEach(() => { lang.value = 'fr'; });

describe('the session', () => {
  it('a session being renewed (every token refresh, a phone waking after an hour) never asks to sign in again', () => {
    expect(readNet({ ...START, session: 'expired', pending: 3 }).sessionLost).toBe(false);
  });
  it('a session the server ended asks to sign in again', () => {
    expect(readNet({ ...START, session: 'lost', pending: 3 })).toMatchObject({ sessionLost: true, pending: 3 });
    expect(readNet({ ...START, session: 'ok' }).sessionLost).toBe(false);
    // the older flag still counts
    expect(readNet({ ...START, sessionLost: true }).sessionLost).toBe(true);
  });
});

describe('storage', () => {
  it('memory only (private window, storage lost or full) is said on every screen', () => {
    expect(readNet({ ...START, storage: 'memory', storageBroken: true }).storageLost).toBe(true);
    expect(readNet(START).storageLost).toBe(false);
  });
});

describe('a change stuck at the head of the queue', () => {
  it('the data layer’s object counts as one stuck change, with its label and its reason', () => {
    const v = readNet({ ...START, pending: 2, stuck: { label: 'Réservation de Jean Tremblay', since: '2026-11-16T12:00:00Z', tries: 5, why: 'server' } });
    expect(v).toMatchObject({ stuck: 1, stuckLabel: 'Réservation de Jean Tremblay', stuckWhy: 'server' });
  });
  it('without a label, still one; null is none', () => {
    expect(readNet({ ...START, stuck: { since: '2026-11-16T12:00:00Z', tries: 2, why: 'network' } })).toMatchObject({ stuck: 1, stuckLabel: null, stuckWhy: 'network' });
    expect(readNet(START)).toMatchObject({ stuck: 0, stuckLabel: null, stuckWhy: null });
  });
  it('a count or a list (older shapes) still reads', () => {
    expect(readNet({ ...START, stuck: 3 }).stuck).toBe(3);
    expect(readNet({ ...START, stuck: [1, 2] }).stuck).toBe(2);
  });
});

describe('a refused change, in the person’s language', () => {
  it('reads the code kept under err (never the database’s sentence for an English user)', () => {
    lang.value = 'en';
    const e = refused({ kind: 'refused', sub: 'rights', code: '42501', status: 403 });
    expect(refusalText(e)).toBe(`Réservation de Jean Tremblay: ${t('common.notAllowed')}`);
    expect(refusalText({ ...e, label: null })).toBe(t('common.notAllowed'));
  });
  it('reads the hint kept under err', () => {
    lang.value = 'en';
    const e = refused({ kind: 'refused', sub: 'rule', hint: 'not_found' }, 'Introuvable');
    const k = t('errors.not_found');
    expect(refusalText({ ...e, label: null })).toBe(k !== 'errors.not_found' ? k : 'Introuvable');
  });
  it('kept in English, read after switching to French: the server’s own sentence, never the English words', () => {
    // as the data layer keeps it for a person in English: the words of the moment, the server's sentence under err.said
    const e = refused({ kind: 'refusal', sub: 'rule', code: 'past', hint: 'past', said: 'Ce bloc est passé.' }, 'That day is over: choose today or later.');
    lang.value = 'en';
    expect(refusalText({ ...e, label: null })).toBe(t('errors.past'));
    lang.value = 'fr';
    expect(refusalText({ ...e, label: null })).toBe('Ce bloc est passé.');
  });
  it('kept in French, read after switching to English: the dictionary’s words', () => {
    lang.value = 'en';
    const e = refused({ kind: 'refusal', sub: 'rule', code: 'past', hint: 'past', said: 'Ce bloc est passé.' }, 'Ce bloc est passé.');
    expect(refusalText({ ...e, label: null })).toBe(t('errors.past'));
    expect(t('errors.past')).not.toBe('errors.past');
  });
  it('a code without words: the server’s sentence, in either language', () => {
    const e = refused({ kind: 'refusal', sub: 'rule', code: 'no_such_words', hint: 'no_such_words', said: 'Phrase du serveur.' }, 'Phrase du serveur.');
    lang.value = 'en';
    expect(refusalText({ ...e, label: null })).toBe('Phrase du serveur.');
    lang.value = 'fr';
    expect(refusalText({ ...e, label: null })).toBe('Phrase du serveur.');
  });
  it('a database refusal kept in English is not wrapped twice in French', () => {
    lang.value = 'fr';
    const raw = 'duplicate key value violates unique constraint "x"';
    const e = refused({ kind: 'refusal', sub: 'duplicate', code: '23505', status: 409, said: raw }, `Something went wrong: ${raw}`);
    expect(refusalText({ ...e, label: null })).toBe(t('common.genericError', { msg: raw }));
  });
  it('an entry without err shows what was stored', () => {
    expect(refusalText({ label: 'Réservation', error: 'raison' })).toBe('Réservation : raison');
  });
});
