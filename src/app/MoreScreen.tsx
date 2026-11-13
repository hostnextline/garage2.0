/* « Plus » (phone): every part of the app as glass tiles, like the home screen of a phone. On top: me (my account), the
   help and the settings; today in four numbers; the filters (Tout, Journée, Bureau, Garage). At the bottom: the
   getting-started progress (while steps are left) and signing out. Each person sees only the parts they may open. */
import { useEffect, useState } from 'preact/hooks';
import { LogOut, CircleQuestionMark, Settings } from 'lucide-preact';
import { NAV, navLabel, type NavItem } from './nav';
import { may } from './routes';
import { t, lang } from '../lib/i18n';
import { today } from '../lib/dates';
import { money } from '../lib/money';
import { me, signOut } from '../data/auth';
import { pendingCount } from '../data/sync';
import { jobsOn, invoicesList, lowStock } from '../data/select';
import { Button, Avatar, Banner } from '../ui';
import { computeChecklist, nextStep, progress, mainRole, type Role } from '../features/guide/checklist';
import { guideInput, nextJobId, refreshChecks } from '../features/guide/guide-data';
import { TILE_HUE, filtersFor, tilesFor, dayCounts, dueCents, unpaidCount, ratio, type MoreFilter } from './more';
import { callCount } from '../features/oil/select';
import './more.css';

const FILTER_KEY = 'his.more.filter';
function savedFilter(): MoreFilter {
  try { const v = sessionStorage.getItem(FILTER_KEY); return v === 'day' || v === 'office' || v === 'garage' ? v : 'all'; } catch { return 'all'; }
}

/** the number on a tile: what waits (today's jobs to do, invoices to cash, parts to order) */
function badgeOf(key: string): { n: number; label: string } | null {
  if (key === 'today') {
    const c = dayCounts(jobsOn(today()));
    const n = c.booked + c.live;
    return n ? { n, label: t('shell.more.badges.today', { n }) } : null;
  }
  if (key === 'invoices') {
    const n = unpaidCount(invoicesList.value);
    return n ? { n, label: t('shell.more.badges.invoices', { n }) } : null;
  }
  if (key === 'inventory') {
    const n = lowStock.value.length;
    return n ? { n, label: t('shell.more.badges.inventory', { n }) } : null;
  }
  if (key === 'oil') {
    const n = callCount.value;
    return n ? { n, label: t('shell.more.badges.oil', { n }) } : null;
  }
  return null;
}

function Tile(p: { item: NavItem }) {
  const Icon = p.item.icon;
  const b = badgeOf(p.item.key);
  const name = navLabel(p.item.key);
  return (
    <a href={p.item.href} class="more-tile" style={{ '--hue': TILE_HUE[p.item.key] || 'var(--accent)' }} data-testid={`more-${p.item.key}`}
      aria-label={b ? `${name}, ${b.label}` : undefined}>
      <span class="more-tile-icon" aria-hidden="true"><Icon size={24} strokeWidth={1.75} /></span>
      <span class="more-tile-label">{name}</span>
      {b && <span class="more-tile-badge" aria-hidden="true">{b.n > 99 ? '99+' : b.n}</span>}
    </a>
  );
}

/** today in three numbers, and what customers still owe (only for who sees the invoices) */
function TodayStrip() {
  const c = dayCounts(jobsOn(today()));
  const due = may.invoices() ? dueCents(invoicesList.value) : null;
  const dayHref = may.agenda() ? '#/agenda' : '#/';
  const stat = (key: string, value: number, href: string, tone: string) => (
    <a key={key} href={href} class="more-stat" style={{ '--tone': tone }} data-testid={`more-stat-${key}`}>
      <b class="more-stat-n">{value}</b>
      <span class="more-stat-l">{t(`shell.more.${key}`)}</span>
    </a>
  );
  return (
    <section class="more-stats glass" aria-label={t('shell.more.today')} data-testid="more-stats">
      <div class="more-stats-head">
        <p class="more-stats-title">{t('shell.more.today')}</p>
        {due != null && (
          <a href="#/invoices" class="more-due" data-testid="more-stat-due">
            <span class="more-due-l">{t('shell.more.due')}</span>
            <b class="more-due-n">{money(due, lang.value, { whole: true })}</b>
          </a>
        )}
      </div>
      <div class="more-stats-row">
        {stat('booked', c.booked, dayHref, 'var(--st-booked)')}
        {stat('live', c.live, '#/', 'var(--st-site)')}
        {stat('done', c.done, dayHref, 'var(--st-done)')}
      </div>
    </section>
  );
}

/** « Démarrage » : the ring of the first steps, while some are left (« Par où commencer ») */
function SetupPill() {
  useEffect(() => { void refreshChecks(); }, []);
  const input = guideInput();
  if (!input) return null;
  const steps = computeChecklist(input, nextJobId());
  const nx = nextStep(steps);
  if (!nx) return null;
  const pr = progress(steps);
  const r = 15.5, len = 2 * Math.PI * r, part = ratio(pr.done, pr.total);
  return (
    <a href="#/guide" class="more-setup glass glass-thin" data-testid="more-setup">
      <svg class="more-ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle class="more-ring-track" cx="18" cy="18" r={r} />
        <circle class="more-ring-val" cx="18" cy="18" r={r} stroke-dasharray={`${(len * part).toFixed(2)} ${len.toFixed(2)}`} />
      </svg>
      <span class="more-setup-txt">
        <span class="more-setup-title">{t('shell.more.setup', pr)}</span>
        <span class="more-setup-next">{t('shell.more.setupNext', { step: t(`guide.steps.${nx.id}.title`) })}</span>
      </span>
    </a>
  );
}

export default function MoreScreen() {
  const a = me.value;
  const items = NAV.filter((n) => n.show() && n.key !== 'account');
  const filters = filtersFor(items);
  const [filter, setFilter] = useState<MoreFilter>(savedFilter);
  const shown = tilesFor(items, filters.includes(filter) ? filter : 'all');
  const pick = (f: MoreFilter) => { setFilter(f); try { sessionStorage.setItem(FILTER_KEY, f); } catch { /* private mode */ } };
  const role: Role = a ? mainRole({ roles: (a.roles || []) as Role[], owner: !!a.owner }) : 'office';
  const [warn, setWarn] = useState<number>(0);
  const out = async () => {
    if (!warn) {
      const n = await pendingCount();
      if (n > 0) { setWarn(n); return; }
    }
    await signOut(true);
  };
  return (
    <div class="page more" data-testid="more-screen">
      <h1 class="sr-only">{t('shell.nav.more')}</h1>
      <header class="more-me">
        <a href="#/account" class="more-me-link" data-testid="more-account">
          <span class="more-me-ring"><Avatar name={a?.full_name} color={a?.color} /></span>
          <span class="more-me-txt">
            <span class="more-me-name">{a?.full_name}</span>
            <span class="more-me-role">{t(`team.roles.${role}`)}</span>
          </span>
        </a>
        <a href="#/guide" class="more-round glass glass-thin" aria-label={t('shell.more.help')} data-testid="more-help"><CircleQuestionMark size={22} strokeWidth={1.75} /></a>
        {may.settings() && <a href="#/settings" class="more-round glass glass-thin" aria-label={t('shell.nav.settings')} data-testid="more-gear"><Settings size={22} strokeWidth={1.75} /></a>}
      </header>

      <TodayStrip />

      {filters.length > 0 && (
        <div class="more-filters" role="group" aria-label={t('shell.more.filters')} data-testid="more-filters">
          {filters.map((f) => (
            <button key={f} type="button" class="more-filter" aria-pressed={(filters.includes(filter) ? filter : 'all') === f} onClick={() => pick(f)} data-testid={`more-filter-${f}`}>
              {t(`shell.more.groups.${f}`)}
            </button>
          ))}
        </div>
      )}

      <nav class="more-grid" aria-label={t('shell.menu')} data-testid="more-grid">
        {shown.map((n) => <Tile key={n.key} item={n} />)}
      </nav>

      <SetupPill />

      {warn > 0 && <Banner kind="warn">{t('auth.signOutPending', { n: warn })}</Banner>}
      <Button variant={warn ? 'danger' : 'secondary'} block icon={<LogOut size={18} />} onClick={out} data-testid="sign-out">{warn ? t('auth.signOutAnyway') : t('auth.signOut')}</Button>
    </div>
  );
}
