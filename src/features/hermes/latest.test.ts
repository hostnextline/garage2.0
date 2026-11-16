import { describe, it, expect } from 'vitest';
import { latestOnly } from './latest';

const later = <T,>(v: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(v), ms));

describe('only the newest answer counts', () => {
  it('a slow first answer after a quick second one is dropped', async () => {
    const l = latestOnly();
    const a = l.run(() => later('Saleh', 30));
    const b = l.run(() => later('Adam', 5));
    expect(await b).toBe('Adam');
    expect(await a).toBeNull();
  });
  it('nothing is drawn after the screen left', async () => {
    const l = latestOnly();
    const a = l.run(() => later(1, 5));
    l.drop();
    expect(await a).toBeNull();
    expect(await l.run(() => later(2, 1))).toBe(2);
  });
});
