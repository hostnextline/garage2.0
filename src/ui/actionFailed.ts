/* What a kit control does with an action that threw past its own handling: it is always reported; the team app also
   says it in a toast (ui/toast.tsx registers that). The customer's page loads the Button alone, without the
   dictionaries: there the failure is reported only. */
import { reportError } from '../platform/report';

let tell: ((e: unknown) => void) | null = null;
/** the way to tell the person (registered once by the toasts) */
export function onActionFailed(fn: (e: unknown) => void) { tell = fn; }
export function actionFailed(e: unknown, where: string) {
  reportError(e, where, 'action');
  try { tell?.(e); } catch { /* telling must not throw */ }
}
