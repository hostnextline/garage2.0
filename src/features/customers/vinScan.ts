/* Reading a VIN with the phone, on every phone (iPhone, Android, computer with a camera):
   - the barcode of the door-jamb sticker (Code 39 / Code 128 / Data Matrix / QR), live in the camera. The phone's own
     barcode reader when it has one (Android), else ZXing in WebAssembly (our own file, loaded the first time, then kept);
   - the printed VIN (windshield plate, registration, insurance card) from a photo, read by tesseract.js. OCR mixes up
     letters and digits: the VIN's check digit picks the right reading. */
import { vinCheck } from '../../lib/text';
import { vinFromCode } from './vehicleText';
import { loadTesseract, shrinkPhoto } from '../treasury/ocr';

export const FORMATS = ['code_39', 'code_128', 'data_matrix', 'qr_code', 'pdf417'] as const;
export interface Detected { rawValue: string }
export interface Detector { detect(src: ImageBitmapSource | ImageData): Promise<Detected[]> }
interface DetectorClass { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> }
const nativeClass = (): DetectorClass | null => (typeof globalThis !== 'undefined' && (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector) || null;

/** the phone has a camera the page may use */
export function hasCamera(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

let detectorP: Promise<{ detector: Detector; native: boolean }> | null = null;
/** the barcode reader: the phone's own when it reads VIN barcodes, else ZXing (WebAssembly) */
export function barcodeReader(): Promise<{ detector: Detector; native: boolean }> {
  if (detectorP) return detectorP;
  detectorP = (async () => {
    const Native = nativeClass();
    if (Native) {
      try {
        const have = await Native.getSupportedFormats();
        const formats = FORMATS.filter((f) => have.includes(f));
        if (formats.includes('code_39') || formats.includes('data_matrix')) return { detector: new Native({ formats }), native: true };
      } catch { /* use ZXing */ }
    }
    const [{ BarcodeDetector, prepareZXingModule }, wasm] = await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url')
    ]);
    const url = (wasm as { default: string }).default;
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? url : prefix + path) }, fireImmediately: false });
    return { detector: new BarcodeDetector({ formats: [...FORMATS] }) as unknown as Detector, native: false };
  })();
  detectorP.catch(() => { detectorP = null; });
  return detectorP;
}

/* ---------- the printed VIN (OCR) ---------- */
const LEGAL = /^[A-HJ-NPR-Z0-9]$/;
/** OCR letters a VIN never has: O and Q are 0, I is 1 */
const FIX: Record<string, string> = { O: '0', Q: '0', I: '1' };
/** look-alikes OCR swaps: tried when the check digit says the reading is wrong */
const SWAP: Record<string, string[]> = {
  '0': ['D', '8'], D: ['0'], '1': ['L', 'T', '7'], L: ['1'], T: ['1', '7'], '7': ['T', '1'], '5': ['S'], S: ['5'], '8': ['B', '0'], B: ['8'],
  '2': ['Z'], Z: ['2'], '6': ['G'], G: ['6'], U: ['V'], V: ['U'], '4': ['A'], A: ['4'], '3': ['8'], M: ['N'], N: ['M'], K: ['X'], X: ['K']
};
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';
/** how much a 17-character reading looks like a real VIN (the check digit counts most) */
export function vinScore(v: string): number {
  let s = 0;
  if (vinCheck(v) === 'ok') s += 10;
  if (YEAR_CODES.includes(v[9])) s += 2;
  if (/^\d{4}$/.test(v.slice(13))) s += 2;
  if (/[1-5JKLSVWYZ39]/.test(v[0])) s += 1;
  if (/[A-Z]/.test(v.slice(0, 3)) || /^\d[A-Z]/.test(v)) s += 1;
  return s;
}
/** every 17-character window of a line of text, with O/Q/I fixed */
function windows(line: string): string[] {
  const s = line.toUpperCase().replace(/[^A-Z0-9]/g, '').split('').map((c) => FIX[c] || c).join('');
  const out: string[] = [];
  for (let i = 0; i + 17 <= s.length; i++) {
    const w = s.slice(i, i + 17);
    if (w.split('').every((c) => LEGAL.test(c))) out.push(w);
  }
  return out;
}
/** the same reading with one or two look-alike characters changed, so its check digit matches */
function repaired(w: string): string | null {
  const spots = w.split('').map((c, i) => (SWAP[c] ? i : -1)).filter((i) => i >= 0);
  const found = new Set<string>();
  for (const i of spots) {
    for (const a of SWAP[w[i]]) {
      const one = w.slice(0, i) + a + w.slice(i + 1);
      if (vinCheck(one) === 'ok') found.add(one);
    }
  }
  if (found.size === 1) return [...found][0];
  if (found.size > 1) return [...found].sort((a, b) => vinScore(b) - vinScore(a))[0];
  if (spots.length > 12) return null;
  for (let x = 0; x < spots.length; x++) for (let y = x + 1; y < spots.length; y++) {
    const i = spots[x], j = spots[y];
    for (const a of SWAP[w[i]]) for (const b of SWAP[w[j]]) {
      const two = w.slice(0, i) + a + w.slice(i + 1, j) + b + w.slice(j + 1);
      if (vinCheck(two) === 'ok') found.add(two);
    }
  }
  return found.size ? [...found].sort((a, b) => vinScore(b) - vinScore(a))[0] : null;
}
/** the VIN in the text read from a photo: ok when its check digit matches (a car from outside North America may not have one) */
export function findVin(text: string): { vin: string; ok: boolean } | null {
  const lines = String(text || '').split(/\r?\n/);
  // a VIN cut in two by the reader (« 1HGCM826 33A004352 ») is found once the spaces are gone; two lines glued too
  const sources = [...lines, ...lines.slice(1).map((l, i) => lines[i] + l)];
  const read = sources.flatMap(windows);
  const pick = (list: string[]) => list.reduce<string | null>((b, v) => (b == null || vinScore(v) > vinScore(b) ? v : b), null);
  const direct = pick(read);
  if (direct && vinCheck(direct) === 'ok') return { vin: direct, ok: true };
  const fixed = pick(read.map(repaired).filter((x): x is string => !!x));
  if (fixed) return { vin: fixed, ok: true };
  return direct ? { vin: direct, ok: false } : null;
}

export interface VinReading { cancel: () => void; result: Promise<{ vin: string; ok: boolean } | null> }
/** reads the VIN printed in a photo; `onProgress(0..1)` while it works */
export function readVinPhoto(file: Blob, onProgress: (p: number) => void, timeoutMs = 90000): VinReading {
  let stopped = false;
  let worker: { terminate(): Promise<unknown> } | null = null;
  const stop = () => { const w = worker; worker = null; if (w) void w.terminate().catch(() => undefined); };
  const result = (async () => {
    const timer = setTimeout(() => { stopped = true; stop(); }, timeoutMs);
    try {
      onProgress(0.02);
      const photo = await shrinkPhoto(file, 2000, 0.9);
      const T = await loadTesseract();
      if (stopped) return null;
      const w = await T.createWorker('eng', 1, {
        logger: (m) => { if (!stopped && m.status === 'recognizing text') onProgress(0.3 + 0.7 * Math.max(0, Math.min(1, Number(m.progress) || 0))); },
        errorHandler: () => undefined
      }) as unknown as { recognize(i: string): Promise<{ data: { text: string } }>; setParameters?(p: Record<string, string>): Promise<unknown>; terminate(): Promise<unknown> };
      worker = w;
      if (stopped) { stop(); return null; }
      onProgress(0.3);
      await w.setParameters?.({ tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789OQI ' }).catch(() => undefined);
      const out = await w.recognize(photo.dataUrl);
      stop();
      if (stopped) return null;
      return findVin(String(out?.data?.text || ''));
    } finally {
      clearTimeout(timer);
    }
  })();
  return { result, cancel: () => { stopped = true; stop(); } };
}

/** the VIN in what a barcode reader saw (re-exported for the camera sheet) */
export { vinFromCode };
