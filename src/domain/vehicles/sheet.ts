/* Which « Fiche technique » a car shows: its own (the car is linked to it by spec_key), else the one confirmed for
   another car with the same engine key. One function, so the car's file, the job card and the week's needs say the
   same thing about the same car (customers-b-06: « Confirmée » on the file, « à compléter » on the job). */
import type { EngineSpec, Vehicle } from '../../data/types';
import { specByKey } from '../../data/select';
import { specKeyOf } from './engineRef';

export interface CarSheet { spec: EngineSpec; /** false: confirmed for another car alike, this one is not linked yet */ linked: boolean }
export function sheetOf(car: Pick<Vehicle, 'spec_key' | 'year' | 'make' | 'model' | 'engine' | 'displacement'> | null | undefined): CarSheet | null {
  if (!car) return null;
  const own = car.spec_key ? specByKey(car.spec_key) : undefined;
  if (own) return { spec: own, linked: true };
  const key = specKeyOf(car);
  const shared = key ? specByKey(key) : undefined;
  return shared ? { spec: shared, linked: false } : null;
}
