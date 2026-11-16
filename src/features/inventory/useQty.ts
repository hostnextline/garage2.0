/* A quantity in words, in the language on screen: « 38 L », « 6 unités », « 2 jeux ». */
import { t, lang } from '../../lib/i18n';
import { formatQty, qtyLabel } from '../../domain/stock/stock';

export function useQty() {
  const l = lang.value;
  return (n: number | null | undefined, unit: string | null | undefined) => qtyLabel(n, unit, l, (k) => t('inventory.units', { n: k, q: formatQty(k, l) }));
}
/** « +4 L », « −2 unités » */
export const signed = (n: number, text: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}`;
