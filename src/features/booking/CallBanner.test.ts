import { describe, it, expect } from 'vitest';
import { callToShow, callLink, CALL_SHOWN_MS, type IncomingCall } from './CallBanner';

const now = Date.parse('2026-11-12T15:00:00Z');
const call = (id: string, agoMs: number, name: string | null = null): IncomingCall => ({ id, phone: '+15145550100', name, at: new Date(now - agoMs).toISOString() });

describe('« Appel entrant » banner', () => {
  it('the newest call, while it is fresh and not closed', () => {
    const list = [call('old', 60000), call('new', 5000), call('gone', CALL_SHOWN_MS + 1000)];
    expect(callToShow(list, new Set(), now)?.id).toBe('new');
    expect(callToShow(list, new Set(['new']), now)?.id).toBe('old');
    expect(callToShow(list, new Set(['new', 'old']), now)).toBeNull();
  });
  it('opens Appel entrant with the 10 digits and the name', () => {
    expect(callLink({ phone: '+15145550100', name: 'Julie Tremblay' })).toBe('/call?phone=5145550100&name=Julie%20Tremblay');
    expect(callLink({ phone: '+15145550100', name: null })).toBe('/call?phone=5145550100');
  });
});
