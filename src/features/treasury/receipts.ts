/* Receipt photos: sending them, and showing them again.

   A photo (300 to 700 KB) no longer waits in the phone's ordered outbox. There it was sent before everything queued
   after it, with 15 s per try: on a weak uplink it never passed, and the expense, the job steps and the payments behind
   it stayed on the phone (bug 02). Now:
   - each photo has its id from the moment it is taken, used by the first try and by every retry: a try whose answer
     was lost and that did land is found again (duplicate key), never stored twice;
   - a try is really stopped (abort) after a time that grows with the photo, and one photo is sent at a time;
   - when the photo cannot go, the expense is saved WITHOUT it (expenses.receipt_id must name a photo already on the
     server) and goes at once; the photo waits here, on the phone (Cache Storage, per person), is tried again later and
     when the signal comes back, and then the expense is given its receipt_id.
   Pictures read from the server are kept for the session (a few only), and only real pictures are shown: a receipt
   stored as anything else (an SVG with a script, an HTML page) is never opened as a document of the app. */
import { t } from '../../lib/i18n';
import { Refused } from '../../lib/errors';
import { sb, preview } from '../../data/auth';
import { loadAttachment, errorMessage } from '../../data/api';
import { currentUid, isNetworkError, net, updateRow } from '../../data/sync';
import { getRow } from '../../data/store';
import type { Expense } from '../../data/types';
import { toast } from '../../ui';
import { withTimeout } from '../../shared/charts/useReport';
import type { Photo } from '../../shared/export/ocr';

/** a photo with the id it will have on the server */
export interface ReceiptPhoto extends Photo { id: string }
export interface WaitingPhoto extends ReceiptPhoto { uid: string; expenseId: string }

export interface QueueDeps {
  upload: (p: ReceiptPhoto, signal: AbortSignal) => Promise<void>;
  /** the photo is on the server: the expense may now name it */
  link: (expenseId: string, receiptId: string) => void;
  /** a photo the server will never take (a refusal, not the network) */
  refused: (e: unknown) => void;
  keep: { put: (p: WaitingPhoto) => Promise<void>; remove: (id: string) => Promise<void>; all: () => Promise<WaitingPhoto[]> };
  uid: () => string;
}
/** how long one try may take: 20 s, plus the time to send the photo at about 64 kbit/s */
export const tryTimeout = (dataUrl: string) => 20000 + Math.round(dataUrl.length / 8);
/** waits between the tries of the waiting photos (the signal coming back tries at once) */
export const RETRY_MS = [10000, 30000, 60000, 120000, 300000, 600000];

export function createReceiptQueue(deps: QueueDeps) {
  const waiting = new Map<string, WaitingPhoto>();
  const sending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let draining = false;
  let failures = 0;

  async function tryOnce(p: ReceiptPhoto): Promise<void> {
    const ctl = new AbortController();
    const stop = setTimeout(() => ctl.abort(), tryTimeout(p.dataUrl));
    sending.add(p.id);
    try { await deps.upload(p, ctl.signal); } finally { clearTimeout(stop); sending.delete(p.id); }
  }
  function schedule() {
    if (timer || !waiting.size) return;
    timer = setTimeout(() => { timer = null; void drain(); }, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
  }
  async function forget(id: string) {
    waiting.delete(id);
    await deps.keep.remove(id).catch((e) => console.warn('receipt: not removed from the phone', e));
  }
  /** sends the photos waiting, one after the other; stops at the first network failure and tries again later */
  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    if (timer) { clearTimeout(timer); timer = null; }
    try {
      for (const p of [...waiting.values()]) {
        if (p.uid !== deps.uid() || sending.has(p.id) || !waiting.has(p.id)) continue;
        try {
          await tryOnce(p);
        } catch (e) {
          if (isNetworkError(e)) { failures++; break; }
          await forget(p.id);
          deps.refused(e);
          continue;
        }
        failures = 0;
        await forget(p.id);
        deps.link(p.expenseId, p.id);
      }
    } finally {
      draining = false;
      schedule();
    }
  }

  return {
    /** sends the photo of `expenseId` now; with no signal it waits on the phone (queued: true) and the expense is
        saved without it. A refusal (rights, preview) throws: the person is told and nothing is saved. */
    async send(p: ReceiptPhoto, expenseId: string): Promise<{ id: string; queued: boolean }> {
      if (waiting.has(p.id)) { waiting.set(p.id, { ...waiting.get(p.id)!, expenseId }); return { id: p.id, queued: true }; }
      try {
        await tryOnce(p);
        return { id: p.id, queued: false };
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        const w: WaitingPhoto = { ...p, uid: deps.uid(), expenseId };
        waiting.set(p.id, w);
        await deps.keep.put(w).catch((err) => console.warn('receipt: kept in memory only', err));
        schedule();
        return { id: p.id, queued: true };
      }
    },
    /** the picture of a photo still waiting (the person sees it in the expense) */
    picture(id: string): string | null { return waiting.get(id)?.dataUrl ?? null; },
    /** the photo waiting for this expense, if any */
    waitingFor(expenseId: string): WaitingPhoto | null {
      for (const p of waiting.values()) if (p.expenseId === expenseId) return p;
      return null;
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

/** the picture of a receipt, or null when there is none (or it is not a picture). Throws when the network is
    missing, so the person reads « needs the network » rather than « no longer available ». */
export async function receiptImage(id: string, load: (id: string) => Promise<string | null> = loadAttachment): Promise<string | null> {
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
