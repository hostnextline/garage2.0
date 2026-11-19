/* DEV ONLY — pretend stock operations: « Entrée » paid by the Trésorerie or the Coffre (inventory_buy, Part 24
   quinquies) and « Supprimer cet article » (inventory_delete, Part 24 quater), with the database's rules. They used to be
   missing: the demo answered « ok » and nothing happened (demo-01). */
import { registerRpc, put, find, table, db, rows, refuse, nowIso, uuid, type DemoRow } from '../fake-server';
import { can, demoUser, isOwner, need } from '../demo-rules';
import { today } from '../../lib/dates';

const qtyText = (q: number) => String(Math.round(q * 100) / 100).replace('.', ',');

function operations() {
  registerRpc('inventory_buy', (a) => {
    need(isOwner() || can('inventory'), 'Tu n’as pas le droit de changer l’inventaire.');
    const from = String(a.p_from ?? '');
    if (!['treasury', 'coffre', 'none'].includes(from)) refuse('bad_from', 'Choisis qui paie : la Trésorerie ou le Coffre.');
    const it = find('inventory_items', a.p_item);
    if (!it || it.deleted_at) refuse('not_found', 'Cet article n’existe plus.');
    const pool = it.pool === 'coffre' ? 'coffre' : 'garage';
    if (pool === 'coffre' && from === 'treasury') refuse('bad_from', 'Un article du Coffre se paie avec l’argent du Coffre.');
    if (pool === 'garage' && from === 'coffre') refuse('bad_from', 'Un article du garage se paie par la Trésorerie. Pour l’argent du Coffre, ajoute l’article au stock du Coffre.');
    const qty = Number(a.p_qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) refuse('bad_qty', 'Écris une quantité plus grande que zéro.');
    const total = Number(a.p_total_cents);
    if (from !== 'none' && (!Number.isFinite(total) || total <= 0 || total > 100000000)) {
      refuse('bad_amount', pool === 'coffre' ? 'Écris le prix payé.' : 'Écris le prix payé (le total, taxes incluses).');
    }
    const vendor = String(a.p_vendor ?? '').trim() || null, note = String(a.p_note ?? '').trim() || null;
    const paidBy = from === 'treasury' ? 'Payé par la Trésorerie' : from === 'coffre' ? 'Payé par le Coffre' : null;
    const move = put('inventory_moves', { id: uuid(), item_id: it.id, delta: qty, reason: 'restock', job_id: null,
      note: [vendor, note, paidBy].filter(Boolean).join(' · ') || null, created_by: demoUser() });
    // the quantity follows the move (the database's trigger)
    put('inventory_items', { id: it.id, qty: Math.round((Number(it.qty) + qty) * 100) / 100, ...(from !== 'none' ? { cost_cents: Math.round(total / qty) } : {}) });
    let expense: DemoRow | undefined, coffre: DemoRow | undefined;
    if (from === 'treasury') {
      const tx = (find('settings', '1')?.taxes || {}) as { enabled?: boolean; tps?: number; tvq?: number };
      const on = tx.enabled !== false, tps = tx.tps ?? 0.05, tvq = tx.tvq ?? 0.09975;
      const sub = on ? Math.round(total / (1 + tps + tvq)) : total, tpsC = on ? Math.round(sub * tps) : 0;
      expense = put('expenses', { id: uuid(), day: today(), vendor, category: 'Pièces', description: `${qtyText(qty)} × ${String(it.name)}`, subtotal_cents: sub, tps_cents: tpsC,
        tvq_cents: on ? total - sub - tpsC : 0, total_cents: total, method: null, truck_id: null, receipt_id: null, notes: note, created_by: demoUser(), move_id: move.id });
    } else if (from === 'coffre') {
      coffre = put('coffre', { id: uuid(), kind: 'purchase', customer_id: null, amount_cents: total, value_cents: 0, received_on: today(), note: [vendor, note].filter(Boolean).join(' · ') || null,
        item_id: it.id, item_name: it.name, qty, created_by: demoUser(), move_id: move.id, job_ids: [], job_numbers: [] });
    }
    return { ok: true, move_id: move.id, expense_id: expense?.id ?? null, coffre_id: coffre?.id ?? null,
      rows: rows({ inventory_items: find('inventory_items', it.id), inventory_moves: move, expenses: expense }) };
  });
  registerRpc('inventory_delete', (a) => {
    need(isOwner() || can('inventory'), 'Tu n’as pas le droit de changer l’inventaire.');
    const it = find('inventory_items', a.p_item);
    if (!it) refuse('not_found', 'Cet article n’existe plus.');
    // its moves and its links to services go with it (foreign keys)
    db.inventory_moves = table('inventory_moves').filter((m) => m.item_id !== it.id);
    db.service_parts = table('service_parts').filter((p) => p.item_id !== it.id);
    db.inventory_items = table('inventory_items').filter((x) => x.id !== it.id);
    return { ok: true, id: it.id, name: it.name, at: nowIso() };
  });
}

export function load() {
  try { operations(); } catch (e) { console.warn('demo-extra/inventory', e); }
}
