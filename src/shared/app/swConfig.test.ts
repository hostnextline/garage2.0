/* The installed app's offline copy (vite.config.ts, the service worker): what every phone keeps, and when.
   - every screen's code is kept, and the worker takes the page at its first install (« No signal »: a screen never
     opened yet opens with no signal; live waited for the next start);
   - the iPhone VIN barcode reader (zxing .wasm, 1.09 MB) is NOT in that copy: as on live, it comes the first time a VIN
     is scanned and is kept from then on (fluidite-04). */
import { describe, it, expect } from 'vitest';

// read from the disk (the test runner cannot import the build's config)
const disk = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync: (p: URL, enc: 'utf8') => string };
const here = import.meta.url.replace(/[^/]*$/, '');
const config = disk.readFileSync(new URL(here + '../../../vite.config.ts'), 'utf8');
const code = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the offline copy of the app', () => {
  it('keeps every screen (js, css, html…) but not the .wasm barcode reader', () => {
    const m = /globPatterns:\s*\[([^\]]*)\]/.exec(code);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/\bjs\b/);
    expect(m![1]).toMatch(/\bcss\b/);
    expect(m![1]).not.toMatch(/wasm/);
  });
  it('the barcode reader is kept once fetched (CacheFirst, its own cache, as on live)', () => {
    const rule = /urlPattern:[^\n]*\.wasm[\s\S]*?handler:\s*'([A-Za-z]+)'[\s\S]*?cacheName:\s*'([^']+)'/.exec(code);
    expect(rule).not.toBeNull();
    expect(rule![1]).toBe('CacheFirst');
    expect(rule![2]).toBe('outils-garage');
  });
  it('takes the page at its first install, and never skips the wait of an update', () => {
    expect(code).toMatch(/clientsClaim:\s*true/);
    expect(code).not.toMatch(/skipWaiting:\s*true/);
    expect(code).toMatch(/registerType:\s*'prompt'/);
  });
});
