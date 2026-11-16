import { describe, it, expect } from 'vitest';
import { mayRemove, removal, addsExtra, mayReprice, mayAnswer } from './work';

describe('the work lines of a job', () => {
  it('a line billed on a finished invoice is not taken off; refused or already off neither', () => {
    expect(mayRemove({ status: 'planned' }, false)).toBe(true);
    expect(mayRemove({ status: 'proposed' }, false)).toBe(true);
    expect(mayRemove({ status: 'done' }, true)).toBe(false);
    expect(mayRemove({ status: 'declined' }, false)).toBe(false);
    expect(mayRemove({ status: 'removed' }, false)).toBe(false);
  });
  it('on site the line becomes « Pas fait »; before, or a proposal, it leaves the job', () => {
    expect(removal('on_site', { status: 'planned' })).toBe('not_done');
    expect(removal('on_site', { status: 'proposed' })).toBe('delete');
    expect(removal('booked', { status: 'planned' })).toBe('delete');
    expect(removal('en_route', { status: 'done' })).toBe('delete');
  });
  it('a mechanic’s work added on site is an extra; the office’s is planned', () => {
    expect(addsExtra(false, 'on_site')).toBe(true);
    expect(addsExtra(true, 'on_site')).toBe(false);
    expect(addsExtra(false, 'booked')).toBe(false);
  });
  it('prices change while the job is open', () => {
    expect(mayReprice('booked', { status: 'planned' })).toBe(true);
    expect(mayReprice('done', { status: 'planned' })).toBe(false);
    expect(mayReprice('on_site', { status: 'declined' })).toBe(false);
  });
  it('« Réponse » only while the job is open (jobs-b-24: before, on a finished or cancelled job too)', () => {
    expect(mayAnswer(true, 'on_site', { status: 'proposed' })).toBe(true);
    expect(mayAnswer(true, 'done', { status: 'proposed' })).toBe(false);
    expect(mayAnswer(true, 'cancelled', { status: 'proposed' })).toBe(false);
    expect(mayAnswer(false, 'on_site', { status: 'proposed' })).toBe(false);
    expect(mayAnswer(true, 'on_site', { status: 'approved' })).toBe(false);
  });
});
