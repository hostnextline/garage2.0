import { describe, it, expect } from 'vitest';
import { HOME_URL, movedTo } from './config';
import linksSource from '../../supabase/functions/_shared/links.ts?raw';

describe('where the app lives', () => {
  it('its home is on Vercel, at the root of its own address', () => {
    expect(HOME_URL).toBe('https://mecanique-mobile-his.vercel.app/');
  });
  it('the old address (GitHub Pages) knows where the app moved', () => {
    expect(movedTo('https://hostnextline.github.io/garage2.0/')).toBe(HOME_URL);
    expect(movedTo('https://hostnextline.github.io/garage2.0/client.html#t=abc')).toBe(HOME_URL);
    expect(movedTo('https://HostNextLine.GitHub.io/garage2.0/#/today')).toBe(HOME_URL);
  });
  it('everywhere else, nothing moved', () => {
    expect(movedTo(HOME_URL)).toBeNull();
    expect(movedTo('http://127.0.0.1:4173/')).toBeNull();
    expect(movedTo('https://github.io.example.com/')).toBeNull();
    expect(movedTo('https://notgithub.io/')).toBeNull();
    expect(movedTo('pas une adresse')).toBeNull();
  });
  it('the server sends links to the same home (first allowed address)', () => {
    const m = /DEFAULT_BASES\s*=\s*\[\s*'([^']+)'/.exec(linksSource);
    expect(m?.[1]).toBe(HOME_URL);
    expect(linksSource).not.toContain('github.io/garage2.0');
  });
});
