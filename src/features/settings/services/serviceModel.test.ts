import { describe, it, expect, beforeEach } from 'vitest';
import { lang } from '../../../lib/i18n';
import type { Service } from '../../../data/types';
import { toDraft, toRow, check, promoEnded } from './serviceModel';
import { PART_STEP } from './PartsPanel';

beforeEach(() => { lang.value = 'fr'; });
const oil = { id: 's1', name_fr: 'Huile', name_en: null, category: 'entretien', price_cents: 7999, duration_min: 45, taxable: true, needs_machine: false, is_promo: false, promo_until: null, includes: [], active: true, sort: 3, needs: null } as unknown as Service;

describe('a service of the price list', () => {
  it('a new one goes after the last of the list; a stored one reads its values', () => {
    expect(toDraft(undefined, 7).sort).toBe(8);
    expect(toDraft(oil, 7)).toMatchObject({ name_fr: 'Huile', fixed: 'fixed', price_cents: 7999, sort: 3 });
    expect(toDraft({ ...oil, price_cents: null }, 0).fixed).toBe('hourly');
  });
  it('the row written: words trimmed, category in small letters, duration kept between 5 min and 12 h, no end date without promo', () => {
    const d = { ...toDraft(oil, 0), name_fr: ' Huile synthétique ', category: ' Entretien ', duration_min: 900, promo_until: '2026-12-01', includes: [{ fr: ' Filtre ', en: ' ' }, { fr: '', en: 'x' }] };
    expect(toRow('s1', d)).toMatchObject({ name_fr: 'Huile synthétique', category: 'entretien', duration_min: 720, promo_until: null, includes: [{ fr: 'Filtre', en: undefined }] });
    expect(toRow('s1', { ...d, fixed: 'hourly' }).price_cents).toBeNull();
  });
  it('a name is needed, and a price unless it is « à confirmer »', () => {
    expect(check({ ...toDraft(oil, 0), name_fr: ' ', price_cents: null })).toEqual({ name: expect.any(String), price: expect.any(String) });
    expect(check({ ...toDraft(oil, 0), fixed: 'hourly', price_cents: null })).toEqual({});
  });
  it('a promo past its last day is said over (booking no longer offers it: settings-team-23)', () => {
    expect(promoEnded({ promo_until: '2026-11-30' }, '2026-12-01')).toBe(true);
    expect(promoEnded({ promo_until: '2026-11-30' }, '2026-11-30')).toBe(false);
    expect(promoEnded({ promo_until: null }, '2026-12-01')).toBe(false);
  });
  it('a part’s quantity goes by halves (settings-team-22)', () => {
    expect(PART_STEP).toBe(0.5);
    expect(1 - PART_STEP).toBeGreaterThanOrEqual(0.5);   // from 1 the minus gives 0,5 (it was disabled)
  });
});
