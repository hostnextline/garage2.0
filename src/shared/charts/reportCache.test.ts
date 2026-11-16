import { describe, it, expect, beforeEach } from 'vitest';
import { readReport, writeReport, clearReports, pruneReports } from './reportCache';

beforeEach(() => { clearReports(); localStorage.clear(); });

describe('the reports kept on the device', () => {
  it('a kept answer of another shape is shaped again when read, never trusted as is', () => {
    localStorage.setItem('his.report.u1.dashboard.2026-11', JSON.stringify({ at: '2026-11-15T10:00:00Z', data: { months: 'old shape' } }));
    const c = readReport('his.report.u1.dashboard.2026-11', (raw) => ({ months: Array.isArray((raw as { months?: unknown }).months) ? 1 : 0 }));
    expect(c).toEqual({ at: '2026-11-15T10:00:00Z', data: { months: 0 } });
  });
  it('one that cannot be read is dropped', () => {
    localStorage.setItem('his.report.u1.dashboard.2026-10', '{oops');
    expect(readReport('his.report.u1.dashboard.2026-10')).toBeNull();
    expect(localStorage.getItem('his.report.u1.dashboard.2026-10')).toBeNull();
    localStorage.setItem('his.report.u1.dashboard.2026-09', JSON.stringify({ at: 'x', data: 1 }));
    expect(readReport('his.report.u1.dashboard.2026-09', () => { throw new Error('bad'); })).toBeNull();
    expect(localStorage.getItem('his.report.u1.dashboard.2026-09')).toBeNull();
  });
  it('only the most recent ones stay; the app’s other keys are never touched', () => {
    localStorage.setItem('his.dayView', 'owner');
    for (let n = 0; n < 30; n++) writeReport(`his.report.u1.treasury.${n}`, { at: `2026-11-${String(n % 28 + 1).padStart(2, '0')}T00:00:${String(n).padStart(2, '0')}Z`, data: n });
    const kept = Object.keys(localStorage).filter((k) => k.startsWith('his.report.'));
    expect(kept.length).toBe(24);
    expect(localStorage.getItem('his.dayView')).toBe('owner');
    pruneReports(localStorage, 2);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('his.report.'))).toHaveLength(2);
  });
  it('sign-out forgets them all, on the device and in memory', () => {
    writeReport('his.report.u1.dashboard.2026-11', { at: '2026-11-15T10:00:00Z', data: { revenue_cents: 1 } });
    localStorage.setItem('his.dayView', 'owner');
    clearReports();
    expect(readReport('his.report.u1.dashboard.2026-11')).toBeNull();
    expect(localStorage.getItem('his.dayView')).toBe('owner');
  });
});
