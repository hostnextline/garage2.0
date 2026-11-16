/* What the person may do: per right, « toujours / jamais » when the roles decide, else 3 choices « Selon son rôle (oui/non)
   / Oui / Non ». An owner has everything. */
import { Check } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { RIGHTS, type Right, type Role } from '../../data/types';
import { Panel, Seg } from '../../ui';
import { fromRoles, choiceOf, activeOverrides, type Choice, type Overrides, type RoleRights } from '../../domain/team/rights';

export function RightsPanel(p: { name: string; roles: Role[]; rights: Overrides; roleRights: RoleRights; pending: Partial<Record<Right, Choice>>; onChoose: (r: Right, c: Choice) => void }) {
  const isOwner = p.roles.includes('owner');
  const own = activeOverrides(p.roles, p.rights, p.roleRights);
  return (
    <Panel plain title={t('team.person.rights', { name: p.name })} help={t('team.person.rightsHelp')} data-tour="team-rights" data-testid="person-rights"
      sub={!isOwner && own.length ? t('team.person.own', { n: own.length }) : undefined}>
      {isOwner ? <p class="muted" style={{ margin: 0 }}>{t('team.person.ownerAll')}</p> : (
        <div class="team-rights">
          {RIGHTS.map((r) => {
            const base = fromRoles(p.roles, r, p.roleRights);
            const c = p.pending[r] ?? choiceOf(p.rights, r);
            return (
              <div key={r} class="team-right" data-testid={`right-${r}`}>
                <div class="team-right-text">
                  <b>{t(`team.rights.${r}.title`)}</b>
                  <span class="small muted">{t(`team.rights.${r}.text`)}</span>
                </div>
                {base.kind === 'can'
                  ? <Seg label={t(`team.rights.${r}.title`)} value={c} onValue={(v) => p.onChoose(r, v)} class="team-choice"
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
  );
}
