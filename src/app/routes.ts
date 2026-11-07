/* Every screen of the team app: its address, who may open it, and the code that draws it (loaded on first use,
   kept by the service worker for offline). A screen receives { params, query }. */
import type { ComponentType } from 'preact';
import { can, hasRole, isOwner, myTrucks } from '../data/auth';

export interface ScreenProps { params: Record<string, string>; query: URLSearchParams }
type Loader = () => Promise<{ default: ComponentType<ScreenProps> }>;
export interface RouteDef {
  pattern: string;
  load: Loader;
  /** who may open it (the server checks again; this only avoids a screen full of refusals) */
  allow?: () => boolean;
  /** the menu entry it belongs to (highlighted in the menu) */
  nav?: NavKey;
}
export type NavKey = 'today' | 'agenda' | 'customers' | 'invoices' | 'quotes' | 'map' | 'hours' | 'treasury' | 'inventory' | 'dashboard' | 'team' | 'settings' | 'guide' | 'account' | 'more';

export const isField = () => hasRole('owner') || hasRole('office') || hasRole('mechanic');
export const may = {
  today: () => true,
  agenda: () => can('agenda') || hasRole('mechanic'),
  book: () => can('book'),
  customers: () => can('clients') || isField(),
  invoices: () => can('invoices'),
  quotes: () => isField() || can('invoices'),
  map: () => can('map'),
  // a mechanic opens Horaires for the truck he drives (the server lets him change its hours and its start)
  hours: () => can('hours') || myTrucks().length > 0,
  treasury: () => can('treasury'),
  inventory: () => can('inventory'),
  dashboard: () => can('money'),
  team: () => isOwner(),
  settings: () => can('settings'),
  walkIn: () => can('book') || hasRole('mechanic'),
  newCustomer: () => can('clients') || can('book')
};

export const ROUTES: RouteDef[] = [
  { pattern: '/', load: () => import('../features/today/TodayScreen'), nav: 'today' },
  { pattern: '/agenda/:day?', load: () => import('../features/agenda/AgendaScreen'), allow: may.agenda, nav: 'agenda' },
  { pattern: '/book', load: () => import('../features/booking/BookScreen'), allow: () => may.book() || may.walkIn(), nav: 'agenda' },
  { pattern: '/hours/:truck?', load: () => import('../features/hours/HoursScreen'), allow: may.hours, nav: 'hours' },
  { pattern: '/customers', load: () => import('../features/customers/CustomersScreen'), allow: may.customers, nav: 'customers' },
  { pattern: '/customer/:id', load: () => import('../features/customers/CustomerScreen'), allow: may.customers, nav: 'customers' },
  { pattern: '/vehicle/:id', load: () => import('../features/customers/VehicleScreen'), allow: may.customers, nav: 'customers' },
  { pattern: '/job/:id', load: () => import('../features/jobs/JobScreen'), nav: 'today' },
  { pattern: '/invoices', load: () => import('../features/invoices/InvoicesScreen'), allow: may.invoices, nav: 'invoices' },
  { pattern: '/invoice/:id', load: () => import('../features/invoices/InvoiceScreen'), nav: 'invoices' },
  { pattern: '/quotes', load: () => import('../features/quotes/QuotesScreen'), allow: may.quotes, nav: 'quotes' },
  { pattern: '/quote/:id', load: () => import('../features/quotes/QuoteScreen'), allow: may.quotes, nav: 'quotes' },
  { pattern: '/map', load: () => import('../features/map/MapScreen'), allow: may.map, nav: 'map' },
  { pattern: '/team', load: () => import('../features/team/TeamScreen'), allow: may.team, nav: 'team' },
  { pattern: '/settings/:section?', load: () => import('../features/settings/SettingsScreen'), allow: may.settings, nav: 'settings' },
  { pattern: '/account', load: () => import('../features/account/AccountScreen'), nav: 'account' },
  { pattern: '/treasury', load: () => import('../features/treasury/TreasuryScreen'), allow: may.treasury, nav: 'treasury' },
  { pattern: '/inventory', load: () => import('../features/inventory/InventoryScreen'), allow: may.inventory, nav: 'inventory' },
  { pattern: '/needs', load: () => import('../features/inventory/NeedsScreen'), allow: may.inventory, nav: 'inventory' },
  { pattern: '/dashboard', load: () => import('../features/dashboard/DashboardScreen'), allow: may.dashboard, nav: 'dashboard' },
  { pattern: '/guide', load: () => import('../features/guide/GuideScreen'), nav: 'guide' },
  { pattern: '/more', load: () => import('./MoreScreen'), nav: 'more' }
];
