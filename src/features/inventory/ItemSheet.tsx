/* An item of the inventory: what is on the shelf, the three moves (Entrée, Sortie, Compter), the history of moves
   (when, who, which job), and its sheet (name, part number, category, unit, minimum, cost, price, supplier, notes,
   active). Phone: two tabs. Computer: side by side. */
import { useState } from 'preact/hooks';
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, RotateCcw, Trash2 } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { stamp } from '../../lib/dates';
import { getRow } from '../../data/store';
import { inventoryList, movesOf, staffName, job } from '../../data/select';
import type { InventoryItem, InventoryMove } from '../../data/types';
import { wide } from '../../app/media';
import { Sheet, Tabs, Form, Field, Input, Textarea, MoneyInput, Switch, Button, Pill, Help, Empty, Seg, toast, attempt, ask } from '../../ui';
import { deleteInventoryItem, type PaidFrom } from '../../data/api';
import { parseQty, formatQty, qtyLabel, unitWord, itemValue, isLow, moveDelta, round2, recordMove, recordPurchase, saveItem, REASON, type MoveKind } from './stock';

export function useQty() {
  const l = lang.value;
  return (n: number | null | undefined, unit: string | null | undefined) => qtyLabel(n, unit, l, (k) => t('inventory.units', { n: k, q: formatQty(k, l) }));
}
const signed = (n: number, text: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}`;

/** `pool`: the stock a new item goes to (the garage's, or the Coffre's) */
export function ItemSheet(p: { open: boolean; itemId: string | null; onClose: () => void; pool?: 'garage' | 'coffre' }) {
  if (!p.open) return null;
  return <ItemPanel key={p.itemId || 'new'} itemId={p.itemId} onClose={p.onClose} pool={p.pool || 'garage'} />;
}

function ItemPanel(p: { itemId: string | null; onClose: () => void; pool: 'garage' | 'coffre' }) {
  const item = p.itemId ? getRow<InventoryItem>('inventory_items', p.itemId) : undefined;
  const [tab, setTab] = useState<'stock' | 'edit'>('stock');
  const isWide = wide.value;
  if (p.itemId && !item) {
    // removed meanwhile (on another phone)
    return <Sheet open onClose={p.onClose} title={t('inventory.title')} data-testid="item-sheet"><Empty title={t('errors.not_found')} /></Sheet>;
  }
  if (!item) {
    return (
      <Sheet open onClose={p.onClose} title={t(p.pool === 'coffre' ? 'inventory.coffre.newTitle' : 'inventory.sheet.newTitle')} data-testid="item-sheet">
        <EditForm item={null} pool={p.pool} onDone={p.onClose} />
      </Sheet>
    );
  }
  const sub = [item.category, item.supplier].filter(Boolean).join(', ');
  return (
    <Sheet open onClose={p.onClose} wide title={item.name} sub={sub || undefined} data-testid="item-sheet">
      {isWide ? (
        <div class="inv-sheet-cols">
          <StockPart item={item} />
          <section class="inv-sheet-edit"><h3 class="inv-h3">{t('inventory.sheet.tabs.edit')}</h3><EditForm item={item} /></section>
        </div>
      ) : (
        <div class="stack-lg">
          <Tabs value={tab} onValue={setTab} label={item.name} tabs={[{ value: 'stock', label: t('inventory.sheet.tabs.stock') }, { value: 'edit', label: t('inventory.sheet.tabs.edit') }]} />
          {tab === 'stock' ? <StockPart item={item} /> : <EditForm item={item} />}
        </div>
      )}
    </Sheet>
  );
}

const MOVES: { k: MoveKind; Icon: typeof ArrowDownToLine }[] = [
  { k: 'in', Icon: ArrowDownToLine }, { k: 'out', Icon: ArrowUpFromLine }, { k: 'count', Icon: ClipboardCheck }
];

function StockPart(p: { item: InventoryItem }) {
  const { item } = p;
  const l = lang.value;
  const qtyText = useQty();
  const [mode, setMode] = useState<MoveKind | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // « Entrée »: what was paid, and who paid it (the money leaves the Trésorerie or the Coffre by itself)
  const [price, setPrice] = useState<number | null>(null);
  const [from, setFrom] = useState<PaidFrom>('none');
  const [vendor, setVendor] = useState('');
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const cur = Number(item.qty);
  const amount = parseQty(text);
  const delta = mode && amount != null ? moveDelta(mode, amount, cur) : null;
  const after = delta != null ? round2(cur + delta) : null;
  const v = itemValue(item);
  const unitShown = unitWord(item.unit === 'unité' ? '' : item.unit, 2, l);

  const submit = async () => {
    if (!mode) return;
    if (amount == null) { setErr(t('inventory.sheet.errQty')); return; }
    if (mode !== 'count' && amount <= 0) { setErr(t('inventory.sheet.errZero')); return; }
    const d = moveDelta(mode, amount, cur);
    if (d === 0) { toast(t('inventory.sheet.same'), { kind: 'ok' }); setText(''); return; }
    if (mode === 'in' && from !== 'none') {
      if (!price || price <= 0) { setPriceErr(t('inventory.sheet.buy.needPrice')); return; }
      const ok = await attempt(() => recordPurchase(item.id, d, price, from, vendor.trim() || null, note.trim() || null),
        { ok: t(from === 'coffre' ? 'inventory.sheet.buy.doneCoffre' : 'inventory.sheet.buy.doneTreasury', { amount: money(price, l) }) });
      if (ok) { setText(''); setNote(''); setErr(null); setPrice(null); setVendor(''); setFrom('none'); setPriceErr(null); }
      return;
    }
    const ok = await attempt(() => recordMove(item.id, d, REASON[mode], note.trim() || null), { ok: t(`inventory.sheet.done.${mode}`) });
    if (ok) { setText(''); setNote(''); setErr(null); }
  };

  let hint: string | null = null;
  if (mode === 'count' && delta != null) hint = delta === 0 ? t('inventory.sheet.same') : t('inventory.sheet.diff', { delta: signed(delta, qtyText(Math.abs(delta), item.unit)) });
  else if (after != null && after >= 0) hint = t('inventory.sheet.after', { qty: qtyText(after, item.unit) });

  return (
    <div class="stack-lg inv-stock">
      <div class="inv-onhand" data-testid="item-onhand">
        <span class="inv-label">{t('inventory.sheet.onHand')}</span>
        <span class={`inv-big num${isLow(item) ? ' is-low' : ''}`} data-testid="item-qty">{qtyText(cur, item.unit)}</span>
        <span class="small muted">
          {item.min_qty != null ? t('inventory.minLine', { qty: qtyText(Number(item.min_qty), item.unit) }) : t('inventory.noMin')}
          {v != null && <>{'. '}{t('inventory.sheet.valueLine', { amount: money(v, l) })}</>}
        </span>
        {isLow(item) && <Pill tone="warn">{t('inventory.low.pill')}</Pill>}
      </div>

      <div class="stack">
        <span class="inv-label">{t('inventory.sheet.movesTitle')} <Help text={t('inventory.sheet.movesHelp')} /></span>
        <div class="inv-moves" role="group" aria-label={t('inventory.sheet.movesTitle')}>
          {MOVES.map(({ k, Icon }) => (
            <button key={k} type="button" class="inv-move" aria-pressed={mode === k} data-testid={`move-${k}`}
              onClick={() => { setMode(k); setErr(null); if (k === 'count') setText(''); }}>
              <Icon size={22} aria-hidden="true" /><span>{t(`inventory.sheet.moves.${k}`)}</span>
            </button>
          ))}
        </div>
        {mode && (
          <Form class="stack inv-move-form" onSubmit={submit}>
            <Field label={t(`inventory.sheet.qty.${mode}`)} error={err}
              hint={after != null && after < 0 ? <span class="tre-warn">{t('inventory.sheet.negative', { qty: formatQty(after, l) })}</span> : hint}>
              <span class="input-wrap inv-qty-wrap">
                <Input value={text} inputMode="decimal" autoComplete="off" autoFocus aria-label={t(`inventory.sheet.qty.${mode}`)} data-testid="move-qty" invalid={!!err}
                  onValue={(x) => { setText(x); setErr(null); }} />
                {unitShown && <span class="input-unit" aria-hidden="true">{unitShown}</span>}
              </span>
            </Field>
            {mode === 'in' && (
              <div class="stack inv-buy" data-testid="move-buy">
                <Field label={t('inventory.sheet.buy.from')} help={t(item.pool === 'coffre' ? 'inventory.coffre.fromHelp' : 'inventory.sheet.buy.fromHelp')} group>
                  <Seg value={from} onValue={(v) => { setFrom(v); setPriceErr(null); }} label={t('inventory.sheet.buy.from')} data-testid="move-from"
                    options={item.pool === 'coffre'
                      ? [{ value: 'none', label: t('inventory.sheet.buy.none') }, { value: 'coffre', label: t('inventory.sheet.buy.coffre') }]
                      : [{ value: 'none', label: t('inventory.sheet.buy.none') }, { value: 'treasury', label: t('inventory.sheet.buy.treasury') }]} />
                </Field>
                {from !== 'none' && <>
                  <Field label={t(item.pool === 'coffre' ? 'inventory.coffre.price' : 'inventory.sheet.buy.price')} hint={t(from === 'coffre' ? 'inventory.sheet.buy.priceHintCoffre' : 'inventory.sheet.buy.priceHintTreasury')} error={priceErr}>
                    <MoneyInput cents={price} onCents={(c) => { setPrice(c); setPriceErr(null); }} aria-label={t('inventory.sheet.buy.price')} data-testid="move-price" />
                  </Field>
                  <Field label={t('inventory.sheet.buy.vendor')} optional>
                    <Input value={vendor} maxLength={80} autoComplete="off" onValue={setVendor} data-testid="move-vendor" />
                  </Field>
                </>}
              </div>
            )}
            <Field label={t('inventory.sheet.note')} optional hint={t('inventory.sheet.noteHint')}>
              <Input value={note} maxLength={200} onValue={setNote} data-testid="move-note" />
            </Field>
            <Button variant="primary" type="submit" block data-testid="move-save">{t(`inventory.sheet.save.${mode}`)}</Button>
          </Form>
        )}
      </div>
      <History item={item} />
    </div>
  );
}

const REASON_ICON = { restock: ArrowDownToLine, used: ArrowUpFromLine, adjust: ClipboardCheck, return: RotateCcw };
function History(p: { item: InventoryItem }) {
  const qtyText = useQty();
  const l = lang.value;
  const moves = movesOf(p.item.id).slice(0, 60);
  return (
    <section class="stack" data-testid="item-history">
      <h3 class="inv-h3">{t('inventory.sheet.history')}</h3>
      {moves.length ? (
        <ul class="inv-hist">
          {moves.map((m: InventoryMove) => {
            const Icon = REASON_ICON[m.reason] || ClipboardCheck;
            const d = Number(m.delta);
            const who = staffName(m.created_by);
            const j = m.job_id ? job(m.job_id) : undefined;
            const jobText = m.job_id ? t('inventory.sheet.job', { n: j?.number ?? '' }).trim() : '';
            const note = m.note && m.note.trim() !== jobText && !(m.job_id && /^job\s*\d+$/i.test(m.note.trim())) ? m.note : null;
            return (
              <li key={m.id} class="inv-hist-item" data-testid="move-row">
                <span class={`inv-hist-icon is-${m.reason}`} aria-hidden="true"><Icon size={18} /></span>
                <div class="grow stack" style={{ gap: '2px' }}>
                  <div class="inv-hist-top">
                    <b>{t(`inventory.sheet.reasons.${m.reason}`)}</b>
                    <span class={`num${d < 0 ? ' inv-minus' : ''}`}>{signed(d, qtyText(Math.abs(d), p.item.unit))}</span>
                  </div>
                  <span class="small muted">
                    {stamp(m.created_at, l)}{who && <>, {t('inventory.sheet.by', { name: who })}</>}
                    {!m.updated_at && <> <span class="inv-pending">{t('inventory.sheet.pending')}</span></>}
                  </span>
                  {(note || m.job_id) && (
                    <span class="small inv-hist-note">
                      {note}
                      {m.job_id && <a class="inv-job" href={`#/job/${m.job_id}`}>{jobText || m.note || t('inventory.sheet.job', { n: '' })}</a>}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p class="muted" style={{ margin: 0 }}>{t('inventory.sheet.noHistory')}</p>}
    </section>
  );
}

interface ItemForm { name: string; sku: string; category: string; unit: string; min: string; cost: number | null; price: number | null; supplier: string; notes: string; active: boolean; first: string }
function EditForm(p: { item: InventoryItem | null; pool?: 'garage' | 'coffre'; onDone?: () => void }) {
  const { item } = p;
  // the Coffre's stock: no taxes, never sold (no selling price)
  const coffre = (item?.pool ?? p.pool) === 'coffre';
  const l = lang.value;
  const isNew = !item;
  const [f, setF] = useState<ItemForm>(() => ({
    name: item?.name || '', sku: item?.sku || '', category: item?.category || '', unit: item?.unit || '',
    min: item?.min_qty != null ? formatQty(Number(item.min_qty), l) : '', cost: item?.cost_cents ?? null, price: item?.price_cents ?? null,
    supplier: item?.supplier || '', notes: item?.notes || '', active: item ? item.active : true, first: ''
  }));
  const [errs, setErrs] = useState<Partial<Record<'name' | 'min' | 'first', string>>>({});
  const set = (patch: Partial<ItemForm>) => setF((x) => ({ ...x, ...patch }));
  const all = inventoryList.value;
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => (x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const categories = uniq(all.map((i) => i.category));
  const units = uniq(['unité', 'L', 'ml', 'jeu', 'boîte', 'paire', 'kg', 'm', ...all.map((i) => i.unit)]);
  const suppliers = uniq(all.map((i) => i.supplier));

  const save = async () => {
    const e: typeof errs = {};
    if (!f.name.trim()) e.name = t('inventory.sheet.errName');
    const min = f.min.trim() ? parseQty(f.min) : null;
    if (f.min.trim() && min == null) e.min = t('inventory.sheet.errNumber');
    const first = isNew && f.first.trim() ? parseQty(f.first) : null;
    if (isNew && f.first.trim() && first == null) e.first = t('inventory.sheet.errNumber');
    setErrs(e);
    if (Object.keys(e).length) return;
    const ok = await attempt(() => saveItem({
      ...(item ? { id: item.id } : {}),
      name: f.name.trim(), sku: f.sku.trim() || null, category: f.category.trim() || null, unit: f.unit.trim() || 'unité',
      min_qty: min, cost_cents: f.cost, price_cents: coffre ? null : f.price, supplier: f.supplier.trim() || null, notes: f.notes.trim() || null, active: f.active,
      ...(item ? {} : { pool: coffre ? 'coffre' as const : 'garage' as const })
    }, first), { ok: isNew ? t('inventory.sheet.created') : t('inventory.sheet.saved') });
    if (ok && isNew) p.onDone?.();
  };
  // gone for good: no history, no link to a service; nothing to undo
  const del = async () => {
    if (!item) return;
    if (!(await ask({ title: t('inventory.sheet.deleteTitle', { name: item.name }), text: t('inventory.sheet.deleteText'), ok: t('inventory.sheet.deleteOk'), danger: true }))) return;
    const ok = await attempt(() => deleteInventoryItem(item.id), { ok: t('inventory.sheet.deleted', { name: item.name }) });
    if (ok) p.onDone?.();
  };

  return (
    <Form class="stack inv-edit" onSubmit={save}>
      <Field label={t('inventory.sheet.name')} error={errs.name}>
        <Input value={f.name} maxLength={160} autoFocus={isNew} invalid={!!errs.name} data-testid="item-name" onValue={(v) => { set({ name: v }); setErrs((x) => ({ ...x, name: undefined })); }} />
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
          <Input value={f.min} inputMode="decimal" autoComplete="off" invalid={!!errs.min} data-testid="item-min" onValue={(v) => { set({ min: v }); setErrs((x) => ({ ...x, min: undefined })); }} />
        </Field>
      </div>
      {isNew && (
        <Field label={t('inventory.sheet.firstQty')} optional hint={t('inventory.sheet.firstQtyHint')} error={errs.first}>
          <Input value={f.first} inputMode="decimal" autoComplete="off" invalid={!!errs.first} data-testid="item-first" onValue={(v) => { set({ first: v }); setErrs((x) => ({ ...x, first: undefined })); }} />
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
      <Button variant="primary" type="submit" block data-testid="item-save">{isNew ? t('inventory.sheet.createItem') : t('inventory.sheet.saveItem')}</Button>
      {!isNew && <Button variant="danger" block icon={<Trash2 size={18} />} onClick={del} data-testid="item-delete">{t('inventory.sheet.delete')}</Button>}
      <datalist id="inv-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="inv-units">{units.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="inv-suppliers">{suppliers.map((c) => <option key={c} value={c} />)}</datalist>
    </Form>
  );
}
