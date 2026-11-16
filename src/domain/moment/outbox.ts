/* Small helpers around the device's outbox (the operations waiting for the network). */
import { outboxList, dismissFailed } from '../../data/sync';

/** A refusal the person has just seen on this screen (the toast and the message next to the block) does not need to
    stay in the frame's « refusé » list as well: the next try, with another block, is the answer. Only for operations
    refused while the person waited; one refused later (sent after the network came back) stays listed. */
export async function forgetRefusal(rpc: string, match: (args: Record<string, unknown>) => boolean): Promise<void> {
  try {
    for (const e of await outboxList()) {
      if (e.state === 'failed' && e.kind === 'rpc' && e.rpc === rpc && e.args && e.seq != null && match(e.args)) await dismissFailed(e.seq);
    }
  } catch { /* it stays listed: the person can dismiss it */ }
}

/** With no signal the shared layer now answers « kept on the phone » after a short moment by itself (and a refusal
    that arrives while the screen still waits is shown here, not listed twice): nothing more to do. Kept so the
    callers read the same; the extra fields are added when the answer is « queued ». */
export async function noLongWaitOffline<T extends { queued: boolean }>(p: Promise<T>, extra: Omit<T, 'queued'> | Record<string, never> = {}): Promise<T> {
  const r = await p;
  return r.queued ? ({ ...(extra as object), ...r } as T) : r;
}
