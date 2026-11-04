/* STUB (owner: customers) — an address with suggestions as you type; gives back the address, unit, postal code
   and the position (lat/lng) used by the planner and the map. */
export interface PlaceValue { address: string; unit: string | null; postal_code: string | null; lat: number | null; lng: number | null }
export interface AddressFieldProps { value: PlaceValue; onValue: (v: PlaceValue) => void; label?: string; autoFocus?: boolean }
export function AddressField(_p: AddressFieldProps) { return null; }
/** address → possible places (empty when nothing is found or there is no signal) */
export async function geocode(_q: string): Promise<PlaceValue[]> { return []; }
