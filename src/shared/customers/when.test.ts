/* When a customer's appointment is, in words, with an explicit day of today (`now`). */
import { describe, it, expect, beforeAll } from 'vitest';
import { lang } from '../../lib/i18n';
import { whenText, nextLine, lastLine } from './when';

beforeAll(() => { lang.value = 'fr'; });

const NOW = '2026-11-16';

describe('whenText', () => {
  it('today and tomorrow by block', () => {
    expect(whenText('2026-11-16', 'am', null, NOW)).toBe('Ce matin');
    expect(whenText('2026-11-16', 'eve', null, NOW)).toBe('Ce soir');
    expect(whenText('2026-11-17', 'pm', null, NOW)).toBe('Demain après-midi');
  });
  it('another day: the day, then the block', () => {
    const w = whenText('2026-11-27', 'am', null, NOW);
    expect(w.endsWith(', matin')).toBe(true);
    expect(w).not.toContain('Demain');
  });
  it('a job booked by arrival window shows the window told to the customer', () => {
    const w = whenText('2026-11-20', 'day', { win_start: 840, win_end: 1080 }, NOW);
    expect(w).toContain('14');
    expect(w).toContain('18');
  });
});

describe('nextLine and lastLine', () => {
  it('today, tomorrow, another day', () => {
    expect(nextLine('2026-11-16', 'pm', null, NOW)).toBe('Rendez-vous cet après-midi');
    expect(nextLine('2026-11-17', 'am', null, NOW)).toBe('Rendez-vous demain matin');
    const other = nextLine('2026-11-27', 'eve', null, NOW);
    expect(other.startsWith('Rendez-vous le ')).toBe(true);
    expect(other.endsWith(', soir')).toBe(true);
  });
  it('by arrival window: « Rendez-vous le … » only further than tomorrow', () => {
    expect(nextLine('2026-11-17', 'day', { win_start: 840, win_end: 1080 }, NOW).startsWith('Rendez-vous le ')).toBe(false);
    expect(nextLine('2026-11-27', 'day', { win_start: 840, win_end: 1080 }, NOW).startsWith('Rendez-vous le ')).toBe(true);
  });
  it('« Dernière visite : … »', () => {
    expect(lastLine('2026-04-06').startsWith('Dernière visite : ')).toBe(true);
  });
});
