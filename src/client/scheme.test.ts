/* Printing the invoice from a dark phone (client-page-24): the paper gets the light inks, the screen gets its dark back. */
import { describe, it, expect, vi } from 'vitest';
import { followScheme } from './scheme';

describe('light or dark', () => {
  it('prints in light mode from a dark phone, then goes back to dark', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined }));
    followScheme();
    const root = document.documentElement;
    expect(root.dataset.theme).toBe('his');
    expect(root.dataset.mode).toBe('dark');
    window.dispatchEvent(new Event('beforeprint'));
    expect(root.dataset.mode).toBe('light');
    window.dispatchEvent(new Event('afterprint'));
    expect(root.dataset.mode).toBe('dark');
    vi.unstubAllGlobals();
  });
});
