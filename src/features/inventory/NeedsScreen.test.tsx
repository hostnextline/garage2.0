/* « Besoins de la semaine » on a phone that holds only its own truck's appointments says so (the list for the supplier
   looked complete); the owner's screen is unchanged. */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import NeedsScreen from './NeedsScreen';
import { access } from '../../data/auth';
import { replaceLocal } from '../../data/store';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';
import type { ScreenProps } from '../../platform/router';

const box = document.createElement('div');
document.body.appendChild(box);
afterEach(() => { act(() => render(null, box)); access.value = null; });

const who = (owner: boolean, rights: Record<string, boolean>, trucks: string[]): Access => ({ id: 'u1', full_name: 'T', short_name: 'T', email: null, phone: null,
  roles: owner ? ['owner'] : ['mechanic'], owner, lang: 'fr', prefs: {}, color: null, rights, trucks, card_online: false, texts_online: false } as unknown as Access);
const props = { query: new URLSearchParams(), params: {} } as unknown as ScreenProps;
const banner = () => box.querySelector('[data-testid="needs-own-trucks"]');

describe('whose appointments the week’s needs count', () => {
  it('a mechanic who holds only his truck is told; the owner, or « Routes partagées », sees no note', async () => {
    lang.value = 'fr';
    replaceLocal('trucks', [{ id: 'a', name: 'Camion', sort: 1, active: true }, { id: 'b', name: 'Voiture', sort: 2, active: true }]);
    replaceLocal('jobs', []);
    access.value = who(false, { inventory: true }, ['a']);
    await act(() => render(<NeedsScreen {...props} />, box));
    expect(banner()?.textContent).toMatch(/Seulement les rendez-vous de ton camion/);
    access.value = who(false, { inventory: true }, ['a', 'b']);
    await act(() => render(<NeedsScreen {...props} />, box));
    expect(banner()).toBeNull();
    access.value = who(true, {}, []);
    await act(() => render(<NeedsScreen {...props} />, box));
    expect(banner()).toBeNull();
  });
});
