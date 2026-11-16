/* « Lire le NIV »: what the server's VIN decoder (NHTSA, function `vin`) says the car is, in the car's own fields. */
import { t } from '../../lib/i18n';
import { errorMessage, isNetworkError } from '../../lib/errors';
import { decodeVin } from '../../data/api';
import { engineLine } from './carText';
import { engineWords } from './words';
import type { CarFields } from './carDraft';

export type VinResult = { ok: true; car: Partial<CarFields>; note: string | null } | { ok: false; message: string; offline: boolean };
const DRIVES = new Set(['fwd', 'rwd', 'awd', '4wd', '2wd']);
const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; };
const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);

/** the decoder's answer → the car's fields (only what it really knows) */
function carOfDecoded(v: Record<string, unknown>): Partial<CarFields> {
  const car: Partial<CarFields> = {};
  if (num(v.year)) car.year = num(v.year);
  if (str(v.make)) car.make = str(v.make);
  if (str(v.model)) car.model = str(v.model);
  if (str(v.trim)) car.trim = str(v.trim);
  if (num(v.displacement)) car.displacement = Math.round(Number(v.displacement) * 10) / 10;
  if (num(v.cylinders)) car.cylinders = num(v.cylinders);
  if (str(v.fuel)) car.fuel = str(v.fuel)!.toLowerCase();
  const drive = str(v.drive)?.toLowerCase();
  if (drive && DRIVES.has(drive)) car.drive = drive;
  const line = engineLine({ displacement: car.displacement, cylinders: car.cylinders, turbo: v.turbo === true, fuel: car.fuel, code: str(v.engine) }, engineWords());
  if (line) car.engine = line;
  return car;
}

export async function readVin(vin: string): Promise<VinResult> {
  try {
    const r = await decodeVin(vin) as { ok?: boolean; vehicle?: Record<string, unknown>; code?: string; error?: string };
    if (!r || r.ok === false) return { ok: false, message: errorMessage(r), offline: false };
    const car = carOfDecoded(r.vehicle || {});
    if (!car.make && !car.model) return { ok: false, message: t('vehicles.vin.nothing'), offline: false };
    return { ok: true, car, note: str((r.vehicle || {}).error) };
  } catch (e) {
    if (isNetworkError(e)) return { ok: false, message: t('vehicles.vin.offline'), offline: true };
    return { ok: false, message: errorMessage(e), offline: false };
  }
}
