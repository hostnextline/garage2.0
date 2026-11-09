/* A customer's shortcuts, the same everywhere a right-click (computer) or a long press (phone) opens the shortcut menu:
   the agenda (on an appointment, with its own address) and the list of customers. Each one only for the people who may. */
import { UserRound, MessageSquareText, Phone, Navigation, Car, FileText, CalendarPlus, Pencil } from 'lucide-preact';
import type { Customer } from '../../data/types';
import { t } from '../../lib/i18n';
import { e164 } from '../../lib/text';
import { may, isField } from '../../app/routes';
import { navigate } from '../../app/router';
import type { MenuAction } from '../agenda/ContextMenu';
import { directionsUrl } from './address';

type Place = { address?: string | null; unit?: string | null; postal_code?: string | null; lat?: number | null; lng?: number | null };
const go = (path: string) => () => navigate(path);
const icon = (I: typeof Phone) => <I size={18} aria-hidden="true" />;

/** `place`: where to drive (an appointment's own address); `file`: show « Fiche du client »; `edit`: « Modifier la fiche » */
export function customerActions(c: Customer, o: { place?: Place; file?: boolean; edit?: boolean } = {}): MenuAction[] {
  const a: MenuAction[] = [];
  const tel = e164(c.phone);
  const dir = directionsUrl(o.place?.address ? o.place : { address: c.address, unit: c.unit, postal_code: c.postal_code, lat: c.lat, lng: c.lng });
  const sees = may.customers();
  if (o.file !== false && sees) a.push({ key: 'file', label: t('agenda.menu.customer'), icon: icon(UserRound), run: go(`/customer/${c.id}`), testid: 'menu-customer' });
  if (o.edit && sees && isField()) a.push({ key: 'edit', label: t('customers.menu.edit'), icon: icon(Pencil), run: go(`/customer/${c.id}?do=edit`), testid: 'menu-edit' });
  if (sees && tel) a.push({ key: 'text', label: t('agenda.menu.text'), icon: icon(MessageSquareText), run: go(`/customer/${c.id}?do=text`), testid: 'menu-text' });
  if (tel) a.push({ key: 'call', label: t('agenda.menu.call', { phone: c.phone || '' }), icon: icon(Phone), run: () => { location.href = `tel:${tel}`; }, testid: 'menu-call' });
  if (dir) a.push({ key: 'dir', label: t('agenda.menu.directions'), icon: icon(Navigation), run: () => { window.open(dir, '_blank', 'noopener'); }, testid: 'menu-directions' });
  if (sees && isField()) a.push({ key: 'car', label: t('agenda.menu.car'), icon: icon(Car), run: go(`/customer/${c.id}?do=car`), testid: 'menu-car' });
  if (may.quotes()) a.push({ key: 'quote', label: t('agenda.menu.quote'), icon: icon(FileText), run: go(`/quote/new?customer=${c.id}`), testid: 'menu-quote' });
  if (may.book()) a.push({ key: 'book', label: t('agenda.menu.book'), icon: icon(CalendarPlus), run: go(`/book?customer=${c.id}`), testid: 'menu-book' });
  return a;
}
