import { describe, it, expect } from 'vitest';
import { moveAll } from './closeFlow';
import type { Move } from '../../shared/map/closing';
import type { Job } from '../../data/types';

const mv = (id: string, target: string | null = 'truck'): Move => ({ job: { id } as Job, target, why: target ? null : 'closed' });

describe('« Déplacer vers … »: the hours close only when every move is confirmed (map-hours-01, -07)', () => {
  it('every move confirmed: done, in order; the ones that stay are not sent', async () => {
    const sent: string[] = [];
    const r = await moveAll([mv('a'), mv('b', null), mv('c')], async (m) => { sent.push(m.job.id); return { queued: false }; });
    expect(r).toEqual({ kind: 'done', moved: ['a', 'c'] });
    expect(sent).toEqual(['a', 'c']);
  });
  it('the server refuses one (no right, full, started): it stops there, nothing after it is sent', async () => {
    const sent: string[] = [];
    const no = Object.assign(new Error('not_allowed'), { code: 'P0001' });
    const r = await moveAll([mv('a'), mv('b'), mv('c')], async (m) => { sent.push(m.job.id); if (m.job.id === 'b') throw no; return { queued: false }; });
    expect(r).toEqual({ kind: 'refused', moved: ['a'], job: 'b', error: no });
    expect(sent).toEqual(['a', 'b']);
  });
  it('a move only kept on the phone is never counted as moved, and stops the closing', async () => {
    const r = await moveAll([mv('a'), mv('b')], async () => ({ queued: true }));
    expect(r).toEqual({ kind: 'waiting', moved: [], job: 'a' });
  });
});
