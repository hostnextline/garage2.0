import { t } from '../../lib/i18n';
import { myLook, teamLook, setMyLook, type Look } from '../../services/theme';
import { Panel, Field, Seg } from '../../ui';
import { ThemeSwatches, LookChoices } from '../../shared/look/LookChoices';

/* my look: the team's, or my own (each tap applies at once) */
export function LookPanel() {
  const mine = myLook.value;
  const shown: Look = mine || teamLook.value;
  return (
    <Panel title={t('account.look')} help={t('account.lookHelp')} data-testid="account-look">
      <div class="stack">
        <Field label={t('account.followLabel')} hint={mine ? undefined : t('account.followHint')} group>
          <Seg value={mine ? 'mine' : 'team'} label={t('account.followLabel')} data-testid="account-follow"
            onValue={(v) => void setMyLook(v === 'mine' ? { ...teamLook.value } : null)}
            options={[{ value: 'team', label: t('account.follow.team') }, { value: 'mine', label: t('account.follow.mine') }]} />
        </Field>
        {mine && (
          <>
            <ThemeSwatches value={shown} onLook={(l) => void setMyLook(l)} label={t('account.look')} />
            <LookChoices look={shown} onLook={(l) => void setMyLook(l)} />
          </>
        )}
      </div>
    </Panel>
  );
}

