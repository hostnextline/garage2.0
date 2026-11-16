/* « La voiture ou le camion » (Part 24 terdecies) as the moment pickers need it: which kind a vehicle is, whether the
   garage has both, which vehicles can take a job, and which kind to ask the planner for. Pure: the vehicles are passed
   in (tested in vehicles.test.ts). Hassan's rule: a moment is « the car's » or « the truck's », never a vehicle's or a
   mechanic's name. */
import type { VehicleKind } from '../../domain/moment/choice';

export type Kind = 'car' | 'truck';
export interface KindTruck { id: string; tire_machine?: boolean | null }
/** what the person asked for: the tire machine (only the truck), the switch « Voiture / Camion », a vehicle by hand */
export interface KindAsk { need?: boolean; kind?: VehicleKind; truckId?: string | null }

/** a vehicle without the tire machine is « la voiture »; with it (or not said: the default) « le camion » */
export const kindOf = (trucks: readonly KindTruck[], id: string | null | undefined): Kind =>
  (trucks.find((x) => x.id === id)?.tire_machine === false ? 'car' : 'truck');

/** the garage has a car and a truck: only then is the kind said or asked */
export const bothKinds = (trucks: readonly KindTruck[]): boolean =>
  trucks.some((x) => x.tire_machine === false) && trucks.some((x) => x.tire_machine !== false);

/** can this vehicle take the job? A vehicle chosen by hand is the only one; the tire machine or « Camion » need one with
    the machine; « Voiture » one without */
export function fitsJob(truck: KindTruck, a: KindAsk): boolean {
  if (a.truckId) return truck.id === a.truckId;
  if (a.need || a.kind === 'truck') return truck.tire_machine !== false;
  if (a.kind === 'car') return truck.tire_machine === false;
  return true;
}

/** the kind sent to suggest_blocks / suggest_windows (`p_kind`). The planner has no vehicle argument and plans the car
    first, so a vehicle chosen by hand got almost no moment (its rows were the car's). The kind of that vehicle is asked
    instead: the planner then only looks at vehicles of that kind, which with one car and one truck is exactly the one
    chosen. Work for the tire machine goes as `need` (kind null), as before. */
export function askedKind(a: KindAsk, trucks: readonly KindTruck[]): Kind | null {
  if (a.need) return null;
  if (a.truckId && bothKinds(trucks) && trucks.some((x) => x.id === a.truckId)) return kindOf(trucks, a.truckId);
  return a.kind ?? null;
}
