/* What the address field does to the place at each thing the person does: type, paste, choose a suggestion, leave the
   field, get a position. Pure (no drawing, no network) so every case is a unit test.

   The unit and the postal code belong to one address: the « anchor », the address text they were written for. When
   the address becomes another door or another street (a customer who moved, an appointment somewhere else), the old
   unit and postal code would stay on the new address, be saved with it, and make locate() refuse the sure answer
   (customers-a-03). So at each choice, paste or leave, they are kept only for the same door; otherwise only what the
   new text itself says stays. A typo fixed in the street (« Grahm » → « Graham ») is still the same door. */
import { findPostal } from '../../lib/text';
import { splitPasted, unitApart, civicOf } from './address';
import { streetWords, wantedOf } from './locate';
import { photonQuery, type Suggestion } from './photon';
import type { PlaceValue } from './place';

/** at most `max` letters changed, added or taken out between a and b */
function closeText(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= max;
}

/** the same door: the same door number and the same street, give or take a typo, a street type or a town added */
export function sameDoor(a: string, b: string): boolean {
  const x = wantedOf(a), y = wantedOf(b);
  const digits = (s: string | null) => String(s || '').replace(/\D/g, '');
  if (digits(x.civic) !== digits(y.civic)) return false;
  const wx = streetWords(x.street), wy = streetWords(y.street);
  if (!wx.length || !wy.length) return wx.length === wy.length;
  const sx = new Set(wx), sy = new Set(wy);
  if (wx.every((w) => sy.has(w)) || wy.every((w) => sx.has(w))) return true;
  return closeText(wx.join(' '), wy.join(' '), 2);
}

/** may the unit and postal code written for `anchor` stay on `address`? (an empty anchor: they were written first,
    for the address to come) */
export function detailsFit(anchor: string, address: string): boolean {
  return !anchor.trim() || !address.trim() || sameDoor(anchor, address);
}

/** typing in the address: the position is no longer known; a postal code typed inside is taken */
export function typed(v: PlaceValue, text: string): PlaceValue {
  return { ...v, address: text, lat: null, lng: null, city: null, postal_code: findPostal(text) ?? v.postal_code };
}

/** a pasted address (« 180-8255 av. Mountain Sights⏎Montréal, QC H4P 2B5 »): its unit and postal code, else the old ones
    only for the same door */
export function pasted(v: PlaceValue, text: string, anchor: string): PlaceValue {
  const s = splitPasted(text);
  const keep = detailsFit(anchor, s.line);
  return { ...v, address: s.line, unit: s.unit ?? (keep ? v.unit : null), postal_code: s.postal ?? (keep ? v.postal_code : null), lat: null, lng: null, city: null };
}

/** a suggestion chosen: its address and position; the unit typed with the address (« 3-1250 rue graham ») is kept
    (customers-a-08); never Photon's postal code (often wrong in Canada), only the person's, and only for the same door */
export function picked(v: PlaceValue, s: Suggestion, anchor: string): PlaceValue {
  const fromText = splitPasted(v.address);
  const keep = detailsFit(anchor, s.place.address);
  return {
    ...v, address: s.place.address, lat: s.place.lat, lng: s.place.lng, city: s.place.city ?? null,
    unit: fromText.unit ?? (keep ? v.unit : null),
    postal_code: fromText.postal ?? (keep ? v.postal_code : null)
  };
}

/** leaving the field without a choice: « 3-1250 rue Graham » typed by hand puts the unit in its own box; the old unit
    and postal code go when the door changed. After a choice nothing is cut again: the address is Photon's, and cutting
    it turned « 1650 rue Logan » into « 1650 rue » + unit « an » (customers-a-02). */
export function left(v: PlaceValue, anchor: string, afterChoice: boolean): PlaceValue {
  if (afterChoice || !v.address.trim()) return v;
  let out = v;
  if (!v.unit) {
    const s = unitApart(v.address);
    if (s.unit) out = { ...out, address: s.line, unit: s.unit };
  }
  if (!detailsFit(anchor, out.address)) {
    const unit = out.unit !== v.unit ? out.unit : null;
    const postal = findPostal(out.address);
    if (unit !== out.unit || postal !== out.postal_code) out = { ...out, unit, postal_code: postal };
  }
  return out;
}

/** the position found for the address as typed: the address stays as typed; the town given when none was */
export function located(v: PlaceValue, s: Suggestion): PlaceValue {
  return { ...v, lat: s.place.lat, lng: s.place.lng, city: v.city || s.place.city || null, postal_code: v.postal_code || null };
}

/** worth asking Photon: three letters at least, and a letter somewhere */
export function searchable(text: string): boolean {
  const t = text.trim();
  return photonQuery(t).length >= 3 && /\p{L}/u.test(t);
}

/** the door number of what is typed, for the hint « Ajoute le numéro de la porte » */
export const hasDoor = (address: string) => !!civicOf(address);
