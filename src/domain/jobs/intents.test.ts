import { describe, it, expect } from 'vitest';
import { intents, keepOp } from './intents';

describe('one operation id per ask, kept until the server answered (R27, R28)', () => {
  it('the same ask tried again carries the same id; once answered, a new one', () => {
    let n = 0;
    const s = intents(() => `op${++n}`);
    const a = s.op('moved|j1|');
    expect(s.op('moved|j1|')).toBe(a);           // tried again after a lost answer: the server texts once
    expect(s.op('booking|j1|again')).not.toBe(a); // another ask, another id
    s.done('moved|j1|', a);
    expect(s.op('moved|j1|')).not.toBe(a);       // « Renvoyer » after it went: a new send
  });
  it('a late answer of an older ask does not drop the newer one', () => {
    let n = 0;
    const s = intents(() => `op${++n}`);
    const first = s.op('k');
    s.done('k', first);
    const second = s.op('k');
    s.done('k', first);
    expect(s.op('k')).toBe(second);
  });
  it('kept for the next try: no network, or the server still busy with the same send', () => {
    expect(keepOp(new Error('Failed to fetch'), true)).toBe(true);
    expect(keepOp({ code: 'busy' }, false)).toBe(true);
    expect(keepOp({ code: 'nothing' }, false)).toBe(false);
    expect(keepOp(null, false)).toBe(false);
  });
});
