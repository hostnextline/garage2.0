/* La fiche d'une personne (propriétaire): ses rôles, ce qu'elle peut faire (3 choix par droit), sa couleur, ses infos,
   son accès, un nouveau mot de passe, voir l'app comme elle, la retirer de l'équipe.
   Every change is sent at once, one after the other (two quick taps never overwrite each other). */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { KeyRound, Eye, UserMinus, Check } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { firstName } from '../../lib/text';
import type { Right, Role } from '../../data/types';
import { staff as staffOf, settings, trucks } from '../../data/select';
import { memberUpdate, saveTruck } from '../../data/api';
import { access, startPreview } from '../../data/auth';
import { refetch } from '../../data/sync';
import { navigate } from '../../platform/router';
import { Sheet, Panel, Button, Chips, Switch, Banner, Avatar, Pill, ask, attempt, run, toast } from '../../ui';
import { ALL_ROLES, withChoice, type Choice, type Overrides, type RoleRights } from '../../domain/team/rights';
import { rolesWords, teamDo, type LinkResult, type TeamList } from '../../domain/team/teamApi';
import { ago } from '../../shared/map/ago';
import { useQueue, useOptimistic } from './useQueue';
import { RightsPanel } from './RightsPanel';
import { InfosPanel } from './InfosPanel';
import { PasswordSheet } from './PasswordSheet';

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
  const enqueue = useQueue();
  const rolesSeq = useOptimistic(), colorSeq = useOptimistic(), activeSeq = useOptimistic();
  /** the roles the server took last from this sheet (null: none yet) */
  const accepted = useRef<Role[] | null>(null);
  // the person left the team (removed here or elsewhere): the sheet closes
  useEffect(() => { if (!s) p.onClose(); }, [!!s]);
  if (!s) return null;

  const isMe = s.id === access.value?.id;
  const shownRoles = roles ?? s.roles;
  const rr = (settings.value.role_rights || {}) as RoleRights;
  const name = s.short_name || firstName(s.full_name) || s.full_name;
  const drives = trucks.value.filter((tr) => tr.driver_id === s.id);
  const seenAt = s.last_seen_at || p.signIns?.[s.id]?.last_sign_in_at || null;
  const isActive = active ?? s.active;

  const chooseRight = (right: Right, c: Choice) => {
    setPending((x) => ({ ...x, [right]: c }));
    void enqueue(async () => {
      // the person's choices as stored now, with every choice still on its way
      let next: Overrides = { ...(staffOf(p.id)?.rights || {}) };
      for (const [k, v] of Object.entries(pendingRef.current)) next = withChoice(next, k as Right, v as Choice);
      next = withChoice(next, right, c);
      await run(() => memberUpdate(p.id, { rights: next }), { ok: t('team.person.rightSaved') });
      setPending((x) => { const y = { ...x }; if (y[right] === c) delete y[right]; return y; });
    });
  };
  const changeRoles = async (next: Role[]) => {
    if (!next.length) { toast(t('team.person.lastRole'), { kind: 'bad' }); return; }
    // the owner role gives everything (money, Coffre, team, keys): never from one mis-tap (settings-team-12)
    if (!shownRoles.includes('owner') && next.includes('owner')
      && !(await ask({ title: t('team.person.giveOwner.title', { name }), text: t('team.person.giveOwner.text'), ok: t('team.person.giveOwner.ok'), danger: true }))) return;
    if (isMe && s.roles.includes('owner') && !next.includes('owner')
      && !(await ask({ title: t('team.person.dropOwner.title'), text: t('team.person.dropOwner.text'), ok: t('team.person.dropOwner.ok'), danger: true }))) return;
    const latest = rolesSeq.start();
    setRoles(next);
    await enqueue(() => run(async () => { const r = await memberUpdate(p.id, { roles: next }); accepted.current = next; return r; }, { ok: t('team.person.rolesSaved') }));
    // no longer a mechanic: the truck he drove is free again (the server's member_update does not free it yet, R174;
    // once it does, this finds no truck left to free) (settings-team-26). Only after the LAST role change, and from the
    // roles the server took last: « Mécanicien » taken off then put back before the server answered keeps his truck
    // (settings-team-r2-1). In the queue, so a change tapped meanwhile waits for it.
    await enqueue(async () => {
      const held = accepted.current;
      if (!latest() || !held || held.includes('mechanic')) return;
      for (const tr of trucks.value.filter((x) => x.driver_id === p.id)) await run(() => saveTruck({ id: tr.id, driver_id: null }), { quiet: true });
    });
    if (latest()) setRoles(null);
  };
  const changeColor = async (hex: string) => {
    const latest = colorSeq.start();
    setColor(hex);
    await enqueue(() => run(() => memberUpdate(p.id, { color: hex }), { ok: t('team.person.colorSaved') }));
    if (latest()) setColor(null);
  };
  const changeActive = async (v: boolean) => {
    if (!v && !(await ask({ title: t('team.person.block.title', { name }), text: t('team.person.block.text'), ok: t('team.person.block.ok'), danger: true }))) return;
    const latest = activeSeq.start();
    setActive(v);
    await enqueue(() => run(() => memberUpdate(p.id, { active: v }), { ok: v ? t('team.person.unblocked') : t('team.person.blocked') }));
    if (latest()) setActive(null);
  };
  const preview = async () => {
    const ok = await startPreview(p.id).catch(() => false);
    if (!ok) { toast(t('team.person.previewFail'), { kind: 'bad' }); return; }
    p.onClose();
    navigate('/');
  };
  const remove = async () => {
    if (!(await attempt(() => teamDo('remove', { staff_id: p.id }), { ok: t('team.person.removed', { name }) }))) return;
    await refetch('staff', p.id);
    p.onClose();
  };

  return (
    <>
      <Sheet open onClose={p.onClose} wide title={s.full_name} sub={s.email || undefined} data-testid="person-sheet">
        <div class="stack-lg">
          <div class="team-head">
            <Avatar name={s.full_name} color={color ?? s.color} />
            <div class="grow">
              <p class="team-head-roles">{drives.length ? t('team.drives', { roles: rolesWords(shownRoles), truck: drives.map((d) => d.name).join(', ') }) : rolesWords(shownRoles)}</p>
              <p class="small muted" style={{ margin: 0 }}>{seenAt ? t('team.seen', { ago: ago(seenAt) }) : t('team.neverSeen')}</p>
            </div>
            {!isActive ? <Pill tone="bad">{t('team.state.blocked')}</Pill> : <Pill tone="ok">{t('team.state.active')}</Pill>}
          </div>
          {isMe && <Banner kind="info" action={<Button size="sm" href="#/account">{t('team.person.selfLink')}</Button>}>{t('team.person.self')}</Banner>}
          <div class="team-sheet-grid">
            <div class="stack-lg">
              <Panel plain title={t('team.person.roles')} help={t('team.rolesHelp')}>
                <Chips multiple value={shownRoles} onValue={(v) => void changeRoles(v as Role[])} label={t('team.person.roles')} data-testid="person-roles"
                  options={ALL_ROLES.map((r) => ({ value: r, label: t(`team.roles.${r}`) }))} />
              </Panel>
              <RightsPanel name={name} roles={shownRoles} rights={s.rights} roleRights={rr} pending={pending} onChoose={chooseRight} />
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
