/* « Info »: may this reader open the screen an article points to? The same rules as the routes table (src/app/routes.ts,
   which a section may not import): « Ouvrir cet écran » is not shown to someone the screen would turn away. Pure: the
   rights come in. Tested in links.test.ts, which also checks every article's link against the real routes. */

export type Rights = Record<'agenda' | 'book' | 'walkIn' | 'customers' | 'newCustomer' | 'oil' | 'invoices' | 'quotes' | 'map' | 'overview' | 'hours' | 'treasury' | 'coffre' | 'inventory' | 'dashboard' | 'team' | 'settings', () => boolean>;

/** the rule of the first part of the address ('#/settings/booking' → 'settings'); a screen everyone opens: always */
export function mayOpen(link: string, may: Rights): boolean {
  const path = link.replace(/^#/, '').split('?')[0];
  const [first = '', second] = path.split('/').filter(Boolean);
  switch (first) {
    case 'agenda': return may.agenda();
    case 'book': return may.book() || may.walkIn();
    case 'call': return may.book();
    case 'customers': case 'vehicle': return may.customers();
    case 'customer': return second === 'new' ? may.newCustomer() && may.customers() : may.customers();
    case 'oil': return may.oil();
    case 'invoices': return may.invoices();
    case 'quotes': case 'quote': return may.quotes();
    case 'map': return may.map();
    case 'overview': return may.overview();
    case 'hours': return may.hours();
    case 'treasury': return may.treasury();
    case 'coffre': return may.coffre();
    case 'inventory': case 'needs': return may.inventory();
    case 'dashboard': return may.dashboard();
    case 'team': return may.team();
    case 'settings': return may.settings();
    default: return true;
  }
}
