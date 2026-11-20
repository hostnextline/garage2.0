/* « Heures travaillées »: a mechanic sees only his own week; the owners and the treasurer see the team, open a person and
   correct a day (the server is pretended). The data is last week's, so no time of the test is « not yet passed ». */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const calls: { name: string; args: unknown[] }[] = [];
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    shiftSave: async (...args: unknown[]) => { calls.push({ name: 'shiftSave', args }); return { queued: false, data: { ok: true } }; },
    shiftRemove: async (...args: unknown[]) => { calls.push({ name: 'shiftRemove', args }); return { queued: false, data: { ok: true } }; }
  };
});
import TimesheetScreen from './TimesheetScreen';
import { replaceLocal } from '../../data/store';
import { access } from '../../data/auth';
import { toasts } from '../../ui/toast';
import { addDays, today } from '../../lib/dates';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';
import { isoAt, mondayOf } from './logic';

const H = (h: number, m = 0) => h * 60 + m;
const MON = addDays(mondayOf(today()), -7);         // last week's Monday
const d = (i: number) => addDays(MON, i);
const who = (id: string, roles: string[]): Access => ({ id, full_name: id, short_name: id, email: null, phone: null, roles, owner: roles.includes('owner'), lang: 'fr', prefs: {}, color: null,
  rights: {}, trucks: [], card_online: false, texts_online: false } as unknown as Access);
const person = (id: string, full_name: string, roles: string[]) => ({ id, full_name, short_name: full_name.split(' ')[0], roles, rights: {}, active: true, color: null, lang: 'fr', prefs: {}, email: null, phone: null, last_seen_at: null, deleted_at: null, updated_at: '2026-11-01T00:00:00Z' });
function seed(roles: string[], me = 'me') {
  replaceLocal('staff', [
    person('ali', 'Ali Mécano', ['mechanic']), person('sam', 'Sam Mécano', ['mechanic']),
    person('own', 'Omar Proprio', ['owner']), person('tre', 'Tina Trésorière', ['treasurer'])
  ] as never);
  replaceLocal('shifts', [
    { id: 'a1', staff_id: 'ali', started_at: isoAt(d(0), H(8, 4)), ended_at: isoAt(d(0), H(16, 12)), deleted_at: null, updated_at: '2026-11-01T00:00:00Z' },
    { id: 'a2', staff_id: 'ali', started_at: isoAt(d(1), H(8)), ended_at: isoAt(d(2), H(3, 17)), deleted_at: null, updated_at: '2026-11-01T00:00:00Z' },  // forgotten: closed by the night
    { id: 's1', staff_id: 'sam', started_at: isoAt(d(0), H(9)), ended_at: isoAt(d(0), H(17)), deleted_at: null, updated_at: '2026-11-01T00:00:00Z' },
    { id: 's2', staff_id: 'sam', started_at: isoAt(d(3), H(9)), ended_at: isoAt(d(3), H(12)), deleted_at: null, fixed_at: '2026-11-02T00:00:00Z', fixed_by: 'own', updated_at: '2026-11-01T00:00:00Z' }
  ] as never);
  access.value = who(me, roles);
}
const box = document.createElement('div');
document.body.appendChild(box);
const q = (id: string) => [...document.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
const text = (id: string) => String(q(id)[0]?.textContent).replace(/\s/g, ' ');
const wait = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const click = async (el: Element | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await wait(); await wait(); };
const type = async (id: string, v: string) => { const el = q(id)[0] as HTMLInputElement; expect(el).toBeTruthy(); await act(async () => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const show = async (staff?: string) => {
  await act(async () => { render(null, box); render(<TimesheetScreen params={staff ? { staff } : {}} query={new URLSearchParams(`week=${MON}`)} />, box); });
  await wait();
};

beforeEach(async () => { lang.value = 'fr'; calls.length = 0; toasts.value = []; await act(async () => { render(null, box); }); });

describe('« Heures travaillées »: the mechanic', () => {
  it('sees « Mes heures », his own week only, even at another person’s address; nothing to correct', async () => {
    seed(['mechanic'], 'ali');
    await show('sam');
    expect(box.textContent).toContain('Mes heures');
    expect(q('ts-team')).toHaveLength(0);
    expect(q('ts-shift-a1')).toHaveLength(1);
    expect(q('ts-shift-s1')).toHaveLength(0);
    // 8 h 08 + 19 h 17 (the forgotten day still counts until it is corrected)
    expect(text('ts-week-total')).toBe('27 h 25');
    expect(text('ts-day-total-' + d(0))).toBe('8 h 08');
    expect(q('ts-shift-a1')[0].tagName).toBe('SPAN');
    expect(q('ts-add')).toHaveLength(0);
    expect(text('ts-check-banner')).toContain('Dis ta vraie heure de fin au propriétaire ou au trésorier');
    expect(text('ts-shift-a2')).toContain('À vérifier');
    expect(text('ts-shift-a2')).toContain('(le lendemain)');
  });
});

describe('« Heures travaillées »: the owners and the treasurer', () => {
  it('see the team: every mechanic with the week’s total and the days to check', async () => {
    seed(['owner'], 'own');
    await show();
    expect(text('ts-person-total-ali')).toBe('27 h 25');
    expect(text('ts-person-total-sam')).toBe('11 h');
    expect(text('ts-person-check-ali')).toBe('1 à vérifier');
    expect(q('ts-person-check-sam')).toHaveLength(0);
    expect(q('ts-person-own')).toHaveLength(0);   // an owner who did not work that week is not listed
    expect(text('ts-team-total')).toBe('38 h 25');
    expect(q('ts-person-ali')[0].getAttribute('href')).toBe(`#/timesheet/ali?week=${MON}`);
  });
  it('the treasurer too (without being an owner)', async () => {
    seed(['treasurer'], 'tre');
    await show();
    expect(q('ts-person-ali')).toHaveLength(1);
    await show('ali');
    expect(q('ts-shift-a1')[0].tagName).toBe('BUTTON');
  });
  it('correct a forgotten end: the 3 h 17 is not kept, the real end is written and sent', async () => {
    seed(['owner'], 'own');
    await show('ali');
    expect(text('ts-check-banner')).toContain('Touche-la pour écrire la vraie heure de fin');
    await click(q('ts-shift-a2')[0]);
    expect(q('ts-sheet')).toHaveLength(1);
    expect(text('ts-forgot')).toContain('3 h 17');
    expect((q('ts-start')[0] as HTMLInputElement).value).toBe('08:00');
    expect((q('ts-end')[0] as HTMLInputElement).value).toBe('');
    await click(q('ts-save')[0]);
    expect(calls).toHaveLength(0);
    expect(text('ts-error')).toBe('Écris l’heure de la fin.');
    await type('ts-end', '16:30');
    expect(text('ts-length')).toContain('8 h 30');
    await click(q('ts-save')[0]);
    expect(calls).toEqual([{ name: 'shiftSave', args: ['a2', 'ali', isoAt(d(1), H(8)), isoAt(d(1), H(16, 30))] }]);
    expect(q('ts-sheet')).toHaveLength(0);
  });
  it('refuse hours over another day of the same person before sending', async () => {
    seed(['owner'], 'own');
    await show('sam');
    await click(q('ts-add-' + d(1))[0]);
    await type('ts-start', '08:00');
    await type('ts-end', '10:00');
    expect(q('ts-error')).toHaveLength(0);
    // the sheet's day can change: Monday already has 9 h – 17 h
    const day = q('ts-sheet')[0].querySelector('input[type="date"]') as HTMLInputElement;
    await act(async () => { day.value = d(0); day.dispatchEvent(new Event('input', { bubbles: true })); });
    await type('ts-start', '16:00');
    await type('ts-end', '18:00');
    expect(text('ts-error')).toBe('Ces heures chevauchent une autre journée de cette personne.');
    await click(q('ts-save')[0]);
    expect(calls).toHaveLength(0);
    await type('ts-start', '17:00');
    await click(q('ts-save')[0]);
    expect(calls).toEqual([{ name: 'shiftSave', args: [null, 'sam', isoAt(d(0), H(17)), isoAt(d(0), H(18))] }]);
  });
  it('remove a day started by mistake (two taps), and show who corrected a day', async () => {
    seed(['owner'], 'own');
    await show('sam');
    expect(text('ts-shift-s2')).toContain('Corrigée');
    await click(q('ts-shift-s2')[0]);
    expect(q('ts-sheet')[0].textContent).toContain('Corrigée par Omar');
    await click(q('ts-remove')[0]);
    expect(calls).toHaveLength(0);
    await click(q('ts-remove')[0]);
    expect(calls).toEqual([{ name: 'shiftRemove', args: ['s2'] }]);
  });
  it('the week moves with the arrows (never past this week)', async () => {
    seed(['owner'], 'own');
    await show('ali');
    expect(text('ts-week-total')).toBe('27 h 25');
    await click(q('ts-prev')[0]);
    expect(text('ts-week-total')).toBe('0 h');
    await click(q('ts-now')[0]);
    expect((q('ts-next')[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
