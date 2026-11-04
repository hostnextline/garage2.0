/* La fiche d'une personne (propriétaire): ses rôles, ce qu'elle peut faire (3 choix par droit), sa couleur, ses infos,
   son accès, un nouveau mot de passe, voir l'app comme elle, la retirer de l'équipe.
   Every change is sent at once, one after the other (two quick taps never overwrite each other). */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { KeyRound, Eye, UserMinus, Check, Send, Link2 } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { firstName } from '../../lib/text';
import { RIGHTS, type Right, type Role } from '../../data/types';
import { staff as staffOf, settings, trucks } from '../../data/select';
import { memberUpdate, errorMessage } from '../../data/api';
import { access, startPreview } from '../../data/auth';
import { refetch } from '../../data/sync';
import { navigate } from '../../app/router';
import { Sheet, Panel, Button, Field, Input, PhoneInput, Chips, Seg, Switch, Banner, Avatar, Pill, ask, run, toast } from '../../ui';
import { ALL_ROLES, fromRoles, choiceOf, withChoice, activeOverrides, type Choice, type Overrides, type RoleRights } from './rights';
import { teamDo, rolesWords, type LinkAnswer, type LinkResult, type SendHow, type TeamList } from './teamApi';
import { HowSeg } from './LinkSheet';
import { ago } from '../map/ago';

export const COLORS: { key: string; hex: string }[] = [
  { key: 'red', hex: '#D3000E' }, { key: 'blue', hex: '#2F6FD0' }, { key: 'green', hex: '#1F8A53' }, { key: 'amber', hex: '#B86E00' },
  { key: 'violet', hex: '#7347D1' }, { key: 'teal', hex: '#0F7C82' }, { key: 'raspberry', hex: '#C2185B' }, { key: 'slate', hex: '#5D6B78' }
];

export function PersonSheet(p: { id: string | null; signIns?: TeamList['sign_ins']; onClose: () => void; onLink: (r: LinkResult) => void }) {
  if (!p.id) return null;
  return <PersonOpen {...p} id={p.id} />;
}

function PersonOpen(p: { id: string; signIns?: TeamList['sign_ins']; onClose: () => void; onLink: (r: LinkResult) => void }) {
  const s = staffOf(p.id);
  const [pending, setPending] = useState<Partial<Record<Right, Choice>>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(fn, fn);
    queue.current = next.catch(() => undefined);
    return next;
  };
  // the person left the team (removed here or elsewhere): the sheet closes
  useEffect(() => { if (!s) p.onClose(); }, [!!s]);
  if (!s) return null;

  const isMe = s.id === access.value?.id;
  const shownRoles = roles ?? s.roles;
  const isOwner = shownRoles.includes('owner');
  const rr = (settings.value.role_rights || {}) as RoleRights;
  const name = s.short_name || firstName(s.full_name) || s.full_name;
  const drives = trucks.value.filter((tr) => tr.driver_id === s.id);
  const seenAt = s.last_seen_at || p.signIns?.[s.id]?.last_sign_in_at || null;
  const isActive = active ?? s.active;
  const own = activeOverrides(shownRoles, s.rights, rr);

  const chooseRight = (right: Right, c: Choice) => {
    setPending((x) => ({ ...x, [right]: c }));
    void enqueue(async () => {
      let next: Overrides = { ...(staffOf(p.id)?.rights || {}) };
      for (const [k, v] of Object.entries(pendingRef.current)) next = withChoice(next, k as Right, v as Choice);
      next = withChoice(next, right, c);
      await run(() => memberUpdate(p.id, { rights: next }), { ok: t('team.person.rightSaved') });
      setPending((x) => { const y = { ...x }; if (y[right] === c) delete y[right]; return y; });
    });
  };
  const changeRoles = async (next: Role[]) => {
    if (!next.length) { toast(t('team.person.lastRole'), { kind: 'bad' }); return; }
    if (isMe && s.roles.includes('owner') && !next.includes('owner')) {
      const ok = await ask({ title: t('team.person.dropOwner.title'), text: t('team.person.dropOwner.text'), ok: t('team.person.dropOwner.ok'), danger: true });
      if (!ok) return;
    }
    setRoles(next);
    await enqueue(() => run(() => memberUpdate(p.id, { roles: next }), { ok: t('team.person.rolesSaved') }));
    setRoles(null);
  };
  const changeColor = async (hex: string) => {
    setColor(hex);
    await enqueue(() => run(() => memberUpdate(p.id, { color: hex }), { ok: t('team.person.colorSaved') }));
    setColor(null);
  };
  const changeActive = async (v: boolean) => {
    if (!v && !(await ask({ title: t('team.person.block.title', { name }), text: t('team.person.block.text'), ok: t('team.person.block.ok'), danger: true }))) return;
    setActive(v);
    await enqueue(() => run(() => memberUpdate(p.id, { active: v }), { ok: v ? t('team.person.unblocked') : t('team.person.blocked') }));
    setActive(null);
  };
  const preview = async () => {
    const ok = await startPreview(p.id).catch(() => false);
    if (!ok) { toast(t('team.person.previewFail'), { kind: 'bad' }); return; }
    p.onClose();
    navigate('/');
  };
  const remove = async () => {
    try {
      await teamDo('remove', { staff_id: p.id });
      toast(t('team.person.removed', { name }), { kind: 'ok' });
      await refetch('staff', p.id);
      p.onClose();
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };

  const head = (
    <div class="team-head">
      <Avatar name={s.full_name} color={color ?? s.color} />
      <div class="grow">
        <p class="team-head-roles">{drives.length ? t('team.drives', { roles: rolesWords(shownRoles), truck: drives.map((d) => d.name).join(', ') }) : rolesWords(shownRoles)}</p>
        <p class="small muted" style={{ margin: 0 }}>{seenAt ? t('team.seen', { ago: ago(seenAt) }) : t('team.neverSeen')}</p>
      </div>
      {!isActive ? <Pill tone="bad">{t('team.state.blocked')}</Pill> : <Pill tone="ok">{t('team.state.active')}</Pill>}
    </div>
  );

  return (
    <>
      <Sheet open onClose={p.onClose} wide title={s.full_name} sub={s.email || undefined} data-testid="person-sheet">
        <div class="stack-lg">
          {head}
          {isMe && <Banner kind="info" action={<Button size="sm" href="#/account">{t('team.person.selfLink')}</Button>}>{t('team.person.self')}</Banner>}
          <div class="team-sheet-grid">
            <div class="stack-lg">
              <Panel plain title={t('team.person.roles')} help={t('team.rolesHelp')}>
                <Chips multiple value={shownRoles} onValue={(v) => void changeRoles(v as Role[])} label={t('team.person.roles')} data-testid="person-roles"
                  options={ALL_ROLES.map((r) => ({ value: r, label: t(`team.roles.${r}`) }))} />
              </Panel>
              <Panel plain title={t('team.person.rights', { name })} help={t('team.person.rightsHelp')} data-tour="team-rights" data-testid="person-rights"
                sub={!isOwner && own.length ? t('team.person.own', { n: own.length }) : undefined}>
                {isOwner ? <p class="muted" style={{ margin: 0 }}>{t('team.person.ownerAll')}</p> : (
                  <div class="team-rights">
                    {RIGHTS.map((r) => {
                      const base = fromRoles(shownRoles, r, rr);
                      const c = pending[r] ?? choiceOf(s.rights, r);
                      return (
                        <div key={r} class="team-right" data-testid={`right-${r}`}>
                          <div class="team-right-text">
                            <b>{t(`team.rights.${r}.title`)}</b>
                            <span class="small muted">{t(`team.rights.${r}.text`)}</span>
                          </div>
                          {base.kind === 'can'
                            ? <Seg label={t(`team.rights.${r}.title`)} value={c} onValue={(v) => chooseRight(r, v)} class="team-choice"
                                options={[
                                  { value: 'role', label: t('team.person.choiceRole', { value: base.value ? t('team.person.yesWord') : t('team.person.noWord') }) },
                                  { value: 'yes', label: t('team.person.yes') },
                                  { value: 'no', label: t('team.person.no') }
                                ]} />
                            : <span class={`team-fixed${base.value ? ' is-on' : ''}`}>{base.value ? <Check size={16} aria-hidden="true" /> : null}{base.value ? t('team.person.always') : t('team.person.never')}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </div>
            <div class="stack-lg">
              <Panel plain title={t('team.person.color')} help={t('team.person.colorHelp')}>
                <div class="team-colors" role="radiogroup" aria-label={t('team.person.color')}>
                  {COLORS.map((c) => {
                    const on = (color ?? s.color ?? '').toLowerCase() === c.hex.toLowerCase();
                    return (
                      <button key={c.key} type="button" role="radio" aria-checked={on} class="team-color" style={{ '--c': c.hex }} aria-label={t(`team.person.colors.${c.key}`)}
                        title={t(`team.person.colors.${c.key}`)} onClick={() => { if (!on) void changeColor(c.hex); }}>
                        {on && <Check size={20} strokeWidth={3} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </Panel>
              <InfosPanel id={s.id} full_name={s.full_name} short_name={s.short_name} phone={s.phone} email={s.email} enqueue={enqueue} />
              {!isMe && (
                <Panel plain title={t('team.person.access')}>
                  <Switch checked={isActive} onChange={(v) => void changeActive(v)} label={t('team.person.canSignIn')} hint={t('team.person.canSignInHint')} data-testid="person-active" />
                </Panel>
              )}
              {!isMe && (
                <Panel plain title={t('team.person.actions')}>
                  <div class="stack">
                    <ActionRow sub={t('team.person.passwordSub')}>
                      <Button block icon={<KeyRound size={18} />} onClick={() => setPwOpen(true)} data-testid="person-password">{t('team.person.password')}</Button>
                    </ActionRow>
                    {!s.roles.includes('owner') && (
                      <ActionRow sub={t('team.person.previewSub')}>
                        <Button block icon={<Eye size={18} />} onClick={preview} data-testid="person-preview">{t('team.person.preview', { name })}</Button>
                      </ActionRow>
                    )}
                    <ActionRow sub={t('team.person.removeSub')}>
                      <Button block variant="danger" icon={<UserMinus size={18} />} confirm={t('team.person.removeConfirm')} onClick={remove} data-testid="person-remove">{t('team.person.remove')}</Button>
                    </ActionRow>
                  </div>
                </Panel>
              )}
            </div>
          </div>
        </div>
      </Sheet>
      <PasswordSheet open={pwOpen} id={s.id} name={name} email={s.email} phone={s.phone} onClose={() => setPwOpen(false)} onLink={p.onLink} />
    </>
  );
}

function ActionRow(p: { sub: string; children: ComponentChildren }) {
  return (
    <div class="team-action">
      {p.children}
      <p class="small muted">{p.sub}</p>
    </div>
  );
}

function InfosPanel(p: { id: string; full_name: string; short_name: string | null; phone: string | null; email: string | null; enqueue: <T>(fn: () => Promise<T>) => Promise<T> }) {
  const saved = { full_name: p.full_name || '', short_name: p.short_name || '', phone: p.phone || '' };
  const [d, setD] = useState(saved);
  const [err, setErr] = useState<string | null>(null);
  // the stored values changed (saved here or elsewhere): start again from them
  useEffect(() => { setD(saved); }, [p.full_name, p.short_name, p.phone]);
  const dirty = d.full_name.trim() !== saved.full_name || d.short_name.trim() !== saved.short_name || d.phone.trim() !== saved.phone;
  const save = async () => {
    if (!d.full_name.trim()) { setErr(t('team.person.needName')); return; }
    setErr(null);
    await p.enqueue(() => run(() => memberUpdate(p.id, { full_name: d.full_name.trim(), short_name: d.short_name.trim(), phone: d.phone.trim() }), { ok: t('team.person.infosSaved') }));
  };
  return (
    <Panel plain title={t('team.person.infos')}>
      <div class="stack">
        <Field label={t('team.person.name')} error={err}><Input value={d.full_name} onValue={(v) => setD({ ...d, full_name: v })} autoComplete="off" invalid={!!err} /></Field>
        <div class="grid-2">
          <Field label={t('team.person.short')} optional><Input value={d.short_name} onValue={(v) => setD({ ...d, short_name: v })} autoComplete="off" maxLength={40} /></Field>
          <Field label={t('team.person.phone')} optional><PhoneInput value={d.phone} onValue={(v) => setD({ ...d, phone: v })} /></Field>
        </div>
        {p.email && <p class="small muted" style={{ margin: 0 }}>{t('team.person.emailLine', { email: p.email })}</p>}
        <div><Button variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} onClick={save} data-testid="person-save">{t('team.person.saveInfos')}</Button></div>
      </div>
    </Panel>
  );
}

/* « Nouveau mot de passe »: a link for the person, sent by e-mail or text, or copied */
function PasswordSheet(p: { open: boolean; id: string; name: string; email: string | null; phone: string | null; onClose: () => void; onLink: (r: LinkResult) => void }) {
  const [how, setHow] = useState<SendHow>('email');
  useEffect(() => { if (p.open) setHow(p.email ? 'email' : p.phone ? 'sms' : 'none'); }, [p.open]);
  const send = async () => {
    try {
      const r = await teamDo<LinkAnswer>('reset-link', { staff_id: p.id, send: how });
      if (r.sent === 'sent') { toast(t('team.person.passwordSent', { name: p.name }), { kind: 'ok' }); p.onClose(); return; }
      p.onClose();
      p.onLink({ ...r, link: String(r.link || ''), sent: String(r.sent || 'none'), name: p.name, email: p.email, phone: p.phone, reset: true });
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
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
