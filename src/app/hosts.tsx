/* What floats over every screen, mounted once by the frame: the « + » and sync sheets, « Reconnecte-toi », the Coffre
   sheet, the shortcut menu, 🤖 Hermes, « Appel entrant », « Texto entrant ». Each one in its own error boundary: a host
   that throws disappears (reported) and comes back at the next screen; it never takes the screen or the others down. */
import type { ComponentType } from 'preact';
import { route } from '../platform/router';
import { ErrorBoundary } from '../ui';
import { ContextMenuHost } from '../ui/ContextMenu';
import { CoffreHost } from '../shared/invoices/CoffreHost';
import { HermesHost } from '../features/hermes/host';
import { CallHost } from '../features/booking/CallBanner';
import { TextHost } from '../features/conversation/TextHost';
import { QuickSheet } from './QuickSheet';
import { SyncSheet } from './sync';
import { ReconnectSheet } from './ReconnectSheet';

const HOSTS: { name: string; C: ComponentType }[] = [
  { name: 'quick', C: QuickSheet },
  { name: 'sync', C: SyncSheet },
  { name: 'reconnect', C: ReconnectSheet },
  { name: 'coffre', C: CoffreHost },
  { name: 'menu', C: ContextMenuHost },
  { name: 'hermes', C: HermesHost },
  { name: 'calls', C: CallHost },
  { name: 'texts', C: TextHost }
];

export function Hosts() {
  const path = route.value.path;
  return <>{HOSTS.map((h) => <ErrorBoundary key={h.name} name={`host:${h.name}`} resetKey={path} silent><h.C /></ErrorBoundary>)}</>;
}
