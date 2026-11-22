import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const calls: [string, string, boolean][] = [];
let answer: () => void = () => undefined;
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return { ...real, setRoleRight: (role: string, right: string, on: boolean) => { calls.push([role, right, on]); return new Promise<void>((r) => { answer = r; }); } };
});
import { RoleTable } from './RoleTable';
import { replaceLocal } from '../../data/store';
import { lang } from '../../lib/i18n';

const box = document.createElement('div');
document.body.appendChild(box);
const cell = () => box.querySelector('[data-testid="role-office-book"]') as HTMLElement;
const wait = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

beforeEach(async () => {
  lang.value = 'fr'; calls.length = 0;
  replaceLocal('settings', [{ id: '1', role_rights: {} }] as never);
  await act(async () => { render(null, box); render(<RoleTable />, box); });
});

describe('Équipe: what each role may do (settings-team-19)', () => {
  it('a double tap sends one call; the switch shows the value sent until the answer', async () => {
    expect(cell().getAttribute('aria-checked')).toBe('true');   // the office books by default
    await act(async () => { cell().click(); });
    await act(async () => { cell().click(); });
    expect(calls).toEqual([['office', 'book', false]]);
    expect(cell().getAttribute('aria-checked')).toBe('false');
    await act(async () => { answer(); });
    await wait();
    await act(async () => { cell().click(); });
    expect(calls.length).toBe(2);
  });
});
