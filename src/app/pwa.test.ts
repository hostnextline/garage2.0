import { describe, it, expect } from 'vitest';
import { parseRemote, isNewer, isImportant } from './pwa';

describe('the version file', () => {
  it('reads what the build wrote, and nothing else', () => {
    expect(parseRemote({ version: 'abc1234', built_at: '2026-11-04T10:00:00Z', important_since: null, notes: ' Carte : vraie route ' }))
      .toEqual({ version: 'abc1234', built_at: '2026-11-04T10:00:00Z', important_since: null, notes: 'Carte : vraie route' });
    expect(parseRemote(null)).toBeNull();
    expect(parseRemote({ version: '' })).toBeNull();
    expect(parseRemote('<html>')).toBeNull();
  });
  it('a newer version is another published one (never the test version)', () => {
    expect(isNewer({ version: 'b', built_at: null, important_since: null, notes: null }, 'a')).toBe(true);
    expect(isNewer({ version: 'a', built_at: null, important_since: null, notes: null }, 'a')).toBe(false);
    expect(isNewer({ version: 'dev', built_at: null, important_since: null, notes: null }, 'a')).toBe(false);
    expect(isNewer(null, 'a')).toBe(false);
  });
  it('important only when an important version came out after this one was made', () => {
    const v = (since: string | null) => ({ version: 'b', built_at: '2026-11-05T12:00:00Z', important_since: since, notes: null });
    expect(isImportant(v('2026-11-05T09:00:00Z'), '2026-11-04T10:00:00Z')).toBe(true);
    expect(isImportant(v('2026-11-03T09:00:00Z'), '2026-11-04T10:00:00Z')).toBe(false);
    expect(isImportant(v(null), '2026-11-04T10:00:00Z')).toBe(false);
    expect(isImportant(v('2026-11-05T09:00:00Z'), '')).toBe(false);
    expect(isImportant(v('pas une date'), '2026-11-04T10:00:00Z')).toBe(false);
  });
});
