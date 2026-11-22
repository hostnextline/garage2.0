import { describe, it, expect, beforeEach } from 'vitest';
import { backOutcome, blockNow, toldWindow, toCallText, keptWords } from './backToBlocks';
import { replaceLocal } from '../../../data/store';
import { addDays, today } from '../../../lib/dates';

const BLOCKS = [{ key: 'am', start: 480, end: 720 }, { key: 'pm', start: 720, end: 960 }, { key: 'eve', start: 960, end: 1200 }];
beforeEach(() => { replaceLocal('settings', [{ id: '1', booking: { blocks: BLOCKS } } as never]); });
const sp = (s: string) => s.replace(/\s/g, ' ');

describe('« Revenir aux blocs »: the server’s answer, read safely (R87)', () => {
  it('to_call and kept are read; a row missing its job, day or block, or with an unknown block, is left out', () => {
    const r = backOutcome({ ok: true, converted: 3, to_call: [
      { job_id: 'j1', day: '2026-11-17', block: 'pm', win_start: 600, win_end: 840, customer_id: 'c1', truck_id: 't1' },
      { job_id: 'j2', day: '2026-11-17', block: 'am', win_start: null, win_end: null, customer_id: null },
      { job_id: '', day: '2026-11-17', block: 'am' }, { job_id: 'j3', day: '2026-11-17', block: 'nuit' }, null, 'x'
    ], kept: [{ day: '2026-11-18', block: 'eve' }, { day: '2026-11-18' }, { block: 'am' }] });
    expect(r.toCall).toEqual([
      { job_id: 'j1', day: '2026-11-17', block: 'pm', win_start: 600, win_end: 840, customer_id: 'c1' },
      { job_id: 'j2', day: '2026-11-17', block: 'am', win_start: null, win_end: null, customer_id: null }
    ]);
    expect(r.kept).toEqual([{ day: '2026-11-18', block: 'eve' }]);
  });
  it('an older server (no lists), nothing or garbage: both lists empty, the screen of before', () => {
    for (const a of [{ ok: true, converted: 2 }, null, undefined, 'x', { to_call: 'x', kept: 3 }]) expect(backOutcome(a)).toEqual({ toCall: [], kept: [] });
  });
  it('the words: the block now, the window told, the text in the customer’s language, a day left as it was', () => {
    const tomorrow = addDays(today(), 1);
    expect(sp(blockNow(tomorrow, 'pm', 'fr'))).toBe('demain après-midi (12 h à 16 h)');
    expect(sp(toldWindow({ win_start: 600, win_end: 840 }, 'fr'))).toBe('10 h à 14 h');
    expect(toldWindow({ win_start: null, win_end: 840 }, 'fr')).toBe('');
    const c = { job_id: 'j1', day: tomorrow, block: 'pm' as const, win_start: 600, win_end: 840, customer_id: 'c1' };
    expect(sp(toCallText(c, 'Julie', 'fr'))).toBe('Bonjour Julie, petit changement pour votre rendez-vous : le mécanicien arrivera demain après-midi (12 h à 16 h) au lieu de 10 h à 14 h. Merci !');
    expect(sp(toCallText({ ...c, win_start: null, win_end: null }, null, 'en'))).toBe('Hello, a small change for your appointment: the mechanic will arrive tomorrow, afternoon (12 p.m. to 4 p.m.). Thank you!');
    expect(sp(keptWords({ day: tomorrow, block: 'eve' }, 'fr'))).toBe('Demain soir');
  });
});
