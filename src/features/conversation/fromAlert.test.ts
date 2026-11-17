/* A tap on a text's alert while the app is open opens that number's conversation (comms-guide-14). */
import { describe, it, expect } from 'vitest';
import { openFromAlert, phoneOfAlert, type Listen } from './fromAlert';

describe('the alert opens the conversation', () => {
  it('reads only the worker’s message with a number', () => {
    expect(phoneOfAlert({ type: 'his-texto-open', phone: '+15145550177' })).toBe('+15145550177');
    expect(phoneOfAlert({ type: 'other', phone: '+15145550177' })).toBeNull();
    expect(phoneOfAlert({ type: 'his-texto-open', phone: '<img src=x>' })).toBeNull();
    expect(phoneOfAlert({ type: 'his-texto-open' })).toBeNull();
    expect(phoneOfAlert('his-texto-open')).toBeNull();
    expect(phoneOfAlert(null)).toBeNull();
  });
  it('listens while the bubbles are on, and stops after', () => {
    const fs = new Set<(e: MessageEvent) => void>();
    const on: Listen = { addEventListener: (_k, f) => { fs.add(f); }, removeEventListener: (_k, f) => { fs.delete(f); } };
    const opened: string[] = [];
    const stop = openFromAlert((p) => opened.push(p), on);
    for (const f of fs) f({ data: { type: 'his-texto-open', phone: '+15145550177' } } as MessageEvent);
    expect(opened).toEqual(['+15145550177']);
    stop();
    expect(fs.size).toBe(0);
  });
  it('no service worker (an old browser): nothing to listen to, no error', () => {
    expect(() => openFromAlert(() => undefined, null)()).not.toThrow();
  });
});
