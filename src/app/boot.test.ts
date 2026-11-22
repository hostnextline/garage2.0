import { describe, it, expect } from 'vitest';
import { runBoot, wantsDemo, type BootSteps } from './boot';
import { linkTarget } from './links';
import { readNet, refusalText } from './netView';
import { lang, t } from '../lib/i18n';

const steps = (o: Partial<BootSteps> = {}): BootSteps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls, demo: false,
    startDemo: async () => { calls.push('demo'); },
    finishOAuth: async () => { calls.push('oauth'); return true; },
    startAuth: async () => { calls.push('auth'); },
    startPwa: async () => { calls.push('pwa'); },
    report: () => { calls.push('report'); },
    failed: () => { calls.push('failed'); },
    ...o
  };
};

describe('the start of the app', () => {
  it('back from Google: the session watcher starts too (old logic skipped startAuth after a Google sign-in)', async () => {
    const s = steps();
    await runBoot(s);
    expect(s.calls).toEqual(['oauth', 'auth', 'pwa']);
  });
  it('a start that throws says « Recharger » instead of a splash for ever, and is reported', async () => {
    const s = steps({ startAuth: async () => { throw new Error('idb blocked'); } });
    await runBoot(s);
    expect(s.calls).toEqual(['oauth', 'report', 'failed']);
  });
  it('a failed Google exchange still starts the session; the demo starts alone', async () => {
    const s = steps({ finishOAuth: async () => { throw new Error('bad code'); } });
    await runBoot(s);
    expect(s.calls).toEqual(['report', 'auth', 'pwa']);
    const d = steps({ demo: true });
    await runBoot(d);
    expect(d.calls).toEqual(['demo', 'pwa']);
  });
  it('« ?demo » is found before or after the « # »', () => {
    expect(wantsDemo('?demo', '')).toBe(true);
    expect(wantsDemo('', '#/book?demo=office')).toBe(true);
    expect(wantsDemo('?x=1', '#/book')).toBe(false);
  });
});

describe('internal links', () => {
  const a = (attrs: Record<string, string>) => { const el = document.createElement('a'); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); const s = document.createElement('span'); el.appendChild(s); return s; };
  const ev = (target: Element, o: Partial<MouseEvent> = {}) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target, ...o }) as MouseEvent;
  it('a plain click on #/… is a step of the app', () => {
    expect(linkTarget(ev(a({ href: '#/job/1' })))).toBe('/job/1');
  });
  it('modifier keys, another window, a download, an outside link or a handled click are left to the browser', () => {
    expect(linkTarget(ev(a({ href: '#/job/1' }), { ctrlKey: true }))).toBeNull();
    expect(linkTarget(ev(a({ href: '#/job/1', target: '_blank' })))).toBeNull();
    expect(linkTarget(ev(a({ href: '#/x', download: '' })))).toBeNull();
    expect(linkTarget(ev(a({ href: 'https://x.ca' })))).toBeNull();
    expect(linkTarget(ev(a({ href: '#/job/1' }), { defaultPrevented: true }))).toBeNull();
  });
});

describe('the connection as the frame shows it', () => {
  const base = { online: true, realtime: true, pending: 0, failed: [], sending: false, lastPull: null, ready: true, storageBroken: false };
  it('a refused change makes the chip say so (old logic: « Tout est envoyé », a green check)', () => {
    expect(readNet({ ...base, failed: [{}] }).chip).toBe('failed');
    expect(readNet(base).chip).toBe('synced');
    expect(readNet({ ...base, pending: 2, sending: true }).chip).toBe('sending');
  });
  it('the phone’s own « offline » counts at once', () => {
    expect(readNet(base, false).chip).toBe('offline');
  });
  it('reads the data layer’s newer fields when they are there, and nothing breaks without them', () => {
    expect(readNet({ ...base, session: 'lost', storage: 'memory', stuck: [1, 2] })).toMatchObject({ sessionLost: true, storageLost: true, stuck: 2 });
    expect(readNet({ ...base, storageBroken: true }).storageLost).toBe(true);
    expect(readNet(base)).toMatchObject({ sessionLost: false, storageLost: false, stuck: 0 });
    expect(readNet(null).chip).toBe('synced');
  });
  it('a refusal in the person’s language when its code is kept; the separator follows the language', () => {
    lang.value = 'en';
    expect(refusalText({ label: 'Booking', error: 'raw' })).toBe('Booking: raw');
    // a rights refusal kept with its code: plain words, never the database's sentence
    expect(refusalText({ label: 'Booking', error: 'new row violates row-level security policy', code: '42501' })).toBe(`Booking: ${t('common.notAllowed')}`);
    lang.value = 'fr';
    expect(refusalText({ label: 'Réservation', error: 'raison' })).toBe('Réservation : raison');
    expect(refusalText({ error: 'raison' })).toBe('raison');
  });
});
