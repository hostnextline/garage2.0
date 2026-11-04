/* The calm guided tour: which elements it shows for each role, and how a step is found (go to its screen, wait for
   the element up to 3 s, else skip it). Pure: the real screen and router are passed in (see tour.ts), so the rules
   are tested in tour.test.ts. The anchors are the data-tour="…" ids listed in docs/ARCHITECTURE.md. */
import type { Role } from './checklist';

export interface TourCtx {
  /** may.* of the routes (agenda, book, customers, hours, team, settings, dashboard, map, treasury, inventory, invoices…) */
  can: (what: string) => boolean;
  wide: boolean;
  /** the job a mechanic would open next (the job steps are shown on it), or null */
  nextJobId: string | null;
}
export interface TourStep {
  /** words: guide.tour.steps.<key>.title / .text */
  key: string;
  /** the first one found on the screen is shown */
  anchors: string[];
  /** shown only when none of `anchors` appears in time (e.g. the menu entry of a screen) */
  fallback?: string[];
  /** the screen it is on (none: wherever the person is, e.g. the frame's bars); '/job/:next' = the next job */
  path?: string;
  when?: (c: TourCtx) => boolean;
  /** a first step of the checklist this step teaches (marked as seen once shown) */
  teaches?: string;
}

const NEXT_JOB = '/job/:next';
const anyAdd = (c: TourCtx) => c.can('book') || c.can('walkIn') || c.can('quotes') || c.can('treasury');

export const TOURS: Record<Role, TourStep[]> = {
  owner: [
    { key: 'sync', anchors: ['sync-state'] },
    { key: 'add', anchors: ['quick-add', 'nav-book'], when: anyAdd },
    { key: 'today', path: '/', anchors: ['today-next', 'today-shift'], fallback: ['nav-today'] },
    { key: 'agenda', path: '/agenda', anchors: ['agenda-week', 'agenda-day'], fallback: ['nav-agenda'], when: (c) => c.can('agenda'), teaches: 'agenda' },
    { key: 'book', path: '/book', anchors: ['book-customer', 'book-services'], when: (c) => c.can('book') },
    { key: 'hours', path: '/hours', anchors: ['hours-grid', 'hours-truck'], when: (c) => c.can('hours') },
    { key: 'team', path: '/team', anchors: ['team-invite', 'team-rights'], when: (c) => c.can('team') },
    { key: 'settings', path: '/settings', anchors: ['settings-company', 'settings-services', 'settings-connect'], when: (c) => c.can('settings') },
    { key: 'dashboard', path: '/dashboard', anchors: ['dashboard-kpis'], when: (c) => c.can('dashboard') }
  ],
  office: [
    { key: 'sync', anchors: ['sync-state'] },
    { key: 'add', anchors: ['quick-add', 'nav-book'], when: anyAdd },
    { key: 'agenda', path: '/agenda', anchors: ['agenda-day', 'agenda-week'], fallback: ['nav-agenda'], when: (c) => c.can('agenda'), teaches: 'agenda' },
    { key: 'agendaBlock', path: '/agenda', anchors: ['agenda-block'], when: (c) => c.can('agenda') },
    { key: 'bookCustomer', path: '/book', anchors: ['book-customer'], when: (c) => c.can('book') },
    { key: 'bookServices', path: '/book', anchors: ['book-services'], when: (c) => c.can('book') },
    { key: 'bookBlock', path: '/book', anchors: ['book-block', 'book-confirm'], when: (c) => c.can('book') },
    { key: 'customers', path: '/customers', anchors: ['customers-search'], fallback: ['nav-customers'], when: (c) => c.can('customers'), teaches: 'customers' },
    { key: 'map', path: '/map', anchors: ['map-legend'], when: (c) => c.can('map') }
  ],
  mechanic: [
    { key: 'shift', path: '/', anchors: ['today-shift'], teaches: 'day' },
    { key: 'next', path: '/', anchors: ['today-next'] },
    { key: 'bigstep', path: NEXT_JOB, anchors: ['job-bigstep'], teaches: 'job' },
    { key: 'waiver', path: NEXT_JOB, anchors: ['job-waiver'] },
    { key: 'work', path: NEXT_JOB, anchors: ['job-work'] },
    { key: 'extra', path: NEXT_JOB, anchors: ['job-extra'] },
    { key: 'pay', path: NEXT_JOB, anchors: ['job-pay', 'job-invoice'] },
    { key: 'syncMechanic', anchors: ['sync-state'], teaches: 'offline' }
  ],
  treasurer: [
    { key: 'treasuryAdd', path: '/treasury', anchors: ['treasury-add'], when: (c) => c.can('treasury') },
    { key: 'treasuryReport', path: '/treasury', anchors: ['treasury-report'], when: (c) => c.can('treasury'), teaches: 'report' },
    { key: 'invoices', path: '/invoices', anchors: ['nav-invoices'], when: (c) => c.can('invoices') && c.wide },
    { key: 'dashboard', path: '/dashboard', anchors: ['dashboard-kpis'], when: (c) => c.can('dashboard') },
    { key: 'inventory', path: '/inventory', anchors: ['inventory-low'], when: (c) => c.can('inventory') },
    { key: 'addTreasurer', anchors: ['quick-add'], when: anyAdd },
    { key: 'sync', anchors: ['sync-state'] }
  ]
};

/** the steps of a role's tour this person can see, with the real screen of each */
export function tourFor(role: Role, c: TourCtx): TourStep[] {
  return TOURS[role]
    .filter((s) => !s.when || s.when(c))
    .filter((s) => s.path !== NEXT_JOB || !!c.nextJobId)
    .map((s) => (s.path === NEXT_JOB ? { ...s, path: `/job/${c.nextJobId}` } : s));
}

/** is the person already on that screen? ('/settings' covers '/settings/company'; the query does not count) */
export function onScreen(current: string, target: string): boolean {
  const cur = current.split('?')[0] || '/', tgt = target.split('?')[0] || '/';
  if (tgt === '/') return cur === '/';
  return cur === tgt || cur.startsWith(tgt + '/');
}

/** shown on the screen: has a size, not hidden */
export function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity || '1') > 0.05;
}
/** the first visible element carrying one of the ids, in the order given (never the tour's own bubble) */
export function findAnchor(anchors: string[], root: ParentNode = document): Element | null {
  for (const a of anchors) {
    for (const el of Array.from(root.querySelectorAll(`[data-tour="${a}"]`))) {
      if (!el.closest('#guide-tour-host') && visible(el)) return el;
    }
  }
  return null;
}

export interface TourEnv {
  /** the screen shown (route path) */
  path(): string;
  go(path: string): void;
  /** the first visible element carrying one of these data-tour ids */
  find(anchors: string[]): Element | null;
  sleep(ms: number): Promise<void>;
  now(): number;
}
export const WAIT_MS = 3000;
export const FALLBACK_MS = 1500;

/** opens the step's screen if needed and waits for its element (up to `timeout`); null when it never shows */
export async function locate(step: TourStep, env: TourEnv, timeout = WAIT_MS, alive: () => boolean = () => true): Promise<Element | null> {
  if (step.path && !onScreen(env.path(), step.path)) env.go(step.path);
  // a step with a stand-in (the menu entry) does not keep the person waiting long
  const until = env.now() + (step.fallback?.length ? Math.min(timeout, FALLBACK_MS) : timeout);
  for (;;) {
    if (!alive()) return null;
    const el = env.find(step.anchors);
    if (el) return el;
    if (env.now() >= until) return step.fallback?.length ? env.find(step.fallback) : null;
    await env.sleep(100);
  }
}

/** from step `from`, going forward (+1) or back (-1): the first step whose element shows (missing ones are skipped) */
export async function resolveStep(steps: TourStep[], from: number, dir: 1 | -1, env: TourEnv, timeout = WAIT_MS, alive: () => boolean = () => true): Promise<{ index: number; el: Element } | null> {
  for (let i = from; i >= 0 && i < steps.length; i += dir) {
    const el = await locate(steps[i], env, timeout, alive);
    if (!alive()) return null;
    if (el) return { index: i, el };
  }
  return null;
}

/** where the bubble goes: under the element when it fits, else above, else at the bottom of the screen */
export function placeBubble(r: { top: number; bottom: number; left: number; width: number } | null, vw: number, vh: number, bw: number, bh: number, gap = 14, pad = 16): { top: number; left: number; side: 'below' | 'above' | 'bottom' } {
  const w = Math.min(bw, vw - 2 * pad);
  if (!r) return { top: Math.max(pad, vh - bh - pad - 88), left: Math.round((vw - w) / 2), side: 'bottom' };
  const left = Math.round(Math.min(Math.max(pad, r.left + r.width / 2 - w / 2), vw - w - pad));
  if (r.bottom + gap + bh <= vh - pad) return { top: Math.round(r.bottom + gap), left, side: 'below' };
  if (r.top - gap - bh >= pad) return { top: Math.round(r.top - gap - bh), left, side: 'above' };
  return { top: Math.max(pad, Math.round(vh - bh - pad)), left, side: 'bottom' };
}
