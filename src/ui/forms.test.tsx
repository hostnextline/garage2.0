import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { MoneyInput, Field, Input, Form, readMoney } from './forms';
import { lang } from '../lib/i18n';

let root: HTMLDivElement;
beforeEach(() => { lang.value = 'fr'; root = document.createElement('div'); document.body.appendChild(root); });
afterEach(async () => { await act(() => { render(null, root); }); root.remove(); });

describe('MoneyInput', () => {
  it('tells a mistyped amount from an empty one (old logic: both null, nothing to refuse the save on)', () => {
    expect(readMoney('')).toEqual({ cents: null, valid: true });
    expect(readMoney('12,3a')).toEqual({ cents: null, valid: false });
    expect(readMoney('59,99')).toEqual({ cents: 5999, valid: true });
    expect(readMoney('-5')).toEqual({ cents: 500, valid: true });
    expect(readMoney('-5', true)).toEqual({ cents: -500, valid: true });
  });
  it('reads the amount in the language on screen (R05): en « 1,000 » is 1 000 $, fr « 59,999 » is refused', () => {
    lang.value = 'en';
    expect(readMoney('1,000')).toEqual({ cents: 100000, valid: true });
    expect(readMoney('1,234.50')).toEqual({ cents: 123450, valid: true });
    lang.value = 'fr';
    expect(readMoney('59,999')).toEqual({ cents: null, valid: false });
    expect(readMoney('1 000,50')).toEqual({ cents: 100050, valid: true });
    // said explicitly, whatever the screen
    expect(readMoney('1,000', false, 'en')).toEqual({ cents: 100000, valid: true });
    expect(readMoney('1,000', false, 'fr')).toEqual({ cents: null, valid: false });
  });
  it('an English « 1,000 » typed in the field is reported as 1 000 $ (not red)', async () => {
    lang.value = 'en';
    const onCents = vi.fn();
    await act(() => { render(<MoneyInput cents={null} onCents={onCents} />, root); });
    const input = root.querySelector('input')!;
    await act(() => { input.dispatchEvent(new FocusEvent('focus')); input.value = '1,000'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onCents).toHaveBeenLastCalledWith(100000, { valid: true });
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
  it('leaving the field without changing the amount reports nothing (old logic saved the draft at every visit)', async () => {
    const onCents = vi.fn();
    await act(() => { render(<MoneyInput cents={5999} onCents={onCents} />, root); });
    const input = root.querySelector('input')!;
    await act(() => { input.dispatchEvent(new FocusEvent('focus')); input.dispatchEvent(new FocusEvent('blur')); });
    expect(onCents).not.toHaveBeenCalled();
    await act(() => { input.value = '12,3a'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onCents).toHaveBeenLastCalledWith(null, { valid: false });
  });
});

describe('Field with a « ? »', () => {
  it('the label names the input, not the « ? » button', async () => {
    await act(() => { render(<Field label="Prix" help="Le prix du client"><Input value="" onValue={() => undefined} /></Field>, root); });
    const input = root.querySelector('input')!;
    expect(input.labels?.length).toBe(1);
    expect(input.labels?.[0].textContent).toContain('Prix');
    expect((root.querySelector('button.help') as HTMLButtonElement).labels?.length ?? 0).toBe(0);
  });
});

describe('Form', () => {
  it('a second submit while the first is pending is dropped', async () => {
    let done: () => void = () => undefined;
    const fn = vi.fn(() => new Promise<void>((r) => { done = r; }));
    await act(() => { render(<Form onSubmit={fn}><input /></Form>, root); });
    const form = root.querySelector('form')!;
    await act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { done(); });
    await act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
