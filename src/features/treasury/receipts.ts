/* Receipt photos: sending them, and showing them again.

   A photo (300 to 700 KB) no longer waits in the phone's ordered outbox. There it was sent before everything queued
   after it, with 15 s per try: on a weak uplink it never passed, and the expense, the job steps and the payments behind
   it stayed on the phone (bug 02). Now:
   - each photo has its id from the moment it is taken, used by the first try and by every retry: a try whose answer
     was lost and that did land is found again (duplicate key), never stored twice;
   - a try is really stopped (abort). The try made while the person waits in the sheet stops after 25 s at most; the
     tries in the background get a time that grows with the photo;
   - one photo is sent at a time: a save in the sheet goes first and pauses the background try, which goes on after it;
   - when the photo cannot go, the expense is saved WITHOUT it (expenses.receipt_id must name a photo already on the
     server) and goes at once; the photo waits here, on the phone (Cache Storage, per person), is tried again later and
     when the signal comes back, and then the expense is given its receipt_id;
   - an expired sign-in (a night with no signal) is not a refusal: the session is renewed and the photo waits;
   - a photo the server really refuses is never thrown away: it stays on the phone, marked « refused », is not tried
     again by itself, and is tried again when the person saves that expense again (or taken off with « Retirer »).
   Pictures read from the server are kept for the session (a few only), and only real pictures are shown: a receipt
   stored as anything else (an SVG with a script, an HTML page) is never opened as a document of the app. */
import { t } from '../../lib/i18n';
import { Refused } from '../../lib/errors';
import { sb, preview } from '../../data/auth';
import { errorMessage } from '../../data/api';
import { currentUid, isNetworkError, net, updateRow } from '../../data/sync';
import { getRow } from '../../data/store';
import type { Expense } from '../../data/types';
import { toast } from '../../ui';
import { withTimeout } from '../../shared/charts/useReport';
import type { Photo } from '../../shared/export/ocr';

/** a photo with the id it will have on the server */
export interface ReceiptPhoto extends Photo { id: string }
/** `failed`: the server refused it (not the network); it waits for the person, never tried again by itself */
export interface WaitingPhoto extends ReceiptPhoto { uid: string; expenseId: string; failed?: boolean }

export interface QueueDeps {
  upload: (p: ReceiptPhoto, signal: AbortSignal) => Promise<void>;
  /** the photo is on the server: the expense may now name it */
  link: (expenseId: string, receiptId: string) => void;
  /** a photo the server will not take (a refusal, not the network) */
  refused: (e: unknown) => void;
  /** the sign-in expired: renew it (true when it worked) */
  reauth?: () => Promise<boolean>;
  keep: { put: (p: WaitingPhoto) => Promise<void>; remove: (id: string) => Promise<void>; all: () => Promise<WaitingPhoto[]> };
  uid: () => string;
}
/** how long one background try may take: 20 s, plus the time to send the photo at about 64 kbit/s */
export const tryTimeout = (dataUrl: string) => 20000 + Math.round(dataUrl.length / 8);
/** the try made while the person waits in the sheet: never longer than this, then the expense is saved and the photo
    waits (a try cut off that did land is found again by its id) */
export const SEND_MAX_MS = 25000;
/** waits between the tries of the waiting photos (the signal coming back tries at once) */
export const RETRY_MS = [10000, 30000, 60000, 120000, 300000, 600000];

/** the sign-in has expired (the same test as the phone's outbox) */
export function isAuthError(e: unknown): boolean {
  const err = e as { code?: string; status?: number; message?: string } | null;
  return !!err && (err.status === 401 || err.code === 'PGRST301' || err.code === 'PGRST303' || /JWT expired|invalid JWT|jwt/i.test(String(err.message || '')));
}
/** not the photo's fault: no signal, an expired sign-in, or « Voir l'app comme… » for a while */
const isLater = (e: unknown) => isNetworkError(e) || isAuthError(e) || (e instanceof Refused && e.code === 'preview');

export function createReceiptQueue(deps: QueueDeps) {
  const waiting = new Map<string, WaitingPhoto>();
  const sending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let draining = false;
  let failures = 0;
  // one upload at a time: the sheet's save pauses the background one, which goes on once the save is done
  let busySend = 0;
  let drainCtl: AbortController | null = null;
  let paused = false;
  let drainAfter = false;

  async function tryOnce(p: ReceiptPhoto, ms: number, ctl = new AbortController()): Promise<void> {
    const stop = setTimeout(() => ctl.abort(), ms);
    sending.add(p.id);
    try { await deps.upload(p, ctl.signal); } finally { clearTimeout(stop); sending.delete(p.id); }
  }
  function schedule() {
    if (timer || busySend || ![...waiting.values()].some((p) => !p.failed)) return;
    timer = setTimeout(() => { timer = null; void drain(); }, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
  }
  async function forget(id: string) {
    waiting.delete(id);
    await deps.keep.remove(id).catch((e) => console.warn('receipt: not removed from the phone', e));
  }
  async function hold(w: WaitingPhoto) {
    waiting.set(w.id, w);
    await deps.keep.put(w).catch((err) => console.warn('receipt: kept in memory only', err));
  }
  function reauth() {
    if (!deps.reauth) return Promise.resolve(false);
    return deps.reauth().catch((e) => { console.warn('receipt: sign-in not renewed', e); return false; });
  }
  /** sends the photos waiting, one after the other; stops at the first network failure and tries again later */
  async function drain(): Promise<void> {
    if (busySend) { drainAfter = true; return; }
    if (draining) return;
    draining = true;
    if (timer) { clearTimeout(timer); timer = null; }
    try {
      for (const p of [...waiting.values()]) {
        if (busySend) { drainAfter = true; break; }
        if (p.failed || p.uid !== deps.uid() || sending.has(p.id) || !waiting.has(p.id)) continue;
        try {
          drainCtl = new AbortController();
          await tryOnce(p, tryTimeout(p.dataUrl), drainCtl);
        } catch (e) {
          // paused by a save in the sheet: not a failure, it goes on right after
          if (paused) break;
          if (isAuthError(e)) await reauth();
          if (isLater(e)) { failures++; break; }
          // a real refusal: kept, marked, and the person is told once
          if (waiting.has(p.id)) await hold({ ...p, failed: true });
          deps.refused(e);
          continue;
        } finally { drainCtl = null; }
        failures = 0;
        await forget(p.id);
        deps.link(p.expenseId, p.id);
      }
    } finally {
      draining = false;
      paused = false;
      schedule();
    }
  }

  return {
    /** sends the photo of `expenseId` now (25 s at most); with no signal it waits on the phone (queued: true) and the
        expense is saved without it. A refusal (rights, preview) throws: the person is told and nothing is saved. */
    async send(p: ReceiptPhoto, expenseId: string): Promise<{ id: string; queued: boolean }> {
      const known = waiting.get(p.id);
      if (known) {
        await hold({ ...known, expenseId, failed: false });
        if (known.failed) void drain();
        return { id: p.id, queued: true };
      }
      busySend++;
      if (timer) { clearTimeout(timer); timer = null; }
      if (drainCtl) { paused = true; drainAfter = true; drainCtl.abort(); }
      try {
        await tryOnce(p, Math.min(SEND_MAX_MS, tryTimeout(p.dataUrl)));
        return { id: p.id, queued: false };
      } catch (e) {
        if (isAuthError(e)) void reauth();
        if (!isLater(e) || (e instanceof Refused)) throw e;
        await hold({ ...p, uid: deps.uid(), expenseId });
        return { id: p.id, queued: true };
      } finally {
        busySend--;
        if (!busySend) {
          if (drainAfter) { drainAfter = false; void drain(); } else schedule();
        }
      }
    },
    /** the picture of a photo still waiting (the person sees it in the expense) */
    picture(id: string): string | null { return waiting.get(id)?.dataUrl ?? null; },
    /** the photo waiting for this expense, if any (`failed`: refused by the server, waiting for the person) */
    waitingFor(expenseId: string): WaitingPhoto | null {
      for (const p of waiting.values()) if (p.expenseId === expenseId) return p;
      return null;
    },
    /** a refused photo: the person saved its expense again, so it gets a new try (in the background) */
    async retry(id: string): Promise<void> {
      const w = waiting.get(id);
      if (!w) return;
      if (w.failed) await hold({ ...w, failed: false });
      void drain();
    },
    /** the person took the photo off the expense (or changed it): it will not be sent */
    drop(id: string): Promise<void> { return forget(id); },
    /** the photos kept on the phone by an earlier visit, then a try */
    async resume(): Promise<void> {
      const kept = await deps.keep.all().catch((e) => { console.warn('receipt: kept photos not read', e); return [] as WaitingPhoto[]; });
      for (const p of kept) if (!waiting.has(p.id)) waiting.set(p.id, p);
      await drain();
    },
    drain,
    get size() { return waiting.size; }
  };
}

/* ---------- the real queue of the app ---------- */

/** the photo goes straight to the server with its own id (« already there » is a success) */
async function uploadPhoto(p: ReceiptPhoto, signal: AbortSignal): Promise<void> {
  if (preview.value) throw new Refused('preview', t('errors.preview'));
  const data = p.dataUrl.split(',')[1] || '';
  const { error } = await sb.from('attachments')
    .insert({ id: p.id, kind: 'receipt', mime: 'image/jpeg', data, bytes: Math.round(data.length * 0.75), width: p.w, height: p.h })
    .abortSignal(signal);
  // 23505: an earlier try of this same photo landed and its answer was lost
  if (error && error.code !== '23505') throw error;
}

/* the photos waiting live in Cache Storage (not in the phone's database, whose format is fixed): one entry per photo,
   under the person's id, so a photo is never sent from someone else's session */
const CACHE = 'his-receipts-waiting';
const keyOf = (uid: string, id: string) => `/__his-receipts/${encodeURIComponent(uid)}/${encodeURIComponent(id)}`;
const hasCaches = () => typeof caches !== 'undefined';
const keep: QueueDeps['keep'] = {
  async put(p) { if (hasCaches()) await (await caches.open(CACHE)).put(keyOf(p.uid, p.id), new Response(JSON.stringify(p))); },
  async remove(id) {
    if (!hasCaches()) return;
    const c = await caches.open(CACHE);
    for (const r of await c.keys()) if (r.url.endsWith(`/${encodeURIComponent(id)}`)) await c.delete(r);
  },
  async all() {
    if (!hasCaches()) return [];
    const c = await caches.open(CACHE);
    const out: WaitingPhoto[] = [];
    for (const r of await c.keys()) {
      const res = await c.match(r);
      const p = res ? (await res.json()) as WaitingPhoto : null;
      if (p && typeof p.id === 'string' && typeof p.dataUrl === 'string' && typeof p.expenseId === 'string') out.push(p);
    }
    return out;
  }
};

export const receiptQueue = createReceiptQueue({
  upload: uploadPhoto,
  link: (expenseId, receiptId) => {
    const e = getRow<Expense>('expenses', expenseId);
    if (e?.deleted_at) return;
    void updateRow('expenses', expenseId, { receipt_id: receiptId }, { label: t('log.expense') })
      .catch((err) => toast(errorMessage(err), { kind: 'bad' }));
  },
  refused: (e) => toast(errorMessage(e), { kind: 'bad' }),
  reauth: async () => { const { error } = await sb.auth.refreshSession(); return !error; },
  keep,
  uid: currentUid
});
let started = false;
/** once per visit: the photos left by an earlier visit, and a try each time the signal comes back */
export function startReceiptQueue() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => void receiptQueue.drain());
  void receiptQueue.resume();
}

/* ---------- showing a receipt ---------- */

/** the kinds of picture shown in the app (an <img> never runs what an SVG holds) */
const SHOWN = /^data:image\/(?:jpeg|png|webp|gif|svg\+xml);base64,/;
/** the kinds opened full size in a tab of their own: plain pictures only (an SVG there would run its script) */
const OPENED = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/;

const MAX_KEPT = 12;
const receipts = new Map<string, string>();
function remember(id: string, url: string) {
  receipts.delete(id);
  receipts.set(id, url);
  // the oldest goes: a picture is about 0,5 MB of memory
  while (receipts.size > MAX_KEPT) receipts.delete(receipts.keys().next().value as string);
}
export function rememberReceipt(id: string, dataUrl: string) { if (SHOWN.test(dataUrl)) remember(id, dataUrl); }

/** the stored picture of a receipt, or null when the server has none. A failed request THROWS (a weak or just-lost
    signal is not « no longer available », even while the phone still believes it is online). */
export async function readAttachment(id: string): Promise<string | null> {
  const { data, error } = await sb.from('attachments').select('mime, data').eq('id', id).maybeSingle();
  if (error) throw error;
  const row = data as { mime: string; data: string } | null;
  return row ? `data:${row.mime};base64,${row.data}` : null;
}

/** the picture of a receipt, or null when there is none (or it is not a picture). Throws when the network is
    missing, so the person reads « needs the network » rather than « no longer available ». */
export async function receiptImage(id: string, load: (id: string) => Promise<string | null> = readAttachment): Promise<string | null> {
  const waitingPhoto = receiptQueue.picture(id);
  if (waitingPhoto) return waitingPhoto;
  const known = receipts.get(id);
  if (known) { remember(id, known); return known; }
  const url = await withTimeout(load(id), 30000);
  if (url == null && !isOnline()) throw Object.assign(new Error('offline'), { code: 'timeout' });
  if (!url || !SHOWN.test(url)) return null;
  remember(id, url);
  return url;
}
const isOnline = () => net.value.online && (typeof navigator === 'undefined' || navigator.onLine !== false);

/** an address to open the picture full size, made before the tap (Safari blocks a window opened after a wait).
    The kind is the one checked here, never the one stored. null for anything that is not a plain picture. */
export function openableUrl(dataUrl: string | null | undefined): string | null {
  const m = dataUrl ? OPENED.exec(dataUrl) : null;
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: m[1] }));
  } catch (e) {
    console.warn('receipt: not opened full size', e);
    return null;
  }
}
