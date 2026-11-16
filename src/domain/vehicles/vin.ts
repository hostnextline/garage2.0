/* The VIN box's rules: what is kept of what was typed or pasted, and what the box says about it. */
import { cleanVin, vinCheck } from '../../lib/text';

export type VinState = 'empty' | 'short' | 'ok' | 'bad' | 'old';
export function vinState(vin: string): VinState {
  if (!vin) return 'empty';
  if (vin.length === 17) return vinCheck(vin) === 'ok' ? 'ok' : 'bad';
  return vin.length >= 11 && vin.length < 17 ? 'old' : 'short';
}
/** a VIN the database takes: none, or 11 to 17 letters and digits (never I, O, Q) */
export const vinSavable = (vin: string) => !vin || (vin.length >= 11 && vin.length <= 17);

/** what the box keeps of what was typed or pasted: a pasted « VIN: 1HGCM82633A004352 » gives its VIN; anything else is
    cut at 17 characters, never searched. Searching inside typed text let an 18th character typed by mistake shift the
    VIN by one and show it valid (customers-b-02). A pasted door-jamb reading « I » + VIN loses its « I », not its last
    character (cleanVin would turn that « I » into a 1 first). */
export function typedVin(input: string): string {
  const fields = String(input || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
    .map((f) => (f.length === 18 && f[0] === 'I' ? f.slice(1) : f));
  if (fields.length > 1) {
    const whole = fields.filter((f) => f.length === 17).map(cleanVin);
    const pick = whole.find((f) => vinCheck(f) === 'ok') || whole[0];
    if (pick) return pick;
  }
  return cleanVin(fields.join('')).slice(0, 17);
}
