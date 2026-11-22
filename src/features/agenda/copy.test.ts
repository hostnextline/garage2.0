import { describe, it, expect, afterEach } from 'vitest';
import { access, viewAs } from '../../data/auth';
import { replaceLocal, clearAll } from '../../data/store';
import type { Access } from '../../data/types';
import { copiedJob, copiedRow, copyJob, clearCopy } from './copy';

const ID = '11111111-2222-3333-4444-555555555555';
afterEach(() => { clearCopy(); viewAs.value = null; access.value = null; clearAll(); });

describe('the appointment copied (agenda-19)', () => {
  it('is forgotten when the person signs out, or another person signs in on the same tab', () => {
    access.value = { id: 'nadia' } as Access;
    copyJob(ID);
    expect(copiedJob.value).toBe(ID);
    access.value = null;
    expect(copiedJob.value).toBe(null);
    expect(sessionStorage.getItem('his.agenda.copy')).toBe(null);
    access.value = { id: 'nadia' } as Access;
    copyJob(ID);
    access.value = { id: 'hassan' } as Access;
    expect(copiedJob.value).toBe(null);
  });
  it('stays when the owner looks at the app as someone else and comes back (« Voir l’app comme… »)', () => {
    access.value = { id: 'hassan', owner: true } as Access;
    copyJob(ID);
    viewAs.value = { id: 'nadia', owner: false } as Access;
    expect(copiedJob.value).toBe(ID);
    viewAs.value = null;
    expect(copiedJob.value).toBe(ID);
  });
  it('is offered for pasting only while the phone holds the appointment', () => {
    copyJob(ID);
    expect(copiedRow()).toBeUndefined();
    replaceLocal('jobs', [{ id: ID, day: '2026-11-17', block: 'am', number: 1 }]);
    expect(copiedRow()?.id).toBe(ID);
  });
});
