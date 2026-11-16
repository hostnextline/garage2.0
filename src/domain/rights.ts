/* Who may open what (the server checks again; this only avoids a screen full of refusals). */
import { hasRole, can, isOwner, myTrucks } from '../data/auth';

export const isField = () => hasRole('owner') || hasRole('office') || hasRole('mechanic');
export const may = {
  today: () => true,
  agenda: () => can('agenda') || hasRole('mechanic'),
  book: () => can('book'),
  customers: () => can('clients') || isField(),
  // « Rappels d’huile »: the people who see every visit and call customers (a mechanic only holds his own truck's visits)
  oil: () => isOwner() || (hasRole('office') && can('agenda') && can('clients')),
  invoices: () => can('invoices'),
  quotes: () => isField() || can('invoices'),
  map: () => can('map'),
  // today's appointments and the map on one screen (who sees the map and the day's appointments)
  overview: () => can('map') && (can('agenda') || isOwner()),
  // a mechanic opens Horaires for the truck he drives (the server lets him change its hours and its start)
  hours: () => can('hours') || myTrucks().length > 0,
  treasury: () => can('treasury'),
  // « Coffre » (family and friends): the owner, and the accountant (« Trésorerie ») who exports its report apart
  coffre: () => isOwner() || can('treasury'),
  inventory: () => can('inventory'),
  dashboard: () => can('money'),
  team: () => isOwner(),
  // Réglages opens for everyone (« Mise à jour de l'app » lives there too); the sections that change the garage need the right
  settings: () => true,
  settingsEdit: () => can('settings'),
  walkIn: () => can('book') || hasRole('mechanic'),
  newCustomer: () => can('clients') || can('book')
};
