/* The rules of a tap on a kit button, without any drawing (tested in tapGuard.test.ts).
   - An action that returns a promise holds the button until it is done, then a short cool-down: the second tap of a
     double tap whose first answer came back at once (« gardé sur le téléphone ») does nothing. Typing in between ends
     the cool-down (a correction after a refusal is not a double tap).
   - The lock is taken before the action is called, so two clicks in the same instant run it once.
   - confirm: the first tap arms the button and shows the question; taps during the next ARM_DEAD_MS are ignored (a
     double tap, gloves, is never a confirmation), then a tap within CONFIRM_MS does the action. */

/** after arming, taps are ignored this long: the person must read « Toucher encore pour… » */
export const ARM_DEAD_MS = 450;
/** an armed button waits this long for the confirmation, then disarms */
export const CONFIRM_MS = 4000;
/** after an action that returned a promise settles, taps are ignored this long */
export const COOL_MS = 350;

export type TapVerdict = 'ignore' | 'arm' | 'act';

export interface TapGuard {
  /** what to do with a tap now */
  tap(now: number): TapVerdict;
  /** the action started (a promise is pending) */
  start(): void;
  /** the action's promise settled */
  settle(now: number): void;
  /** the button disarmed by itself (CONFIRM_MS passed) */
  disarm(): void;
  readonly busy: boolean;
  readonly armedAt: number | null;
}

export function createTapGuard(o: { confirm: () => boolean; blocked: () => boolean; lastInputAt?: () => number }): TapGuard {
  let busy = false;
  let armedAt: number | null = null;
  let coolUntil = 0;
  let settledAt = 0;
  const cooling = (now: number) => now < coolUntil && (o.lastInputAt?.() ?? 0) <= settledAt;
  return {
    get busy() { return busy; },
    get armedAt() { return armedAt; },
    tap(now) {
      if (busy || o.blocked() || cooling(now)) return 'ignore';
      if (o.confirm()) {
        if (armedAt == null || now - armedAt >= CONFIRM_MS) { armedAt = now; return 'arm'; }
        if (now - armedAt < ARM_DEAD_MS) return 'ignore';
      }
      armedAt = null;
      return 'act';
    },
    start() { busy = true; },
    settle(now) { busy = false; settledAt = now; coolUntil = now + COOL_MS; },
    disarm() { armedAt = null; }
  };
}
