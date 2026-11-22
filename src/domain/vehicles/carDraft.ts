/* « Ajouter un véhicule » (also the new customer's car and the new caller's car in the booking): the draft, what is
   wrong with it, and the row saved. Pure: the forms only draw it. */
import { t } from '../../lib/i18n';
import { today, isValidDay } from '../../lib/dates';
import { fold } from '../../lib/text';
import type { Vehicle } from '../../data/types';
import { vinSavable } from './vin';

/** what the VIN's decoding (or the engine chosen) adds to the car */
export type CarFields = Pick<Vehicle, 'year' | 'make' | 'model' | 'trim' | 'engine' | 'displacement' | 'cylinders' | 'fuel' | 'drive'>;

/** a year the database takes */
export function yearOk(s: string): boolean {
  const y = Number(s);
  return /^\d{4}$/.test(s) && y >= 1950 && y <= new Date().getFullYear() + 2;
}

export interface AddDraft { year: string; make: string; model: string; vin: string; extra: Partial<CarFields>;
  /** « Dernier changement d’huile »: the day the customer says (for « Rappels d’huile ») */
  lastOil?: string }
export type AddMode = 'ymm' | 'vin';
export const EMPTY_CAR: AddDraft = { year: '', make: '', model: '', vin: '', extra: {} };
/** nothing typed yet (the car is optional on a new customer) */
export const carIsEmpty = (d: AddDraft) => !d.year.trim() && !d.make.trim() && !d.model.trim() && !d.vin;

/** what is wrong with the car typed (null: fine). The VIN is only in the form in « NIV » mode: withMode takes it out when
    the person goes back to « Année, marque, modèle », so nothing hidden is ever sent (customers-b-07) */
export function carErrors(d: AddDraft, mode: AddMode): { year: string | null; model: string | null; vin: string | null } {
  return {
    year: d.year.trim() && !yearOk(d.year.trim()) ? t('vehicles.errors.year') : null,
    model: mode === 'ymm' && (!d.make.trim() || !d.model.trim()) ? t('vehicles.errors.model') : null,
    vin: mode === 'vin' && !vinSavable(d.vin) ? t('vehicles.errors.vin') : mode === 'vin' && !d.vin && !d.make.trim() ? t('vehicles.errors.vinOrModel') : null
  };
}
/** the car to save for a customer */
export function carRow(d: AddDraft, customerId: string): Partial<Vehicle> {
  return { ...d.extra, customer_id: customerId, year: d.year.trim() ? Number(d.year) : null, make: d.make.trim() || null, model: d.model.trim() || null, vin: d.vin || null,
    ...(d.lastOil && isValidDay(d.lastOil) && d.lastOil <= today() ? { last_oil_on: d.lastOil } : {}) };
}

/** switching how the car is given: back to « Année, marque, modèle », the VIN box is gone, so the VIN and what its
    decoding added go too: a partial VIN was sent hidden and refused by the database after « Véhicule ajouté », a wrong
    one was saved with its decoded engine (customers-b-07). The year, make and model stay: they are shown. */
export function withMode(d: AddDraft, mode: AddMode): Partial<AddDraft> | null {
  return mode === 'ymm' && d.vin ? { vin: '', extra: {} } : null;
}

export interface EngineChosen { displacement: number | null; cylinders: number | null; fuel: string; engine: string }
/** the year, make and model chosen in the lists (and the engine, when one was chosen). Another make or model makes
    the engine of the first choice, or the VIN's, wrong: it goes unless a new engine was chosen (customers-b-13). The same
    make and model written another way (« HONDA » from the VIN, « Honda » from the list) is the same car: its engine stays. */
export function withChoice(d: AddDraft, c: { year: string; make: string; model: string; engine?: EngineChosen | null }): Partial<AddDraft> {
  const sameCar = fold(c.make) === fold(d.make) && fold(c.model) === fold(d.model);
  const extra = c.engine ? { ...(sameCar ? d.extra : {}), ...c.engine } : sameCar ? d.extra : {};
  return { year: c.year, make: c.make, model: c.model, extra };
}
