/* The « Fiche » of an item: name, part number, category, unit, minimum, first quantity (new item), cost, selling price
   (never for a Coffre item), supplier, notes, « Article actif », « Supprimer cet article ». The form keeps only what the
   person changed (itemForm.ts): the rest follows the item's row as it changes, and only the changes are sent.
   Category, unit and supplier offer the garage's existing words. */
import { useRef, useState } from 'preact/hooks';
import { Trash2 } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { inventoryList } from '../../data/select';
import { uuid } from '../../data/sync';
import type { InventoryItem } from '../../data/types';
import { deleteInventoryItem } from '../../data/api';
import { Form, Field, Input, Textarea, MoneyInput, Switch, Button, attempt, ask } from '../../ui';
import { formOf, checkItem, itemPatch, firstQty, type ItemForm } from './itemRules';
import { saveItem } from './actions';
import { useOnce } from './useOnce';

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => (x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));

/** `onDone`: a new item was added; `onDeleted`: the item is gone (the sheet closes) */
export function EditForm(p: { item: InventoryItem | null; pool: 'garage' | 'coffre'; onDone?: () => void; onDeleted?: () => void }) {
  const { item } = p;
  // the Coffre's stock: no taxes, never sold (no selling price)
  const coffre = (item?.pool ?? p.pool) === 'coffre';
  const l = lang.value;
  const isNew = !item;
  const { busy, once } = useOnce();
  // what the person changed; the other fields show the row as it is now
  const [edited, setEdited] = useState<Partial<ItemForm>>({});
  const f: ItemForm = { ...formOf(item, l), ...edited };
  const [errs, setErrs] = useState<Partial<Record<'name' | 'min' | 'first', string>>>({});
  // the new item's id, chosen once: a second « Ajouter l'article » changes it instead of adding a second item
  const newId = useRef(uuid());
  const set = (patch: Partial<ItemForm>, clear?: 'name' | 'min' | 'first') => {
    setEdited((x) => ({ ...x, ...patch }));
    if (clear) setErrs((x) => ({ ...x, [clear]: undefined }));
  };
  const all = inventoryList.value;
  const categories = uniq(all.map((i) => i.category));
  const units = uniq(['unité', 'L', 'ml', 'jeu', 'boîte', 'paire', 'kg', 'm', ...all.map((i) => i.unit)]);
  const suppliers = uniq(all.map((i) => i.supplier));

  const save = () => once(async () => {
    const e = checkItem(f, isNew);
    setErrs(Object.fromEntries(Object.entries(e).map(([k, v]) => [k, t(`inventory.sheet.${v}`)])));
    if (Object.keys(e).length) return;
    const patch = itemPatch(item, edited, l, p.pool);
    const ok = await attempt(async () => {
      if (!item) return saveItem({ ...patch, id: newId.current }, firstQty(f));
      if (Object.keys(patch).length) return saveItem({ ...patch, id: item.id }, null);
    }, { ok: isNew ? t('inventory.sheet.created') : t('inventory.sheet.saved') });
    if (!ok) return;
    if (isNew) p.onDone?.();
    else setEdited({});
  });
  // gone for good: no history, no link to a service; nothing to undo
  const del = async () => {
    if (!item) return;
    if (!(await ask({ title: t('inventory.sheet.deleteTitle', { name: item.name }), text: t('inventory.sheet.deleteText'), ok: t('inventory.sheet.deleteOk'), danger: true }))) return;
    const ok = await attempt(() => deleteInventoryItem(item.id), { ok: t('inventory.sheet.deleted', { name: item.name }) });
    if (ok) p.onDeleted?.();
  };

  return (
    <Form class="stack inv-edit" onSubmit={save}>
      <Field label={t('inventory.sheet.name')} error={errs.name}>
        <Input value={f.name} maxLength={160} autoFocus={isNew} invalid={!!errs.name} data-testid="item-name" onValue={(v) => set({ name: v }, 'name')} />
      </Field>
      <div class="grid-2">
        <Field label={t('inventory.sheet.sku')} optional hint={t('inventory.sheet.skuHint')}>
          <Input value={f.sku} maxLength={60} autoComplete="off" onValue={(v) => set({ sku: v })} />
        </Field>
        <Field label={t('inventory.sheet.category')} optional hint={t('inventory.sheet.categoryHint')}>
          <Input value={f.category} list="inv-categories" maxLength={60} autoComplete="off" onValue={(v) => set({ category: v })} />
        </Field>
      </div>
      <div class="grid-2">
        <Field label={t('inventory.sheet.unit')} optional hint={t('inventory.sheet.unitHint')}>
          <Input value={f.unit} list="inv-units" maxLength={20} autoComplete="off" onValue={(v) => set({ unit: v })} />
        </Field>
        <Field label={t('inventory.sheet.min')} optional hint={t('inventory.sheet.minHint')} error={errs.min}>
          <Input value={f.min} inputMode="decimal" autoComplete="off" invalid={!!errs.min} data-testid="item-min" onValue={(v) => set({ min: v }, 'min')} />
        </Field>
      </div>
      {isNew && (
        <Field label={t('inventory.sheet.firstQty')} optional hint={t('inventory.sheet.firstQtyHint')} error={errs.first}>
          <Input value={f.first} inputMode="decimal" autoComplete="off" invalid={!!errs.first} data-testid="item-first" onValue={(v) => set({ first: v }, 'first')} />
        </Field>
      )}
      <div class="grid-2">
        <Field label={t(coffre ? 'inventory.coffre.cost' : 'inventory.sheet.cost')} optional hint={t(coffre ? 'inventory.coffre.costHint' : 'inventory.sheet.costHint')}>
          <MoneyInput cents={f.cost} onCents={(c) => set({ cost: c })} aria-label={t('inventory.sheet.cost')} />
        </Field>
        {!coffre && (
          <Field label={t('inventory.sheet.price')} optional hint={t('inventory.sheet.priceHint')}>
            <MoneyInput cents={f.price} onCents={(c) => set({ price: c })} aria-label={t('inventory.sheet.price')} />
          </Field>
        )}
      </div>
      <Field label={t('inventory.sheet.supplier')} optional>
        <Input value={f.supplier} list="inv-suppliers" maxLength={80} autoComplete="off" onValue={(v) => set({ supplier: v })} />
      </Field>
      <Field label={t('inventory.sheet.notes')} optional>
        <Textarea value={f.notes} rows={2} maxLength={500} onValue={(v) => set({ notes: v })} />
      </Field>
      {!isNew && <Switch checked={f.active} onChange={(v) => set({ active: v })} label={t('inventory.sheet.active')} hint={t('inventory.sheet.activeHint')} data-testid="item-active" />}
      <Button variant="primary" type="submit" block busy={busy} data-testid="item-save">{isNew ? t('inventory.sheet.createItem') : t('inventory.sheet.saveItem')}</Button>
      {!isNew && <Button variant="danger" block icon={<Trash2 size={18} />} onClick={del} data-testid="item-delete">{t('inventory.sheet.delete')}</Button>}
      <datalist id="inv-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="inv-units">{units.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="inv-suppliers">{suppliers.map((c) => <option key={c} value={c} />)}</datalist>
    </Form>
  );
}
