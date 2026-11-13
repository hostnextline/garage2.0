/* The menu: what each person sees depends on their rights (the server checks every action again). */
import { type LucideIcon, LayoutDashboard, CalendarCheck, CalendarDays, Users, Receipt, ClipboardList, MapIcon, Clock, Wallet, Package, ChartColumn, UsersRound, Settings, Compass, UserRound, CalendarPlus, Wrench, FileText, UserPlus, ReceiptText, BookOpen, PhoneIncoming, Droplet } from 'lucide-preact';
import { may, type NavKey } from './routes';
import { t } from '../lib/i18n';

export interface NavItem { key: NavKey; href: string; icon: LucideIcon; show: () => boolean; group: 'day' | 'office' | 'garage' }
export const NAV: NavItem[] = [
  { key: 'today', href: '#/', icon: CalendarCheck, show: may.today, group: 'day' },
  { key: 'overview', href: '#/overview', icon: LayoutDashboard, show: may.overview, group: 'day' },
  { key: 'agenda', href: '#/agenda', icon: CalendarDays, show: may.agenda, group: 'day' },
  { key: 'map', href: '#/map', icon: MapIcon, show: may.map, group: 'day' },
  { key: 'customers', href: '#/customers', icon: Users, show: may.customers, group: 'office' },
  { key: 'oil', href: '#/oil', icon: Droplet, show: may.oil, group: 'office' },
  { key: 'quotes', href: '#/quotes', icon: ClipboardList, show: may.quotes, group: 'office' },
  { key: 'invoices', href: '#/invoices', icon: Receipt, show: may.invoices, group: 'office' },
  { key: 'treasury', href: '#/treasury', icon: Wallet, show: may.treasury, group: 'office' },
  { key: 'dashboard', href: '#/dashboard', icon: ChartColumn, show: may.dashboard, group: 'office' },
  { key: 'hours', href: '#/hours', icon: Clock, show: may.hours, group: 'garage' },
  { key: 'inventory', href: '#/inventory', icon: Package, show: may.inventory, group: 'garage' },
  { key: 'team', href: '#/team', icon: UsersRound, show: may.team, group: 'garage' },
  { key: 'settings', href: '#/settings', icon: Settings, show: may.settings, group: 'garage' },
  { key: 'info', href: '#/info', icon: BookOpen, show: () => true, group: 'day' },
  { key: 'guide', href: '#/guide', icon: Compass, show: () => true, group: 'garage' },
  { key: 'account', href: '#/account', icon: UserRound, show: () => true, group: 'garage' }
];
export const navLabel = (k: NavKey) => t(`shell.nav.${k}`);

/** the phone's bottom bar: Aujourd'hui, Vue d'ensemble, +, Agenda, Plus (adapted to what the person may open) */
export function tabItems(): NavItem[] {
  const want: NavKey[] = ['today', 'overview', 'agenda', 'customers', 'invoices', 'treasury', 'map'];
  return want.map((k) => NAV.find((n) => n.key === k)!).filter((n) => n.show()).slice(0, 3);
}

export interface QuickAction { key: string; href: string; icon: LucideIcon; show: () => boolean }
export const QUICK: QuickAction[] = [
  { key: 'call', href: '#/call', icon: PhoneIncoming, show: may.book },
  { key: 'book', href: '#/book', icon: CalendarPlus, show: may.book },
  { key: 'walkIn', href: '#/book?walkin=1', icon: Wrench, show: may.walkIn },
  { key: 'quote', href: '#/quote/new', icon: FileText, show: may.quotes },
  { key: 'customer', href: '#/customer/new', icon: UserPlus, show: may.newCustomer },
  { key: 'expense', href: '#/treasury?add=1', icon: ReceiptText, show: may.treasury }
];
