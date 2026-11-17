/* The lines editor: a price typed wrong is never saved as 0 $ (R126: MoneyInput says { valid: false }). */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { lang } from '../../lib/i18n';
import { LinesEditor } from './LinesEditor';
import type { EditLine } from '../../domain/money/editLines';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => { act(() => render(null, box)); });
const type = (input: HTMLInputElement, s: string) => act(() => { input.value = s; input.dispatchEvent(new Event('input', { bubbles: true })); });

describe('a price typed in the lines editor (R126)', () => {
  it('typed wrong: the line keeps its last good price (nothing sent); typed right: the new price', () => {
    lang.value = 'fr';
    const onLines = vi.fn();
    const lines = [{ _k: 'l1', description: 'Freins', qty: 1, unit_cents: 10000, taxable: true, kind: 'service' }] as unknown as EditLine[];
    act(() => render(<LinesEditor lines={lines} onLines={onLines} docLang="fr" />, box));
    const price = box.querySelector('.inv-line-price input') as HTMLInputElement;
    type(price, '12,,5');
    expect(onLines).not.toHaveBeenCalled();
    expect(price.getAttribute('aria-invalid')).toBe('true');
    type(price, '12,50');
    expect(onLines).toHaveBeenLastCalledWith([expect.objectContaining({ unit_cents: 1250 })]);
    // emptied on purpose: 0 $, as before
    type(price, '');
    expect(onLines).toHaveBeenLastCalledWith([expect.objectContaining({ unit_cents: 0 })]);
  });
});

describe('a price left red is counted, so nothing is finished, sent or booked with it (review invoices-r2-3)', () => {
  const two = [
    { _k: 'l1', description: 'Freins', qty: 1, unit_cents: 10000, taxable: true, kind: 'service' },
    { _k: 'l2', description: 'Rabais', qty: 1, unit_cents: 1000, taxable: true, kind: 'discount' }
  ] as unknown as EditLine[];
  const draw = (lines: EditLine[], onInvalid: (n: number) => void, onLines: (l: EditLine[]) => void = () => undefined) =>
    act(() => render(<LinesEditor lines={lines} onLines={onLines} docLang="fr" onInvalid={onInvalid} />, box));
  const prices = () => [...box.querySelectorAll<HTMLInputElement>('.inv-line-price input')];

  it('typed wrong: 1; typed right again: 0; each red price counts once, on every keystroke and when the field is left', () => {
    lang.value = 'fr';
    const onInvalid = vi.fn();
    draw(two, onInvalid);
    type(prices()[0], '12,,5');
    expect(onInvalid).toHaveBeenLastCalledWith(1);
    type(prices()[0], '12,,50');
    act(() => { prices()[0].dispatchEvent(new Event('blur')); });
    expect(onInvalid).toHaveBeenLastCalledWith(1);
    type(prices()[1], '5,,');
    expect(onInvalid).toHaveBeenLastCalledWith(2);
    type(prices()[0], '12,50');
    expect(onInvalid).toHaveBeenLastCalledWith(1);
    type(prices()[1], '');
    expect(onInvalid).toHaveBeenLastCalledWith(0);
  });
  it('a red line taken off: no longer counted', () => {
    lang.value = 'fr';
    const onInvalid = vi.fn();
    draw(two, onInvalid);
    type(prices()[0], '12,,5');
    expect(onInvalid).toHaveBeenLastCalledWith(1);
    draw([two[1]], onInvalid);
    expect(onInvalid).toHaveBeenLastCalledWith(0);
  });
  it('the price changed from elsewhere while the field is not in use (a % chip): the field shows it, no longer red, no longer counted', () => {
    lang.value = 'fr';
    const onInvalid = vi.fn();
    let lines = two;
    const onLines = (l: EditLine[]) => { lines = l; };
    draw(lines, onInvalid, onLines);
    type(prices()[1], '5,,');
    expect(onInvalid).toHaveBeenLastCalledWith(1);
    act(() => { (box.querySelector('.inv-line-pct .chip') as HTMLElement).click(); });
    draw(lines, onInvalid, onLines);
    expect(prices()[1].getAttribute('aria-invalid')).toBeNull();
    expect(onInvalid).toHaveBeenLastCalledWith(0);
  });
  it('the same price given again (nothing changed): MoneyInput keeps the red text, so it is still counted', () => {
    lang.value = 'fr';
    const onInvalid = vi.fn();
    draw(two, onInvalid);
    type(prices()[0], '12,,5');
    draw(two.map((l) => ({ ...l })), onInvalid);
    expect(prices()[0].getAttribute('aria-invalid')).toBe('true');
    expect(onInvalid).toHaveBeenLastCalledWith(1);
  });
});

describe('a quantity typed in the lines editor (scan x-money-28, invoices-quotes-27)', () => {
  it('two decimals, as a job line keeps them: an estimate booked keeps its amount', () => {
    lang.value = 'fr';
    const onLines = vi.fn();
    const lines = [{ _k: 'l1', description: 'Main-d’œuvre', qty: 1, unit_cents: 11500, taxable: true, kind: 'labour' }] as unknown as EditLine[];
    act(() => render(<LinesEditor lines={lines} onLines={onLines} docLang="fr" />, box));
    const qty = box.querySelector('.inv-qty') as HTMLInputElement;
    type(qty, '1,125');
    expect(onLines).toHaveBeenLastCalledWith([expect.objectContaining({ qty: 1.13 })]);
    type(qty, '1,5');
    expect(onLines).toHaveBeenLastCalledWith([expect.objectContaining({ qty: 1.5 })]);
  });
});
