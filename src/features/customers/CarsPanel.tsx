/* « Véhicules »: each car (plate, engine, km, last oil change) → its file, « Historique », « Ajouter ». */
import { Plus, Car, Gauge, Droplet } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import type { Customer, Vehicle } from '../../data/types';
import { Panel, Rows, RowItem, Button } from '../../ui';
import { VehicleAddSheet } from '../../shared/vehicles/VehicleBits';
import { CarHistoryButton } from '../../shared/jobs/CarHistory';
import { km } from '../../shared/vehicles/vehicleText';
import { Plate, Bit } from '../../shared/customers/bits';
import { dateShort } from '../../domain/moment/dayWords';
import { carName } from '../../domain/vehicles/words';
import { lastOil } from '../../domain/oil/select';

export function CarsPanel(p: { c: Customer; cars: Vehicle[]; canEdit: boolean; adding: boolean; onAdding: (on: boolean) => void }) {
  const adding = p.adding, setAdding = p.onAdding;
  return (
    <Panel title={t('customers.cars.title')} flush data-testid="cars-panel"
      action={p.canEdit && <Button icon={<Plus size={18} />} onClick={() => setAdding(true)} data-testid="car-add">{t('common.add')}</Button>}>
      {p.cars.length
        ? <Rows>{p.cars.map((v) => (
            <div key={v.id} class="customers-car-wrap" role="listitem">
              <RowItem href={`#/vehicle/${v.id}`} chevron start={<span class="customers-car-icon"><Car size={20} aria-hidden="true" /></span>} title={carName(v)} data-testid="car-row"
              sub={<span class="customers-line"><Plate plate={v.plate} />{v.engine && <Bit>{v.engine}</Bit>}{v.odometer_km != null && <Bit icon={<Gauge size={14} aria-hidden="true" />}>{km(v.odometer_km, lang.value)}</Bit>}<CarOil v={v} /></span>} />
              <CarHistoryButton car={v} size="sm" variant="ghost" />
            </div>
          ))}</Rows>
        : <p class="customers-panel-empty muted">{t('customers.cars.none')}</p>}
      {adding && <VehicleAddSheet customerId={p.c.id} onClose={() => setAdding(false)} onAdded={() => setAdding(false)} />}
    </Panel>
  );
}

/** « Huile : 12 mai » on a car's line: its last oil change (ours, or the day the customer gave) */
function CarOil(p: { v: Vehicle }) {
  const o = lastOil(p.v);
  return o ? <Bit icon={<Droplet size={14} aria-hidden="true" />}>{t('vehicles.fields.lastOilShort', { day: dateShort(o.day) })}</Bit> : null;
}
