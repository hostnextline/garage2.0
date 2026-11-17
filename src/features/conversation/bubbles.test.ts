/* « Texto entrant »: what the host draws, how often it asks (comms-guide-06, comms-guide-15, comms-guide-28). */
import { describe, it, expect } from 'vitest';
import type { Chat, IncomingText } from '../../shared/customers/texts';
import { bubblePlan, isPretend, openAsked, askEvery, sameTexts, refreshEvery, MAX_HEADS, PEEK_MS, ASK_MS, ASK_LIVE_MS, REFRESH_MS, REFRESH_QUIET_MS } from './bubbles';

const now = Date.parse('2026-11-17T15:30:00Z');
const at = (min: number) => new Date(now - min * 60000).toISOString();
const text = (phone: string, min: number, body = 'Bonjour'): IncomingText => ({ id: `${phone}-${min}`, phone, name: null, body, at: at(min) });
const head = (phone: string, seenMin = 999): Chat => ({ phone, name: null, state: 'min', seenAt: at(seenMin) });

describe('the bubbles drawn', () => {
  it('nine conversations waiting: three heads and « +6 », none lost from sight (the old host drew 4 and nothing more)', () => {
    const phones = Array.from({ length: 9 }, (_, i) => `514555010${i + 1}`);
    const plan = bubblePlan(phones.map((p) => head(p)), phones.map((p, i) => text(p, 60 + i)), false, now);
    expect(plan.round).toHaveLength(MAX_HEADS - 1);
    expect(plan.more).toHaveLength(6);
    expect([...plan.round, ...plan.more].map((c) => c.phone).sort()).toEqual([...phones].sort());
    expect(plan.round[0].phone).toBe('5145550101');   // the newest text first
  });
  it('four fit: four heads and no « +N »', () => {
    const phones = ['5145550111', '5145550112', '5145550113', '5145550114'];
    const plan = bubblePlan(phones.map((p) => head(p)), phones.map((p, i) => text(p, i)), false, now);
    expect(plan.round).toHaveLength(4);
    expect(plan.more).toEqual([]);
  });
  it('the Hermes panel open: the window waits as a head', () => {
    const open: Chat = { phone: '5145550120', name: null, state: 'open', seenAt: at(1) };
    expect(bubblePlan([open], [text(open.phone, 1)], false, now).win).toBe(open);
    const plan = bubblePlan([open], [text(open.phone, 1)], true, now);
    expect(plan.win).toBeNull();
    expect(plan.round).toEqual([open]);
  });
  it('a peek for a young unread text only', () => {
    const c = head('5145550130');
    expect(bubblePlan([c], [text(c.phone, 1, 'Une place demain ?')], false, now).peek?.text.body).toBe('Une place demain ?');
    expect(bubblePlan([c], [text(c.phone, PEEK_MS / 60000 + 1)], false, now).peek).toBeNull();
    expect(bubblePlan([head(c.phone, 0)], [text(c.phone, 1)], false, now).peek).toBeNull();   // already read
  });
  it('the pretend number of « Essayer » is known whatever the way it is written', () => {
    expect(isPretend('+15145550100')).toBe(true);
    expect(isPretend('(514) 555-0100')).toBe(true);
    expect(isPretend('+15145550177')).toBe(false);
  });
});

describe('asking the server', () => {
  it('realtime up: the list is only checked every minute; down: every 15 s', () => {
    expect(askEvery(true)).toBe(ASK_LIVE_MS);
    expect(askEvery(false)).toBe(ASK_MS);
  });
  it('the same list is not drawn again', () => {
    const a = [text('5145550140', 1)];
    expect(sameTexts(a, [{ ...a[0] }])).toBe(true);
    expect(sameTexts(a, [{ ...a[0], body: 'autre' }])).toBe(false);
    expect(sameTexts(a, [])).toBe(false);
  });
  it('an open window asks GoHighLevel every 20 s while the conversation moves, every minute once quiet', () => {
    expect(refreshEvery(now - 30000, now)).toBe(REFRESH_MS);
    expect(refreshEvery(now - 5 * 60000, now)).toBe(REFRESH_QUIET_MS);
  });
});

describe('a tap on a text alert (comms-guide-14)', () => {
  const NOW = Date.parse('2026-11-16T15:00:00Z');
  const txt = (phone: string, at: string, name: string | null = null): IncomingText => ({ id: phone + at, phone, name, body: 'Allo', at });
  it('no bubble for that number yet: a new open one, read up to the text, the open window becomes a head', () => {
    const before: Chat[] = [{ phone: '+15145550188', name: null, state: 'open', seenAt: '2026-11-16T10:00:00Z' }];
    const after = openAsked(before, '15145550177', [txt('+15145550177', '2026-11-16T14:59:00Z', 'Lara')], NOW);
    expect(after).toEqual([
      { phone: '+15145550188', name: null, state: 'min', seenAt: '2026-11-16T10:00:00Z' },
      { phone: '+15145550177', name: 'Lara', state: 'open', seenAt: '2026-11-16T14:59:00Z' }
    ]);
  });
  it('the texts not read yet (the app was hidden): opened all the same, read up to now', () => {
    expect(openAsked([], '+15145550177', [], NOW)).toEqual([{ phone: '+15145550177', name: null, state: 'open', seenAt: new Date(NOW).toISOString() }]);
  });
  it('a bubble already there, whatever the way the number is written: that one opens, no second bubble', () => {
    const before: Chat[] = [{ phone: '+1 514 555-0177', name: 'Lara', state: 'closed', seenAt: '2026-11-16T10:00:00Z' }];
    const after = openAsked(before, '5145550177', [], NOW);
    expect(after).toHaveLength(1);
    expect(after[0].state).toBe('open');
  });
  it('no number: nothing changes', () => {
    const before: Chat[] = [];
    expect(openAsked(before, '', [], NOW)).toBe(before);
  });
});
