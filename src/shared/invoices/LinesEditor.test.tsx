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
