/* One operation id per thing the person asked for (a text to the customer, « Je pars vers la Centrale »), kept until the
   server answered it: the same send tried again after a lost answer (a weak signal, a second tap) carries the same id,
   so the server texts once and gives the first answer again (notify, enroute return: op_begin / once). Once answered,
   the next ask is a new send (« Renvoyer » sends again on purpose). Pure (intents.test.ts): the id maker is given. */

export interface Intents {
  /** the id of this ask: the one still waiting for an answer, else a new one */
  op(key: string): string;
  /** the server answered (sent, refused, nothing to send): the next ask of this key is a new send */
  done(key: string, op: string): void;
}
export function intents(make: () => string): Intents {
  const ops = new Map<string, string>();
  return {
    op(key) {
      let o = ops.get(key);
      if (!o) { o = make(); ops.set(key, o); }
      return o;
    },
    // only the ask that is still the current one (an older answer arriving late does not drop a newer ask)
    done(key, op) { if (ops.get(key) === op) ops.delete(key); }
  };
}
/** the answer did not come (no network, the server busy with the same send): the same id is kept for the next try */
export function keepOp(e: unknown, network: boolean): boolean {
  const code = String((e as { code?: string; hint?: string } | null)?.code || (e as { hint?: string } | null)?.hint || '');
  return network || code === 'busy';
}
