/* « Objectif du mois »: the field shows the goal even when the settings reach the phone after the screen opened. */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { GoalSheet } from './GoalSheet';
import { replaceLocal } from '../../data/store';
import { lang } from '../../lib/i18n';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => act(() => render(null, box)));

describe('the goal sheet', () => {
  it('opened after the settings arrived late, it shows the current goal', async () => {
    lang.value = 'fr';
    replaceLocal('settings', []);
    await act(() => render(<GoalSheet open={false} onClose={() => undefined} />, box));
    await act(() => replaceLocal('settings', [{ id: '1', billing: { goal_cents: 2500000 } }]));
    await act(() => render(<GoalSheet open onClose={() => undefined} />, box));
    const input = document.querySelector('[data-testid="goal-sheet"] input.input-money') as HTMLInputElement;
    expect(input.value.replace(/\s/g, '')).toBe('25000,00');
  });
});
