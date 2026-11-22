import { describe, it, expect } from 'vitest';
import { intents, keepOp, KEEP_OP_MS } from './intents';

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
  it('an ask that tells something else is a new send, and going back to the first words is a new send too (jobs-r2-1)', () => {
    let n = 0;
    const s = intents(() => `op${++n}`);
    const tuesday = s.op('moved|j1|', '2026-11-17|am');
    expect(s.op('moved|j1|', '2026-11-17|am')).toBe(tuesday);   // the same move tried again: one text
    const thursday = s.op('moved|j1|', '2026-11-19|am');
    expect(thursday).not.toBe(tuesday);                          // moved again: Thursday is told, not Tuesday's answer
    expect(s.op('moved|j1|', '2026-11-17|am')).not.toBe(tuesday); // back to Tuesday: told again, the old answer is gone
  });
  it('a kept id waits a few minutes for its retry; asked later, it is a new ask; forget ends it at once', () => {
    let n = 0, clock = 0;
    const s = intents(() => `op${++n}`, { maxAge: KEEP_OP_MS, now: () => clock });
    const a = s.op('return', 'd1');
    clock += KEEP_OP_MS - 1000;
    expect(s.op('return', 'd1')).toBe(a);       // tried again within the minutes: the same
    clock += KEEP_OP_MS - 1000;
    expect(s.op('return', 'd1')).toBe(a);       // counted from the last try (still trying after a dead signal)
    clock += KEEP_OP_MS + 1;
    const b = s.op('return', 'd1');
    expect(b).not.toBe(a);                      // asked again much later: a new ask
    s.forget('return');
    expect(s.op('return', 'd1')).not.toBe(b);
  });
  it('kept for the next try: no network, or the server still busy with the same send', () => {
    expect(keepOp(new Error('Failed to fetch'), true)).toBe(true);
    expect(keepOp({ code: 'busy' }, false)).toBe(true);
    expect(keepOp({ code: 'nothing' }, false)).toBe(false);
    expect(keepOp(null, false)).toBe(false);
  });
});
