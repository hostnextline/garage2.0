/* The receipt photo: shrunk on the phone (1600 px at most, JPEG 0.8) before it is sent, then read by tesseract.js
   (French and English), loaded from jsDelivr only the first time a receipt is read and kept by the service worker.
   Everything here can fail (no signal, an old phone, a blocked script): the caller then lets the person type. */

export interface Photo { dataUrl: string; w: number; h: number }

/** shrinks a photo to `max` px on its long side, as a JPEG data URL (white behind transparent images) */
export async function shrinkPhoto(file: Blob, max = 1600, quality = 0.8): Promise<Photo> {
  let src: CanvasImageSource | null = null, w = 0, h = 0, close = () => {};
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
      src = b; w = b.width; h = b.height; close = () => b.close();
    } catch { src = null; }
  }
  if (!src) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      src = img; w = img.naturalWidth; h = img.naturalHeight;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  if (!w || !h) throw new Error('empty image');
  const k = Math.min(1, max / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw, ch);
  close();
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('no jpeg');
  return { dataUrl, w: cw, h: ch };
}

/* ---------- tesseract.js, from the CDN, only when needed ---------- */
export const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
interface LoggerMessage { status: string; progress: number }
interface TWorker { recognize(image: string): Promise<{ data: { text: string } }>; terminate(): Promise<unknown> }
interface TesseractLib { createWorker(langs: string | string[], oem?: number, options?: { logger?: (m: LoggerMessage) => void; errorHandler?: (e: unknown) => void }): Promise<TWorker> }

let loading: Promise<TesseractLib> | null = null;
function lib(): TesseractLib | null {
  const t = (globalThis as { Tesseract?: TesseractLib }).Tesseract;
  return t && typeof t.createWorker === 'function' ? t : null;
}
export function loadTesseract(timeoutMs = 25000): Promise<TesseractLib> {
  const ready = lib();
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  loading = new Promise<TesseractLib>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.async = true;
    s.crossOrigin = 'anonymous';
    let done = false;
    const fail = (why: string) => {
      if (done) return;
      done = true; clearTimeout(timer); s.remove(); loading = null;
      reject(Object.assign(new Error(`receipt reader: ${why}`), { code: 'reader' }));
    };
    const timer = setTimeout(() => fail('timeout'), timeoutMs);
    s.onload = () => {
      if (done) return;
      const t = lib();
      if (!t) { fail('missing'); return; }
      done = true; clearTimeout(timer); resolve(t);
    };
    s.onerror = () => fail('load');
    document.head.appendChild(s);
  });
  return loading;
}

export interface Reading { cancel: () => void; result: Promise<string> }
/** reads the text of a receipt; `onProgress(0..1, stage)` while it works; `cancel()` stops it (result rejects) */
export function readReceipt(image: string, onProgress: (p: number, stage: 'load' | 'read') => void, timeoutMs = 120000): Reading {
  let worker: TWorker | null = null;
  let stopped = false;
  let rejectNow: (e: Error) => void = () => {};
  const stop = () => { const w = worker; worker = null; if (w) void w.terminate().catch(() => undefined); };
  const result = new Promise<string>((resolve, reject) => {
    rejectNow = (e) => { stop(); reject(e); };
    const timer = setTimeout(() => rejectNow(Object.assign(new Error('receipt reader: timeout'), { code: 'reader' })), timeoutMs);
    (async () => {
      await Promise.resolve();   // the caller has its handle before the first progress
      onProgress(0, 'load');
      const T = await loadTesseract();
      if (stopped) return;
      const w = await T.createWorker(['fra', 'eng'], 1, {
        logger: (m) => { if (!stopped) onProgress(Math.max(0, Math.min(1, Number(m.progress) || 0)), m.status === 'recognizing text' ? 'read' : 'load'); },
        errorHandler: () => undefined
      });
      if (stopped) { void w.terminate().catch(() => undefined); return; }
      worker = w;
      const out = await w.recognize(image);
      clearTimeout(timer);
      stop();
      if (!stopped) resolve(String(out?.data?.text || ''));
    })().catch((e) => { clearTimeout(timer); if (!stopped) rejectNow(e instanceof Error ? e : new Error(String(e))); });
  });
  return {
    result,
    cancel: () => { if (stopped) return; stopped = true; rejectNow(Object.assign(new Error('stopped'), { code: 'stopped' })); }
  };
}
