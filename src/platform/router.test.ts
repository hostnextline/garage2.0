/* The router and the sheets' history steps, in jsdom (history.back() answers with a popstate a moment later, as in a
   browser). The traces of the scan (« + » → « Réserver » left a dead step; setQuery threw the page to the top) are the
   first cases. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseHash, href, matchPath, navigate, setQuery, goBack, route, patchQuery } from './router';
import { openLayer, whenHistorySettled, layersOpen, stackOf } from './history';

const settled = () => new Promise<void>((r) => whenHistorySettled(() => setTimeout(r, 0)));
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function calm() { for (let i = 0; i < 6; i++) { await tick(); await settled(); } }

beforeEach(async () => {
  await calm();
  history.replaceState({ d: 0 }, '', '/#/');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await calm();
});

describe('addresses', () => {
  it('parses screens, cleans paths, ignores non-screen links', () => {
    expect(parseHash('#/job/abc?x=1').path).toBe('/job/abc');
    expect(parseHash('#/job/abc?x=1').query.get('x')).toBe('1');
    expect(parseHash('#/agenda/').path).toBe('/agenda');
    expect(parseHash('#invite=tok').path).toBe('/');
    expect(parseHash('#/client/Ren%C3%A9').parts).toEqual(['client', 'René']);
  });
  it('builds links and matches patterns', () => {
    expect(href('job/1', { a: 'x', b: null, c: false, d: '' })).toBe('#/job/1?a=x');
    expect(matchPath('/job/:id', '/job/abc')).toEqual({ id: 'abc' });
    expect(matchPath('/agenda/:day?', '/agenda')).toEqual({});
    expect(matchPath('/agenda/:day?', '/agenda/2026-11-04/x')).toBeNull();
    expect(matchPath('/job/:id', '/jobs/abc')).toBeNull();
    expect(patchQuery(new URLSearchParams('a=1&b=2'), { a: null, c: 3 })).toBe('b=2&c=3');
  });
});

describe('navigation', () => {
  it('a new screen goes to the top; a query change (setQuery) never moves the page (old logic: always scrolled)', async () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    navigate('/invoices');
    await calm();
    expect(route.value.path).toBe('/invoices');
    expect(scroll).toHaveBeenCalledTimes(1);
    setQuery({ tab: 'all' });
    await calm();
    expect(route.value.query.get('tab')).toBe('all');
    expect(scroll).toHaveBeenCalledTimes(1);
    scroll.mockRestore();
  });
  it('goBack at the first screen of the app uses the fallback, replacing the entry', async () => {
    goBack('/agenda');
    await calm();
    expect(route.value.path).toBe('/agenda');
    expect((history.state as { d: number }).d).toBe(0);
  });
});

describe('sheets and history', () => {
  it('« + » then an entry: no dead step, one « Retour » goes back (old logic needed two)', async () => {
    navigate('/');
    await calm();
    const closed: string[] = [];
    const layer = openLayer(() => { closed.push('quick'); });
    await calm();
    expect(stackOf(history.state)).toEqual([layer.id]);
    // the sheet's button: it closes the sheet and navigates in the same handler
    navigate('/book');
    await calm();
    layer.release();                       // the sheet unmounts afterwards
    await calm();
    expect(route.value.path).toBe('/book');
    expect(closed).toEqual(['quick']);
    expect(layersOpen.value).toBe(0);
    history.back();
    await calm();
    expect(route.value.path).toBe('/');
    expect(stackOf(history.state)).toEqual([]);
  });
  it('the back button closes the top sheet; a sheet that may not close keeps its step (a signature in progress)', async () => {
    const calls: string[] = [];
    let mayClose = false;
    const sign = openLayer((why) => { calls.push(why); if (!mayClose) return false; });
    await calm();
    history.back();
    await calm();
    expect(calls).toEqual(['back']);
    expect(stackOf(history.state)).toEqual([sign.id]);
    expect(layersOpen.value).toBe(1);
    mayClose = true;
    history.back();
    await calm();
    expect(calls).toEqual(['back', 'back']);
    expect(layersOpen.value).toBe(0);
  });
  it('closed by a button: the sheet steps back over its own step; a sheet opened right after waits for that step', async () => {
    navigate('/job/1');
    await calm();
    const depth = history.length;
    const a = openLayer(() => undefined);
    await calm();
    a.release();
    const b = openLayer(() => undefined);    // « close A, open B » in the same instant
    await calm();
    expect(stackOf(history.state)).toEqual([b.id]);
    b.release();
    await calm();
    expect(stackOf(history.state)).toEqual([]);
    expect(route.value.path).toBe('/job/1');
    expect(history.length).toBeGreaterThanOrEqual(depth);
  });
  it('setQuery while a sheet is open keeps its step, and its query survives the sheet closing', async () => {
    navigate('/invoices');
    await calm();
    const s = openLayer(() => undefined);
    await calm();
    setQuery({ tab: 'paid' });
    await calm();
    expect(stackOf(history.state)).toEqual([s.id]);
    s.release();
    await calm();
    expect(stackOf(history.state)).toEqual([]);
    expect(route.value.query.get('tab')).toBe('paid');
    expect(location.hash).toBe('#/invoices?tab=paid');
  });
  it('a navigation with two sheets open closes both, top first, then goes', async () => {
    navigate('/customers');
    await calm();
    const order: string[] = [];
    openLayer((why) => { order.push(`low:${why}`); });
    openLayer((why) => { order.push(`top:${why}`); });
    await calm();
    navigate('/customer/c1');
    await calm();
    expect(order).toEqual(['top:navigate', 'low:navigate']);
    expect(route.value.path).toBe('/customer/c1');
    history.back();
    await calm();
    expect(route.value.path).toBe('/customers');
    expect(stackOf(history.state)).toEqual([]);
  });
});
