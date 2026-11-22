/* What a screen knows of a server preview (« Vraies routes »: move_preview, stop_order_preview): not asked (the switch
   off), being asked, no answer (no signal, an error, an older server), or the answer. With the switch on a screen shows
   the answer, or says « pas encore calculé »: never the phone's own guess in its place. */
export type Asked<T> = { kind: 'off' } | { kind: 'asking' } | { kind: 'none' } | { kind: 'done'; answer: T };
export const NOT_ASKED = { kind: 'off' } as const;
export const ASKING = { kind: 'asking' } as const;
export const NO_ANSWER = { kind: 'none' } as const;

/** The answers of one sheet while it is open, by key (a vehicle + day + list, an order, a truck…). Pure (asked.test.ts).
    - Each key is asked once per measure of the roads (`tick` = roadsTick): `start` says whether to ask and marks it.
    - A measure that ends asks again WITHOUT throwing away the answer on screen: it stays until the new answer of the same
      key replaces it; a new ask that fails keeps it too (review-sheets L2).
    - Only the answer of the latest ask of a key is taken: an older ask answering last is dropped (review K2).
    - A key's answer is only ever shown for that key (another order, another day never borrows it). */
export class Answers<T> {
  private readonly by = new Map<string, { tick: number; shown: Asked<T> }>();
  /** what to show for that key: its answer, « asking » (never asked, or asked and not answered), or « none » */
  shown(key: string): Asked<T> { return this.by.get(key)?.shown ?? ASKING; }
  /** that key was already asked at this measure (or a later one) */
  asked(key: string, tick: number): boolean { const e = this.by.get(key); return !!e && e.tick >= tick; }
  /** true when that key must be asked now (marks it asked at `tick`; the answer shown stays) */
  start(key: string, tick: number): boolean {
    const e = this.by.get(key);
    if (e && e.tick >= tick) return false;
    this.by.set(key, { tick, shown: e?.shown.kind === 'done' ? e.shown : ASKING });
    return true;
  }
  /** the answer of the ask made at `tick` (null: no preview from the server; undefined: an error, no signal). false: dropped
      (an older ask, or a key never asked) */
  take(key: string, tick: number, answer: T | null | undefined): boolean {
    const e = this.by.get(key);
    if (!e || e.tick !== tick) return false;
    if (answer != null) e.shown = { kind: 'done', answer };
    else if (e.shown.kind !== 'done') e.shown = NO_ANSWER;
    return true;
  }
}
