/* The « … » menu of a job: which shortcuts this person gets, in their order. Pure (tested in menu.test.ts). */
import type { Job } from '../../data/types';
import type { JobRights } from './rights';

export type MenuKey = 'edit' | 'resend' | 'tracking' | 'arrived' | 'link' | 'first' | 'order' | 'move' | 'truck' | 'back' | 'noshow' | 'cancel' | 'coffre' | 'reopen';
export interface MenuContext {
  /** « Modifier le rendez-vous » is open to this person (mayEditJob) */
  edit: boolean;
  /** the customer's own page has a link to copy */
  link: boolean;
  /** « Changer de camion » is possible now (mayChangeTruck) and offered here */
  truck: boolean;
  /** « Payé par le Coffre » is offered here */
  coffre: boolean;
  /** the job's invoice is finished (issued or paid) / paid */
  invoiceDone: boolean;
  invoicePaid: boolean;
  /** the invoice the customer gets on arrival has something to say (priced work, not the Coffre) */
  arrivalText: boolean;
}
type Rights = Pick<JobRights, 'text' | 'act' | 'order' | 'move' | 'backFromDone' | 'reopen'>;

/** « Revenir en arrière »: a mistake on the way or on site, for whoever moves the job forward; a finished job, only the
    owner and the office (as the server) */
export function mayBack(s: Job['status'], r: Pick<JobRights, 'act' | 'backFromDone'>): boolean {
  return s === 'en_route' || s === 'on_site' ? r.act : s === 'done' ? r.backFromDone : false;
}
export function jobMenu(j: Pick<Job, 'status' | 'truck_id' | 'coffre_id'>, r: Rights, c: MenuContext): MenuKey[] {
  const s = j.status;
  const booked = s === 'booked';
  const out: (MenuKey | false)[] = [
    c.edit && 'edit',
    booked && r.text && 'resend',
    s === 'en_route' && r.act && 'tracking',
    s === 'on_site' && r.act && !c.invoiceDone && c.arrivalText && 'arrived',
    c.link && 'link',
    booked && r.order && !!j.truck_id && 'first',
    booked && r.order && !!j.truck_id && 'order',
    booked && r.move && 'move',
    c.truck && 'truck',
    mayBack(s, r) && 'back',
    (booked || s === 'en_route' || s === 'on_site') && r.act && 'noshow',
    (booked || s === 'en_route') && r.act && 'cancel',
    c.coffre && !j.coffre_id && s !== 'cancelled' && s !== 'no_show' && !c.invoicePaid && 'coffre',
    (s === 'cancelled' || s === 'no_show') && r.reopen && 'reopen'
  ];
  return out.filter((x): x is MenuKey => !!x);
}
