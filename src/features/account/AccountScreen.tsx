/* Mon compte (#/account): my name and phone, the app's language, my look (the team's, or my own with live swatches),
   installing the app, signing out (warns about changes not sent yet), deleting my account. */
import { useEffect, useState } from 'preact/hooks';
import { LogOut, Smartphone, Trash2 } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { t, lang, setLang, type Lang } from '../../lib/i18n';
import { APP_VERSION } from '../../lib/config';
import { access, me, preview, signOut, refreshAccess, isOwner } from '../../data/auth';
import { updateMe, memberUpdate, errorMessage } from '../../data/api';
import { pendingCount } from '../../data/sync';
import { trucks } from '../../data/select';
import { myLook, teamLook, setMyLook, type Look } from '../../app/theme';
import { Page, Panel, Rows, RowItem, Field, Input, PhoneInput, Seg, Button, Banner, Avatar, ask, run, toast } from '../../ui';
import { ThemeSwatches, LookChoices } from '../settings/LookSection';
import { rolesWords, teamDo } from '../team/teamApi';
import '../settings/settings.css';
import './account.css';

export default function AccountScreen(_p: ScreenProps) {
  const a = me.value;
  const pv = preview.value;
  const [warn, setWarn] = useState(0);
  if (!a) return <Page title={t('account.title')} />;
  const drives = trucks.value.filter((tr) => tr.driver_id === a.id).map((tr) => tr.name).join(', ');

  const out = async () => {
    if (!warn) {
      const n = await pendingCount();
      if (n > 0) { setWarn(n); return; }
    }
    await signOut(true);
  };
  const leave = async () => {
    const ok = await ask({ title: t('account.leaveAsk.title'), text: t('account.leaveAsk.text'), ok: t('account.leaveAsk.ok'), danger: true });
    if (!ok) return;
    try {
      await teamDo('leave');
      toast(t('account.left'), { kind: 'ok' });
      await signOut(true);
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
                onValue={(l) => { setLang(l as Lang); if (!pv) void updateMe({ lang: l }).then(() => refreshAccess()); toast(t('account.langSaved'), { kind: 'ok' }); }}
                options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} />
              <p class="small muted" style={{ margin: 0 }}>{t('account.langHint')}</p>
            </div>
          </Panel>
        </div>
        <div class="stack-lg">
          {!pv && <LookPanel />}
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
          <p class="small faint" style={{ margin: 0 }}>{t('account.version', { v: APP_VERSION })}</p>
        </div>
      </div>
    </Page>
  );
}

/* my name (the owner changes it; others ask the owner) and my phone */
function InfosPanel() {
  const a = access.value!;
  const owner = isOwner();
  const saved = { full_name: a.full_name || '', short_name: a.short_name || '', phone: a.phone || '' };
  const [d, setD] = useState(saved);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD(saved); }, [a.full_name, a.short_name, a.phone]);
  const dirty = d.phone.trim() !== saved.phone || (owner && (d.full_name.trim() !== saved.full_name || d.short_name.trim() !== saved.short_name));
  const save = async () => {
    if (owner && !d.full_name.trim()) { setErr(t('account.needName')); return; }
    setErr(null);
    await run(async () => {
      if (owner && (d.full_name.trim() !== saved.full_name || d.short_name.trim() !== saved.short_name)) {
        await memberUpdate(a.id, { full_name: d.full_name.trim(), short_name: d.short_name.trim() });
      }
      if (d.phone.trim() !== saved.phone) { await updateMe({ phone: d.phone.trim() }); await refreshAccess(); }
    }, { ok: t('account.saved') });
  };
  return (
    <Panel title={t('account.infos')}>
      <div class="stack">
        {owner ? (
          <div class="grid-2">
            <Field label={t('account.name')} error={err}><Input value={d.full_name} onValue={(v) => setD({ ...d, full_name: v })} autoComplete="name" invalid={!!err} /></Field>
            <Field label={t('account.short')} hint={t('account.shortHint')} optional><Input value={d.short_name} onValue={(v) => setD({ ...d, short_name: v })} autoComplete="nickname" maxLength={40} /></Field>
          </div>
        ) : (
          <p class="small muted" style={{ margin: 0 }}>{t('account.nameByOwner')}</p>
        )}
        <Field label={t('account.phone')} hint={t('account.phoneHint')} optional>
          <PhoneInput value={d.phone} onValue={(v) => setD({ ...d, phone: v })} />
        </Field>
        {a.email && <p class="small muted" style={{ margin: 0 }}>{t('account.emailLine', { email: a.email })}</p>}
        <div><Button variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} onClick={save} data-testid="account-save">{t('account.save')}</Button></div>
      </div>
    </Panel>
  );
}

/* my look: the team's, or my own (each tap applies at once) */
function LookPanel() {
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
            <ThemeSwatches value={shown.theme} onValue={(k) => void setMyLook({ theme: k })} label={t('account.look')} />
            <LookChoices look={shown} onLook={(l) => void setMyLook(l)} />
          </>
        )}
      </div>
    </Panel>
  );
}
