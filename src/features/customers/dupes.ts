/* « Ce numéro est déjà à Julie Tremblay » — the same phone on two customer files. The server keeps the last 10 digits
   of the phone (phone_digits); a number typed here is read the same way, whatever its format. */
import { phoneDigits } from '../../lib/text';
import type { Customer } from '../../data/types';

type Phoned = Pick<Customer, 'id' | 'phone' | 'phone_digits' | 'deleted_at'>;

/** the 10 digits used to compare two numbers, or null while the number is not complete */
export function phoneKey(input: string | null | undefined): string | null {
  const nice = phoneDigits(input);
  if (nice) return nice;
  const d = String(input || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}
function keyOf(c: Phoned): string | null {
  const d = c.phone_digits && c.phone_digits.length === 10 ? c.phone_digits : null;
  return d || phoneKey(c.phone);
}

/** the other customers who already have this phone number (none while it is incomplete) */
export function phoneOwners<T extends Phoned>(phone: string | null | undefined, customers: T[], exceptId?: string | null): T[] {
  const k = phoneKey(phone);
  if (!k) return [];
  return customers.filter((c) => !c.deleted_at && c.id !== exceptId && keyOf(c) === k);
}
