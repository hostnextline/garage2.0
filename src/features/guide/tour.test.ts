import { describe, it, expect, afterEach } from 'vitest';
import { TOURS, tourFor, onScreen, locate, resolveStep, placeBubble, findAnchor, WAIT_MS, FALLBACK_MS, type TourCtx, type TourEnv, type TourStep } from './tour-steps';

const all = (): TourCtx => ({ can: () => true, wide: false, nextJobId: 'j-2' });

describe('the tours', () => {
  it('has 6 to 10 steps per role, each with words and an anchor', () => {
    for (const [role, steps] of Object.entries(TOURS)) {
      expect(steps.length, role).toBeGreaterThanOrEqual(6);
      expect(steps.length, role).toBeLessThanOrEqual(10);
      for (const s of steps) expect(s.anchors.length, `${role}.${s.key}`).toBeGreaterThan(0);
    }
  });
  it('only uses the anchors listed in ARCHITECTURE.md', () => {
    const listed = /^(nav-[a-z]+|quick-add|sync-state|agenda-(day|block|week)|book-(customer|vehicle|services|block|confirm)|hours-(truck|grid|apply)|customers-search|customer-book|today-(shift|next)|job-(bigstep|waiver|work|extra|invoice|pay)|invoice-(send|pay)|quote-(items|send)|team-(invite|rights)|map-legend|settings-(company|services|texts|look|connect)|treasury-(add|report)|inventory-low|dashboard-kpis)$/;
    for (const steps of Object.values(TOURS)) for (const s of steps) for (const a of [...s.anchors, ...(s.fallback || [])]) expect(a).toMatch(listed);
  });
  it('leaves out what the person can’t open', () => {
    const owner = tourFor('owner', { ...all(), can: (k) => k !== 'team' && k !== 'dashboard' });
    expect(owner.map((s) => s.key)).toEqual(['sync', 'add', 'today', 'agenda', 'book', 'hours', 'settings']);
    const treasurer = tourFor('treasurer', { ...all(), can: (k) => ['treasury', 'invoices'].includes(k) });
    expect(treasurer.map((s) => s.key)).toEqual(['treasuryAdd', 'treasuryReport', 'addTreasurer', 'sync']);
    expect(tourFor('treasurer', { ...all(), wide: true }).map((s) => s.key)).toContain('invoices');   // the side menu only exists on a computer
  });
  it('shows the job steps on the mechanic’s next job, or skips them without one', () => {
    const withJob = tourFor('mechanic', all());
    expect(withJob.map((s) => s.key)).toEqual(['shift', 'next', 'bigstep', 'waiver', 'work', 'extra', 'pay', 'syncMechanic']);
    expect(withJob.find((s) => s.key === 'bigstep')?.path).toBe('/job/j-2');
    expect(TOURS.mechanic.find((s) => s.key === 'bigstep')?.path).toBe('/job/:next');   // the definitions stay untouched
    expect(tourFor('mechanic', { ...all(), nextJobId: null }).map((s) => s.key)).toEqual(['shift', 'next', 'syncMechanic']);
  });
  it('knows when the person is already on the screen', () => {
    expect(onScreen('/settings/company', '/settings')).toBe(true);
    expect(onScreen('/agenda/2026-11-04', '/agenda')).toBe(true);
    expect(onScreen('/agendas', '/agenda')).toBe(false);
    expect(onScreen('/', '/')).toBe(true);
    expect(onScreen('/guide', '/')).toBe(false);
    expect(onScreen('/treasury', '/treasury?add=1')).toBe(true);
  });
});

/* a pretend screen: elements appear at given moments; time moves only when the tour waits */
function fakeEnv(start: string, appear: Record<string, number>) {
  let now = 0;
  let path = start;
  const went: string[] = [];
  const env: TourEnv = {
    path: () => path,
    go: (p) => { went.push(p); path = p.split('?')[0]; now += 50; },
    find: (anchors) => { for (const a of anchors) if (appear[a] != null && appear[a] <= now) return { id: a } as unknown as Element; return null; },
    sleep: async (ms) => { now += ms; },
    now: () => now
  };
  return { env, went, time: () => now };
}

describe('finding a step', () => {
  const step = (o: Partial<TourStep>): TourStep => ({ key: 'x', anchors: ['a'], ...o });
  it('opens the step’s screen, then waits for its element', async () => {
    const f = fakeEnv('/guide', { 'agenda-week': 900 });
    const el = await locate(step({ path: '/agenda', anchors: ['agenda-week'] }), f.env);
    expect(f.went).toEqual(['/agenda']);
    expect((el as unknown as { id: string }).id).toBe('agenda-week');
    expect(f.time()).toBeLessThan(1100);
  });
  it('does not open the screen again when already there', async () => {
    const f = fakeEnv('/agenda/2026-11-04', { 'agenda-day': 0 });
    await locate(step({ path: '/agenda', anchors: ['agenda-day'] }), f.env);
    expect(f.went).toEqual([]);
  });
  it('gives up after 3 seconds', async () => {
    const f = fakeEnv('/', {});
    expect(await locate(step({ path: '/hours', anchors: ['hours-grid'] }), f.env)).toBeNull();
    expect(f.time()).toBeGreaterThanOrEqual(WAIT_MS);
    expect(f.time()).toBeLessThan(WAIT_MS + 300);
  });
  it('uses the stand-in (the menu entry) only when the screen’s own element does not come, after a short wait', async () => {
    const early = fakeEnv('/', { 'nav-agenda': 0, 'agenda-week': 600 });
    expect((await locate(step({ path: '/agenda', anchors: ['agenda-week'], fallback: ['nav-agenda'] }), early.env) as unknown as { id: string }).id).toBe('agenda-week');
    const never = fakeEnv('/', { 'nav-today': 0 });
    expect((await locate(step({ path: '/', anchors: ['today-next'], fallback: ['nav-today'] }), never.env) as unknown as { id: string }).id).toBe('nav-today');
    expect(never.time()).toBeLessThan(FALLBACK_MS + 300);
  });
  it('skips missing steps forward, and looks back for « Précédent »', async () => {
    const steps: TourStep[] = [step({ key: 'a', anchors: ['sync-state'] }), step({ key: 'b', path: '/hours', anchors: ['hours-grid'] }), step({ key: 'c', path: '/team', anchors: ['team-invite'] })];
    const f = fakeEnv('/guide', { 'sync-state': 0, 'team-invite': 0 });
    const fwd = await resolveStep(steps, 1, 1, f.env);
    expect(fwd?.index).toBe(2);
    expect(f.went).toEqual(['/hours', '/team']);
    const back = await resolveStep(steps, 1, -1, fakeEnv('/team', { 'sync-state': 0 }).env);
    expect(back?.index).toBe(0);
    expect(await resolveStep(steps, 1, 1, fakeEnv('/guide', {}).env)).toBeNull();
  });
  it('stops waiting when the tour is stopped', async () => {
    let alive = true;
    const f = fakeEnv('/', {});
    const p = locate(step({ path: '/hours', anchors: ['hours-grid'] }), { ...f.env, sleep: async (ms) => { alive = false; await f.env.sleep(ms); } }, WAIT_MS, () => alive);
    expect(await p).toBeNull();
    expect(f.time()).toBeLessThan(500);
  });
});

describe('the anchor on the real page', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  const box = (el: Element, w: number, h: number) => { (el as HTMLElement).getBoundingClientRect = () => ({ width: w, height: h, top: 10, left: 10, right: 10 + w, bottom: 10 + h, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect; };
  it('takes the first visible element, in the order of the ids', () => {
    document.body.innerHTML = '<nav><a data-tour="nav-agenda" id="hidden"></a><a data-tour="nav-agenda" id="shown"></a></nav><section data-tour="agenda-week" id="week"></section><div id="guide-tour-host"><b data-tour="agenda-week" id="ours"></b></div>';
    box(document.getElementById('hidden')!, 0, 0);
    box(document.getElementById('shown')!, 80, 40);
    box(document.getElementById('week')!, 0, 0);
    box(document.getElementById('ours')!, 50, 50);
    expect(findAnchor(['agenda-week', 'nav-agenda'])?.id).toBe('shown');
    box(document.getElementById('week')!, 600, 400);
    expect(findAnchor(['agenda-week', 'nav-agenda'])?.id).toBe('week');
    (document.getElementById('week') as HTMLElement).style.visibility = 'hidden';
    expect(findAnchor(['agenda-week'])).toBeNull();
  });
});

describe('the bubble', () => {
  const vw = 390, vh = 664, bw = 358, bh = 200;
  it('goes under the element when it fits', () => {
    expect(placeBubble({ top: 4, bottom: 50, left: 326, width: 54 }, vw, vh, bw, bh)).toEqual({ top: 64, left: 16, side: 'below' });
  });
  it('goes above an element low on the screen', () => {
    const p = placeBubble({ top: 587, bottom: 655, left: 153, width: 84 }, vw, vh, bw, bh);
    expect(p.side).toBe('above');
    expect(p.top + bh).toBeLessThanOrEqual(587);
  });
  it('sits at the bottom of the screen over a very tall element, and stays inside the screen', () => {
    const p = placeBubble({ top: 40, bottom: 650, left: 10, width: 370 }, vw, vh, bw, bh);
    expect(p).toEqual({ top: vh - bh - 16, left: 16, side: 'bottom' });
    const wide = placeBubble({ top: 100, bottom: 140, left: 1200, width: 100 }, 1366, 860, 380, 200);
    expect(wide.left + 380).toBeLessThanOrEqual(1366 - 16);
  });
});
