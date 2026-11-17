/* What floats over every screen, mounted once by the frame: the « + » and sync sheets, « Reconnecte-toi », the Coffre
   sheet, the shortcut menu, 🤖 Hermes, « Appel entrant », « Texto entrant ». Each one in its own error boundary: a host
   that throws disappears (reported) and comes back at the next screen; it never takes the screen or the others down. */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { route } from '../platform/router';
import { ErrorBoundary } from '../ui';
import { ContextMenuHost } from '../ui/ContextMenu';
import { QuickSheet } from './QuickSheet';
import { SyncSheet } from './sync';
import { ReconnectSheet } from './ReconnectSheet';
// their looks stay in the first download, in the same place as before (only their code waits): every screen's own
// stylesheet still comes after them, as it always did
import '../features/hermes/hermes.css';
import '../shared/moment/booking.css';
import '../shared/customers/conversation.css';

/** a host whose code is a file of its own (the first download stays small): asked as the app starts (preloadHosts) and
    drawn as soon as it is there; one that could not come (no signal and no offline copy yet) is asked again at the next
    screen. The service worker keeps every one of them for offline. */
function lazyHost(load: () => Promise<ComponentType>): { C: ComponentType; load: () => Promise<ComponentType | null> } {
  let got: ComponentType | null = null;
  let asked: Promise<ComponentType | null> | null = null;
  const fetchIt = () => (asked ??= load().then((c) => (got = c), () => { asked = null; return null; }));
  function LazyHost() {
    const path = route.value.path;
    const [, redraw] = useState(0);
    useEffect(() => {
      if (got) return;
      let alive = true;
      void fetchIt().then((c) => { if (alive && c) redraw((n) => n + 1); });
      return () => { alive = false; };
    }, [path]);
    const C = got;
    return C ? <C /> : null;
  }
  return { C: LazyHost, load: fetchIt };
}
const coffre = lazyHost(() => import('../shared/invoices/CoffreHost').then((m) => m.CoffreHost));
const hermes = lazyHost(() => import('../features/hermes/host').then((m) => m.HermesHost));
const calls = lazyHost(() => import('../features/booking/CallBanner').then((m) => m.CallHost));
const texts = lazyHost(() => import('../features/conversation/TextHost').then((m) => m.TextHost));

const HOSTS: { name: string; C: ComponentType }[] = [
  { name: 'quick', C: QuickSheet },
  { name: 'sync', C: SyncSheet },
  { name: 'reconnect', C: ReconnectSheet },
  { name: 'coffre', C: coffre.C },
  { name: 'menu', C: ContextMenuHost },
  { name: 'hermes', C: hermes.C },
  { name: 'calls', C: calls.C },
  { name: 'texts', C: texts.C }
];

/** the floating hosts' code, asked at start (while the session is checked), so they are there with the first screen */
export function preloadHosts(): void { for (const h of [coffre, hermes, calls, texts]) void h.load(); }

export function Hosts() {
  const path = route.value.path;
  return <>{HOSTS.map((h) => <ErrorBoundary key={h.name} name={`host:${h.name}`} resetKey={path} silent><h.C /></ErrorBoundary>)}</>;
}
