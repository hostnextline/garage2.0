/* The customer's cars as chips, plus « Ajouter un véhicule » (year, make, model, or VIN). Shared with booking and
   estimates. A customer with a single car has it chosen at once (tap it again to leave the car out). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Plus } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { vehiclesOf, vehicleLabel } from '../../data/select';
import { Button, Chips } from '../../ui';
import { VehicleAddSheet } from './VehicleBits';
import { carName } from './bits';
import './customers.css';

export interface VehiclePickerProps {
  customerId: string | null;
  value: string | null;
  onPick: (vehicleId: string | null) => void;
  /** false: never choose the only car by itself */
  autoPick?: boolean;
}
export function VehiclePicker(p: VehiclePickerProps) {
  const [adding, setAdding] = useState(false);
  const cars = p.customerId ? vehiclesOf(p.customerId).sort((a, b) => (b.year ?? 0) - (a.year ?? 0)) : [];
  // the only car is chosen once per customer (so it can still be left out)
  const autoDone = useRef<string | null>(null);
  useEffect(() => {
    if (p.autoPick === false || !p.customerId || autoDone.current === p.customerId) return;
    if (cars.length) autoDone.current = p.customerId;
    if (!p.value && cars.length === 1) p.onPick(cars[0].id);
  }, [p.customerId, cars.length]);

  if (!p.customerId) return <p class="muted small customers-vpicker-none" data-testid="vehicle-picker">{t('vehicles.picker.noCustomer')}</p>;
  // two cars with the same name: the plate (or the colour) tells them apart
  const label = (id: string) => {
    const v = cars.find((x) => x.id === id)!;
    const name = carName(v);
    const twin = cars.some((x) => x.id !== id && vehicleLabel(x) === vehicleLabel(v));
    return twin && (v.plate || v.color) ? `${name} (${v.plate || v.color})` : name;
  };
  return (
    <div class="customers-vpicker" data-testid="vehicle-picker">
      {cars.length > 0
        ? <Chips label={t('vehicles.picker.label')} value={p.value ? [p.value] : []} onValue={(v) => p.onPick(v[0] ?? null)} options={cars.map((v) => ({ value: v.id, label: label(v.id) }))} data-testid="vehicle-chips" />
        : <p class="muted small" style={{ margin: 0 }}>{t('vehicles.picker.none')}</p>}
      <Button variant="ghost" icon={<Plus size={18} />} onClick={() => setAdding(true)} class="customers-vpicker-add" data-testid="vehicle-add-open">{t('vehicles.picker.add')}</Button>
      {adding && <VehicleAddSheet customerId={p.customerId} onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); p.onPick(id); }} />}
    </div>
  );
}
