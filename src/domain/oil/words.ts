/* Reading an oil change of the ENGINE in the words of a line, a service or a stock item. Words only propose: a person
   can always say otherwise on the car (« L’huile a été changée à cette visite », « Pas de changement d’huile à cette
   visite », see followup.ts). Pure, tested in due.test.ts. */
import type { InventoryItem, JobItem, Service } from '../../data/types';

/** the line statuses that count as work done or to do (not proposed, refused or taken off) */
export const COUNTED = new Set(['planned', 'done', 'approved']);

export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, ' ');

/* another fluid, another job or a part that also says « huile », « oil » or « vidange »: a leak, a sensor, the drain plug,
   gear oil (75W-90), grease, washer fluid, two-stroke oil */
const OTHER = /transmission|boite|differentiel|differential|transfert|transfer case|direction|steering|hydraulique|hydraulic|frein|brake|refroidissement|coolant|antigel|antifreeze|prestone|radiateur|radiator|fuite|leak|suintement|pression d huile|oil pressure|temoin|voyant|sensor|capteur|sonde|pan gasket|joint|carter|oil pan|pompe a huile|oil pump|cooler|refroidisseur|bouchon|drain plug|jauge|dipstick|boitier|housing|graisse|grease|\batf\b|dexron|lave.?glace|washer|2 temps|deux temps|two.?stroke|\b(?:70|75|80|85|90)\s?w\b/;
/* oil only added or looked at, or a symptom: not an oil change, unless the same words also say the oil is changed */
const SOFT = /\bajout|\bajouter|\bappoint|\bcomplement|top.?up|\btop off|\bremplir|\bremplissage|\bniveau|\blevel|\bverif|\bcheck|\binspect|\btemoin|\blumiere|\blight|\bconsomm|\bbrule|\bburn|\bodeur|\bsmell|\banalyse|\bechantillon|\bdiagnos|\breset\b/;
const CHANGED = /\bchangement|\bchanger\b|\bchange\b|\bvidange|\bremplac|\breplace|\blube\b|\blof\b/;
/* an oil change said in words: « changement d’huile », « vidange », « huile et filtre », « oil change », « lube », « LOF »,
   « oil service »; an engine oil grade alone (« 5W-30 synthétique, 5 L ») is one. « Entretien A » is NOT one (too vague). */
const OIL = /\bhuile\b|\bhuiles\b|\boil\b|\bvidange\b|\blube\b|\blof\b|\bl\.o\.f\b|\bsynthetique\b|\bsynthetic\b|\b(?:0|5|10|15|20|25)\s?w\s?-?\s?\d{2}\b/;
/* the words that name the engine's oil itself, not only « a drain » (« vidange » alone may be the transmission's) */
const ENGINE_OIL = /\bhuile\b|\bhuiles\b|\boil\b|\blube\b|\blof\b|\bl\.o\.f\b|\bsynthetique\b|\bsynthetic\b|\bmoteur\b|\bengine\b|\b(?:0|5|10|15|20|25)\s?w\s?-?\s?\d{2}\b/;
const PIECES = /\s*(?:\+|,|;|\/|&|\bet\b|\band\b|\bavec\b|\bwith\b|\||:)\s*/;

/** the words of a line or of a service say an oil change of the engine. Each piece (split on « + », « , », « et », « and »,
    « / », « : ») is read alone, so « Fuite de transmission + changement d’huile » is one, « Vidange de transmission » is
    not; a bare « vidange » does not count when the line names another fluid (« Vidange et remplissage de transmission »,
    « Transmission : vidange »); oil only added or looked at (« Ajout d’huile », « Vérifier le niveau d’huile ») is not one */
export function oilWords(text: string | null | undefined): boolean {
  const all = fold(String(text || ''));
  const otherInLine = OTHER.test(all);
  return all.split(PIECES).some((part) => OIL.test(part) && !OTHER.test(part)
    && (!SOFT.test(part) || CHANGED.test(part))
    && (!otherInLine || ENGINE_OIL.test(part)));
}
/** the words say oil was only added or looked at (« Ajout d’huile », « Vérifier le niveau d’huile »), not changed */
export function oilOnlyAdded(text: string | null | undefined): boolean {
  const f = fold(String(text || ''));
  return OIL.test(f) && SOFT.test(f) && !CHANGED.test(f) && !oilWords(text);
}
/** a service is an oil change: said in its settings (« Ce que ça prend »), else its name and what it includes */
export function isOilService(s: Pick<Service, 'name_fr' | 'name_en' | 'includes' | 'needs'>): boolean {
  if (Array.isArray(s.needs)) return s.needs.some((n) => n.kind === 'oil');
  return [s.name_fr, s.name_en, ...(s.includes || []).flatMap((i) => [i.fr, i.en])].some((x) => oilWords(x));
}
/** a line of work that is an oil change: its service is one, or its own words say so (a line reworded by hand, a custom line) */
export function isOilItem(i: Pick<JobItem, 'kind' | 'status' | 'service_id' | 'description'>, services: Map<string, Service>): boolean {
  if (!COUNTED.has(i.status) || i.kind === 'discount' || i.kind === 'fee') return false;
  const s = i.service_id ? services.get(i.service_id) : undefined;
  if (s && Array.isArray(s.needs)) return isOilService(s);
  return (!!s && isOilService(s)) || oilWords(i.description);
}
/** a part of the stock that is engine oil (« Huile 5W-30 synthétique », category « Huile »): never a filter, gear oil,
    ATF, two-stroke oil or washer fluid filed under the same category */
export function isOilStock(it: Pick<InventoryItem, 'name' | 'category'>): boolean {
  const name = fold(it.name || ''), cat = fold(it.category || '');
  if (/filtre|filter/.test(name)) return false;
  return (OIL.test(name) || /\bhuile|\boil/.test(cat)) && !OTHER.test(name);
}
