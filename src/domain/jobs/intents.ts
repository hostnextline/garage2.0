/* One operation id per thing the person asked for (a text to the customer, « Je pars vers la Centrale »), kept until the
   server answered it: the same send tried again after a lost answer (a weak signal, a second tap) carries the same id,
   so the server texts once and gives the first answer again (notify, enroute return: op_begin / once). Once answered,
   the next ask is a new send (« Renvoyer » sends again on purpose).
   The same send means the same words: an ask carries `what` it tells (the day and the hours of « moved », the work
   proposed…), and an ask that tells something else is a new send, never the old answer given again (moved to Tuesday,
   the answer lost, then to Thursday: the customer gets Thursday, jobs-r2-1). A kept id also stops being the same send
   after a few minutes with no try (`maxAge`): asked again an hour later is a new ask, not the retry of a lost answer.
   Pure (intents.test.ts): the id maker and the clock are given. */

/** how long an id waits for its retry: a lost answer is tried again within seconds or minutes */
export const KEEP_OP_MS = 10 * 60000;

export interface Intents {
  /** the id of this ask: the one still waiting for an answer when it is the same ask (the same `what`, tried again
      within `maxAge` of the last try), else a new one (which replaces the old one: the key holds one ask) */
  op(key: string, what?: string): string;
  /** the server answered (sent, refused, nothing to send): the next ask of this key is a new send */
  done(key: string, op: string): void;
  /** what was asked is over by other means (the trip back ended): the next ask is a new send */
  forget(key: string): void;
}
export function intents(make: () => string, o: { maxAge?: number; now?: () => number } = {}): Intents {
  const now = o.now ?? (() => Date.now());
  const ops = new Map<string, { op: string; what: string; at: number }>();
  return {
    op(key, what = '') {
      const at = now();
      const kept = ops.get(key);
      if (kept && kept.what === what && (o.maxAge == null || at - kept.at <= o.maxAge)) { kept.at = at; return kept.op; }
      const op = make();
      ops.set(key, { op, what, at });
      return op;
    },
    // only the ask that is still the current one (an older answer arriving late does not drop a newer ask)
    done(key, op) { if (ops.get(key)?.op === op) ops.delete(key); },
    forget(key) { ops.delete(key); }
  };
}
/** the answer did not come (no network, the server busy with the same send): the same id is kept for the next try */
export function keepOp(e: unknown, network: boolean): boolean {
  const code = String((e as { code?: string; hint?: string } | null)?.code || (e as { hint?: string } | null)?.hint || '');
  return network || code === 'busy';
}
