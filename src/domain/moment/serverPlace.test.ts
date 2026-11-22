/* « Vraies routes » on: what the app reads of a server row (serverPlace.ts). Rank and route only from a window-mode row
   (review-moments M5, lead 2026-11-20), never another vehicle's numbers under this one's map (L1), never a number
   while a trip is not measured (H3). */
import { describe, it, expect } from 'vitest';
import { serverRank, saysOrder, rowOfTruck, addsFromRow, dayFromRow, blockAdds } from './serverPlace';

const win = (o: Record<string, unknown> = {}) => ({ block: 'day', truck: 'T1', rank: 2, route: ['A', 'new', 'B'], stops: 2, ...o });

describe('serverRank: « Arrêt n sur N » only where the server is exact (window mode)', () => {
  it('a window-mode row for the vehicle drawn: its rank, N = the route', () => {
    expect(serverRank(win(), 'T1')).toEqual({ n: 2, total: 3 });
    expect(serverRank(win(), null)).toEqual({ n: 2, total: 3 });
    expect(serverRank(win({ route: null, stops: 3, rank: 1 }), 'T1')).toEqual({ n: 1, total: 4 });
  });
  it('blocks mode (am, pm, eve), or a row that does not say its block: nothing of the order, whatever the server sends', () => {
    for (const block of ['am', 'pm', 'eve', undefined, null]) expect(serverRank(win({ block }), 'T1')).toBeNull();
    expect(saysOrder({ block: 'am', rank: 1 })).toBe(false);
    expect(saysOrder({ block: 'day' })).toBe(true);
    expect(saysOrder(null)).toBe(false);
  });
  it('another vehicle, no vehicle, no rank, a rank out of the route or not where the route puts « new »: nothing', () => {
    expect(serverRank(win(), 'T2')).toBeNull();
    expect(serverRank(win({ truck: null }), null)).toBeNull();
    expect(serverRank(win({ rank: null }), 'T1')).toBeNull();
    expect(serverRank(win({ rank: 4 }), 'T1')).toBeNull();
    expect(serverRank(win({ rank: 1 }), 'T1')).toBeNull();
    expect(serverRank(null, 'T1')).toBeNull();
  });
});

describe('rowOfTruck: a row speaks only of its own vehicle (L1)', () => {
  it('the vehicle drawn is the row’s, or none is drawn: the row; another vehicle (or a row with no vehicle under one): null', () => {
    const r = { truck: 'T2', add_min: 25 };
    expect(rowOfTruck(r, 'T2')).toBe(r);
    expect(rowOfTruck(r, null)).toBe(r);
    expect(rowOfTruck(r, 'T1')).toBeNull();
    expect(rowOfTruck({ truck: null, add_min: 5 }, 'T1')).toBeNull();
    expect(rowOfTruck(null, 'T1')).toBeNull();
  });
});

describe('the words of a row (real roads), fr and en', () => {
  it('what it adds: minutes and km of real road; minutes only; not measured; nothing known', () => {
    expect(addsFromRow({ add_min: 13, add_km: 4.2 }, 'fr')).toBe('Ce rendez-vous ajoute 13 min de route (4,2 km).');
    expect(addsFromRow({ add_min: 13, add_km: 4.2 }, 'en')).toBe('This appointment adds 13 min of driving (4.2 km).');
    expect(addsFromRow({ add_min: 13, add_km: null }, 'fr')).toBe('Ce rendez-vous ajoute 13 min de route.');
    expect(addsFromRow({ add_min: 40, add_km: null, unmeasured: 2 }, 'fr')).toBe('Route ajoutée : pas encore mesurée');
    expect(addsFromRow({ add_min: 40, add_km: null, unmeasured: 2 }, 'en')).toBe('Driving added: not measured yet');
    expect(addsFromRow(null, 'fr')).toBe('Route ajoutée : pas encore calculée');
    expect(addsFromRow({ add_min: null }, 'en')).toBe('Driving added: not worked out yet');
  });
  it('the day with it: km and time; not measured; nothing said without a number', () => {
    expect(dayFromRow({ day_min: 70, day_km: 38 }, 'fr')).toBe('Route de la journée avec ce rendez-vous : 38 km, 1 h 10');
    expect(dayFromRow({ day_min: 70, day_km: null }, 'en')).toMatch(/^Route of the day with this appointment: 1 h 10/);
    expect(dayFromRow({ day_min: 90, unmeasured: 1 }, 'fr')).toBe('Route de la journée : pas encore mesurée');
    expect(dayFromRow({ day_min: null }, 'fr')).toBe('');
    expect(dayFromRow(null, 'fr')).toBe('');
  });
  it('under a block of « Choisir sur la carte »: « +13 min de route (4,2 km) », « route pas encore mesurée », never 40 min of unknown time', () => {
    expect(blockAdds({ add_min: 13, add_km: 4.2 }, 'fr')).toBe('+13 min de route (4,2 km)');
    expect(blockAdds({ add_min: 40, add_km: null, unmeasured: 2 }, 'fr')).toBe('route pas encore mesurée');
    expect(blockAdds({ add_min: 40, add_km: null, unmeasured: 2 }, 'en')).toBe('road not measured yet');
    expect(blockAdds({ add_min: null }, 'fr')).toBe('');
    expect(blockAdds(null, 'fr')).toBe('');
  });
});
