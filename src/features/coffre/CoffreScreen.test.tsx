/* « Coffre »: the period read from the address, « Réessayer » and the kept answer when the server cannot be reached
   (bug 14), and « Retirer » only on money received (bug 07). The server is pretended. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

let down = false;
const calls: Record<string, unknown>[] = [];
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    rpcNow: async (_name: string, args: Record<string, unknown>) => {
      calls.push(args);
      if (down) throw Object.assign(new Error('TypeError: Failed to fetch'), { code: '' });
      return { balance_cents: 4500, stock_cents: 3000, rows: [
        { id: 'a', kind: 'received', day: '2026-11-02', customer: 'Tante Rima', amount_cents: 10000, value_cents: 25000, job_numbers: [12], job_ids: ['j-1'] },
        { id: 'p', kind: 'purchase', day: '2026-11-06', customer: 'Filtre', amount_cents: 5500, value_cents: 0, work: '5 × Filtre', job_numbers: [], job_ids: [] }
      ] };
    }
  };
});
import CoffreScreen from './CoffreScreen';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';

let person = 0;
const owner = (): Access => ({ id: `o${++person}`, full_name: 'Hassan', short_name: 'Hassan', email: null, phone: null, roles: ['owner'], owner: true, lang: 'fr', prefs: {}, color: null,
  rights: { treasury: true }, trucks: [], card_online: false, texts_online: false } as unknown as Access);
const box = document.createElement('div');
document.body.appendChild(box);
const q = (sel: string) => [...box.querySelectorAll(sel)] as HTMLElement[];
const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const show = async (query = '') => { await act(async () => { render(null, box); render(<CoffreScreen params={{}} query={new URLSearchParams(query)} />, box); }); await wait(); await wait(); };

beforeEach(() => { lang.value = 'fr'; down = false; calls.length = 0; access.value = owner(); });

describe('« Coffre »', () => {
  it('the period comes from the address, like the treasury', async () => {
    await show('p=custom&from=2026-10-01&to=2026-10-31');
    expect(calls[0]).toEqual({ p_from: '2026-10-01', p_to: '2026-10-31' });
  });
  it('« Retirer » on money received, never on a purchase (it would leave the stock bought)', async () => {
    await show();
    expect(q('[data-testid="coffre-row-a"] button').map((b) => b.textContent)).toContain('Retirer');
    expect(q('[data-testid="coffre-row-p"] button').length).toBe(0);
  });
  it('no signal: the last answer stays with « Réessayer », which asks again', async () => {
    await show();
    expect(q('[data-testid="coffre-stock"]')[0].textContent).toMatch(/30,00/);
    down = true;
    const before = calls.length;
    await show();
    expect(q('[data-testid="coffre-stock"]')[0].textContent).toMatch(/30,00/);
    const retry = q('button').find((b) => b.textContent === 'Réessayer');
    expect(retry).toBeTruthy();
    down = false;
    await act(async () => { retry!.click(); });
    await wait(); await wait();
    expect(calls.length).toBe(before + 2);
    expect(q('button').some((b) => b.textContent === 'Réessayer')).toBe(false);
  });
});
