import { describe, it, expect, afterEach } from 'vitest';
import { replaceLocal, clearAll } from '../../data/store';
import { firstWork } from './work';
import { jobsOfDay } from './days';

afterEach(() => clearAll());

describe('the work a ticket of the agenda says (agenda-17)', () => {
  it('never a line taken off, refused, or an extra the customer has not answered', () => {
    replaceLocal('job_items', [
      { id: 'a', job_id: 'j', status: 'removed', description: 'Freins', sort: 1 },
      { id: 'b', job_id: 'j', status: 'proposed', description: 'Essuie-glaces', sort: 2 },
      { id: 'c', job_id: 'j', status: 'declined', description: 'Pneus', sort: 3 },
      { id: 'd', job_id: 'j', status: 'planned', description: 'Changement d’huile', sort: 4 },
      { id: 'e', job_id: 'k', status: 'approved', description: 'Filtre', sort: 1 },
      { id: 'f', job_id: 'k', status: 'done', description: 'Avant', sort: 0, deleted_at: '2026-11-01' }
    ]);
    expect(firstWork('j')).toBe('Changement d’huile');
    expect(firstWork('k')).toBe('Filtre');
    expect(firstWork('none')).toBe('');
  });
  it('follows the sort order of the job sheet', () => {
    replaceLocal('job_items', [{ id: 'x', job_id: 'j', status: 'done', description: 'Deux', sort: 2 }, { id: 'y', job_id: 'j', status: 'planned', description: 'Un', sort: 1 }]);
    expect(firstWork('j')).toBe('Un');
  });
});

describe('the jobs of each day, indexed once (agenda-13)', () => {
  it('gives a day’s jobs in the day’s order, without the deleted ones', () => {
    replaceLocal('jobs', [
      { id: 'p', day: '2026-11-16', block: 'pm', stop_order: 1, number: 3 },
      { id: 'a2', day: '2026-11-16', block: 'am', stop_order: 2, number: 2 },
      { id: 'a1', day: '2026-11-16', block: 'am', stop_order: 1, number: 1 },
      { id: 'other', day: '2026-11-17', block: 'am', stop_order: 1, number: 4 }
    ]);
    expect(jobsOfDay('2026-11-16').map((j) => j.id)).toEqual(['a1', 'a2', 'p']);
    expect(jobsOfDay('2026-11-18')).toEqual([]);
  });
});
