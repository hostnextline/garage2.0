import { describe, it, expect, beforeEach } from 'vitest';
import { reportError, recentErrors, onErrorReport, resetReports, errorCount, isChunkError, routeShape, installGlobalErrorHandlers, QUIET_MS } from './report';

beforeEach(() => resetReports());

describe('unexpected errors', () => {
  it('are kept, counted and handed to listeners; never thrown', () => {
    const got: string[] = [];
    onErrorReport((r) => got.push(r.message));
    onErrorReport(() => { throw new Error('a broken listener'); });
    expect(() => reportError(new Error('boom'), 'screen:/x', 'render')).not.toThrow();
    expect(got).toEqual(['boom']);
    expect(errorCount()).toBe(1);
    expect(recentErrors()[0]).toMatchObject({ kind: 'render', where: 'screen:/x', message: 'boom', count: 1 });
  });
  it('the same error within a minute is counted on the first report, not reported again', () => {
    reportError('x', 'w', 'error', 1000);
    reportError('x', 'w', 'error', 2000);
    expect(recentErrors()).toHaveLength(1);
    expect(recentErrors()[0].count).toBe(2);
    reportError('x', 'w', 'error', 1000 + QUIET_MS);
    expect(recentErrors()).toHaveLength(2);
  });
  it('keeps the last 20; ignores the browser’s noise', () => {
    for (let i = 0; i < 25; i++) reportError(`e${i}`, 'w');
    expect(recentErrors()).toHaveLength(20);
    expect(recentErrors()[0].message).toBe('e5');
    resetReports();
    reportError(new Error('ResizeObserver loop completed with undelivered notifications.'), 'w');
    expect(recentErrors()).toHaveLength(0);
  });
  it('a screen’s address without its ids; a screen that could not be downloaded is recognised', () => {
    expect(routeShape('#/job/0b6f1c2a-1111-2222-3333-444455556666?do=edit')).toBe('/job/:id');
    expect(routeShape('#/agenda/2026-11-17')).toBe('/agenda/:id');
    expect(routeShape('#/customers')).toBe('/customers');
    expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: x.js'))).toBe(true);
    expect(isChunkError(new Error('boom'))).toBe(false);
  });
  it('window errors and promises nobody caught are reported (they used to vanish)', () => {
    installGlobalErrorHandlers();
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('script'), message: 'script' }));
    const ev = new Event('unhandledrejection') as Event & { reason?: unknown };
    ev.reason = new Error('nobody caught me');
    window.dispatchEvent(ev);
    expect(recentErrors().map((r) => [r.kind, r.message])).toEqual([['error', 'script'], ['rejection', 'nobody caught me']]);
  });
});
