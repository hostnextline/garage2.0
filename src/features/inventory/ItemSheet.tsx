/* An item of the inventory: what is on the shelf and the three moves (StockPart), the history of moves (History), and
   its sheet (EditForm). Phone: two tabs. Computer: side by side. */
import { useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { getRow } from '../../data/store';
import type { InventoryItem } from '../../data/types';
import { wide } from '../../platform/media';
import { Sheet, Tabs, Empty } from '../../ui';
import { StockPart } from './StockPart';
import { EditForm } from './EditForm';

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
  // after « Supprimer cet article » the sheet closes (it said « introuvable » under the toast « supprimé »)
  return (
    <Sheet open onClose={p.onClose} wide title={item.name} sub={sub || undefined} data-testid="item-sheet">
      {isWide ? (
        <div class="inv-sheet-cols">
          <StockPart item={item} />
          <section class="inv-sheet-edit"><h3 class="inv-h3">{t('inventory.sheet.tabs.edit')}</h3><EditForm item={item} pool={p.pool} onDeleted={p.onClose} /></section>
        </div>
      ) : (
        <div class="stack-lg">
          <Tabs value={tab} onValue={setTab} label={item.name} tabs={[{ value: 'stock', label: t('inventory.sheet.tabs.stock') }, { value: 'edit', label: t('inventory.sheet.tabs.edit') }]} />
          {tab === 'stock' ? <StockPart item={item} /> : <EditForm item={item} pool={p.pool} onDeleted={p.onClose} />}
        </div>
      )}
    </Sheet>
  );
}
