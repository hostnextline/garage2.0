/* A service of the price list, the rules without the screen (serviceModel.test.ts): the form of its sheet, the row it
   saves, what must be fixed first, and whether its promo is over. */
import { t } from '../../../lib/i18n';
import type { Service, Need } from '../../../data/types';
import { cleanText } from '../draft';

export interface ServiceDraft {
  name_fr: string; name_en: string; category: string; fixed: 'fixed' | 'hourly'; price_cents: number | null; duration_min: number; taxable: boolean;
  is_promo: boolean; promo_until: string; includes: { fr: string; en: string }[]; active: boolean; sort: number; needs_machine: boolean;
  /** null: guessed from the name (the needs of the week) */
  needs: Need[] | null;
}

/** the sheet's form for a stored service, or for a new one (placed after the last of the list) */
export function toDraft(s: Service | undefined, lastSort: number): ServiceDraft {
  return {
    name_fr: s?.name_fr || '', name_en: s?.name_en || '', category: s?.category || '', fixed: s && s.price_cents == null ? 'hourly' : 'fixed',
    price_cents: s?.price_cents ?? null, duration_min: s?.duration_min ?? 60, taxable: s?.taxable ?? true, needs_machine: !!s?.needs_machine, is_promo: !!s?.is_promo,
    promo_until: s?.promo_until || '', includes: (s?.includes || []).map((i) => ({ fr: i.fr || '', en: i.en || '' })), active: s?.active ?? true,
    sort: s?.sort ?? Math.max(0, lastSort) + 1,
    needs: Array.isArray(s?.needs) ? s!.needs : null
  };
}

export function check(d: ServiceDraft): { name?: string; price?: string } {
  const e: { name?: string; price?: string } = {};
  if (!d.name_fr.trim()) e.name = t('settings.services.needName');
  if (d.fixed === 'fixed' && d.price_cents == null) e.price = t('settings.services.needPrice');
  return e;
}

/** the row written: words trimmed, a category in small letters (« autre » when none), a duration of 5 min to 12 h */
export function toRow(id: string, d: ServiceDraft): Partial<Service> {
  return {
    id, name_fr: d.name_fr.trim(), name_en: cleanText(d.name_en), category: (cleanText(d.category) || 'autre').toLowerCase(),
    price_cents: d.fixed === 'fixed' ? d.price_cents : null, duration_min: Math.min(720, Math.max(5, Math.round(d.duration_min))), taxable: d.taxable, needs_machine: d.needs_machine,
    is_promo: d.is_promo, promo_until: d.is_promo && d.promo_until ? d.promo_until : null,
    includes: d.includes.map((i) => ({ fr: i.fr.trim(), en: i.en.trim() || undefined })).filter((i) => i.fr), active: d.active, sort: Math.max(0, Math.round(d.sort)),
    needs: d.needs
  } as Partial<Service>;
}

/** a promo whose last day has passed: booking no longer offers the service (activeServices), the list says so */
export function promoEnded(s: Pick<Service, 'promo_until'>, today: string): boolean {
  return !!s.promo_until && s.promo_until < today;
}
