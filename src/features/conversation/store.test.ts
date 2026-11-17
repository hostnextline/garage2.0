/* « Texto entrant »: what belongs to the person signed in (comms-guide-10, comms-guide-24; push at sign-out: comms-guide-02). */
import { describe, it, expect, vi } from 'vitest';
import { readChats, draftOf, setDraft, claimTexts } from './store';

describe('the bubbles kept on the device', () => {
  it('reads only well-formed bubbles', () => {
    expect(readChats('[{"phone":"5145550100","seenAt":"2026-11-17T10:00:00Z","state":"min","name":null},{"phone":3},null]')).toHaveLength(1);
    expect(readChats('not json')).toEqual([]);
    expect(readChats(null)).toEqual([]);
  });
});

describe('the person signed in', () => {
  it('an answer half written survives the window closing, per number, whatever the way the number is written', () => {
    claimTexts('owner-1', async () => undefined);
    setDraft('+15145550177', 'Oui, demain 9 h');
    expect(draftOf('(514) 555-0177')).toBe('Oui, demain 9 h');
    expect(draftOf('5145550188')).toBe('');
    setDraft('5145550177', '');
    expect(draftOf('5145550177')).toBe('');
  });
  it('sign-out: the answers being written are dropped and the alert of this browser is switched off', () => {
    const off = vi.fn(async () => undefined);
    claimTexts('owner-1', off);
    setDraft('5145550177', 'brouillon');
    claimTexts(null, off);
    expect(draftOf('5145550177')).toBe('');
    expect(off).toHaveBeenCalledTimes(1);
  });
  it('the first sign-in of the visit does not touch the alert', () => {
    claimTexts(null, async () => undefined);
    const off = vi.fn(async () => undefined);
    claimTexts('owner-2', off);
    expect(off).not.toHaveBeenCalled();
  });
});

describe('the operation number of an answer (R28)', () => {
  it('the same words keep it; other words, the answer sent or another person signed in drop it', async () => {
    const { opOf, setDraft: draft, claimTexts } = await import('./store');
    let n = 0; const make = () => `op-${++n}`;
    draft('+15145550190', 'Oui');
    expect(opOf('+15145550190', 'Oui', make)).toBe('op-1');
    expect(opOf('514-555-0190', 'Oui', make)).toBe('op-1');
    draft('+15145550190', 'Oui!');
    expect(opOf('+15145550190', 'Oui!', make)).toBe('op-2');
    draft('+15145550190', '');
    expect(opOf('+15145550190', 'Oui!', make)).toBe('op-3');
    claimTexts('someone-else', async () => undefined);
    expect(opOf('+15145550190', 'Oui!', make)).toBe('op-4');
  });
});
