/* The trucks (owner, or the « settings » right): name, colour, driver, plate, in service. */
import { useEffect, useState } from 'preact/hooks';
import { Plus, Check as CheckIcon } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { trucks, truck as truckRow, staffList, staffName, truckColor } from '../../data/select';
import { saveTruck } from '../../data/api';
import { uuid } from '../../data/sync';
import type { Truck } from '../../data/types';
import { Panel, Rows, RowItem, Button, Sheet, Field, Input, Select, Switch, attempt } from '../../ui';

/** the 8 colours a truck can take (data, the same in every theme) */
export const TRUCK_COLORS: { key: string; hex: string }[] = [
  { key: 'red', hex: '#D3000E' }, { key: 'blue', hex: '#2F6FD0' }, { key: 'green', hex: '#1F8A53' }, { key: 'amber', hex: '#B86E00' },
  { key: 'violet', hex: '#7347D1' }, { key: 'teal', hex: '#0F7C82' }, { key: 'pink', hex: '#C2185B' }, { key: 'slate', hex: '#5D6B78' }
];

export function TrucksPanel(p: { onAdded?: (id: string) => void }) {
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  const list = trucks.value;
  return (
    <Panel title={t('hours.manage.title')} sub={t('hours.manage.sub')} flush data-testid="trucks-panel"
      action={<Button size="sm" icon={<Plus />} onClick={() => setEdit('new')} data-testid="truck-add">{t('hours.manage.add')}</Button>}>
      <Rows>
        {list.map((tr) => (
          <RowItem key={tr.id} chevron onClick={() => setEdit(tr.id)} data-testid={`truck-row-${tr.id}`}
            start={<span class="hours-swatch" style={{ background: truckColor(tr.id) }} aria-hidden="true" />}
            title={tr.name}
            sub={[tr.driver_id ? t('hours.manage.driverOf', { name: staffName(tr.driver_id) }) : t('hours.manage.noDriverShort'), tr.plate, !tr.active ? t('hours.inactive') : ''].filter(Boolean).join(', ')} />
        ))}
      </Rows>
      <TruckSheet id={edit} onClose={() => setEdit(null)} onAdded={p.onAdded} />
    </Panel>
  );
}

function TruckSheet(p: { id: string | 'new' | null; onClose: () => void; onAdded?: (id: string) => void }) {
  const isNew = p.id === 'new';
  const cur = p.id && p.id !== 'new' ? truckRow(p.id) : undefined;
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(TRUCK_COLORS[0].hex);
  const [driver, setDriver] = useState<string>('');
  const [plate, setPlate] = useState('');
  const [active, setActive] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!p.id) return;
    setErr(null);
    if (cur) { setName(cur.name); setColor(cur.color || truckColor(cur.id)); setDriver(cur.driver_id || ''); setPlate(cur.plate || ''); setActive(cur.active); }
    else {
      const used = new Set(trucks.value.map((x) => (x.color || '').toUpperCase()));
      setName(''); setColor((TRUCK_COLORS.find((c) => !used.has(c.hex)) || TRUCK_COLORS[0]).hex); setDriver(''); setPlate(''); setActive(true);
    }
  }, [p.id]);
  const mechanics = staffList.value.filter((s) => s.active && (s.roles.includes('mechanic') || s.id === cur?.driver_id));
  const save = async () => {
    if (!name.trim()) { setErr(t('hours.manage.nameRequired')); return; }
    const id = cur?.id || uuid();
    const row: Partial<Truck> = { id, name: name.trim().slice(0, 60), color, driver_id: driver || null, plate: plate.trim().toUpperCase() || null, active };
    if (isNew) row.sort = Math.max(0, ...trucks.value.map((x) => x.sort || 0)) + 1;
    const ok = await attempt(() => saveTruck(row), { ok: isNew ? t('hours.manage.added') : t('hours.manage.saved') });
    if (!ok) return;
    p.onClose();
    if (isNew) p.onAdded?.(id);
  };
  return (
    <Sheet open={!!p.id} onClose={p.onClose} title={isNew ? t('hours.manage.newTitle') : t('hours.manage.edit')} data-testid="truck-sheet"
      footer={<><Button onClick={p.onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save} data-testid="truck-save">{t('common.save')}</Button></>}>
      <div class="stack">
        <Field label={t('hours.manage.name')} hint={t('hours.manage.nameHint')} error={err}>
          <Input value={name} onValue={(v) => { setName(v); if (err) setErr(null); }} maxLength={60} autoFocus={isNew} invalid={!!err} data-testid="truck-name" />
        </Field>
        <Field label={t('hours.manage.color')} group>
          <div class="hours-colors" role="group" aria-label={t('hours.manage.color')}>
            {TRUCK_COLORS.map((c) => {
              const on = c.hex.toUpperCase() === color.toUpperCase();
              return (
                <button key={c.key} type="button" aria-pressed={on} class={`hours-color${on ? ' is-on' : ''}`} style={{ '--sw': c.hex }}
                  aria-label={t(`hours.manage.colors.${c.key}`)} title={t(`hours.manage.colors.${c.key}`)} onClick={() => setColor(c.hex)}>
                  {on && <CheckIcon size={18} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label={t('hours.manage.driver')}>
          <Select value={driver} onValue={setDriver} options={[{ value: '', label: t('hours.manage.noDriver') }, ...mechanics.map((s) => ({ value: s.id, label: s.full_name }))]} />
        </Field>
        <Field label={t('hours.manage.plate')} optional>
          <Input value={plate} onValue={setPlate} maxLength={12} autoCapitalize="characters" />
        </Field>
        <Switch checked={active} onChange={setActive} label={t('hours.manage.active')} hint={t('hours.manage.activeHint')} />
      </div>
    </Sheet>
  );
}
