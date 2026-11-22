/* « Info » on screen with the real roads (Part 27): the sheet and the list show the text the garage's switch chooses
   (articleText), not the text of before (review-settings R12, mutation M22: the screen showing the OFF text with the
   switch on left every test green). */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import InfoScreen from './InfoScreen';
import { replaceLocal } from '../../data/store';
import { lang } from '../../lib/i18n';
import type { ScreenProps } from '../../platform/router';

const box = document.createElement('div');
document.body.appendChild(box);
beforeEach(() => { lang.value = 'fr'; });
afterEach(() => { act(() => render(null, box)); lang.value = 'fr'; });
const props = (id?: string) => ({ query: new URLSearchParams(), params: id ? { id } : {} } as unknown as ScreenProps);
const sp = (s: string | null | undefined) => String(s).replace(/\s/g, ' ');
const switchTo = (on: boolean) => replaceLocal('settings', [{ id: '1', booking: { roads_on: on } } as never]);
const show = async (id?: string) => { await act(async () => { render(null, box); render(<InfoScreen {...props(id)} />, box); }); };

describe('« Info » on screen follows the real roads switch', () => {
  it('the sheet « Garde-route »: the real roads’ text with the switch on, the estimate’s with it off, both languages', async () => {
    switchTo(true);
    await show('far');
    let text = sp(box.querySelector('[data-testid="info-sheet"]')?.textContent);
    expect(text).toContain('La route vient des vraies routes (TomTom), avec la circulation habituelle de l’heure');
    expect(text).not.toContain('Le calcul de la route');
    lang.value = 'en';
    await show('far');
    text = sp(box.querySelector('[data-testid="info-sheet"]')?.textContent);
    expect(text).toContain('The driving comes from the real roads (TomTom)');
    lang.value = 'fr';
    switchTo(false);
    await show('far');
    text = sp(box.querySelector('[data-testid="info-sheet"]')?.textContent);
    expect(text).toContain('La route est une estimation (« Le calcul de la route », Réglages → Réservations), pas la circulation réelle.');
    expect(text).not.toContain('TomTom');
  });
  it('the list and its search read the same text', async () => {
    switchTo(true);
    await show();
    expect(box.querySelector('[data-testid="info-far"]')).toBeTruthy();
    switchTo(false);
    await show();
    expect(box.querySelector('[data-testid="info-far"]')).toBeTruthy();
  });
});
