/* Équipe (#/team, propriétaire): the people as rows (colour, name, roles, last seen, state), the pending invitations,
   « Inviter quelqu'un », the person's sheet (roles, rights, colour…), and what each role may do. */
import { useEffect, useState } from 'preact/hooks';
import { UserPlus } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { t } from '../../lib/i18n';
import { staffList, trucks, truck } from '../../data/select';
import { access } from '../../data/auth';
import { errorMessage } from '../../data/api';
import type { Staff } from '../../data/types';
import { Page, Panel, Button, Avatar, Pill, Banner, Empty, Skeleton, Rows } from '../../ui';
import { ago } from '../map/ago';
import { loadTeamList, loadRules, rolesWords, type Invitation, type LinkResult, type TeamList } from './teamApi';
import { InviteSheet, type InviteDraft } from './InviteSheet';
import { PersonSheet } from './PersonSheet';
import { InvitationSheet } from './InvitationSheet';
import { LinkSheet } from './LinkSheet';
import { RoleTable } from './RoleTable';
import './team.css';

export default function TeamScreen(_p: ScreenProps) {
  const people = staffList.value;
  const [list, setList] = useState<TeamList | null>(null);
  const [listState, setListState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [listError, setListError] = useState('');
  const [invite, setInvite] = useState<{ prefill: Partial<InviteDraft> | null; again: boolean } | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [inv, setInv] = useState<Invitation | null>(null);
  const [link, setLink] = useState<LinkResult | null>(null);

  const refresh = async () => {
    setListState((s) => (s === 'ok' ? 'ok' : 'loading'));
    try { setList(await loadTeamList()); setListState('ok'); }
    catch (e) { setListError(errorMessage(e)); setListState('error'); }
  };
  useEffect(() => { void refresh(); void loadRules(); }, []);

  const meId = access.value?.id;
  const order = (s: Staff) => (s.id === meId ? 0 : s.active ? 1 : 3);
  const sorted = people.slice().sort((a, b) => order(a) - order(b) || a.full_name.localeCompare(b.full_name, 'fr'));
  const invitations = (list?.invitations || []).filter((i) => i.kind === 'invite')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  return (
    <Page title={t('team.title')} sub={t('team.sub', { n: people.length })} help={t('team.help')} data-testid="team-screen"
      actions={<Button variant="primary" icon={<UserPlus size={18} />} onClick={() => setInvite({ prefill: null, again: false })} data-tour="team-invite" data-testid="team-invite">{t('team.invite')}</Button>}>
      <div class="team-layout">
        <div class="stack">
          <Panel flush title={t('team.people')} help={t('team.peopleHelp')} data-testid="team-people">
            <Rows>
              {sorted.map((s) => <PersonRow key={s.id} s={s} me={s.id === meId} seen={s.last_seen_at || list?.sign_ins?.[s.id]?.last_sign_in_at || null} onOpen={() => setPersonId(s.id)} />)}
              {invitations.map((i) => <InvitationRow key={i.id} inv={i} onOpen={() => setInv(i)} />)}
            </Rows>
            {listState === 'loading' && <div class="team-list-wait" aria-busy="true"><Skeleton h={18} lines={2} /></div>}
            {sorted.length <= 1 && !invitations.length && listState !== 'loading' && (
              <Empty title={t('team.empty.title')} text={t('team.empty.text')}
                action={<Button variant="primary" icon={<UserPlus size={18} />} onClick={() => setInvite({ prefill: null, again: false })}>{t('team.invite')}</Button>} />
            )}
          </Panel>
          {listState === 'error' && (
            <Banner kind="warn" title={t('team.listError')} action={<Button size="sm" onClick={() => void refresh()}>{t('common.retry')}</Button>}>{listError}</Banner>
          )}
        </div>
        <RoleTable />
      </div>

      <InviteSheet open={!!invite} prefill={invite?.prefill} again={invite?.again} onClose={() => setInvite(null)} onSent={() => void refresh()} onLink={setLink} />
      <PersonSheet id={personId} signIns={list?.sign_ins} onClose={() => setPersonId(null)} onLink={setLink} />
      <InvitationSheet inv={inv} onClose={() => setInv(null)} onCancelled={() => void refresh()}
        onAgain={(i) => { setInv(null); setInvite({ again: true, prefill: { full_name: i.full_name, email: i.email, roles: i.roles.length ? i.roles : ['mechanic'], truck_id: i.truck_id || '' } }); }} />
      <LinkSheet result={link} onClose={() => setLink(null)} />
    </Page>
  );
}

function PersonRow(p: { s: Staff; me: boolean; seen: string | null; onOpen: () => void }) {
  const s = p.s;
  const drives = trucks.value.filter((tr) => tr.driver_id === s.id).map((tr) => tr.name).join(', ');
  const words = rolesWords(s.roles);
  return (
    <button type="button" role="listitem" class={`row-item team-row${s.active ? '' : ' is-blocked'}`} onClick={p.onOpen} data-testid={`person-${s.id}`}>
      <Avatar name={s.full_name} color={s.color} />
      <span class="row-main">
        <span class="row-title">{p.me ? t('team.me', { name: s.full_name }) : s.full_name}</span>
        <span class="row-sub">{drives ? t('team.drives', { roles: words, truck: drives }) : words}</span>
      </span>
      <span class="row-end team-row-end">
        {s.active ? <Pill tone="ok">{t('team.state.active')}</Pill> : <Pill tone="bad">{t('team.state.blocked')}</Pill>}
        <span class="small faint">{p.seen ? t('team.seen', { ago: ago(p.seen) }) : t('team.neverSeen')}</span>
      </span>
    </button>
  );
}

function InvitationRow(p: { inv: Invitation; onOpen: () => void }) {
  const i = p.inv;
  const expired = Date.parse(i.expires_at) < Date.now();
  const words = rolesWords(i.roles);
  const tr = i.truck_id ? truck(i.truck_id) : undefined;
  return (
    <button type="button" role="listitem" class="row-item team-row is-invited" onClick={p.onOpen} data-testid={`invitation-${i.id}`}>
      <span class="team-av-invited"><Avatar name={i.full_name} /></span>
      <span class="row-main">
        <span class="row-title">{i.full_name}</span>
        <span class="row-sub">{tr ? t('team.willDrive', { roles: words, truck: tr.name }) : words}</span>
      </span>
      <span class="row-end team-row-end">
        {expired ? <Pill tone="warn">{t('team.state.expired')}</Pill> : <Pill tone="booked">{t('team.state.invited')}</Pill>}
        <span class="small faint">{ago(i.created_at)}</span>
      </span>
    </button>
  );
}
