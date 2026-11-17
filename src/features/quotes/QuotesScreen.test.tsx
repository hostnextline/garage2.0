/* « Estimations »: « Nouvelle estimation » for whoever the server lets make one (quotes_ins: the field), the same rule
   as the « + » menu (may.newQuote, R125). */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { replaceLocal, clearAll } from '../../data/store';
import { access } from '../../data/auth';
import { lang } from '../../lib/i18n';
import type { Access } from '../../data/types';
import QuotesScreen from './QuotesScreen';

const box = document.createElement('div');
document.body.appendChild(box);
const as = (roles: Access['roles'], rights: Record<string, boolean> = {}) => {
  access.value = { id: 'u-1', full_name: 'X', short_name: null, email: null, phone: null, roles, owner: roles.includes('owner'), lang: 'fr', prefs: {}, color: null, rights: rights as unknown as Access['rights'], trucks: [] };
};
const draw = () => { lang.value = 'fr'; replaceLocal('quotes', []); act(() => render(<QuotesScreen params={{}} query={new URLSearchParams()} />, box)); };
afterEach(() => { act(() => render(null, box)); clearAll(); access.value = null; });

describe('« Nouvelle estimation »', () => {
  it('a mechanic makes one', () => {
    as(['mechanic']);
    draw();
    expect(box.querySelector('[data-testid="quote-new-phone"]')).not.toBeNull();
  });
  it('a treasurer with « Factures » sees the estimates but makes none (the server would refuse)', () => {
    as(['treasurer'], { invoices: true });
    draw();
    expect(box.querySelector('[data-testid="quotes-list"]')).not.toBeNull();
    expect(box.querySelector('[data-testid="quote-new-phone"]')).toBeNull();
  });
});
