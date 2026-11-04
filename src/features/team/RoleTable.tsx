/* « Ce que chaque rôle peut faire »: Bureau, Mécanicien, Trésorier × the rights, with a switch where the owner decides.
   Computer: one table. Phone: one role at a time. The owner always has everything. */
import { useState } from 'preact/hooks';
import { Check } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { RIGHTS, type Right } from '../../data/types';
import { settings } from '../../data/select';
import { setRoleRight } from '../../data/api';
import { wide } from '../../app/media';
import { Panel, Tabs, run } from '../../ui';
import { TEAM_ROLES, ruleOf, roleGives, type TeamRole, type RoleRights } from './rights';

export function RoleTable() {
  const rr = (settings.value.role_rights || {}) as RoleRights;
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<TeamRole>('office');
  const valueOf = (role: TeamRole, right: Right) => pending[`${role}.${right}`] ?? roleGives(role, right, rr);
  const toggle = async (role: TeamRole, right: Right) => {
    const key = `${role}.${right}`;
    const on = !valueOf(role, right);
    setPending((x) => ({ ...x, [key]: on }));
    await run(() => setRoleRight(role, right, on), { ok: t('team.table.saved') });
    setPending((x) => { const y = { ...x }; delete y[key]; return y; });
  };
  const cell = (role: TeamRole, right: Right) => {
    const rule = ruleOf(role, right);
    if (rule === 'always') return <span class="team-cell-fixed is-on"><Check size={16} aria-hidden="true" />{t('team.table.always')}</span>;
    if (rule === 'never') return <span class="team-cell-fixed">{t('team.table.never')}</span>;
    const on = valueOf(role, right);
    return (
      <button type="button" role="switch" class="switch" aria-checked={on} data-testid={`role-${role}-${right}`}
        aria-label={t('team.table.switchLabel', { right: t(`team.rights.${right}.title`), role: t(`team.roles.${role}`) })} onClick={() => void toggle(role, right)} />
    );
  };
  return (
    <Panel title={t('team.table.title')} help={t('team.table.help')} sub={t('team.table.owner')} flush class="team-table-panel" data-testid="role-table">
      {wide.value ? (
        <div class="team-table-wrap">
          <table class="team-table">
            <thead>
              <tr>
                <th scope="col" class="team-th-right">{t('team.table.right')}</th>
                {TEAM_ROLES.map((r) => <th key={r} scope="col">{t(`team.roles.${r}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {RIGHTS.map((right) => (
                <tr key={right}>
                  <th scope="row" class="team-th-right">
                    <span class="team-th-in">
                      <b>{t(`team.rights.${right}.title`)}</b>
                      <span class="small muted">{t(`team.rights.${right}.text`)}</span>
                    </span>
                  </th>
                  {TEAM_ROLES.map((role) => <td key={role}>{cell(role, right)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div class="team-table-phone">
          <div class="team-table-tabs">
            <Tabs value={tab} onValue={setTab} label={t('team.table.title')} tabs={TEAM_ROLES.map((r) => ({ value: r, label: t(`team.roles.${r}`) }))} />
          </div>
          <div class="rows" role="list">
            {RIGHTS.map((right) => (
              <div key={right} class="row-item team-role-row" role="listitem">
                <span class="row-main">
                  <span class="row-title">{t(`team.rights.${right}.title`)}</span>
                  <span class="team-wrap small muted">{t(`team.rights.${right}.text`)}</span>
                </span>
                <span class="row-end">{cell(tab, right)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
