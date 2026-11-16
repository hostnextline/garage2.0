/* The inventory parts a service uses (taken off the stock when the job is finished). Each change is saved at once. */
import { useState } from 'preact/hooks';
import { Plus, Trash2 } from 'lucide-preact';
import { t, lang } from '../../../lib/i18n';
import { partsOfService, inventoryList } from '../../../data/select';
import { getRow } from '../../../data/store';
import { saveServicePart, Refused } from '../../../data/api';
import { updateRow, uuid } from '../../../data/sync';
import { preview } from '../../../data/auth';
import type { ServicePart, InventoryItem } from '../../../data/types';
import { Panel, IconButton, Button, Stepper, Select, Banner, attempt, run } from '../../../ui';

/** a part's quantity goes by halves (4,5 L of oil): with a step of 1, 0,5 / 1,5 / 4,5 could never be reached (settings-team-22) */
export const PART_STEP = 0.5;

/* parts removed in this session: re-adding the same part brings its row back (the database keeps one per service and part) */
const removedParts = new Map<string, string>();
function guard() { if (preview.value) throw new Refused('preview', t('errors.preview')); }

export function PartsPanel(p: { serviceId: string | null }) {
  const [item, setItem] = useState('');
  const [qty, setQty] = useState(1);
  const items = inventoryList.value;
  if (!p.serviceId) return <Panel plain title={t('settings.services.parts')}><p class="muted small" style={{ margin: 0 }}>{t('settings.services.partsFirst')}</p></Panel>;
  const sid = p.serviceId;
  const parts = partsOfService(sid);
  const used = new Set(parts.map((x) => x.item_id));
  const choices = items.filter((i) => !used.has(i.id));
  const nameOf = (id: string) => getRow<InventoryItem>('inventory_items', id)?.name || '—';
  const unitOf = (id: string) => getRow<InventoryItem>('inventory_items', id)?.unit || '';
  const add = async () => {
    if (!item) return;
    const back = removedParts.get(`${sid}|${item}`);
    const ok = await attempt(async () => {
      guard();
      if (back) { await updateRow('service_parts', back, { deleted_at: null, qty }); removedParts.delete(`${sid}|${item}`); }
      else await saveServicePart({ id: uuid(), service_id: sid, item_id: item, qty });
    }, { ok: t('settings.services.partAdded') });
    if (ok) { setItem(''); setQty(1); }
  };
  const remove = async (sp: ServicePart) => {
    if (await attempt(() => saveServicePart({ id: sp.id, deleted_at: new Date().toISOString() }), { ok: t('settings.services.partRemoved') })) removedParts.set(`${sid}|${sp.item_id}`, sp.id);
  };
  return (
    <Panel plain title={t('settings.services.parts')} help={t('settings.services.partsHelp')} data-testid="service-parts">
      <div class="stack">
        {!parts.length && <p class="muted small" style={{ margin: 0 }}>{t('settings.services.noParts')}</p>}
        {parts.length > 0 && (
          <div class="settings-parts">
            {parts.map((sp) => (
              <div key={sp.id} class="settings-part">
                <span class="grow ellipsis">{nameOf(sp.item_id)}</span>
                <Stepper value={Number(sp.qty)} min={0.5} max={999} step={PART_STEP} label={`${t('settings.services.qty')}, ${nameOf(sp.item_id)}`}
                  format={(v) => `${v.toLocaleString(lang.value === 'en' ? 'en-CA' : 'fr-CA')} ${unitOf(sp.item_id)}`}
                  onValue={(v) => void run(() => saveServicePart({ id: sp.id, qty: v }))} />
                <IconButton icon={<Trash2 />} label={t('settings.services.removePart')} onClick={() => remove(sp)} />
              </div>
            ))}
          </div>
        )}
        {!items.length ? <Banner kind="info">{t('settings.services.noInventory')}</Banner> : choices.length > 0 && (
          <div class="settings-part-add">
            <Select value={item} onValue={setItem} placeholder={t('settings.services.choosePart')} aria-label={t('settings.services.part')}
              options={choices.map((i) => ({ value: i.id, label: i.name }))} />
            <Stepper value={qty} onValue={setQty} min={0.5} max={999} step={PART_STEP} label={t('settings.services.qty')} format={(v) => `${v.toLocaleString(lang.value === 'en' ? 'en-CA' : 'fr-CA')} ${item ? unitOf(item) : ''}`} />
            <Button icon={<Plus size={18} />} disabled={!item} onClick={add} data-testid="part-add">{t('settings.services.addPart')}</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
