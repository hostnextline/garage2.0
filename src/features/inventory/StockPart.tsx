/* The « Stock » part of an item's sheet: the quantity on hand (warning colour and pill when low), the minimum and the
   value, the three moves (Entrée, Sortie, Compter) and the history. The quantity is the one on hand (useOnHand): the
   row plus what still waits to be sent. */
import { useState } from 'preact/hooks';
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import type { InventoryItem } from '../../data/types';
import { Pill, Help } from '../../ui';
import { itemValue, isLow, type MoveKind } from '../../domain/stock/stock';
import { useQty } from './useQty';
import { useOnHand } from './useOnHand';
import { MoveForm } from './MoveForm';
import { History } from './History';

const MOVES: { k: MoveKind; Icon: typeof ArrowDownToLine }[] = [
  { k: 'in', Icon: ArrowDownToLine }, { k: 'out', Icon: ArrowUpFromLine }, { k: 'count', Icon: ClipboardCheck }
];

export function StockPart(p: { item: InventoryItem }) {
  const l = lang.value;
  const qtyText = useQty();
  const qty = useOnHand()(p.item);
  const item = qty === Number(p.item.qty) ? p.item : { ...p.item, qty };
  const [mode, setMode] = useState<MoveKind | null>(null);
  // each tap on a move clears the form's error, and a count starts from an empty quantity (what was typed stays otherwise)
  const [tap, setTap] = useState(0);
  const v = itemValue(item);
  const low = isLow(item);

  return (
    <div class="stack-lg inv-stock">
      <div class="inv-onhand" data-testid="item-onhand">
        <span class="inv-label">{t('inventory.sheet.onHand')}</span>
        <span class={`inv-big num${low ? ' is-low' : ''}`} data-testid="item-qty">{qtyText(qty, item.unit)}</span>
        <span class="small muted">
          {item.min_qty != null ? t('inventory.minLine', { qty: qtyText(Number(item.min_qty), item.unit) }) : t('inventory.noMin')}
          {v != null && <>{'. '}{t('inventory.sheet.valueLine', { amount: money(v, l) })}</>}
        </span>
        {low && <Pill tone="warn">{t('inventory.low.pill')}</Pill>}
      </div>

      <div class="stack">
        <span class="inv-label">{t('inventory.sheet.movesTitle')} <Help text={t('inventory.sheet.movesHelp')} /></span>
        <div class="inv-moves" role="group" aria-label={t('inventory.sheet.movesTitle')}>
          {MOVES.map(({ k, Icon }) => (
            <button key={k} type="button" class="inv-move" aria-pressed={mode === k} data-testid={`move-${k}`}
              onClick={() => { setMode(k); setTap((n) => n + 1); }}>
              <Icon size={22} aria-hidden="true" /><span>{t(`inventory.sheet.moves.${k}`)}</span>
            </button>
          ))}
        </div>
        {mode && <MoveForm item={item} mode={mode} tap={tap} />}
      </div>
      <History item={item} />
    </div>
  );
}
