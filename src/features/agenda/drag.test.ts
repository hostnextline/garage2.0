import { describe, it, expect, vi } from 'vitest';
import type { Job } from '../../data/types';
import { makeDrag } from './drag';

const job = { id: 'j1', status: 'booked' } as Job;
const dragEvent = () => ({ dataTransfer: { effectAllowed: '', setData: vi.fn() } }) as unknown as DragEvent;

describe('a job dragged on the agenda', () => {
  it('says why the place it was let go on refuses it', () => {
    const say = vi.fn();
    const d = makeDrag(() => {}, say);
    d.start(job, dragEvent());
    d.hover({ key: 'a', minute: 0, ok: false }, 'started', false);
    d.end();
    expect(say).toHaveBeenCalledTimes(1);
  });
  it('says nothing when the drag ends outside the grid after crossing a refusing place (agenda-16)', () => {
    const say = vi.fn();
    const d = makeDrag(() => {}, say);
    d.start(job, dragEvent());
    d.hover({ key: 'a', minute: 0, ok: false }, 'started', false);
    d.leave('a');
    d.end();
    expect(say).not.toHaveBeenCalled();
    expect(d.over.value).toBe(null);
  });
  it('gives the job on a good drop, once', () => {
    const d = makeDrag(() => {});
    d.start(job, dragEvent());
    d.hover({ key: 'b', minute: 600, ok: true }, null, true);
    expect(d.over.value).toEqual({ key: 'b', minute: 600, ok: true });
    expect(d.take()).toBe(job);
    expect(d.take()).toBe(null);
  });
  it('moves the place under the pointer only when it changes (the grid does not redraw for nothing)', () => {
    const d = makeDrag(() => {});
    d.hover({ key: 'b', minute: 600, ok: true }, null, true);
    const first = d.over.value;
    d.hover({ key: 'b', minute: 600, ok: true }, null, true);
    expect(d.over.value).toBe(first);
  });
});
