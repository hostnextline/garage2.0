import { describe, it, expect } from 'vitest';
import { loadTesseract } from './ocr';

const script = () => document.head.querySelector('script[src*="tesseract"]') as HTMLScriptElement | null;

describe('the receipt reader’s script (x-security-15, 28)', () => {
  it('is asked with its exact content (integrity) and without cookies; a refused script fails calmly and is removed', async () => {
    const p = loadTesseract(5000);
    const s = script()!;
    expect(s.integrity).toMatch(/^sha384-/);
    expect(s.crossOrigin).toBe('anonymous');
    expect(s.src).toContain('tesseract.js@5.1.1');
    s.onerror?.(new Event('error'));
    await expect(p).rejects.toMatchObject({ code: 'reader' });
    expect(script()).toBeNull();
  });
  it('gives up after its time limit, and a later call tries again', async () => {
    await expect(loadTesseract(10)).rejects.toMatchObject({ code: 'reader' });
    const again = loadTesseract(10);
    expect(script()).not.toBeNull();
    await expect(again).rejects.toMatchObject({ code: 'reader' });
  });
});
