import { describe, it, expect, vi } from 'vitest';
vi.mock('../../data/auth', async (orig) => ({ ...(await orig<typeof import('../../data/auth')>()), isOwner: () => true, can: () => true, myTrucks: () => [] }));
import { mayEditDay } from './MapLegend';

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
