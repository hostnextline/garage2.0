/* Making a customer, the same from the new customer page and the picker's short sheet: the file, then the car when one
   was typed (so « Créer et réserver » opens the booking with that car already chosen). Works offline (outbox). */
import { saveCustomer, saveVehicle } from '../../data/api';
import { may, isField } from '../../domain/rights';
import { carRow, type AddDraft } from '../vehicles/VehicleBits';
import { customerPatch, type Draft } from './draft';

export async function createCustomer(d: Draft, car?: AddDraft | null): Promise<string> {
  const id = await saveCustomer(customerPatch(d));
  if (car) await saveVehicle(carRow(car, id));
  return id;
}

/** may make a customer's file: the right to (« clients » or « book ») AND a field role, as the server's insert policy
    asks (`customers_ins` = is_field()): a treasurer given « clients » would otherwise see « Client créé » and then the
    row refused at the next sync */
export const mayCreateCustomer = () => may.newCustomer() && isField();
