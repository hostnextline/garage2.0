/* The bars of the frame. Phone: a glass bar on top (logo, sync state) and a glass bar at the bottom (the person's
   first screens, « + », Plus). Computer (≥ 960 px): a glass menu on the left with « Réserver » on top. */
import { type LucideIcon, Plus, Menu, CalendarPlus, ChevronRight } from 'lucide-preact';
import { t } from '../lib/i18n';
import { me } from '../data/auth';
import { garageName } from '../data/select';
import { may } from '../domain/rights';
import { Button, IconButton, Avatar } from '../ui';
import { NAV, QUICK, navLabel, tabItems } from './nav';
import { currentNav, type NavKey } from './routes';
import { openQuick } from './QuickSheet';
import { SyncChip } from './sync';

function Logo() {
  return (
    <a href="#/" class="brand" aria-label={garageName.value}>
      <img src="./logo-his.png" alt="" width="40" height="40" />
      <span class="brand-name">{garageName.value}</span>
    </a>
  );
}

export function Sidebar() {
  const cur = currentNav();
  const groups: ('day' | 'office' | 'garage')[] = ['day', 'office', 'garage'];
  const a = me.value;
  const canAdd = QUICK.some((q) => q.show());
  return (
    <aside class="sidebar glass" aria-label={t('shell.menu')}>
      <Logo />
      {canAdd && (
        <div class="side-actions">
          {may.book()
            ? <Button variant="primary" class="grow" icon={<CalendarPlus size={20} />} href="#/book" data-tour="nav-book" data-testid="side-book">{t('shell.book')}</Button>
            // the guide's « + » step points here for someone who adds but does not book
            : <Button variant="primary" class="grow" icon={<Plus size={20} />} onClick={openQuick} data-tour="quick-add" data-testid="quick-add">{t('shell.quick.title')}</Button>}
          {may.book() && <IconButton class="side-plus" icon={<Plus />} label={t('shell.quick.title')} onClick={openQuick} data-tour="quick-add" data-testid="quick-add" />}
        </div>
      )}
      <nav class="side-nav">
        {groups.map((g) => {
          const items = NAV.filter((n) => n.group === g && n.show() && n.key !== 'account');
          if (!items.length) return null;
          return (
            <div class="side-group" key={g}>
              <span class="side-group-title">{t(`shell.groups.${g}`)}</span>
              {items.map((n) => {
                const Icon = n.icon;
                return <a key={n.key} href={n.href} class="side-link" aria-current={cur === n.key ? 'page' : undefined} data-tour={`nav-${n.key}`} data-testid={`nav-${n.key}`}><Icon size={20} /><span>{navLabel(n.key)}</span></a>;
              })}
            </div>
          );
        })}
      </nav>
      <div class="side-foot">
        <SyncChip />
        <a href="#/account" class="side-me" aria-current={cur === 'account' ? 'page' : undefined} data-testid="nav-account">
          <Avatar name={a?.full_name} color={a?.color} size="sm" />
          <span class="grow ellipsis">{a?.short_name || a?.full_name}</span>
          <ChevronRight size={16} class="faint" />
        </a>
      </div>
    </aside>
  );
}

export function TopBar() {
  return (
    <header class="topbar glass glass-thin">
      <Logo />
      <span class="grow" />
      <SyncChip />
    </header>
  );
}

export function TabBar() {
  const cur = currentNav();
  const tabs = tabItems();
  const canAdd = QUICK.some((q) => q.show());
  const tab = (key: NavKey, label: string, Icon: LucideIcon, href: string) => (
    <a key={key} href={href} class="tab" aria-current={cur === key ? 'page' : undefined} data-tour={`nav-${key}`} data-testid={`tab-${key}`}><Icon size={24} /><span>{label}</span></a>
  );
  const list = tabs.map((n) => tab(n.key, navLabel(n.key), n.icon, n.href));
  if (canAdd) list.splice(Math.min(2, list.length), 0, (
    <button key="add" type="button" class="tab tab-add" onClick={openQuick} aria-label={t('shell.quick.title')} data-tour="quick-add" data-testid="quick-add"><span class="tab-add-ring"><Plus size={28} /></span></button>
  ));
  list.push(tab('more', t('shell.nav.more'), Menu, '#/more'));
  return <nav class="tabbar glass-strong glass-thin" aria-label={t('shell.menu')}>{list}</nav>;
}
