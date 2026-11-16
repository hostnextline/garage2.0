/* The item sheet with a pretend server: one tap = one purchase, one move, one item, however fast the second tap
   comes; the sheet closes after a delete; a purchase kept on the phone is not announced as an expense. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

const calls: { name: string; args: unknown[] }[] = [];
let answer: () => Promise<unknown> = async () => ({ queued: false, data: { ok: true } });
vi.mock('../../data/api', async (orig) => {
  const real = await orig<typeof import('../../data/api')>();
  return {
    ...real,
    buyStock: async (...args: unknown[]) => { calls.push({ name: 'buyStock', args }); return answer(); },
    moveStock: async (...args: unknown[]) => { calls.push({ name: 'moveStock', args }); await answer(); return `m${calls.length}`; },
    saveInventoryItem: async (i: { id?: string }) => { calls.push({ name: 'saveInventoryItem', args: [i] }); await answer(); return i.id || 'new'; },
    deleteInventoryItem: async (id: string) => { calls.push({ name: 'deleteInventoryItem', args: [id] }); return { ok: true }; }
  };
});
vi.mock('../../ui', async (orig) => {
  const real = await orig<typeof import('../../ui')>();
  return { ...real, ask: async () => true };
});
import { ItemSheet } from './ItemSheet';
import { replaceLocal } from '../../data/store';
import { toasts } from '../../ui/toast';
import { lang } from '../../lib/i18n';

const box = document.createElement('div');
document.body.appendChild(box);
// the sheet is drawn at the end of the page, outside the box
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const type = (el: HTMLElement, v: string) => act(() => { const i = (el.tagName === 'INPUT' ? el : el.querySelector('input')) as HTMLInputElement; i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); });
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });

const ITEM = { id: 'i1', name: 'Huile 5W-30', qty: 38, unit: 'L', min_qty: 20, cost_cents: 650, price_cents: null, active: true, pool: 'garage', sku: null, category: 'Huile', supplier: null, notes: null, updated_at: '2026-11-15T10:00:00+00:00' };
let closed = 0;
const open = (id: string | null) => act(() => render(<ItemSheet open itemId={id} onClose={() => { closed++; }} />, box));

beforeEach(() => {
  calls.length = 0; closed = 0; toasts.value = []; lang.value = 'fr';
  answer = async () => ({ queued: false, data: { ok: true } });
  replaceLocal('inventory_items', [ITEM]);
  replaceLocal('inventory_moves', []);
});
afterEach(() => act(() => render(null, box)));

describe('one tap, one write', () => {
  it('two taps on « Ajouter au stock » paid by the Trésorerie send ONE purchase; the button is busy meanwhile; the next purchase goes through', async () => {
    answer = () => new Promise((r) => setTimeout(() => r({ queued: false, data: { ok: true } }), 300));
    await open('i1');
    await click(q('move-in'));
    await type(q('move-qty'), '24');
    await click(q('move-from').querySelectorAll('button')[1]);
    await type(q('move-buy').querySelector('input.input-money') as HTMLElement, '240,00');
    await click(q('move-save'));
    await wait(20);
    expect(q('move-save').getAttribute('aria-busy')).toBe('true');
    await click(q('move-save'));
    await wait(400);
    expect(calls.filter((c) => c.name === 'buyStock')).toHaveLength(1);
    expect(calls[0].args.slice(0, 4)).toEqual(['i1', 24, 24000, 'treasury']);
    expect(q('move-save').getAttribute('aria-busy')).toBeNull();
    // a real second purchase, typed again, is sent
    await type(q('move-qty'), '24');
    await click(q('move-from').querySelectorAll('button')[1]);
    await type(q('move-buy').querySelector('input.input-money') as HTMLElement, '240,00');
    await click(q('move-save'));
    await wait(400);
    expect(calls.filter((c) => c.name === 'buyStock')).toHaveLength(2);
  });
  it('a purchase kept on the phone (no signal) says so, not « ajouté aux dépenses »', async () => {
    answer = async () => ({ queued: true });
    await open('i1');
    await click(q('move-in'));
    await type(q('move-qty'), '24');
    await click(q('move-from').querySelectorAll('button')[1]);
    await type(q('move-buy').querySelector('input.input-money') as HTMLElement, '240,00');
    await click(q('move-save'));
    await wait(20);
    const said = toasts.value.map((x) => x.text).join(' | ');
    expect(said).not.toMatch(/dépenses/);
    expect(said).toMatch(/téléphone/i);
    expect(toasts.value).toHaveLength(1);
  });
  it('two fast taps on « Retirer du stock » make one move', async () => {
    answer = () => new Promise((r) => setTimeout(r, 200));
    await open('i1');
    await click(q('move-out'));
    await type(q('move-qty'), '4');
    await click(q('move-save'));
    await click(q('move-save'));
    await wait(300);
    expect(calls.filter((c) => c.name === 'moveStock')).toHaveLength(1);
  });
  it('two taps on « Ajouter l’article » make one item (one id, chosen once)', async () => {
    answer = () => new Promise((r) => setTimeout(r, 200));
    await open(null);
    await type(q('item-name'), 'Filtre PH7317');
    await click(q('item-save'));
    await click(q('item-save'));
    await wait(300);
    const saves = calls.filter((c) => c.name === 'saveInventoryItem');
    expect(saves).toHaveLength(1);
    expect((saves[0].args[0] as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
    expect(closed).toBe(1);
  });
});

describe('the sheet', () => {
  it('the quantity on hand counts a move still waiting on the phone, and « Compter » sends the difference with it', async () => {
    replaceLocal('inventory_moves', [{ id: 'w1', item_id: 'i1', delta: -4, reason: 'used', note: null, created_at: '2026-11-15T11:00:00Z', updated_at: null }]);
    await open('i1');
    expect(q('item-qty').textContent).toBe('34 L');
    await click(q('move-count'));
    await type(q('move-qty'), '34');
    await click(q('move-save'));
    await wait(10);
    expect(calls.filter((c) => c.name === 'moveStock')).toHaveLength(0);   // « Le compte est juste »
  });
  it('a « Sortie » bigger than the stock warns in the inventory’s own warning colour', async () => {
    await open('i1');
    await click(q('move-out'));
    await type(q('move-qty'), '40');
    expect(document.querySelector('.inv-warn-text')?.textContent).toMatch(/−2|-2/);
  });
  it('the sheet closes after « Supprimer cet article »', async () => {
    await open('i1');
    // the phone layout: the « Fiche » tab
    const tab = [...document.querySelectorAll('[role="tab"]')].find((x) => /Fiche/.test(x.textContent || ''));
    if (tab) await click(tab);
    await click(q('item-delete'));
    await wait(10);
    expect(calls.map((c) => c.name)).toContain('deleteInventoryItem');
    expect(closed).toBe(1);
  });
  it('« Enregistrer l’article » sends only the minimum changed (the cost set meanwhile is kept)', async () => {
    await open('i1');
    const tab = [...document.querySelectorAll('[role="tab"]')].find((x) => /Fiche/.test(x.textContent || ''));
    if (tab) await click(tab);
    await act(() => replaceLocal('inventory_items', [{ ...ITEM, cost_cents: 1000 }]));
    await type(q('item-min'), '25');
    await click(q('item-save'));
    await wait(10);
    expect(calls.find((c) => c.name === 'saveInventoryItem')?.args[0]).toEqual({ id: 'i1', min_qty: 25 });
  });
});
