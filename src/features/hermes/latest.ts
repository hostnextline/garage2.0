/* Only the newest answer counts: each load is numbered, and an answer that comes back after a newer load was started
   (or after the screen went away) is dropped instead of drawn. Tested in latest.test.ts. */
export interface Latest {
  /** does the work; its result, or null when a newer run (or drop) came meanwhile */
  run<T>(work: () => Promise<T>): Promise<T | null>;
  /** forget every run in flight (the screen leaves) */
  drop(): void;
}
export function latestOnly(): Latest {
  let n = 0;
  return {
    async run<T>(work: () => Promise<T>): Promise<T | null> {
      const mine = ++n;
      const r = await work();
      return mine === n ? r : null;
    },
    drop() { n++; }
  };
}
