import { describe, it, expect } from 'vitest';
import { bookedBy } from './bookedBy';

const at = new Date(2026, 10, 9, 14, 32).toISOString(); // 9 Nov., 14 h 32 on the phone's clock
describe('« Réservé par »', () => {
  it('names the team member and when', () => {
    expect(bookedBy({ source: 'phone', created_by: 'x', created_at: at }, 'Nadia', 'fr')).toMatch(/^Nadia, le 9 nov\.?( 2026)?, 14 h 32$/);
    expect(bookedBy({ source: 'phone', created_by: 'x', created_at: at }, 'Nadia', 'en')).toMatch(/^Nadia, Nov\.? 9(, 2026)?, 2:32/);
  });
  it('says how: on the spot, from an estimate, by the customer online', () => {
    expect(bookedBy({ source: 'walk_in', created_by: 'x', created_at: at }, 'Saleh', 'fr')).toMatch(/^Saleh, sur place, le /);
    expect(bookedBy({ source: 'quote', created_by: 'x', created_at: at }, 'Hassan', 'fr')).toMatch(/^Hassan, depuis une estimation, le /);
    expect(bookedBy({ source: 'web', created_by: null, created_at: at }, '', 'fr')).toMatch(/^Le client, en ligne, le /);
  });
  it('a member this phone does not know, or nobody recorded', () => {
    expect(bookedBy({ source: 'phone', created_by: 'x', created_at: at }, '', 'fr')).toMatch(/^Quelqu’un de l’équipe, le /);
    expect(bookedBy({ source: 'phone', created_by: null, created_at: at }, '', 'fr')).toBeNull();
  });
});
