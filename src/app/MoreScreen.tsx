/* « Plus » (phone): every part of the app that is not in the bottom bar, then my account and signing out. */
import { useState } from 'preact/hooks';
import { LogOut } from 'lucide-preact';
import { NAV, navLabel, tabItems } from './nav';
import { t } from '../lib/i18n';
import { me, signOut } from '../data/auth';
import { pendingCount } from '../data/sync';
import { Page, Panel, Rows, RowItem, Button, Avatar, Banner } from '../ui';

export default function MoreScreen() {
  const inBar = new Set(tabItems().map((n) => n.key));
  const items = NAV.filter((n) => n.show() && !inBar.has(n.key) && n.key !== 'account');
  const a = me.value;
  const [warn, setWarn] = useState<number>(0);
  const out = async () => {
    if (!warn) {
      const n = await pendingCount();
      if (n > 0) { setWarn(n); return; }
    }
    await signOut(true);
  };
  return (
    <Page title={t('shell.nav.more')}>
      <Panel flush>
        <Rows>
          <RowItem href="#/account" start={<Avatar name={a?.full_name} color={a?.color} />} title={a?.full_name} sub={t('shell.nav.account')} chevron data-testid="more-account" />
          {items.map((n) => {
            const Icon = n.icon;
            return <RowItem key={n.key} href={n.href} start={<span class="quick-icon"><Icon size={20} /></span>} title={navLabel(n.key)} chevron data-testid={`more-${n.key}`} />;
          })}
        </Rows>
      </Panel>
      {warn > 0 && <Banner kind="warn">{t('auth.signOutPending', { n: warn })}</Banner>}
      <Button variant={warn ? 'danger' : 'secondary'} block icon={<LogOut size={18} />} onClick={out} data-testid="sign-out">{warn ? t('auth.signOutAnyway') : t('auth.signOut')}</Button>
    </Page>
  );
}
