/* Making a customer, the same from the new customer page and the picker's short sheet: the file, then the car when one
   was typed (so « Créer et réserver » opens the booking with that car already chosen). Works offline (outbox). */
import { saveCustomer, saveVehicle } from '../../data/api';
import { may, isField } from '../../domain/rights';
import { carRow, type AddDraft } from '../vehicles/VehicleBits';
import { withPosition } from '../places/withPosition';
import type { locate } from '../places/locate';
import { customerPatch, type Draft } from './draft';

/** the draft with the position of its typed address, when a sure answer comes in a short moment (R163): a tap on
    « Créer » or « Enregistrer » right after typing is also the tap that leaves the address field, whose own lookup
    answers after the sheet is gone; never waits without signal */
export async function positioned(d: Draft, find?: typeof locate): Promise<Draft> {
  const place = await withPosition(d.place, 2500, find);
  return place === d.place ? d : { ...d, place };
}

export async function createCustomer(d: Draft, car?: AddDraft | null, find?: typeof locate): Promise<string> {
  const id = await saveCustomer(customerPatch(await positioned(d, find)));
  if (car) await saveVehicle(carRow(car, id));
  return id;
}

/** may make a customer's file: the right to (« clients » or « book ») AND a field role, as the server's insert policy
    asks (`customers_ins` = is_field()): a treasurer given « clients » would otherwise see « Client créé » and then the
    row refused at the next sync */
export const mayCreateCustomer = () => may.newCustomer() && isField();
