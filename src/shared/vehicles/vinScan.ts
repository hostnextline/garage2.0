/* Reading a VIN with the phone, on every phone (iPhone, Android, computer with a camera):
   - the barcode of the door-jamb sticker (Code 39 / Code 128 / Data Matrix / QR), live in the camera. The phone's own
     barcode reader when it has one (Android), else ZXing in WebAssembly (our own file, loaded the first time, then kept);
   - the printed VIN (windshield plate, registration, insurance card) from a photo, read by tesseract.js.
   What counts as a VIN in what was read is decided in domain/vehicles/vinRead.ts. */
import { findVin, type VinRead } from '../../domain/vehicles/vinRead';
import { loadTesseract, shrinkPhoto } from '../export/ocr';

const FORMATS = ['code_39', 'code_128', 'data_matrix', 'qr_code', 'pdf417'] as const;
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
      } catch { /* the phone's reader cannot say what it reads: ZXing below */ }
    }
    const [{ BarcodeDetector, prepareZXingModule }, wasm] = await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url')
    ]);
    const url = (wasm as { default: string }).default;
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? url : prefix + path) }, fireImmediately: false });
    return { detector: new BarcodeDetector({ formats: [...FORMATS] }) as unknown as Detector, native: false };
  })();
  // a failed load (no signal the first time) is tried again next time, not kept
  detectorP.catch(() => { detectorP = null; });
  return detectorP;
}

/* ---------- the printed VIN (OCR) ---------- */
/** the photo reader itself could not be loaded (tesseract.js and its language come from the network the first time):
    the sheet says so, instead of « no VIN in the photo », which sent the mechanic retaking photos for nothing */
export class ReaderUnavailable extends Error {
  constructor(cause?: unknown) { super('vin-reader-unavailable'); this.name = 'ReaderUnavailable'; this.cause = cause; }
}
interface OcrWorker { recognize(i: string): Promise<{ data: { text: string } }>; setParameters?(p: Record<string, string>): Promise<unknown>; terminate(): Promise<unknown> }

export interface VinReading { cancel: () => void; result: Promise<VinRead | null> }
/** reads the VIN printed in a photo; `onProgress(0..1)` while it works. The result always settles: null when nothing
    was read, when cancelled, or after `timeoutMs` (a terminated tesseract job may never answer: the sheet stayed on
    « Lecture… » for ever, customers-b-16); rejects with ReaderUnavailable when the reader could not be loaded. */
export function readVinPhoto(file: Blob, onProgress: (p: number) => void, timeoutMs = 90000): VinReading {
  let stopped = false;
  let worker: OcrWorker | null = null;
  let halt: (v: null) => void = () => undefined;
  const halted = new Promise<null>((done) => { halt = done; });
  const stopWorker = () => { const w = worker; worker = null; if (w) void w.terminate().catch(() => undefined); };
  const cancel = () => { stopped = true; stopWorker(); halt(null); };

  const work = (async (): Promise<VinRead | null> => {
    onProgress(0.02);
    const photo = await shrinkPhoto(file, 2000, 0.9);
    let w: OcrWorker;
    try {
      const T = await loadTesseract();
      if (stopped) return null;
      w = await T.createWorker('eng', 1, {
        logger: (m) => { if (!stopped && m.status === 'recognizing text') onProgress(0.3 + 0.7 * Math.max(0, Math.min(1, Number(m.progress) || 0))); },
        errorHandler: () => undefined
      }) as unknown as OcrWorker;
    } catch (e) {
      throw new ReaderUnavailable(e);
    }
    worker = w;
    if (stopped) { stopWorker(); return null; }
    onProgress(0.3);
    // a VIN never has I, O, Q: they are still allowed here because OCR reads 0 as O, and vinRead fixes them
    await w.setParameters?.({ tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789OQI ' }).catch(() => undefined);
    const out = await w.recognize(photo.dataUrl);
    return stopped ? null : findVin(String(out?.data?.text || ''));
  })();

  const timer = setTimeout(cancel, timeoutMs);
  const result = Promise.race([work, halted]).finally(() => { clearTimeout(timer); stopWorker(); });
  return { result, cancel };
}
