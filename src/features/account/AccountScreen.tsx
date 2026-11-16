/* Mon compte (#/account): my name and phone, the app's language, my look (the team's, or my own with live swatches),
   installing the app, signing out (warns about changes not sent yet), deleting my account. Each panel has its own file. */
import { LogOut, Smartphone, Trash2 } from 'lucide-preact';
import type { ScreenProps } from '../../platform/router';
import { t, lang, setLang, type Lang } from '../../lib/i18n';
import { me, preview, refreshAccess } from '../../data/auth';
import { updateMe, errorMessage } from '../../data/api';
import { trucks } from '../../data/select';
import { Page, Panel, Rows, RowItem, Seg, Button, Banner, Avatar, ask, attempt, toast } from '../../ui';
import { UpdatePanel } from '../../shared/app/UpdatePanel';
import { useSignOut, signOutNow } from '../../shared/app/signOut';
import { rolesWords, teamDo } from '../../domain/team/teamApi';
import { InfosPanel } from './InfosPanel';
import { LookPanel } from './LookPanel';
import { BackdropPanel } from './BackdropPanel';
import '../../shared/look/settings.css';
import './account.css';

export default function AccountScreen(_p: ScreenProps) {
  const a = me.value;
  const pv = preview.value;
  // the one sign-out of the app (« Plus » has the same): this device's push address leaves first (R104)
  const { warn, out } = useSignOut();
  if (!a) return <Page title={t('account.title')} />;
  const drives = trucks.value.filter((tr) => tr.driver_id === a.id).map((tr) => tr.name).join(', ');

  const leave = async () => {
    const ok = await ask({ title: t('account.leaveAsk.title'), text: t('account.leaveAsk.text'), ok: t('account.leaveAsk.ok'), danger: true });
    if (!ok) return;
    try {
      await teamDo('leave');
      toast(t('account.left'), { kind: 'ok' });
      await signOutNow();
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };

  return (
    <Page title={t('account.title')} sub={a.email || undefined} help={t('account.help')} data-testid="account-screen">
      {pv && <Banner kind="warn">{t('account.preview', { name: a.short_name || a.full_name })}</Banner>}
      <div class="account-grid">
        <div class="stack-lg">
          <Panel class="account-me">
            <div class="row">
              <Avatar name={a.full_name} color={a.color} />
              <div class="grow">
                <h2 class="account-name">{a.full_name}</h2>
                <p class="small muted" style={{ margin: 0 }}>{drives ? t('team.drives', { roles: rolesWords(a.roles), truck: drives }) : rolesWords(a.roles)}</p>
              </div>
            </div>
          </Panel>
          {!pv && <InfosPanel />}
          <Panel title={t('account.lang')}>
            <div class="stack">
              <Seg value={lang.value} label={t('account.lang')} data-testid="account-lang"
                onValue={(l) => { setLang(l as Lang); if (!pv) void attempt(async () => { await updateMe({ lang: l }); await refreshAccess(); }, { quiet: true }); toast(t('account.langSaved'), { kind: 'ok' }); }}
                options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} />
              <p class="small muted" style={{ margin: 0 }}>{t('account.langHint')}</p>
            </div>
          </Panel>
        </div>
        <div class="stack-lg">
          {!pv && <LookPanel />}
          {!pv && <BackdropPanel />}
          <UpdatePanel data-testid="account-update" />
          <Panel flush>
            <Rows>
              <RowItem href="#/guide" start={<span class="quick-icon" aria-hidden="true"><Smartphone size={20} /></span>} title={t('account.install')} sub={t('account.installSub')} chevron data-testid="account-install" />
            </Rows>
          </Panel>
          <div class="stack">
            {warn > 0 && <Banner kind="warn">{t('auth.signOutPending', { n: warn })}</Banner>}
            <Button variant={warn ? 'danger' : 'secondary'} block icon={<LogOut size={18} />} onClick={out} data-testid="account-signout">{warn ? t('auth.signOutAnyway') : t('auth.signOut')}</Button>
          </div>
          {!pv && (
            <Panel plain class="account-leave">
              <div class="stack">
                <p class="small muted" style={{ margin: 0 }}>{t('account.leaveSub')}</p>
                <Button variant="danger" icon={<Trash2 size={18} />} confirm={t('account.leaveConfirm')} onClick={leave} data-testid="account-leave">{t('account.leave')}</Button>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </Page>
  );
}
