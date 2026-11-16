/* Cars in words that need the garage's data (the pure ones are in shared/vehicles/vehicleText.ts). */
import type { Vehicle } from '../../data/types';
import { vehicleLabel } from '../../data/select';
import { t } from '../../lib/i18n';

/** what a car is called in a list: « 2019 Honda Civic », else its plate or the end of its VIN */
export function carName(v: Vehicle | null | undefined): string {
  if (!v) return '';
  return vehicleLabel(v) || v.plate || (v.vin ? t('vehicles.vinTail', { tail: v.vin.slice(-6) }) : t('vehicles.untitled'));
}
