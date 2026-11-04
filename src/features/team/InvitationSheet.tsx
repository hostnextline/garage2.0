/* A pending invitation: who, which role, until when; « Envoyer encore » (a new link replaces the old one) or cancel it. */
import { Send } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { stamp } from '../../lib/dates';
import { truckLabel } from '../../data/select';
import { errorMessage } from '../../data/api';
import { Sheet, Button, Banner, Kv, toast } from '../../ui';
import { teamDo, rolesWords, type Invitation } from './teamApi';

export function InvitationSheet(p: { inv: Invitation | null; onClose: () => void; onAgain: (inv: Invitation) => void; onCancelled: () => void }) {
  const inv = p.inv;
  if (!inv) return null;
  const expired = Date.parse(inv.expires_at) < Date.now();
  const cancel = async () => {
    try {
      await teamDo('invite-cancel', { id: inv.id });
      toast(t('team.invitation.cancelled'), { kind: 'ok' });
      p.onCancelled();
      p.onClose();
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };
  return (
    <Sheet open onClose={p.onClose} title={t('team.invitation.title', { name: inv.full_name })} data-testid="invitation-sheet"
      footer={<>
        <Button variant="danger" confirm={t('team.invitation.cancelConfirm')} onClick={cancel} data-testid="invitation-cancel">{t('team.invitation.cancel')}</Button>
        <Button variant="primary" icon={<Send size={18} />} onClick={() => p.onAgain(inv)} data-testid="invitation-again">{t('team.invitation.again')}</Button>
      </>}>
      <div class="stack">
        {expired
          ? <Banner kind="warn">{t('team.invitation.expired', { date: stamp(inv.expires_at, lang.value) })}</Banner>
          : <p class="muted" style={{ margin: 0 }}>{t('team.invitation.sentOn', { date: stamp(inv.created_at, lang.value) })} {t('team.invitation.until', { date: stamp(inv.expires_at, lang.value) })}</p>}
        <Kv items={[
          [t('team.inviteSheet.email'), inv.email],
          [t('team.inviteSheet.roles'), rolesWords(inv.roles)],
          [t('team.inviteSheet.truck'), inv.truck_id ? truckLabel(inv.truck_id) || null : null]
        ]} />
      </div>
    </Sheet>
  );
}
