/* A car's file being changed (« Modifier » on #/vehicle/:id) and what a VIN reading fills: the draft, what is saved,
   what is refused, and whether the confirmed « Fiche technique » stays linked. Pure (words through t() only), tested in
   vehicleDraft.test.ts. */
import { t } from '../../lib/i18n';
import { today, isValidDay } from '../../lib/dates';
import type { Vehicle } from '../../data/types';
import { vinSavable, yearOk, type CarFields } from '../../shared/vehicles/VehicleBits';
import { parseKm } from '../../shared/vehicles/vehicleText';
import { specKeyOf } from '../../domain/vehicles/engineRef';

export interface VDraft { year: string; make: string; model: string; trim: string; engine: string; displacement: string; cylinders: string; fuel: string; drive: string; vin: string; plate: string; odometer: string; color: string; tire_size: string; notes: string; lastOil: string }
const s = (x: unknown) => (x == null ? '' : String(x));
const dispText = (x: unknown) => (x ? Number(x).toFixed(1) : '');

export function draftOf(v: Vehicle): VDraft {
  return { year: s(v.year), make: s(v.make), model: s(v.model), trim: s(v.trim), engine: s(v.engine), displacement: dispText(v.displacement), cylinders: s(v.cylinders),
    fuel: s(v.fuel), drive: s(v.drive), vin: s(v.vin), plate: s(v.plate), odometer: s(v.odometer_km), color: s(v.color), tire_size: s(v.tire_size), notes: s(v.notes), lastOil: s(v.last_oil_on) };
}
export function patchOf(d: VDraft, day = today()): Partial<Vehicle> {
  const txt = (x: string) => x.trim() || null;
  const disp = Number(d.displacement.replace(',', '.'));
  return {
    year: d.year.trim() ? Number(d.year) : null, make: txt(d.make), model: txt(d.model), trim: txt(d.trim), engine: txt(d.engine),
    displacement: d.displacement.trim() && Number.isFinite(disp) ? Math.round(disp * 10) / 10 : null, cylinders: d.cylinders.trim() ? Number(d.cylinders) : null,
    fuel: txt(d.fuel), drive: txt(d.drive), vin: txt(d.vin), plate: d.plate.trim() ? d.plate.trim().toUpperCase().replace(/\s+/g, ' ') : null,
    odometer_km: parseKm(d.odometer), color: txt(d.color), tire_size: d.tire_size.trim() ? d.tire_size.trim().toUpperCase() : null, notes: txt(d.notes),
    last_oil_on: isValidDay(d.lastOil) && d.lastOil <= day ? d.lastOil : null
  };
}
export interface VErrors { year: string | null; vin: string | null; displacement: string | null; cylinders: string | null; odometer: string | null }
export function errorsOf(d: VDraft): VErrors {
  const disp = Number(d.displacement.replace(',', '.'));
  const cyl = Number(d.cylinders);
  const odo = parseKm(d.odometer);
  return {
    year: d.year.trim() && !yearOk(d.year.trim()) ? t('vehicles.errors.year') : null,
    vin: !vinSavable(d.vin) ? t('vehicles.errors.vin') : null,
    displacement: d.displacement.trim() && !(disp > 0.5 && disp < 10) ? t('vehicles.errors.displacement') : null,
    cylinders: d.cylinders.trim() && !(Number.isInteger(cyl) && cyl >= 2 && cyl <= 16) ? t('vehicles.errors.cylinders') : null,
    odometer: odo != null && (Number.isNaN(odo) || odo > 3000000) ? t('vehicles.errors.km') : null
  };
}
/** only the fields that changed */
export function diffOf(before: Partial<Vehicle>, after: Partial<Vehicle>): Partial<Vehicle> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(after)) if ((before as Record<string, unknown>)[k] !== val) out[k] = val;
  return out as Partial<Vehicle>;
}

/* the « Fiche technique » linked to a car (`spec_key`) follows one rule on every path (the edit sheet, a VIN scanned):
   another make, model or year, or another displacement than the one known, unlinks it; learning the displacement of the
   same car keeps it (the sheet confirmed by hand does not vanish when « Lire le NIV » adds « 2.0 ») */
const carKey = (c: Partial<Vehicle>) => specKeyOf({ ...c, displacement: null, engine: null } as Vehicle);
const dispKey = (c: Partial<Vehicle>) => { const k = specKeyOf(c as Vehicle), b = carKey(c); return k && b && k !== b ? k.slice(b.length + 1) : null; };
export function specLinkPatch(v: Vehicle, change: Partial<Vehicle>): { spec_key?: null } {
  if (!v.spec_key) return {};
  const next = { ...v, ...change };
  if (carKey(next) !== carKey(v)) return { spec_key: null };
  const d0 = dispKey(v), d1 = dispKey(next);
  return d0 && d1 && d0 !== d1 ? { spec_key: null } : {};
}

/** what a VIN reading adds to a car's file: only what the file does not say yet, read from the car as it is NOW */
export function vinFill(v: Partial<Vehicle>, car: Partial<CarFields>): Partial<Vehicle> {
  const fill: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(car)) if (val != null && (v as Record<string, unknown>)[k] == null) fill[k] = val;
  return fill as Partial<Vehicle>;
}
/** what « Lire le NIV » puts in the edit sheet: only the fields the reading gave (a field typed meanwhile that the
    reading does not know is not put back as it was) */
export function decodedDraft(car: Partial<CarFields>): Partial<VDraft> {
  const out: Partial<VDraft> = {};
  if (car.year) out.year = String(car.year);
  if (car.make) out.make = car.make;
  if (car.model) out.model = car.model;
  if (car.trim) out.trim = car.trim;
  if (car.engine) out.engine = car.engine;
  if (car.displacement) out.displacement = dispText(car.displacement);
  if (car.cylinders) out.cylinders = String(car.cylinders);
  if (car.fuel) out.fuel = car.fuel;
  if (car.drive) out.drive = car.drive;
  return out;
}
