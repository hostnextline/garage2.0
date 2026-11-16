/* Every screen of the team app: its address, who may open it, and the code that draws it (loaded on first use,
   kept by the service worker for offline). A screen receives { params, query }. */
import type { ComponentType } from 'preact';
import { matchPath, route, type ScreenProps } from '../platform/router';
import { may } from '../domain/rights';

type Loader = () => Promise<{ default: ComponentType<ScreenProps> }>;
export interface RouteDef {
  pattern: string;
  load: Loader;
  /** who may open it (the server checks again; this only avoids a screen full of refusals) */
  allow?: () => boolean;
  /** the menu entry it belongs to (highlighted in the menu) */
  nav?: NavKey;
  /** 'path' (the default, every screen tonight): a fresh screen for each address; 'pattern': the same screen when only
      a parameter changes (for a screen that follows its parameters by itself) */
  key?: 'path' | 'pattern';
}
export type NavKey = 'today' | 'overview' | 'agenda' | 'customers' | 'oil' | 'invoices' | 'quotes' | 'map' | 'hours' | 'treasury' | 'inventory' | 'dashboard' | 'team' | 'settings' | 'guide' | 'info' | 'account' | 'more';

const ROUTES: RouteDef[] = [
  { pattern: '/', load: () => import('../features/today/TodayScreen'), nav: 'today' },
  { pattern: '/agenda/:day?', load: () => import('../features/agenda/AgendaScreen'), allow: may.agenda, nav: 'agenda' },
  { pattern: '/book', load: () => import('../features/booking/BookScreen'), allow: () => may.book() || may.walkIn(), nav: 'agenda' },
  { pattern: '/call', load: () => import('../features/booking/CallScreen'), allow: may.book, nav: 'agenda' },
  { pattern: '/hours/:truck?', load: () => import('../features/hours/HoursScreen'), allow: may.hours, nav: 'hours' },
  { pattern: '/customers', load: () => import('../features/customers/CustomersScreen'), allow: may.customers, nav: 'customers' },
  { pattern: '/customer/:id', load: () => import('../features/customers/CustomerScreen'), allow: may.customers, nav: 'customers' },
  { pattern: '/vehicle/:id', load: () => import('../features/customers/VehicleScreen'), allow: may.customers, nav: 'customers' },
  { pattern: '/oil', load: () => import('../features/oil/OilScreen'), allow: may.oil, nav: 'oil' },
  { pattern: '/job/:id', load: () => import('../features/jobs/JobScreen'), nav: 'today' },
  { pattern: '/invoices', load: () => import('../features/invoices/InvoicesScreen'), allow: may.invoices, nav: 'invoices' },
  { pattern: '/invoice/:id', load: () => import('../features/invoices/InvoiceScreen'), nav: 'invoices' },
  { pattern: '/quotes', load: () => import('../features/quotes/QuotesScreen'), allow: may.quotes, nav: 'quotes' },
  { pattern: '/quote/:id', load: () => import('../features/quotes/QuoteScreen'), allow: may.quotes, nav: 'quotes' },
  { pattern: '/overview', load: () => import('../features/overview/OverviewScreen'), allow: may.overview, nav: 'overview' },
  { pattern: '/map', load: () => import('../features/map/MapScreen'), allow: may.map, nav: 'map' },
  { pattern: '/team', load: () => import('../features/team/TeamScreen'), allow: may.team, nav: 'team' },
  { pattern: '/settings/:section?', load: () => import('../features/settings/SettingsScreen'), allow: may.settings, nav: 'settings' },
  { pattern: '/account', load: () => import('../features/account/AccountScreen'), nav: 'account' },
  { pattern: '/coffre', load: () => import('../features/coffre/CoffreScreen'), allow: may.coffre, nav: 'treasury' },
  { pattern: '/treasury', load: () => import('../features/treasury/TreasuryScreen'), allow: may.treasury, nav: 'treasury' },
  { pattern: '/inventory', load: () => import('../features/inventory/InventoryScreen'), allow: may.inventory, nav: 'inventory' },
  { pattern: '/needs', load: () => import('../features/inventory/NeedsScreen'), allow: may.inventory, nav: 'inventory' },
  { pattern: '/dashboard', load: () => import('../features/dashboard/DashboardScreen'), allow: may.dashboard, nav: 'dashboard' },
  { pattern: '/guide', load: () => import('../features/guide/GuideScreen'), nav: 'guide' },
  { pattern: '/info/:id?', load: () => import('../features/info/InfoScreen'), nav: 'info' },
  { pattern: '/more', load: () => import('./MoreScreen'), nav: 'more' }
];

/** the route of an address, with its parameters */
export function findRoute(path: string): { def: RouteDef; params: Record<string, string> } | null {
  for (const def of ROUTES) { const params = matchPath(def.pattern, path); if (params) return { def, params }; }
  return null;
}
/** the menu entry of the screen on show */
export function currentNav(): NavKey | undefined { return findRoute(route.value.path)?.def.nav; }

/* the code of each screen, downloaded once (kept here so a screen preloaded is not asked twice) */
type Screen = ComponentType<ScreenProps>;
const loaded = new Map<string, Screen>();
const loading = new Map<string, Promise<Screen>>();
export function loadedScreen(def: RouteDef): Screen | undefined { return loaded.get(def.pattern); }
export function loadScreen(def: RouteDef): Promise<Screen> {
  const got = loaded.get(def.pattern);
  if (got) return Promise.resolve(got);
  let p = loading.get(def.pattern);
  if (!p) {
    p = def.load().then((m) => { loaded.set(def.pattern, m.default); return m.default; });
    // a failed download may be tried again (the next time, or the retry of the screen host)
    p.catch(() => undefined).finally(() => loading.delete(def.pattern));
    loading.set(def.pattern, p);
  }
  return p;
}
/** downloads a screen's code ahead of time (the first screen, at start, while the session is checked); never fails.
    Only code: the screen still checks the rights when it is opened. Not used for screens that are not about to be
    shown: a screen's code brings its stylesheet, and some stylesheets still style the same class differently
    (.inv-filters in invoices.css and stock/inventory.css), so loading one early changed another screen's look. */
export function preloadRoute(path: string): void {
  const found = findRoute(path);
  if (found) loadScreen(found.def).catch(() => undefined);
}
