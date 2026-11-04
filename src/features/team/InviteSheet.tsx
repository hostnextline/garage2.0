/* « Inviter quelqu'un »: name, short name, email, phone, roles, the mechanic's truck, language, how to send.
   The server makes a link (7 days, once); when it could not send it, the link is shown to copy or share. */
import { useEffect, useState } from 'preact/hooks';
import { Send, Link2 } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { EMAIL_RE, firstName, phoneDigits } from '../../lib/text';
import { activeTrucks, truckLabel, staffName } from '../../data/select';
import { errorMessage } from '../../data/api';
import type { Role } from '../../data/types';
import { Sheet, Button, Field, Input, PhoneInput, Chips, Seg, Select, Banner, toast } from '../../ui';
import { HowSeg } from './LinkSheet';
import { teamDo, type LinkAnswer, type LinkResult, type SendHow } from './teamApi';
import { ALL_ROLES } from './rights';

export interface InviteDraft { full_name: string; short_name: string; email: string; phone: string; roles: Role[]; truck_id: string; lang: 'fr' | 'en'; send: SendHow }
const EMPTY: InviteDraft = { full_name: '', short_name: '', email: '', phone: '', roles: ['mechanic'], truck_id: '', lang: 'fr', send: 'email' };
type Errors = Partial<Record<'full_name' | 'email' | 'phone' | 'roles' | 'truck_id', string>>;

/** a truck nobody drives yet, else none (the owner chooses) */
function freeTruck(): string {
  return activeTrucks.value.find((tr) => !tr.driver_id)?.id || '';
}

export function InviteSheet(p: { open: boolean; prefill?: Partial<InviteDraft> | null; again?: boolean; onClose: () => void; onLink: (r: LinkResult) => void; onSent: () => void }) {
  const [d, setD] = useState<InviteDraft>(EMPTY);
  const [err, setErr] = useState<Errors>({});
  useEffect(() => {
    if (!p.open) return;
    const start = { ...EMPTY, truck_id: freeTruck(), ...(p.prefill || {}) };
    setD(start); setErr({});
  }, [p.open]);
  const set = <K extends keyof InviteDraft>(k: K, v: InviteDraft[K]) => { setD((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: undefined })); };
  const isMech = d.roles.includes('mechanic');
  const taken = isMech && d.truck_id ? activeTrucks.value.find((tr) => tr.id === d.truck_id)?.driver_id : null;

  const submit = async () => {
    const e: Errors = {};
    if (!d.full_name.trim()) e.full_name = t('team.inviteSheet.needName');
    if (!EMAIL_RE.test(d.email.trim())) e.email = t('team.inviteSheet.needEmail');
    if (!d.roles.length) e.roles = t('team.inviteSheet.needRole');
    if (d.send === 'sms' && !phoneDigits(d.phone)) e.phone = t('team.inviteSheet.needPhone');
    setErr(e);
    if (Object.keys(e).length) return;
    const name = d.full_name.trim();
    try {
      const r = await teamDo<LinkAnswer>('invite', {
        full_name: name, short_name: d.short_name.trim() || null, email: d.email.trim().toLowerCase(), phone: d.phone.trim() || null,
        roles: d.roles, lang: d.lang, send: d.send, truck_id: isMech && d.truck_id ? d.truck_id : null
      });
      p.onSent();
      if (r.sent === 'sent') { toast(t('team.inviteSheet.sent', { name: firstName(name) || name }), { kind: 'ok' }); p.onClose(); return; }
      p.onClose();
      p.onLink({ ...r, link: String(r.link || ''), sent: String(r.sent || 'none'), name: firstName(name) || name, email: d.email.trim(), phone: d.phone.trim() || null });
    } catch (x) {
      const code = String((x as { code?: string }).code || '');
      const msg = errorMessage(x);
      if (code === 'name') setErr({ full_name: msg });
      else if (code === 'email') setErr({ email: msg });
      else if (code === 'exists') setErr({ email: t('team.inviteSheet.exists') });
      else if (code === 'roles') setErr({ roles: msg });
      else if (code === 'phone') setErr({ phone: msg });
      else if (code === 'truck') setErr({ truck_id: t('team.inviteSheet.badTruck') });
      else toast(msg, { kind: 'bad' });
    }
  };

  return (
    <Sheet open={p.open} onClose={p.onClose} title={p.again ? t('team.inviteSheet.again') : t('team.inviteSheet.title')} data-testid="invite-sheet"
      footer={<>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" icon={d.send === 'none' ? <Link2 size={18} /> : <Send size={18} />} onClick={submit} data-testid="invite-send">
          {d.send === 'none' ? t('team.inviteSheet.makeLink') : t('team.inviteSheet.send')}
        </Button>
      </>}>
      <div class="stack">
        <p class="muted small" style={{ margin: 0 }}>{t('team.inviteSheet.lead')}</p>
        <div class="grid-2">
          <Field label={t('team.inviteSheet.name')} error={err.full_name}>
            <Input value={d.full_name} onValue={(v) => set('full_name', v)} autoComplete="off" placeholder={t('team.inviteSheet.namePh')} invalid={!!err.full_name} data-testid="invite-name" />
          </Field>
          <Field label={t('team.inviteSheet.short')} hint={t('team.inviteSheet.shortHint')} optional>
            <Input value={d.short_name} onValue={(v) => set('short_name', v)} autoComplete="off" placeholder={firstName(d.full_name) || undefined} maxLength={40} />
          </Field>
          <Field label={t('team.inviteSheet.email')} hint={t('team.inviteSheet.emailHint')} error={err.email}>
            <Input type="email" inputMode="email" autoComplete="off" value={d.email} onValue={(v) => set('email', v)} invalid={!!err.email} data-testid="invite-email" />
          </Field>
          <Field label={t('team.inviteSheet.phone')} hint={t('team.inviteSheet.phoneHint')} error={err.phone} optional={d.send !== 'sms'}>
            <PhoneInput value={d.phone} onValue={(v) => set('phone', v)} invalid={!!err.phone} />
          </Field>
        </div>
        <Field label={t('team.inviteSheet.roles')} hint={err.roles ? undefined : t('team.inviteSheet.rolesHint')} error={err.roles} help={t('team.rolesHelp')} group>
          <Chips multiple value={d.roles} onValue={(v) => set('roles', v as Role[])} label={t('team.inviteSheet.roles')} data-testid="invite-roles"
            options={ALL_ROLES.map((r) => ({ value: r, label: t(`team.roles.${r}`) }))} />
        </Field>
        {isMech && (
          <Field label={t('team.inviteSheet.truck')} help={t('team.inviteSheet.truckHelp')} error={err.truck_id}
            hint={taken ? t('team.inviteSheet.truckTaken', { name: staffName(taken) }) : undefined}>
            <Select value={d.truck_id} onValue={(v) => set('truck_id', v)} aria-label={t('team.inviteSheet.truck')}
              options={[{ value: '', label: t('team.inviteSheet.noTruck') }, ...activeTrucks.value.map((tr) => ({ value: tr.id, label: truckLabel(tr.id) }))]} />
          </Field>
        )}
        <Field label={t('team.inviteSheet.lang')} group>
          <Seg value={d.lang} onValue={(v) => set('lang', v)} label={t('team.inviteSheet.lang')} options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} />
        </Field>
        <Field label={t('team.inviteSheet.how')} help={t('team.inviteSheet.howHelp')} group>
          <HowSeg value={d.send} onValue={(v) => set('send', v)} label={t('team.inviteSheet.how')} />
        </Field>
        {d.send === 'sms' && !d.phone.trim() && !err.phone && <Banner kind="info">{t('team.inviteSheet.needPhone')}</Banner>}
      </div>
    </Sheet>
  );
}
