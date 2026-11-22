/* « N clients n'ont pas leur nouvelle heure » (Part 28, REARRANGE.md §3.2, U7): the agenda's day line (ToldBanner) and
   Aujourd'hui's ONE line of every coming day (ToldDays, the lead's addition to days F3), from the phone's own copy.
   The send list itself is pretended (openTell). Real store rows; Montréal's clock fixed. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const opened = vi.hoisted(() => [] as string[]);
vi.mock('./TellHost', () => ({ openTell: (day: string) => { opened.push(day); } }));
import { ToldBanner, ToldDays, dayChipWord } from './ToldBanner';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

const owner = { id: 'u1', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const office = { id: 'u2', owner: false, roles: ['office'], rights: { book: true }, trucks: [] } as unknown as Access;
const mechanic = { id: 'u3', owner: false, roles: ['mechanic'], rights: {}, trucks: ['t1'] } as unknown as Access;
const TOLD = { told_start: 480, told_end: 720, told_at: '2026-11-20T10:00:00-05:00', told_how: 'sms' };
let n = 0;
const job = (o: Record<string, unknown>) => ({ id: `j${++n}`, number: n, truck_id: 't1', block: 'am', status: 'booked', stop_order: 1, duration_min: 60, deleted_at: null, ...o });
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const draw = async (el: preact.ComponentChild) => { await act(async () => { render(el, box); }); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T09:00:00-05:00'));   // a Monday
  lang.value = 'fr'; opened.length = 0; n = 0; clearAll(); access.value = owner;
});
afterEach(() => { render(null, box); vi.useRealTimers(); access.value = null; });

describe('ToldDays: Aujourd’hui’s one line of every coming day', () => {
  it('three customers due on mar. 24 (2: tomorrow) and jeu. 26 (1): the title says 3, one button per day in date order, a tap opens that day', async () => {
    replaceLocal('jobs', [
      job({ customer_id: 'c1', day: '2026-11-24' }),                                       // never told
      job({ customer_id: 'c2', day: '2026-11-24', block: 'pm', told_day: '2026-11-24', ...TOLD }), // told the morning, now the afternoon
      job({ customer_id: 'c3', day: '2026-11-26' }),
      job({ customer_id: 'c4', day: '2026-11-25', told_day: '2026-11-25', ...TOLD }),       // has his hours
      job({ customer_id: 'c5', day: '2026-11-20' }),                                       // a past day
      job({ customer_id: 'c6', day: '2026-11-27', status: 'cancelled' })
    ] as never);
    await draw(<ToldDays />);
    const line = q('told-days')!;
    expect(line.textContent).toContain('3 clients n’ont pas leur nouvelle heure');
    const buttons = [...line.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['demain (2)', 'jeu. 26 (1)']);
    await act(async () => { q('told-day-2026-11-26')!.click(); });
    expect(opened).toEqual(['2026-11-26']);
  });
  it('a customer moved from today to another day counts once and is on both days’ buttons; two cars count once', async () => {
    replaceLocal('jobs', [
      job({ customer_id: 'c1', day: '2026-11-30', told_day: '2026-11-23', ...TOLD }),   // told today, moved to Monday
      job({ customer_id: 'c2', day: '2026-11-24' }), job({ customer_id: 'c2', day: '2026-11-24' })
    ] as never);
    await draw(<ToldDays />);
    expect(q('told-days')!.textContent).toContain('2 clients n’ont pas leur nouvelle heure');
    expect([...q('told-days')!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['aujourd’hui (1)', 'demain (1)', 'lun. 30 (1)']);
  });
  it('nothing when nobody is due, and nothing for a mechanic; the office sees it', async () => {
    replaceLocal('jobs', [job({ customer_id: 'c4', day: '2026-11-25', told_day: '2026-11-25', ...TOLD })] as never);
    await draw(<ToldDays />);
    expect(box.innerHTML).toBe('');
    replaceLocal('jobs', [job({ customer_id: 'c1', day: '2026-11-24' })] as never);
    access.value = mechanic;
    await draw(<ToldDays />);
    expect(box.innerHTML).toBe('');
    access.value = office;
    await draw(<ToldDays />);
    expect(q('told-days')!.textContent).toContain('1 client n’a pas sa nouvelle heure');
  });
  it('English', async () => {
    lang.value = 'en';
    replaceLocal('jobs', [job({ customer_id: 'c1', day: '2026-11-23' }), job({ customer_id: 'c2', day: '2026-11-26' })] as never);
    await draw(<ToldDays />);
    expect(q('told-days')!.textContent).toContain('2 customers don’t have their new time');
    expect([...q('told-days')!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['today (1)', `${dayChipWord('2026-11-26', 'en')} (1)`]);
  });
});

describe('ToldBanner: the agenda’s day', () => {
  it('that day’s count (the day he has and the day he was told), the button opens that day', async () => {
    replaceLocal('jobs', [
      job({ customer_id: 'c1', day: '2026-11-24' }),
      job({ customer_id: 'c2', day: '2026-11-27', told_day: '2026-11-24', ...TOLD }),
      job({ customer_id: 'c3', day: '2026-11-25' })
    ] as never);
    await draw(<ToldBanner day="2026-11-24" />);
    expect(q('told-banner')!.textContent).toContain('2 clients n’ont pas leur nouvelle heure');
    expect(q('told-banner-send')!.textContent).toBe('Envoyer les heures aux clients (2)');
    await act(async () => { q('told-banner-send')!.click(); });
    expect(opened).toEqual(['2026-11-24']);
    await draw(<ToldBanner day="2026-11-26" />);
    expect(box.innerHTML).toBe('');
    access.value = mechanic;
    await draw(<ToldBanner day="2026-11-24" />);
    expect(box.innerHTML).toBe('');
  });
});
