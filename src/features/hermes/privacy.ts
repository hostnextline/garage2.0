/* 🤖 Hermes: what may leave the phone. The panel promises « Pas de numéros ni d'adresses de clients » and the context
   never takes a phone or an address FIELD; but the free text typed by the team (a job's « Problème », a custom work line,
   sometimes a customer's name) can hold one: « Auto dans la cour du 1234 rue Sauvé, appeler sa femme 514 555-0199 ».
   scrub() takes those out before the text goes to the Hermes server, and flattens it to one line so a typed text can
   never pose as a new section of the context (« INVOICES … »). Pure: tested in privacy.test.ts. */

// 7 digits or more, with the usual separators between them: a phone number (« 514 555-0199 », « (450) 555 0101 »,
// « +1 514 555 0100 »). Shorter numbers (a year, a price, a quantity, « 5W-30 ») stay.
const PHONE = /\+?\(?\d(?:[\s().-]{0,3}\d){6,}/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// a Canadian postal code (« H2X 1Y4 », « h2x1y4 »)
const POSTAL = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi;
// a VIN: 17 letters and digits (never I, O, Q), with at least one digit and one letter
const VIN = /\b(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/gi;
// a civic number followed by a street word, up to the next comma or full stop: « 1234 rue Sauvé », « 55, boul. Saint-Laurent »,
// « 12 Graham Street ». The street words are the ones of Québec and English Canada.
const FR_STREET = '(?:rue|avenue|av\\.?|boul\\.?|boulevard|chemin|rang|route|montée|mont[ée]e|côte|cote|croissant|terrasse|allée|allee|impasse|place)';
const EN_STREET = '(?:street|avenue|ave|road|rd|boulevard|blvd|drive|lane|crescent|court)';
const ADDRESS = new RegExp(`\\b\\d{1,6}[a-z]?,?\\s+(?:${FR_STREET}\\s[^,.;\\n]*|[^,.;\\n\\d]*?\\b${EN_STREET}\\b\\.?)`, 'gi');

export const HIDDEN = { phone: '[phone]', email: '[email]', address: '[address]', postal: '[postal code]', vin: '[VIN]' } as const;

/** free text with its phones, e-mails, street addresses, postal codes and VINs taken out, on one line, at most `max` characters */
export function scrub(text: string | null | undefined, max = 160): string {
  if (!text) return '';
  const out = String(text)
    .replace(EMAIL, HIDDEN.email)
    .replace(ADDRESS, HIDDEN.address)
    .replace(POSTAL, HIDDEN.postal)
    .replace(VIN, HIDDEN.vin)
    .replace(PHONE, HIDDEN.phone)
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > max ? out.slice(0, max).trimEnd() + '…' : out;
}
