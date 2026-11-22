import { describe, it, expect } from 'vitest';
import { againDraft } from './again';
import type { Invitation } from '../../domain/team/teamApi';

const inv = (x: Partial<Invitation> = {}): Invitation => ({ id: 'i1', email: 'karim@x.ca', full_name: 'Karim Haddad', roles: ['mechanic'], kind: 'invite', truck_id: 't1',
  expires_at: '2026-11-20T00:00:00Z', used_at: null, created_at: '2026-11-13T00:00:00Z', ...x });

describe('« Envoyer encore »: the invitation filled again (settings-team-25)', () => {
  it('an older server: name, e-mail, roles and truck, the sheet’s own defaults for the rest (as before)', () => {
    expect(againDraft(inv())).toEqual({ full_name: 'Karim Haddad', email: 'karim@x.ca', roles: ['mechanic'], truck_id: 't1' });
    expect(againDraft(inv({ roles: [], truck_id: null }))).toEqual({ full_name: 'Karim Haddad', email: 'karim@x.ca', roles: ['mechanic'], truck_id: '' });
  });
  it('a newer server: the short name, the language and the phone of the invitation are kept', () => {
    expect(againDraft(inv({ short_name: 'Kim', lang: 'en', phone: '514 555-1234' }))).toMatchObject({ short_name: 'Kim', lang: 'en', phone: '514 555-1234' });
  });
  it('an empty or odd value is not taken', () => {
    const d = againDraft(inv({ short_name: '  ', lang: 'es', phone: '' }));
    expect('short_name' in d || 'lang' in d || 'phone' in d).toBe(false);
  });
});
