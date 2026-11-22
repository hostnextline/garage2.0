import { describe, it, expect, vi } from 'vitest';
vi.mock('../../data/auth', async (orig) => ({ ...(await orig<typeof import('../../data/auth')>()), isOwner: () => true, can: () => true, myTrucks: () => [] }));
import { render, h } from 'preact';
import { act } from 'preact/test-utils';
import { lang } from '../../lib/i18n';
import { mayEditDay, roadLine, Legend } from './MapLegend';
import type { Assembled, TruckRoute } from '../../shared/map/assemble';
import type { RoadState } from '../../shared/map/useRoads';

describe('« Départ et heure » on the map (map-hours-03)', () => {
  it('offered today and on the coming days', () => {
    expect(mayEditDay('t1', '2026-11-16', '2026-11-16')).toBe(true);
    expect(mayEditDay('t1', '2026-11-20', '2026-11-16')).toBe(true);
  });
  it('never on a day already gone: the server would write nothing, or today’s hours instead', () => {
    expect(mayEditDay('t1', '2026-11-15', '2026-11-16')).toBe(false);
    expect(mayEditDay('t1', '2026-11-09', '2026-11-16')).toBe(false);
  });
});

describe('the road line of a truck in the legend (review F11)', () => {
  it('the road when known; while it is asked « Route en cours de calcul… »; nobody answered « Route indisponible pour l’instant »', () => {
    expect(roadLine({ km: 7.5, minutes: 36 }, 'known', 'fr')).toEqual({ text: '7,5 km de route, 36 min', note: false });
    expect(roadLine({ km: 7.5, minutes: 36 }, 'down', 'en')).toEqual({ text: '7.5 km by road, 36 min', note: false });   // a road known wins
    expect(roadLine(null, 'asking', 'fr')).toEqual({ text: 'Route en cours de calcul…', note: true });
    expect(roadLine(null, 'down', 'fr')).toEqual({ text: 'Route indisponible pour l’instant', note: true });
    expect(roadLine(null, 'asking', 'en')).toEqual({ text: 'Working out the route…', note: true });
    expect(roadLine(null, 'down', 'en')).toEqual({ text: 'Route not available for now', note: true });
    expect(roadLine(null, 'none', 'fr')).toBeNull();   // nothing to route (no stop placed): nothing said
    // never asked (too many stops, or no road for any planner): no « for now » promise (review-maps L4)
    expect(roadLine(null, 'never', 'fr')).toEqual({ text: 'Route impossible à tracer', note: true });
    expect(roadLine(null, 'never', 'en')).toEqual({ text: 'This route can’t be drawn', note: true });
  });
  it('the note takes the road’s own line in the truck’s row: when the road comes, it replaces the note, nothing moves', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const tr = { id: 't1', name: 'Camion', color: '#D3000E', driverId: null, driverName: '', stops: [], done: 0, total: 2, next: null, nextEta: null, trip: null, legs: [], from: null, start: null } as unknown as TruckRoute;
    const m = { home: null, trucks: [tr], unplaced: [], people: [], trips: [], count: 2 } as Assembled;
    const draw = (road: { km: number; minutes: number } | null, state: RoadState) => act(() => {
      render(h(Legend, { m, day: '2026-11-16', focus: null, onFocus: () => undefined, roadOf: () => road, roadState: () => state }), box);
    });
    lang.value = 'fr';
    await draw(null, 'asking');
    const row = box.querySelector('[data-testid="legend-t1"] .row-main')!;
    const note = box.querySelector('[data-testid="road-note-t1"]')!;
    expect(note.textContent).toBe('Route en cours de calcul…');
    expect(note.className).toContain('row-sub map-road');
    const lines = row.children.length;
    await draw(null, 'down');
    expect(box.querySelector('[data-testid="road-note-t1"]')!.textContent).toBe('Route indisponible pour l’instant');
    await draw({ km: 12, minutes: 25 }, 'known');
    expect(box.querySelector('[data-testid="road-note-t1"]')).toBeNull();
    expect(box.querySelector('[data-testid="road-t1"]')!.textContent).toBe('12 km de route, 25 min');
    expect(row.children.length).toBe(lines);   // the same number of lines: the layout does not move
    await act(() => { render(null, box); });
  });
});
