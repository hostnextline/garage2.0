/* The guided tour, running: a module signal drives an overlay rendered in its own container in document.body (the
   frame is not touched). A step on another screen opens it with navigate() and waits for its element (3 s at most,
   else the step is skipped). « Montre-moi » (showMe) is the same with a single step, used by the checklist.
   Finished tours are remembered per person (guide-data.ts). */
import { signal } from '@preact/signals';
import { h, render } from 'preact';
import { navigate, route } from '../../app/router';
import { may } from '../../app/routes';
import { wide } from '../../app/media';
import { t } from '../../lib/i18n';
import { toast } from '../../ui';
import { tourFor, resolveStep, locate, findAnchor, type TourStep, type TourEnv, type TourCtx } from './tour-steps';
import { markStep, markTour, nextJobId } from './guide-data';
import type { Role, GuideStep } from './checklist';
import { TourOverlay } from './TourOverlay';

export interface TourRun {
  kind: 'tour' | 'spot';
  role: Role | null;
  steps: TourStep[];
  index: number;
  /** seek: opening the screen / waiting for the element; show: the bubble is on it */
  phase: 'seek' | 'show';
  el: Element | null;
  /** words of a single « showMe » step (a tour step takes its words from its key) */
  title?: string;
  text?: string;
  /** the screen the tour started from (it comes back there at the end) */
  from: string;
  shown: number;
}
export const tourRun = signal<TourRun | null>(null);
let run = 0;

/* ---------- the real screen ---------- */
const env: TourEnv = {
  path: () => route.value.path,
  go: (p) => navigate(p),
  find: (a) => findAnchor(a),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now()
};
export function tourCtx(): TourCtx {
  const m = may as unknown as Record<string, (() => boolean) | undefined>;
  return { can: (k) => { try { return !!m[k]?.(); } catch { return false; } }, wide: wide.value, nextJobId: nextJobId() };
}
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
/** in a bar that never scrolls (the top bar, the bottom bar, the side menu)? */
function pinned(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}
function bringIntoView(el: Element) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const behavior: ScrollBehavior = reduced() ? 'auto' : 'smooth';
  // a bar does not scroll with the page; only its own list may need to (the side menu on a short screen)
  if (pinned(el)) { if (r.top < 0 || r.bottom > vh) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior }); return; }
  // on the phone, the top bar and the bottom bar cover the edges of the page
  const top = wide.value ? 16 : 64, bottom = wide.value ? 16 : 96;
  if (r.top < top || r.bottom > vh - bottom) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior });
}

/* ---------- the overlay's container ---------- */
let host: HTMLElement | null = null;
function mount() {
  if (host?.isConnected) return;
  host = document.createElement('div');
  host.id = 'guide-tour-host';
  document.body.appendChild(host);
  render(h(TourOverlay, {}), host);
}

/* ---------- running ---------- */
async function show(index: number, dir: 1 | -1) {
  const cur = tourRun.value;
  if (!cur) return;
  const my = ++run;
  tourRun.value = { ...cur, index: Math.max(0, Math.min(index, cur.steps.length - 1)), phase: 'seek', el: null };
  const found = await resolveStep(cur.steps, index, dir, env, undefined, () => my === run);
  if (my !== run || !tourRun.value) return;
  if (!found) {
    if (dir < 0) { void show(tourRun.value.index, 1); return; }   // nothing before: stay on this step
    end(tourRun.value.shown > 0);
    return;
  }
  bringIntoView(found.el);
  const step = cur.steps[found.index];
  if (step.teaches) markStep(step.teaches);
  tourRun.value = { ...tourRun.value, index: found.index, phase: 'show', el: found.el, shown: tourRun.value.shown + 1 };
}

/** the tour of a role (6 to 10 steps), from the first step */
export function startTour(role: Role) {
  mount();
  const steps = tourFor(role, tourCtx());
  const from = route.value.path + (route.value.query.toString() ? `?${route.value.query.toString()}` : '');
  tourRun.value = { kind: 'tour', role, steps, index: 0, phase: 'seek', el: null, from, shown: 0 };
  void show(0, 1);
}
/** one element shown with a short explanation (after opening its screen); nothing happens if it never shows */
export function showMe(anchors: string[], title: string, text: string, path?: string) {
  mount();
  const my = ++run;
  const step: TourStep = { key: 'spot', anchors, path };
  tourRun.value = { kind: 'spot', role: null, steps: [step], index: 0, phase: 'seek', el: null, title, text, from: route.value.path, shown: 0 };
  void locate(step, env, undefined, () => my === run).then((el) => {
    if (my !== run || !tourRun.value) return;
    if (!el) { tourRun.value = null; return; }
    bringIntoView(el);
    tourRun.value = { ...tourRun.value, phase: 'show', el, shown: 1 };
  });
}
export function nextTourStep() {
  const r = tourRun.value;
  if (!r) return;
  if (r.kind === 'spot' || r.index >= r.steps.length - 1) { end(r.kind === 'tour'); return; }
  void show(r.index + 1, 1);
}
export function prevTourStep() {
  const r = tourRun.value;
  if (!r || r.kind === 'spot' || r.index === 0) return;
  void show(r.index - 1, -1);
}
/** « Arrêter » (or Échap): the tour stops where it is */
export function stopTour() { run++; tourRun.value = null; }
/** the element went away (the screen redrew it): find it again, or move on */
export function relocate() {
  const r = tourRun.value;
  if (!r || r.phase !== 'show') return;
  const step = r.steps[r.index];
  const el = findAnchor(step.anchors) || (step.fallback ? findAnchor(step.fallback) : null);
  if (el) { tourRun.value = { ...r, el }; return; }
  if (r.kind === 'spot') { tourRun.value = null; return; }
  void show(r.index, 1);
}
function end(completed: boolean) {
  const r = tourRun.value;
  run++;
  tourRun.value = null;
  if (!r || r.kind !== 'tour') return;
  if (completed && r.role) { markTour(r.role); toast(t('guide.tour.finished'), { kind: 'ok' }); }
  else if (!r.shown) toast(t('guide.tour.empty'));
  if (r.from && r.from !== route.value.path) navigate(r.from);
}

/** a first step of the checklist: its screen, and the element to tap shown on it (or the tour, or the help) */
export function openStep(s: GuideStep) {
  if (s.kind === 'tour') { startTour(s.role); return; }
  if (s.kind === 'read' || s.kind === 'visit') markStep(s.id);
  navigate(s.href);
  if (s.anchor) showMe([s.anchor], t(`guide.steps.${s.id}.title`), t(`guide.steps.${s.id}.text`));
}
