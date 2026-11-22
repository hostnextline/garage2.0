/* The dev demo NEVER has TomTom's key, whatever the shell or a .env file gives (lib/config.ts TOMTOM_KEY, read once when the
   app loads): it would spend the garage's TomTom transactions on pretend data. The module itself is loaded again with the
   key in the build and the demo in the address (review-settings R12, mutation M28: config.ts passing `false` instead of
   import.meta.env.DEV left every test green, only the pure tomtomKeyFor was tested). */
import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); history.replaceState(null, '', '/'); vi.resetModules(); });
/** TOMTOM_KEY as the app reads it, opened at that address, built with a key (dev: the dev server; false: a production build) */
async function keyAt(address: string, dev: boolean): Promise<string> {
  history.replaceState(null, '', '/' + address);
  vi.stubEnv('VITE_TOMTOM_KEY', 'tt-shell-key');
  vi.stubEnv('DEV', dev);
  vi.resetModules();
  return (await import('../lib/config')).TOMTOM_KEY;
}

describe('the demo and TomTom’s key', () => {
  it('the dev demo (?demo, or in the hash’s query) has no key; the dev app without the demo and a production build keep it', async () => {
    expect(await keyAt('?demo=owner', true)).toBe('');
    expect(await keyAt('?demo=office&tomtom=nokey', true)).toBe('');
    expect(await keyAt('#/book?demo=office', true)).toBe('');
    expect(await keyAt('', true)).toBe('tt-shell-key');
    expect(await keyAt('?demolition', true)).toBe('tt-shell-key');
    expect(await keyAt('?demo', false)).toBe('tt-shell-key');
  });
});
