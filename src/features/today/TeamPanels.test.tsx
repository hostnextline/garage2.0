/* « Demain » on Aujourd'hui (Part 28, REARRANGE.md §3.2, C9, U7), in place of « À confirmer pour demain »: tomorrow's
   appointments, its customers without their hours (new or changed) and the ONE button; no per-row « Envoyer ». Real
   store rows; the send list pretended (openTell). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const opened = vi.hoisted(() => [] as string[]);
const ordered = vi.hoisted(() => [] as string[]);
vi.mock('../../shared/jobs/TellHost', () => ({ openTell: (day: string) => { opened.push(day); } }));
// « Réorganiser demain » (E3's sheet, pretended here: its own tests are DayOrderSheet's)
vi.mock('../../shared/jobs/DayOrderHost', () => ({ openDayOrder: (day: string) => { ordered.push(day); } }));
import { TomorrowPanel } from './TeamPanels';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

const TODAY = '2026-11-23', TOMORROW = '2026-11-24';
const owner = { id: 'u1', owner: true, roles: ['owner'], rights: {}, trucks: [] } as unknown as Access;
const mechanic = { id: 'u3', owner: false, roles: ['mechanic'], rights: {}, trucks: ['t1'] } as unknown as Access;
const TOLD = { told_day: TOMORROW, told_start: 480, told_end: 720, told_at: '2026-11-20T10:00:00-05:00', told_how: 'sms' };
const job = (id: string, o: Record<string, unknown>) => ({ id, number: Number(id.slice(1)), day: TOMORROW, block: 'am', status: 'booked', stop_order: 1, duration_min: 60, deleted_at: null, ...o });
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => box.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (id: string) => [...box.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const sp = (s: string | null | undefined) => String(s).replace(/\s+/g, ' ').trim();
const draw = async () => { await act(async () => { render(<TomorrowPanel day={TODAY} />, box); }); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T20:00:00-05:00'));
  lang.value = 'fr'; opened.length = 0; ordered.length = 0; clearAll(); access.value = owner;
  replaceLocal('customers', [
    { id: 'c1', first_name: 'Chloé', last_name: 'Gagnon', phone: '514 555-0101', sms_ok: true },
    { id: 'c2', first_name: 'Omar', last_name: 'Haddad', phone: '514 555-0102', sms_ok: true },
    { id: 'c3', first_name: 'Fanny', last_name: 'Côté', phone: null, sms_ok: true }
  ] as never);
});
afterEach(() => { render(null, box); vi.useRealTimers(); access.value = null; });

describe('TomorrowPanel', () => {
  it('the title, how many appointments on how many trucks, the line, the due rows (no per-row « Envoyer »), the one button', async () => {
    replaceLocal('jobs', [
      job('j1', { customer_id: 'c1', truck_id: 't1', block: 'pm', ...TOLD }),   // told the morning, now the afternoon
      job('j2', { customer_id: 'c2', truck_id: 't2' }),                         // never told
      job('j3', { customer_id: 'c3', truck_id: 't1' }),                         // never told, no cell
      job('j4', { customer_id: 'c1', truck_id: 't2', ...TOLD }),                // has his hours
      job('j5', { customer_id: 'c2', truck_id: 't2', status: 'cancelled' })
    ] as never);
    await draw();
    const panel = q('today-tomorrow')!;
    expect(sp(panel.querySelector('.panel-title')!.textContent)).toContain('Demain, mardi 24 novembre');
    expect(sp(panel.querySelector('.panel-sub')!.textContent)).toBe('4 rendez-vous sur 2 camions');
    // the buttons under the title (on a phone the title keeps the whole width), never in the panel's head
    expect(panel.querySelector('.panel-head [data-testid="today-tomorrow-send"]')).toBeNull();
    expect(sp(q('today-tomorrow-line')!.textContent)).toBe('3 clients n’ont pas leur nouvelle heure');
    const rows = qa('today-tomorrow-row').map((r) => sp(r.textContent));
    expect(rows.length).toBe(3);
    expect(rows.find((r) => r.startsWith('Chloé'))).toContain('12 h à 16 h avant : 8 h à 12 h');
    expect(rows.find((r) => r.startsWith('Omar'))).toContain('Nouveau');
    expect(rows.find((r) => r.startsWith('Fanny'))).toContain('Pas de cellulaire');
    // no per-row « Envoyer »: the rows hold no button (the panel's only other button is its « ? »)
    expect(qa('today-tomorrow-row').some((r) => r.querySelector('button'))).toBe(false);
    expect(qa('today-tomorrow-send').length).toBe(1);
    expect(sp(q('today-tomorrow-send')!.textContent)).toBe('Envoyer les heures aux clients (3)');
    await act(async () => { q('today-tomorrow-send')!.click(); });
    expect(opened).toEqual([TOMORROW]);
    expect(q('today-tomorrow-order')!.textContent).toBe('Réorganiser demain');
    await act(async () => { q('today-tomorrow-order')!.click(); });
    expect(ordered).toEqual([TOMORROW]);
  });
  it('everyone has his hours: « Tous les clients de demain ont leur heure. », no button', async () => {
    replaceLocal('jobs', [job('j4', { customer_id: 'c1', truck_id: 't2', ...TOLD })] as never);
    await draw();
    expect(sp(q('today-tomorrow-none')!.textContent)).toBe('Tous les clients de demain ont leur heure.');
    expect(q('today-tomorrow-send')).toBeNull();
    expect(sp(q('today-tomorrow')!.querySelector('.panel-sub')!.textContent)).toBe('1 rendez-vous sur 1 camion');
  });
  it('nothing booked tomorrow, or a mechanic: no panel', async () => {
    replaceLocal('jobs', [job('j5', { customer_id: 'c2', status: 'cancelled' })] as never);
    await draw();
    expect(box.innerHTML).toBe('');
    replaceLocal('jobs', [job('j2', { customer_id: 'c2', truck_id: 't1' })] as never);
    access.value = mechanic;
    await draw();
    expect(box.innerHTML).toBe('');
  });
});
