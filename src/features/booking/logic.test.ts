import { describe, it, expect } from 'vitest';
import { missingPiece, bookSummary, workMinutes, toItemInputs, draftsFromQuote, draftsFromJob, parseChoice, cellState, clampDuration, draftOfService, refusalCode, type LoadLike } from './logic';
import { blockPhrase, blockPhraseLower, relativeDay } from './when';
import { QC_TAXES } from '../../lib/money';
import type { ItemDraft } from './ServicePicker';
import type { Service } from '../../data/types';
import { booking as fr } from '../../i18n/fr/booking';
import { booking as en } from '../../i18n/en/booking';
import { sameShape } from './dict-check';

const line = (o: Partial<ItemDraft>): ItemDraft => ({ kind: 'service', service_id: 's-1', description: 'Changement d’huile', qty: 1, unit_cents: 8999, taxable: true, duration_min: 45, ...o });
const choice = { day: '2026-11-05', block: 'pm' as const };

describe('what is missing before « Réserver »', () => {
  it('asks for the customer first, then the work, then the block', () => {
    expect(missingPiece({ customerId: null, items: [], problem: '', choice: null })).toBe('customer');
    expect(missingPiece({ customerId: 'c', items: [], problem: '  ', choice })).toBe('work');
    expect(missingPiece({ customerId: 'c', items: [line({})], problem: '', choice: null })).toBe('block');
    expect(missingPiece({ customerId: 'c', items: [], problem: 'Bruit en freinant', choice })).toBe(null);
  });
  it('a walk-in needs no block', () => {
    expect(missingPiece({ customerId: 'c', items: [line({})], problem: '', choice: null }, true)).toBe(null);
  });
});

describe('the summary', () => {
  it('adds the work time and the price with taxes (TPS 5 %, TVQ 9,975 %)', () => {
    const s = bookSummary([line({}), line({ service_id: 's-2', description: 'Top up', unit_cents: 6000, duration_min: 20 })], QC_TAXES);
    expect(s.minutes).toBe(65);
    expect(s.subtotal).toBe(14999);
    expect(s.tps).toBe(750);
    expect(s.tvq).toBe(1496);
    expect(s.total).toBe(17245);
    expect(s.toConfirm).toBe(false);
  });
  it('counts 45 min for a service with no duration, nothing for a part, and the quantity of services', () => {
    expect(workMinutes([line({ duration_min: null })])).toBe(45);
    expect(workMinutes([line({ kind: 'part', service_id: null, duration_min: null, qty: 4 })])).toBe(0);
    expect(workMinutes([line({ kind: 'labour', service_id: null, duration_min: 30, qty: 2 })])).toBe(30);
    expect(workMinutes([line({ qty: 2 })])).toBe(90);
  });
  it('books 60 min when only a problem is described, and keeps a duration chosen by hand', () => {
    expect(bookSummary([], QC_TAXES).minutes).toBe(60);
    expect(bookSummary([line({})], QC_TAXES, { override: 150 }).minutes).toBe(150);
    expect(clampDuration(5)).toBe(15);
    expect(clampDuration(2000)).toBe(720);
  });
  it('flags the prices to confirm, untaxed lines and taxes turned off', () => {
    const s = bookSummary([line({ service_id: 's-x', unit_cents: 0 })], QC_TAXES, { priceless: (id) => id === 's-x' });
    expect(s.toConfirm).toBe(true);
    expect(bookSummary([line({ taxable: false })], QC_TAXES).total).toBe(8999);
    expect(bookSummary([line({})], { ...QC_TAXES, enabled: false }).total).toBe(8999);
  });
});

describe('lines', () => {
  it('a service in the customer’s language', () => {
    const s = { id: 's-1', name_fr: 'Changement d’huile', name_en: 'Oil change', price_cents: null, duration_min: 45, taxable: true } as Service;
    expect(draftOfService(s, 'en').description).toBe('Oil change');
    expect(draftOfService(s, 'fr').description).toBe('Changement d’huile');
    expect(draftOfService(s, 'fr').unit_cents).toBe(0);
  });
  it('as the server takes them: planned, trimmed, with a quantity', () => {
    const [it] = toItemInputs([line({ description: '  Freins  ', qty: 0 })]);
    expect(it).toMatchObject({ description: 'Freins', qty: 1, status: 'planned', kind: 'service', service_id: 's-1' });
  });
  it('from an estimate', () => {
    const d = draftsFromQuote({ items: [{ description: 'Freins avant', qty: 1, unit_cents: 34999, taxable: true, service_id: 's-f', duration_min: 90 }, { description: ' ', qty: 1, unit_cents: 0, taxable: true }, { description: 'Pièce', qty: 2, unit_cents: 1500, taxable: true, kind: 'part' }] });
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ kind: 'service', service_id: 's-f', duration_min: 90, unit_cents: 34999 });
    expect(d[1]).toMatchObject({ kind: 'part', qty: 2 });
  });
  it('reads the block from the address', () => {
    expect(parseChoice('2026-11-05', 'eve')).toEqual({ day: '2026-11-05', block: 'eve' });
    expect(parseChoice('2026-02-30', 'am')).toBe(null);
    expect(parseChoice('2026-11-05', 'night')).toBe(null);
    expect(parseChoice(null, 'am')).toBe(null);
  });
  it('knows a refusal code', () => {
    expect(refusalCode({ hint: 'block_full', message: 'Ce bloc est complet' })).toBe('block_full');
    expect(refusalCode({ code: '42501' })).toBe('');
  });
});

describe('a block in the picker', () => {
  const lane = (id: string, cap: number, used: number, jobs: LoadLike['trucks'][number]['jobs'] = []) => ({ truck: { id }, cap, used, left: cap - used, jobs });
  it('ok, tight, full by the room left on the best truck', () => {
    const load: LoadLike = { trucks: [lane('a', 240, 200), lane('b', 240, 100)], open: true, started: false };
    expect(cellState(load, 60, 20)).toEqual({ state: 'ok', left: 140 });
    expect(cellState(load, 130, 20).state).toBe('tight');
    expect(cellState(load, 150, 20).state).toBe('full');
  });
  it('only the truck chosen counts', () => {
    const load: LoadLike = { trucks: [lane('a', 240, 200), lane('b', 240, 100)], open: true, started: false };
    expect(cellState(load, 60, 20, { truckId: 'a' }).state).toBe('full');
  });
  it('the job being moved gives back its own room', () => {
    const load: LoadLike = { trucks: [lane('a', 240, 230, [{ id: 'j', duration_min: 60, travel_min: 20, status: 'booked' }])], open: true, started: false };
    expect(cellState(load, 60, 20).state).toBe('full');
    expect(cellState(load, 60, 20, { exclude: 'j' })).toEqual({ state: 'ok', left: 90 });
  });
  it('closed and started blocks', () => {
    expect(cellState({ trucks: [], open: false, started: false }, 60, 20).state).toBe('closed');
    expect(cellState({ trucks: [lane('a', 240, 0)], open: true, started: true }, 60, 20).state).toBe('started');
  });
});

describe('days in words', () => {
  const today = '2026-11-04';   // Wednesday
  it('French, the way it is said on the phone', () => {
    expect(blockPhrase('2026-11-04', 'pm', today, 'fr')).toBe('Cet après-midi');
    expect(blockPhrase('2026-11-05', 'am', today, 'fr')).toBe('Demain matin');
    expect(blockPhrase('2026-11-06', 'eve', today, 'fr')).toBe('Vendredi soir');
    expect(blockPhrase('2026-11-19', 'am', today, 'fr')).toBe('Jeudi 19 novembre, matin');
    expect(blockPhraseLower('2026-11-10', 'am', today, 'fr')).toBe('mardi matin');
    expect(relativeDay('2026-11-03', today, 'fr')).toBe('Hier');
  });
  it('English', () => {
    expect(blockPhrase('2026-11-04', 'eve', today, 'en')).toBe('This evening');
    expect(blockPhrase('2026-11-07', 'pm', today, 'en')).toBe('Saturday afternoon');
    expect(blockPhraseLower('2026-11-07', 'pm', today, 'en')).toBe('Saturday afternoon');
    expect(blockPhraseLower('2026-11-05', 'am', today, 'en')).toBe('tomorrow morning');
  });
  it('French and English have the same keys and the same {placeholders}', () => {
    expect(sameShape(fr, en)).toEqual([]);
  });
});

describe('« Coller » a copied appointment: its work as new lines', () => {
  const it0 = (x: Record<string, unknown>) => ({ kind: 'service', service_id: null, item_id: null, description: 'Vidange', qty: 1, unit_cents: 7999, taxable: true, duration_min: 30, status: 'planned', note: null, sort: 0, ...x }) as never;
  it('keeps what was booked, done or accepted, in order; leaves out refused, removed and still-waiting work', () => {
    const d = draftsFromJob([
      it0({ description: 'Pneus', sort: 2, status: 'done', service_id: 's-p', unit_cents: 12000, duration_min: 45 }),
      it0({ description: 'Vidange', sort: 1, service_id: 's-v' }),
      it0({ description: 'Essuie-glaces', sort: 3, status: 'proposed' }),
      it0({ description: 'Freins', sort: 4, status: 'declined' }),
      it0({ description: 'Filtre', sort: 5, status: 'approved', kind: 'part', item_id: 'i-f', qty: 2, unit_cents: 1500, duration_min: null, note: 'PH7317' }),
      it0({ description: '  ', sort: 6 })
    ]);
    expect(d.map((x) => x.description)).toEqual(['Vidange', 'Pneus', 'Filtre']);
    expect(d[0]).toEqual({ kind: 'service', service_id: 's-v', item_id: null, description: 'Vidange', qty: 1, unit_cents: 7999, taxable: true, duration_min: 30, note: null });
    expect(d[2]).toMatchObject({ kind: 'part', item_id: 'i-f', qty: 2, note: 'PH7317' });
    expect('id' in d[0]).toBe(false);
  });
});

import { needsMachine, wordsNeedMachine } from './logic';
describe('the car or the truck: what needs the tire machine', () => {
  it('mounting, unmounted tires, balancing: yes; tires already mounted, oil: no', () => {
    expect(wordsNeedMachine('Pneus : montage et changement (18, 19 po)')).toBe(true);
    expect(wordsNeedMachine('Promo : pneus non montés + huile + inspection')).toBe(true);
    expect(wordsNeedMachine('Balancement des 4 roues')).toBe(true);
    expect(wordsNeedMachine('Changement de pneus (déjà montés)')).toBe(false);
    expect(wordsNeedMachine('Promo : pneus montés + huile')).toBe(false);
    expect(wordsNeedMachine('Changement d’huile (5 L)')).toBe(false);
  });
  it('a service marked « Camion seulement » counts whatever its name', () => {
    const marked = (id: string) => id === 's-machine';
    expect(needsMachine([{ service_id: 's-machine', description: 'Pose sur jantes' }], marked)).toBe(true);
    expect(needsMachine([{ service_id: 's-oil', description: 'Vidange' }, { service_id: null, description: 'Essuie-glaces' }], marked)).toBe(false);
  });
});
