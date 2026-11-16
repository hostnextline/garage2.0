/* The history entries of sheets (« layers »). Each open sheet owns one history step, so the phone's back button closes
   it instead of leaving the screen. This module is the one owner of those steps:
   - a sheet asks openLayer() and gets its step; release() when it closes by a button steps back over it;
   - a step back is asynchronous: anything that touches history meanwhile (a navigation, the next sheet's step) waits
     for it through whenHistorySettled, or the step back would undo it;
   - the back button pops the top layer; a layer that may not close now (a signature in progress) keeps its step;
   - a navigation to another screen first closes the open layers and removes their steps (closeLayersForNavigation),
     so no dead step is left behind (« Retour » once, not twice).
   The history state keeps the ids under `sheets` (as before), next to the router's depth `d`. */
import { signal } from '@preact/signals';

export type BackReason = 'back' | 'navigate';
interface Layer {
  id: string;
  /** its step is in the history */
  pushed: boolean;
  /** closed already (by a button, the back button or a navigation): nothing more to do */
  closed: boolean;
  /** asked to close: false keeps it open (and its step) */
  onBack: (why: BackReason) => boolean | void;
}

/** how many sheets / questions are open (the update flow never reloads over one) */
export const layersOpen = signal(0);

const layers: Layer[] = [];
let pendingBack = 0;
/** the address to keep once our step back lands (a query changed while the sheet was open must not be undone) */
let keepUrl: string | null = null;
let safety: ReturnType<typeof setTimeout> | null = null;
const settleQueue: (() => void)[] = [];
let seq = 0;
// ids from before a reload must never match: the page's own random tag
const bootTag = Math.random().toString(36).slice(2, 6);

export const stackOf = (st: unknown): string[] => {
  const s = (st as { sheets?: unknown } | null)?.sheets;
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string') : [];
};
const stateObj = (): Record<string, unknown> => {
  const s = history.state as unknown;
  return s && typeof s === 'object' ? { ...(s as Record<string, unknown>) } : {};
};
const count = () => { layersOpen.value = layers.filter((l) => !l.closed).length; };

function settle() {
  pendingBack = 0;
  keepUrl = null;
  if (safety) { clearTimeout(safety); safety = null; }
  for (const f of settleQueue.splice(0)) f();
}
/** runs fn now, or right after the step back in progress */
export function whenHistorySettled(fn: () => void) { if (pendingBack > 0) settleQueue.push(fn); else fn(); }

/** steps back over `n` of our own entries (the popstate it causes is ours, not the person's); `keep`: the address the
    entry we land on must show (the entries below were written before a setQuery made while the sheet was open) */
function stepBack(n = 1, keep: string | null = null) {
  if (n <= 0) return;
  pendingBack++;
  keepUrl = keep;
  try { history.go(-n); } catch { settle(); return; }
  // a browser that never answers the step back must not hold navigation
  if (safety) clearTimeout(safety);
  safety = setTimeout(settle, 700);
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (pendingBack > 0) {
      // this listener runs before the router's: the address is put right before the screen reads it
      if (keepUrl && location.href !== keepUrl) { try { history.replaceState(stateObj(), '', keepUrl); } catch { /* the older address stays */ } }
      if (--pendingBack === 0) settle();
      return;
    }
    // the person pressed back (or forward): the layers whose step is gone close, top first
    const ids = stackOf(history.state);
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.closed || !l.pushed || ids.includes(l.id)) continue;
      if (l.onBack('back') === false) {
        // it may not close now (a signature in progress): its step comes back, the sheet stays as it is
        const keep = layers.slice(0, i + 1).filter((x) => !x.closed && x.pushed).map((x) => x.id);
        try { history.pushState({ ...stateObj(), sheets: keep }, '', location.href); } catch { /* the sheet stays all the same */ }
        break;
      }
      l.closed = true;
      layers.splice(i, 1);
    }
    count();
  });
}

export interface LayerHandle { readonly id: string; release(): void }
/** a sheet opens: its own history step (pushed once any step back in progress is over) */
export function openLayer(onBack: (why: BackReason) => boolean | void): LayerHandle {
  const layer: Layer = { id: `s${++seq}-${bootTag}`, pushed: false, closed: false, onBack };
  layers.push(layer);
  count();
  whenHistorySettled(() => {
    if (layer.closed) return;
    try {
      history.pushState({ ...stateObj(), sheets: [...stackOf(history.state), layer.id] }, '', location.href);
      layer.pushed = true;
    } catch { /* no history: the back button simply leaves the screen */ }
  });
  return {
    id: layer.id,
    release() {
      if (layer.closed) return;
      layer.closed = true;
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
      count();
      // closed by a button: remove its step, but only when it is still the top one (else a navigation replaced it)
      const st = stackOf(history.state);
      if (layer.pushed && st[st.length - 1] === layer.id) stepBack(1, location.href);
    }
  };
}

/** a navigation to another screen: every open layer closes, and its steps are removed first. Returns how many steps
    are being stepped back (0: nothing to wait for). */
export function closeLayersForNavigation(): number {
  const open = layers.splice(0).filter((l) => !l.closed);
  const ids = stackOf(history.state);
  for (let i = open.length - 1; i >= 0; i--) {
    open[i].closed = true;
    try { open[i].onBack('navigate'); } catch { /* the navigation goes on */ }
  }
  count();
  const n = open.filter((l) => l.pushed && ids.includes(l.id)).length;
  stepBack(n);
  return n;
}
