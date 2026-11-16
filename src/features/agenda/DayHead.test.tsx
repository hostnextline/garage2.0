/* The calendar button of the agenda opens the phone's own date picker, also where the browser has no showPicker. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { DatePick } from './DayHead';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => act(() => render(null, box)));

describe('« Choisir une date » (agenda-18)', () => {
  it('clicks the date field where showPicker does not exist (Safari before 16, Firefox before 101)', () => {
    act(() => render(<DatePick value="2026-11-17" onPick={() => {}} />, box));
    const input = box.querySelector('input[type="date"]') as HTMLInputElement & { showPicker?: unknown };
    Object.defineProperty(input, 'showPicker', { value: undefined, configurable: true });
    const click = vi.spyOn(input, 'click');
    act(() => (box.querySelector('[data-testid="agenda-pick"]') as HTMLElement).click());
    expect(click).toHaveBeenCalledTimes(1);
  });
  it('uses showPicker where it exists, and the click when it refuses', () => {
    act(() => render(<DatePick value="2026-11-17" onPick={() => {}} />, box));
    const input = box.querySelector('input[type="date"]') as HTMLInputElement;
    const show = vi.fn();
    Object.defineProperty(input, 'showPicker', { value: show, configurable: true });
    const click = vi.spyOn(input, 'click');
    act(() => (box.querySelector('[data-testid="agenda-pick"]') as HTMLElement).click());
    expect(show).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    Object.defineProperty(input, 'showPicker', { value: () => { throw new Error('NotAllowedError'); }, configurable: true });
    act(() => (box.querySelector('[data-testid="agenda-pick"]') as HTMLElement).click());
    expect(click).toHaveBeenCalledTimes(1);
  });
});
