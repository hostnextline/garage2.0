/* The form of a move: the quantity (with the unit), « Payé par » and the price for an « Entrée » that was paid, a note.
   One submit at a time (useOnce): the button turns busy while the server answers, a second tap does nothing. */
import { useEffect, useState } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import type { InventoryItem } from '../../data/types';
import type { PaidFrom } from '../../data/api';
import { Form, Field, Input, MoneyInput, Button, Seg, toast, attempt } from '../../ui';
import { formatQty, unitWord, REASON, type MoveKind } from '../../domain/stock/stock';
import { checkMove, moveHint } from './moveRules';
import { recordMove, recordPurchase } from './actions';
import { useQty, signed } from './useQty';
import { useOnce } from './useOnce';

/** `item` carries the quantity on hand; `tap` changes at each tap on a move button */
export function MoveForm(p: { item: InventoryItem; mode: MoveKind; tap: number }) {
  const { item, mode } = p;
  const l = lang.value;
  const qtyText = useQty();
  const { busy, once } = useOnce();
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // « Entrée »: what was paid, and who paid it (the money leaves the Trésorerie or the Coffre by itself)
  const [price, setPrice] = useState<number | null>(null);
  const [from, setFrom] = useState<PaidFrom>('none');
  const [vendor, setVendor] = useState('');
  const [priceErr, setPriceErr] = useState<string | null>(null);
  useEffect(() => { setErr(null); if (mode === 'count') setText(''); }, [p.tap]);
  const cur = Number(item.qty);
  const coffre = item.pool === 'coffre';
  const unitShown = unitWord(item.unit === 'unité' ? '' : item.unit, 2, l);

  const submit = () => once(async () => {
    const c = checkMove(mode, text, cur, from, price);
    if (!c.ok) {
      if (c.field === 'price') setPriceErr(t('inventory.sheet.buy.needPrice'));
      else setErr(t(`inventory.sheet.${c.error}`));
      return;
    }
    if (c.same) { toast(t('inventory.sheet.same'), { kind: 'ok' }); setText(''); return; }
    const clean = { note: note.trim() || null, vendor: vendor.trim() || null };
    if (c.paid) {
      const ok = await attempt(() => recordPurchase(item.id, c.delta, price, from, clean.vendor, clean.note),
        { ok: t(from === 'coffre' ? 'inventory.sheet.buy.doneCoffre' : 'inventory.sheet.buy.doneTreasury', { amount: money(price ?? 0, l) }) });
      if (ok) { setText(''); setNote(''); setErr(null); setPrice(null); setVendor(''); setFrom('none'); setPriceErr(null); }
      return;
    }
    const ok = await attempt(() => recordMove(item.id, c.delta, REASON[mode], clean.note), { ok: t(`inventory.sheet.done.${mode}`) });
    if (ok) { setText(''); setNote(''); setErr(null); }
  });

  const h = moveHint(mode, text, cur);
  const hint = !h ? null
    : h.kind === 'negative' ? <span class="inv-warn-text">{t('inventory.sheet.negative', { qty: formatQty(h.after, l) })}</span>
    : h.kind === 'same' ? t('inventory.sheet.same')
    : h.kind === 'diff' ? t('inventory.sheet.diff', { delta: signed(h.delta, qtyText(Math.abs(h.delta), item.unit)) })
    : t('inventory.sheet.after', { qty: qtyText(h.after, item.unit) });

  return (
    <Form class="stack inv-move-form" onSubmit={submit}>
      <Field label={t(`inventory.sheet.qty.${mode}`)} error={err} hint={hint}>
        <span class="input-wrap inv-qty-wrap">
          <Input value={text} inputMode="decimal" autoComplete="off" autoFocus aria-label={t(`inventory.sheet.qty.${mode}`)} data-testid="move-qty" invalid={!!err}
            onValue={(x) => { setText(x); setErr(null); }} />
          {unitShown && <span class="input-unit" aria-hidden="true">{unitShown}</span>}
        </span>
      </Field>
      {mode === 'in' && (
        <div class="stack inv-buy" data-testid="move-buy">
          <Field label={t('inventory.sheet.buy.from')} help={t(coffre ? 'inventory.coffre.fromHelp' : 'inventory.sheet.buy.fromHelp')} group>
            <Seg value={from} onValue={(v) => { setFrom(v); setPriceErr(null); }} label={t('inventory.sheet.buy.from')} data-testid="move-from"
              options={coffre
                ? [{ value: 'none', label: t('inventory.sheet.buy.none') }, { value: 'coffre', label: t('inventory.sheet.buy.coffre') }]
                : [{ value: 'none', label: t('inventory.sheet.buy.none') }, { value: 'treasury', label: t('inventory.sheet.buy.treasury') }]} />
          </Field>
          {from !== 'none' && <>
            <Field label={t(coffre ? 'inventory.coffre.price' : 'inventory.sheet.buy.price')} hint={t(from === 'coffre' ? 'inventory.sheet.buy.priceHintCoffre' : 'inventory.sheet.buy.priceHintTreasury')} error={priceErr}>
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
      <Button variant="primary" type="submit" block busy={busy} data-testid="move-save">{t(`inventory.sheet.save.${mode}`)}</Button>
    </Form>
  );
}
