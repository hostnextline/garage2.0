/* The position of an address at the moment it is saved. A finger tap on « Créer » is also the tap that leaves the
   address field: the field's own lookup starts in that same instant and its answer arrives after the sheet is gone, so
   the customer was saved without a position and the booking ran without distances (customers-a-05). Every save of a
   typed address waits here a short moment for a sure answer; it never blocks without signal. The lookup hurries
   (locate's `hurry`): TomTom and Photon are asked at once, TomTom gets 1.5 s at most and the first door that fits is
   taken (places.ts), so a slow or resting TomTom never eats the 2.5 s when Photon alone would have answered in time. */
import { locate } from './locate';
import type { PlaceValue } from './place';

/** the place with its position when one sure answer comes within `ms` (the address stays as typed); else as it was */
export async function withPosition<P extends PlaceValue>(place: P, ms = 2500, find?: typeof locate): Promise<P> {
  const text = place.address.trim();
  if (!text || (place.lat != null && place.lng != null)) return place;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return place;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<null>((done) => { timer = setTimeout(() => done(null), ms); });
  try {
    const asked = find ? find(text, { postal: place.postal_code }) : locate(text, { postal: place.postal_code, hurry: true });
    const r = await Promise.race([asked, late]);
    if (!r || r.status !== 'found' || r.place.place.lat == null || r.place.place.lng == null) return place;
    return { ...place, lat: r.place.place.lat, lng: r.place.place.lng, city: place.city || r.place.place.city || null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
