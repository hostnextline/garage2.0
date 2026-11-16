import { describe, it, expect } from 'vitest';
import { parseRemote, isTooOld, mayApplyNow, checkVerdict, RESUME_AFTER_MS, type ApplyMoment, type RemoteVersion } from './version';

const v = (o: Partial<RemoteVersion> = {}): RemoteVersion => ({ version: 'b', built_at: null, important_since: null, notes: null, ...o });

describe('the version file', () => {
  it('reads the oldest version still accepted when there is one', () => {
    expect(parseRemote({ version: 'b', min_built_at: '2026-11-15T00:00:00Z' })?.min_built_at).toBe('2026-11-15T00:00:00Z');
    expect(parseRemote({ version: 'b' })).toEqual({ version: 'b', built_at: null, important_since: null, notes: null });
  });
  it('too old: made before the oldest accepted, and only when another version is published', () => {
    expect(isTooOld(v({ min_built_at: '2026-11-15T12:00:00Z' }), '2026-11-14T10:00:00Z', 'a')).toBe(true);
    expect(isTooOld(v({ min_built_at: '2026-11-13T12:00:00Z' }), '2026-11-14T10:00:00Z', 'a')).toBe(false);
    expect(isTooOld(v({ version: 'a', min_built_at: '2026-11-15T12:00:00Z' }), '2026-11-14T10:00:00Z', 'a')).toBe(false);
    expect(isTooOld(v(), '2026-11-14T10:00:00Z', 'a')).toBe(false);
    expect(isTooOld(v({ min_built_at: '2026-11-15T12:00:00Z' }), '2026-11-14T10:00:00Z', 'dev')).toBe(false);
  });
});

describe('a waiting version is put in place by the app itself only when nothing can be lost', () => {
  const base: ApplyMoment = { ready: true, moment: 'resume', awayMs: RESUME_AFTER_MS, layersOpen: 0, typing: false, sending: false, appliedBefore: false, touched: true };
  it('back on the screen after 30 minutes: yes (old logic: never, until every window was closed)', () => {
    expect(mayApplyNow(base)).toBe(true);
    expect(mayApplyNow({ ...base, awayMs: RESUME_AFTER_MS - 1 })).toBe(false);
  });
  it('never with a sheet open, a field being typed, changes being sent, or a second time', () => {
    expect(mayApplyNow({ ...base, layersOpen: 1 })).toBe(false);
    expect(mayApplyNow({ ...base, typing: true })).toBe(false);
    expect(mayApplyNow({ ...base, sending: true })).toBe(false);
    expect(mayApplyNow({ ...base, appliedBefore: true })).toBe(false);
    expect(mayApplyNow({ ...base, ready: false })).toBe(false);
  });
  it('at start: only while the person has not touched the screen yet', () => {
    expect(mayApplyNow({ ...base, moment: 'start', awayMs: 0, touched: false })).toBe(true);
    expect(mayApplyNow({ ...base, moment: 'start', awayMs: 0, touched: true })).toBe(false);
  });
  it('a screen half filled and not saved (a booking left over lunch, the focus gone) is never wiped by the update', () => {
    expect(mayApplyNow({ ...base, typing: false, edited: true })).toBe(false);
    expect(mayApplyNow({ ...base, edited: false })).toBe(true);
  });
  it('a phone keeping changes only in memory never reloads while changes wait', () => {
    expect(mayApplyNow({ ...base, storageLost: true, pending: 2 })).toBe(false);
    expect(mayApplyNow({ ...base, storageLost: true, pending: 0 })).toBe(true);
    expect(mayApplyNow({ ...base, storageLost: false, pending: 2 })).toBe(true);
  });
});

describe('« Vérifier les mises à jour »', () => {
  it('a newer version named by version.json but not ready yet is « en route », never « à jour » (old logic said none)', () => {
    expect(checkVerdict({ remote: v({ version: 'zzz' }), waiting: false, failed: false })).toBe('downloading');
    expect(checkVerdict({ remote: v({ version: 'zzz' }), waiting: false, failed: true })).toBe('downloading');
  });
  it('ready when a version waits; none when version.json names this one; error when nothing could be read', () => {
    expect(checkVerdict({ remote: v({ version: 'zzz' }), waiting: true, failed: false })).toBe('ready');
    expect(checkVerdict({ remote: v({ version: 'dev' }), waiting: false, failed: false })).toBe('none');
    expect(checkVerdict({ remote: null, waiting: false, failed: true })).toBe('error');
  });
});
