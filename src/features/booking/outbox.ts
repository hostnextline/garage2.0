/* Small helpers around the device's outbox (the operations waiting for the network). */
import { outboxList, dismissFailed, net } from '../../data/sync';

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

/** An operation is already in the outbox the moment it is asked. With no signal, there is no answer to wait for
    (the shared layer waits 8 s): after a short moment the screen treats it as « kept on the phone ». */
export async function noLongWaitOffline<T extends { queued: boolean }>(p: Promise<T>, extra: Omit<T, 'queued'> | Record<string, never> = {}): Promise<T> {
  if (net.value.online) return p;
  p.catch(() => undefined);   // a later refusal shows in the frame's « refusé » list
  const later = new Promise<T>((res) => setTimeout(() => res({ ...(extra as object), queued: true } as T), 1500));
  return Promise.race([p, later]);
}
