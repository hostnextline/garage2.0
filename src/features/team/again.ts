/* « Envoyer encore » (settings-team-25): the invitation sheet filled again from the pending invitation, with its short
   name, its language and the phone when the server gives them (a newer `team list`, R179); an older server gives
   neither, and the sheet keeps its own defaults (French, no short name, no phone), as before. Pure, tested in again.test.ts. */
import type { Invitation } from '../../domain/team/teamApi';
import type { InviteDraft } from './InviteSheet';

export function againDraft(i: Invitation): Partial<InviteDraft> {
  const d: Partial<InviteDraft> = { full_name: i.full_name, email: i.email, roles: i.roles.length ? i.roles : ['mechanic'], truck_id: i.truck_id || '' };
  if (typeof i.short_name === 'string' && i.short_name.trim()) d.short_name = i.short_name;
  if (i.lang === 'en' || i.lang === 'fr') d.lang = i.lang;
  if (typeof i.phone === 'string' && i.phone.trim()) d.phone = i.phone;
  return d;
}
