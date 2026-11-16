import { describe, it, expect } from 'vitest';
import { holdsEveryJob } from './scope';

describe('whose appointments the week’s needs count', () => {
  it('the « agenda » right holds every job', () => expect(holdsEveryJob(true, [], ['a', 'b'])).toBe(true));
  it('a mechanic who drives one truck of two holds only his own', () => expect(holdsEveryJob(false, ['a'], ['a', 'b'])).toBe(false));
  it('with « Routes partagées » every truck is his: every job', () => expect(holdsEveryJob(false, ['a', 'b'], ['a', 'b'])).toBe(true));
  it('no truck known: not every job', () => expect(holdsEveryJob(false, [], [])).toBe(false));
});
