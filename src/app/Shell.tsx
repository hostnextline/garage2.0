/* The frame of the team app.
   Phone: a glass bar on top (logo, sync state), the screen, a glass bar at the bottom (Aujourd'hui, Agenda, +, …, Plus).
   Computer (≥ 960 px): a glass menu on the left with « Réserver » on top; the screen takes the rest. */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { type LucideIcon, Plus, Menu, CalendarPlus, CloudOff, RefreshCw, Check, ChevronRight, Eye } from 'lucide-preact';
import { route, matchPath, navigate } from './router';
import { ROUTES, may, type RouteDef, type ScreenProps, type NavKey } from './routes';
import { NAV, QUICK, navLabel, tabItems } from './nav';
import { wide } from './media';
import { t, lang } from '../lib/i18n';
import { stamp } from '../lib/dates';
import { net, flush, pullAll, dismissFailed, outboxList } from '../data/sync';
import type { OutboxEntry } from '../data/local';
import { me, preview, viewAs, stopPreview } from '../data/auth';
import { garageName } from '../data/select';
import { startPositionSharing } from '../features/today/position';
import { Button, IconButton, Sheet, Banner, Avatar, Rows, RowItem, Empty, Skeleton } from '../ui';
import { MovedBanner } from './moved';
import { CoffreHost } from '../features/coffre/host';
import { startLocator } from './locator';
import { ContextMenuHost } from '../features/agenda/ContextMenu';
import { HermesHost } from '../features/hermes/host';
import { CallHost } from '../features/booking/CallBanner';

/* ---------- the screen for the current address ---------- */
const loaded = new Map<string, ComponentType<ScreenProps>>();
function findRoute(path: string): { def: RouteDef; params: Record<string, string> } | null {
  for (const def of ROUTES) { const params = matchPath(def.pattern, path); if (params) return { def, params }; }
  return null;
}
function ScreenHost() {
  const r = route.value;
  const found = findRoute(r.path);
  const [, force] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const key = found?.def.pattern || '';
  const Comp = loaded.get(key);
  useEffect(() => {
    if (!found || Comp) return;
    let alive = true;
    setFailed(null);
    found.def.load().then((m) => { loaded.set(key, m.default); if (alive) force((n) => n + 1); }, () => { if (alive) setFailed(key); });
    return () => { alive = false; };
  }, [key]);
  if (!found) {
    return <div class="page"><Empty title={t('shell.notFound')} action={<Button variant="primary" href="#/">{t('shell.home')}</Button>} /></div>;
  }
  if (found.def.allow && !found.def.allow()) {
    return <div class="page"><Empty title={t('shell.noRight')} text={t('common.notAllowed')} action={<Button variant="primary" href="#/">{t('shell.home')}</Button>} /></div>;
  }
  if (failed === key) {
    return <div class="page"><Banner kind="warn" title={t('shell.loadFail')} action={<Button onClick={() => location.reload()}>{t('shell.reload')}</Button>} /></div>;
  }
  if (!Comp) return <div class="page" aria-busy="true"><Skeleton h={34} w="50%" /><Skeleton h={18} lines={4} /></div>;
  return <Comp key={r.path} params={found.params} query={r.query} />;
}
export function currentNav(): NavKey | undefined { return findRoute(route.value.path)?.def.nav; }

/* ---------- sync state ---------- */
const syncOpen = signal(false);
export function openSync() { syncOpen.value = true; }
/** shows only when there is something to say (no signal, changes waiting or refused): nothing when all is sent */
function SyncChip(p: { compact?: boolean }) {
  const n = net.value;
  const state = !n.online ? 'offline' : n.pending > 0 ? (n.sending ? 'sending' : 'pending') : 'synced';
  if (state === 'synced' && !n.failed.length) return null;
  const label = state === 'offline' ? t('shell.sync.offline') : state === 'pending' ? t('shell.sync.pending', { n: n.pending }) : state === 'sending' ? t('shell.sync.sending') : t('shell.sync.synced');
  return (
    <button type="button" class={`syncchip syncchip-${state}${n.failed.length ? ' has-failed' : ''}`} onClick={openSync} data-tour="sync-state" data-testid="sync-chip"
      aria-label={`${t('shell.sync.title')} : ${label}${!n.online && n.pending ? ` (${t('shell.sync.pending', { n: n.pending })})` : ''}`}>
      {state === 'offline' ? <CloudOff size={16} /> : state === 'synced' ? <Check size={16} /> : <RefreshCw size={16} class={state === 'sending' ? 'spin-slow' : ''} />}
      {!p.compact || state !== 'synced' ? <span>{label}{!n.online && n.pending ? ` (${n.pending})` : ''}</span> : null}
    </button>
  );
}
function SyncSheet() {
  const n = net.value;
  const [list, setList] = useState<OutboxEntry[]>([]);
  const refresh = () => { void outboxList().then(setList); };
  useEffect(() => { if (syncOpen.value) refresh(); }, [syncOpen.value, n.pending, n.failed.length]);
  const pending = list.filter((e) => e.state === 'pending');
  const failed = list.filter((e) => e.state === 'failed');
  return (
    <Sheet open={syncOpen.value} onClose={() => (syncOpen.value = false)} title={t('shell.sync.title')} data-testid="sync-sheet"
      footer={<Button variant="primary" block icon={<RefreshCw size={18} />} onClick={async () => { await flush(); await pullAll(); refresh(); }}>{t('shell.sync.sendNow')}</Button>}>
      <div class="stack">
        {!n.online && <Banner kind="warn">{t('shell.sync.offlineLead')}</Banner>}
        {n.storageBroken && <Banner kind="bad">{t('shell.sync.storage')}</Banner>}
        <p class="muted small" style={{ margin: 0 }}>
          {n.realtime ? t('shell.sync.live') : t('shell.sync.notLive')}
          {n.lastPull ? ` — ${t('shell.sync.lastPull', { when: stamp(n.lastPull, lang.value) })}` : ''}
        </p>
        {failed.length > 0 && (
          <>
            <h3>{t('shell.failed.title', { n: failed.length })}</h3>
            <p class="muted small" style={{ margin: 0 }}>{t('shell.failed.lead')}</p>
            <Rows>
              {failed.map((e) => (
                <RowItem key={e.seq} title={e.label || t('log.change')} sub={e.error}
                  end={<span class="row">
                    <Button size="sm" onClick={async () => { await dismissFailed(e.seq!, true); refresh(); }}>{t('shell.failed.retry')}</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await dismissFailed(e.seq!); refresh(); }}>{t('shell.failed.dismiss')}</Button>
                  </span>} />
              ))}
            </Rows>
          </>
        )}
        {pending.length > 0 && (
          <>
            <h3>{t('shell.sync.pending', { n: pending.length })}</h3>
            <p class="muted small" style={{ margin: 0 }}>{t('shell.sync.pendingLead')}</p>
            <Rows>{pending.map((e) => <RowItem key={e.seq} title={e.label || t('log.change')} sub={stamp(e.at, lang.value)} />)}</Rows>
          </>
        )}
        {!pending.length && !failed.length && n.online && <Banner kind="ok">{t('shell.sync.synced')}</Banner>}
      </div>
    </Sheet>
  );
}

/* ---------- « + » ---------- */
const quickOpen = signal(false);
export function openQuick() { quickOpen.value = true; }
function QuickSheet() {
  const items = QUICK.filter((q) => q.show());
  return (
    <Sheet open={quickOpen.value} onClose={() => (quickOpen.value = false)} title={t('shell.quick.title')} data-testid="quick-sheet">
      <Rows>
        {items.map((q) => {
          const Icon = q.icon;
          return (
            <RowItem key={q.key} start={<span class="quick-icon"><Icon size={22} /></span>} title={t(`shell.quick.${q.key}`)} sub={t(`shell.quick.${q.key}Sub`)} chevron
              data-testid={`quick-${q.key}`} onClick={() => { quickOpen.value = false; navigate(q.href.slice(1)); }} />
          );
        })}
      </Rows>
    </Sheet>
  );
}

/* ---------- banners above every screen ---------- */
function ShellBanners() {
  const n = net.value;
  return (
    <div class="shell-banners">
      <MovedBanner />
      {preview.value && (
        <Banner kind="warn" title={t('shell.preview.banner', { name: viewAs.value?.short_name || viewAs.value?.full_name || '' })}
          action={<Button size="sm" variant="primary" icon={<Eye size={16} />} onClick={() => { stopPreview(); navigate('/team'); }}>{t('shell.preview.stop')}</Button>} data-testid="preview-banner" />
      )}
      {n.failed.length > 0 && (
        <Banner kind="bad" title={t('shell.failed.title', { n: n.failed.length })} action={<Button size="sm" onClick={openSync}>{t('shell.failed.show')}</Button>} data-testid="failed-banner">
          <span class="small">{n.failed[0].label ? `${n.failed[0].label} : ` : ''}{n.failed[0].error}</span>
        </Banner>
      )}
    </div>
  );
}

/* ---------- the frame ---------- */
function Logo() {
  return (
    <a href="#/" class="brand" aria-label={garageName.value}>
      <img src="./logo-his.png" alt="" width="40" height="40" />
      <span class="brand-name">{garageName.value}</span>
    </a>
  );
}
function Sidebar() {
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
            : <Button variant="primary" class="grow" icon={<Plus size={20} />} onClick={openQuick}>{t('shell.quick.title')}</Button>}
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
function TopBar() {
  return (
    <header class="topbar glass glass-thin">
      <Logo />
      <span class="grow" />
      <SyncChip compact />
    </header>
  );
}
function TabBar() {
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

export function Shell() {
  // the mechanic's position is shared only between « Commencer ma journée » and the end of the day, app on screen
  useEffect(() => { startPositionSharing(); startLocator(); }, []);
  // internal links count as steps of the app's history (so « Retour » goes back to them)
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href^="#/"]') as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute('download')) return;
      e.preventDefault();
      navigate(a.getAttribute('href')!.slice(1));
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  const isWide = wide.value;
  return (
    <div class={`app${isWide ? ' app-wide' : ''}`} data-testid="app">
      <a class="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>{t('shell.skip')}</a>
      {isWide ? <Sidebar /> : <TopBar />}
      <main id="main" tabIndex={-1}>
        <ShellBanners />
        <ScreenHost />
      </main>
      {!isWide && <TabBar />}
      <QuickSheet />
      <SyncSheet />
      <CoffreHost />
      <ContextMenuHost />
      <HermesHost />
      <CallHost />
    </div>
  );
}
