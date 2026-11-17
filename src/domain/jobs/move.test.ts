import { describe, it, expect } from 'vitest';
import type { Job } from '../../data/types';
import { moveTextGoes } from './move';

const J = (o: Partial<Job> = {}): Job => ({ id: 'j', day: '2026-11-17', block: 'pm', status: 'booked', truck_id: 't1', win_start: null, win_end: null, win_flex: false, ...o } as Job);
const answer = (data: Record<string, unknown>) => ({ queued: false, data: { ok: true, ...data } });

describe('the « moved » text from the job sheet follows what the customer was told (R84)', () => {
  it('the server says it: tell decides, whatever the rows', () => {
    // a truck changed at the same moment: changed:false, tell:false → no text (before: any answer not « unchanged » texted)
    expect(moveTextGoes(answer({ changed: false, tell: false, rows: { jobs: [J({ truck_id: 't2' })] } }), J(), J({ truck_id: 't2' }), true)).toBe(false);
    // a new window the same day: changed:false but tell:true → the text goes
    expect(moveTextGoes(answer({ changed: false, tell: true, window_changed: true }), J({ block: 'day', win_start: 600, win_end: 840 }), null, true)).toBe(true);
    expect(moveTextGoes(answer({ changed: true, tell: true }), J(), J(), true)).toBe(true);
    // even when this phone's copy of the job is stale (it still shows the old day)
    expect(moveTextGoes(answer({ changed: false, tell: false, rows: { jobs: [J({ day: '2026-11-18' })] } }), J(), J({ day: '2026-11-18' }), true)).toBe(false);
  });
  it('« nothing to change », a move kept on the phone, texts switched off: never', () => {
    expect(moveTextGoes(answer({ unchanged: true, changed: false, tell: false }), J(), J(), true)).toBe(false);
    expect(moveTextGoes({ queued: true }, J(), J({ day: '2026-11-18' }), true)).toBe(false);
    expect(moveTextGoes(answer({ changed: true, tell: true }), J(), J(), false)).toBe(false);
  });
  it('an older server (no tell): the job as written against the job as it was', () => {
    expect(moveTextGoes(answer({ changed: true, rows: { jobs: [J({ day: '2026-11-18' })] } }), J(), null, true)).toBe(true);
    expect(moveTextGoes(answer({ changed: false, rows: { jobs: [J({ truck_id: 't2' })] } }), J(), null, true)).toBe(false);
    expect(moveTextGoes(answer({ unchanged: true }), J(), J(), true)).toBe(false);
    // no row in the answer: the phone's row, else the server's « another day or block »
    expect(moveTextGoes(answer({ changed: false }), J(), J({ block: 'eve' }), true)).toBe(true);
    expect(moveTextGoes(answer({ changed: true }), J(), J(), true)).toBe(true);
    expect(moveTextGoes(answer({ changed: false }), J(), J(), true)).toBe(false);
  });
});
