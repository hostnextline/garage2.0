/* « Nouveau mot de passe »: a link for the person, sent by e-mail or text, or made to copy. */
import { useEffect, useState } from 'preact/hooks';
import { Send, Link2 } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { Sheet, Button, Field, Banner, run, toast } from '../../ui';
import { teamDo, type LinkAnswer, type LinkResult, type SendHow } from '../../domain/team/teamApi';
import { HowSeg } from './LinkSheet';

export function PasswordSheet(p: { open: boolean; id: string; name: string; email: string | null; phone: string | null; onClose: () => void; onLink: (r: LinkResult) => void }) {
  const [how, setHow] = useState<SendHow>('email');
  useEffect(() => { if (p.open) setHow(p.email ? 'email' : p.phone ? 'sms' : 'none'); }, [p.open]);
  const send = async () => {
    const r = await run(() => teamDo<LinkAnswer>('reset-link', { staff_id: p.id, send: how }));
    if (!r) return;
    p.onClose();
    if (r.sent === 'sent') { toast(t('team.person.passwordSent', { name: p.name }), { kind: 'ok' }); return; }
    p.onLink({ ...r, link: String(r.link || ''), sent: String(r.sent || 'none'), name: p.name, email: p.email, phone: p.phone, reset: true });
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('team.person.passwordTitle', { name: p.name })} data-testid="password-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" icon={how === 'none' ? <Link2 size={18} /> : <Send size={18} />} onClick={send} data-testid="password-send">{how === 'none' ? t('team.inviteSheet.makeLink') : t('team.person.passwordSend')}</Button>
      </>}>
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{t('team.person.passwordLead')}</p>
        <Field label={t('team.inviteSheet.how')} help={t('team.inviteSheet.howHelp')} group>
          <HowSeg value={how} onValue={setHow} label={t('team.inviteSheet.how')} />
        </Field>
        {how === 'sms' && !p.phone && <Banner kind="warn">{t('team.inviteSheet.needPhone')}</Banner>}
      </div>
    </Sheet>
  );
}
