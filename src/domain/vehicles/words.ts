/* Cars in words that need the garage's data or the person's language (the pure ones are in shared/vehicles/vehicleText.ts). */
import type { Vehicle } from '../../data/types';
import { vehicleLabel } from '../../data/select';
import { t } from '../../lib/i18n';
import { engineLine } from './carText';
import type { EngineChoice } from './engineRef';

/** what a car is called in a list: « 2019 Honda Civic », else its plate or the end of its VIN */
export function carName(v: Vehicle | null | undefined): string {
  if (!v) return '';
  return vehicleLabel(v) || v.plate || (v.vin ? t('vehicles.vinTail', { tail: v.vin.slice(-6) }) : t('vehicles.untitled'));
}

/** the engine words in the person's language (« turbo », « hybride », « diesel ») for engineLine and refLine */
export const engineWords = () => ({ turbo: t('vehicles.engine.turbo'), hybrid: t('vehicles.engine.hybrid'), diesel: t('vehicles.engine.diesel') });

/** each engine button's two lines. Two engines that read the same (Equinox 1.5T FWD 4 L / AWD 5 L, Colorado 2.7T with
    two oil pans) also say their litres of oil, so the two buttons can be told apart (customers-b-20) */
export function engineButtons(list: EngineChoice[], l: string): { title: string; sub: string }[] {
  const litres = (n: number) => `${new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 2 }).format(n)} L`;
  const base = list.map((e) => ({
    title: engineLine({ displacement: e.displacement, cylinders: e.cylinders, turbo: e.turbo, fuel: e.fuel, code: e.code }, engineWords()) || e.code || '—',
    oil: e.oil_visc, filter: e.oil_filter, litres: e.oil_l
  }));
  const same = (i: number) => base.some((b, j) => j !== i && b.title === base[i].title && b.oil === base[i].oil && b.filter === base[i].filter);
  return base.map((b, i) => {
    const oil = [b.oil, same(i) && b.litres != null ? `(${litres(b.litres)})` : ''].filter(Boolean).join(' ');
    return { title: b.title, sub: [oil && t('vehicles.pick.engineOil', { oil }), b.filter && t('vehicles.pick.engineFilter', { ref: b.filter })].filter(Boolean).join(', ') };
  });
}
