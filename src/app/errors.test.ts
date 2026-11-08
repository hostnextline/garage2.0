import { describe, it, expect } from 'vitest';
import { describe as line, shortAgent, ignorable } from './errors';

describe('an error in one line', () => {
  it('names the kind and the message of an Error, cut short', () => {
    expect(line(new TypeError('x is not a function'))).toBe('TypeError: x is not a function');
    expect(line('plain text')).toBe('plain text');
    expect(line({ code: 'PGRST301', message: 'JWT expired' })).toBe('{"code":"PGRST301","message":"JWT expired"}');
    expect(line(new Error('a'.repeat(900))).length).toBe(500);
  });
  it('tells the phone and its browser in a few words', () => {
    expect(shortAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe('iOS Safari 17');
    expect(shortAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1')).toBe('iOS Chrome 126');
    expect(shortAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36')).toBe('Android Chrome 126');
    expect(shortAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0')).toBe('Windows Edge 126');
    expect(shortAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0')).toBe('macOS Firefox 127');
  });
  it('leaves the network and the update of the app alone (the app says those itself)', () => {
    expect(ignorable('TypeError: Failed to fetch')).toBe(true);
    expect(ignorable('TypeError: Load failed')).toBe(true);
    expect(ignorable('TypeError: Failed to fetch dynamically imported module: https://…/assets/map-1.js')).toBe(true);
    expect(ignorable('TypeError: x is not a function')).toBe(false);
    expect(ignorable("CSP: script-src-elem ← https://evil.example")).toBe(false);
  });
});
