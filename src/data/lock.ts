/* One sender per account on this device. Two tabs of the office computer (or the installed app next to a browser
   tab) share one outbox: without a lock both sent the same waiting change at once when the signal came back, and the
   second one's refusal wrote a false « refusé » back (core-data-06). The browser's Web Lock `his-outbox-<uid>` is held
   for one sending round; a tab that does not get it asks the holder to go on and returns. Without Web Locks (old
   Safari) every tab sends: the operation ids make a repeat harmless on the server, and an entry another tab already
   sent is never written back (local.ts mutateEntry). A broadcast tells the other tabs that the outbox changed. */

export type LockManagerLike = { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) => Promise<void> };

export interface SenderLock {
  /** runs `fn` while this tab is the account's only sender; false when another tab is sending right now */
  run(fn: () => Promise<void>): Promise<boolean>;
  /** tells the other tabs: 'outbox' (reload it), 'kick' (the holder should send again) */
  poke(what: 'outbox' | 'kick'): void;
  listen(fn: (what: 'outbox' | 'kick') => void): () => void;
  close(): void;
}

export function senderLock(uid: string, o: { locks?: LockManagerLike | null; channel?: boolean } = {}): SenderLock {
  const locks = o.locks !== undefined ? o.locks : ((globalThis.navigator as unknown as { locks?: LockManagerLike } | undefined)?.locks ?? null);
  const name = `his-outbox-${uid}`;
  const ch = o.channel !== false && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null;
  return {
    async run(fn) {
      if (!locks) { await fn(); return true; }
      let got = false;
      await locks.request(name, { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        got = true;
        await fn();
      });
      return got;
    },
    poke(what) { try { ch?.postMessage(what); } catch { /* a closed channel: the other tabs pull by themselves */ } },
    listen(fn) {
      if (!ch) return () => undefined;
      const h = (ev: MessageEvent) => { if (ev.data === 'outbox' || ev.data === 'kick') fn(ev.data); };
      ch.addEventListener('message', h);
      return () => ch.removeEventListener('message', h);
    },
    close() { try { ch?.close(); } catch { /* already closed */ } }
  };
}
