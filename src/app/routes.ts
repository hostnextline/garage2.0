/* Every screen of the team app: its address, who may open it, and the code that draws it (loaded on first use,
   kept by the service worker for offline). A screen receives { params, query }. */
import type { ComponentType } from 'preact';
import type { ScreenProps } from '../platform/router';
import { may } from '../domain/rights';

type Loader = () => Promise<{ default: ComponentType<ScreenProps> }>;
export interface RouteDef {
  pattern: string;
  load: Loader;
  /** who may open it (the server checks again; this only avoids a screen full of refusals) */
  allow?: () => boolean;
  /** the menu entry it belongs to (highlighted in the menu) */
  nav?: NavKey;
}
export type NavKey = 'today' | 'overview' | 'agenda' | 'customers' | 'oil' | 'invoices' | 'quotes' | 'map' | 'hours' | 'treasury' | 'inventory' | 'dashboard' | 'team' | 'settings' | 'guide' | 'info' | 'account' | 'more';

export const ROUTES: RouteDef[] = [
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
