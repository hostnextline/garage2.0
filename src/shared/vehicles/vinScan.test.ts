/* The photo reader always ends (customers-b-16, x-errors-30), and says when it could not be loaded (customers-b-09). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ocr = vi.hoisted(() => ({ load: vi.fn(), terminate: vi.fn(async () => undefined), recognize: vi.fn() }));
vi.mock('../export/ocr', () => ({
  shrinkPhoto: async () => ({ dataUrl: 'data:image/jpeg;base64,', w: 1, h: 1 }),
  loadTesseract: ocr.load
}));
import { readVinPhoto, ReaderUnavailable } from './vinScan';

const photo = new Blob(['x'], { type: 'image/jpeg' });
beforeEach(() => {
  ocr.terminate.mockClear();
  ocr.recognize.mockReset();
  ocr.load.mockReset().mockResolvedValue({ createWorker: async () => ({ recognize: ocr.recognize, terminate: ocr.terminate }) });
});

describe('reading the VIN in a photo', () => {
  it('reads the text and finds the VIN', async () => {
    ocr.recognize.mockResolvedValue({ data: { text: 'VIN 1HGCM82633A004352' } });
    expect(await readVinPhoto(photo, () => undefined).result).toEqual({ vin: '1HGCM82633A004352', ok: true });
    expect(ocr.terminate).toHaveBeenCalled();
  });
  it('a reading that never answers ends at its time limit, with nothing', async () => {
    ocr.recognize.mockReturnValue(new Promise(() => undefined));
    expect(await readVinPhoto(photo, () => undefined, 30).result).toBeNull();
    expect(ocr.terminate).toHaveBeenCalled();
  });
  it('cancelled: ends at once, with nothing', async () => {
    ocr.recognize.mockReturnValue(new Promise(() => undefined));
    const r = readVinPhoto(photo, () => undefined);
    await new Promise((done) => setTimeout(done, 5));
    r.cancel();
    expect(await r.result).toBeNull();
  });
  it('the reader not downloadable: says so', async () => {
    ocr.load.mockRejectedValue(new Error('cdn'));
    await expect(readVinPhoto(photo, () => undefined).result).rejects.toBeInstanceOf(ReaderUnavailable);
  });
});
