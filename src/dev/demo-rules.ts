/* DEV ONLY — who acts in the demo and what that person may see and do: the same rules as the database's row rules and
   operations (supabase/migrations: right_of, job_visible, customer_visible, invoice_editable, job_actor, the « … _read »
   policies). A screen tried as ?demo=mechanic now meets what the phone of a mechanic holds on live, not every row of
   the garage (demo-02). The rights rule itself is the app's twin of right_of (domain/team/rights.ts), not a third copy
   (demo-25). */
import { find, table, refuse, type DemoRow } from './fake-server';
import { effectiveRight, type RoleRights } from '../domain/team/rights';
import type { Right, Role } from '../data/types';

/** the person on screen (?demo=…); the owner when nothing was said */
export const demoUser = (): string => (globalThis as { __demoUser?: string }).__demoUser || 'u-hassan';
const staffOf = (id = demoUser()) => find('staff', id);
const rolesOf = (s: DemoRow | undefined): Role[] => (Array.isArray(s?.roles) ? s!.roles as Role[] : []);
/** on the team: active and not removed (is_staff) */
export function isStaff(id = demoUser()): boolean { const s = staffOf(id); return !!s && s.active !== false && !s.deleted_at; }
export function hasRole(role: Role, id = demoUser()): boolean { return isStaff(id) && rolesOf(staffOf(id)).includes(role); }
export function isOwner(id = demoUser()): boolean { return hasRole('owner', id); }
export function isField(id = demoUser()): boolean { return hasRole('owner', id) || hasRole('office', id) || hasRole('mechanic', id); }
/** right_of: the owner has everything; a role's « always »; a « can » given by the role or by the person's own choice */
export function can(right: Right, id = demoUser()): boolean {
  const s = staffOf(id);
  if (!s || s.active === false || s.deleted_at) return false;
  const rr = ((find('settings', '1')?.role_rights || {}) as RoleRights);
  return effectiveRight(rolesOf(s), (s.rights || {}) as Partial<Record<Right, boolean>>, right, rr);
}
/** my_truck_ids: the vehicles I drive (every vehicle for a mechanic with « Routes partagées »), in the order of Horaires */
export function myTruckIds(id = demoUser()): string[] {
  const shared = ((find('settings', '1')?.booking || {}) as { shared_routes?: boolean }).shared_routes === true && hasRole('mechanic', id);
  return table('trucks').filter((t) => !t.deleted_at && (t.driver_id === id || shared))
    .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0) || String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id)).map((t) => t.id);
}
export function jobVisible(j: DemoRow | undefined, id = demoUser()): boolean {
  if (!j) return false;
  return can('agenda', id) || ((myTruckIds(id).includes(String(j.truck_id)) || j.created_by === id) && isStaff(id));
}
export const jobIdVisible = (jobId: unknown, id = demoUser()) => jobVisible(find('jobs', jobId), id);
export function customerVisible(customerId: unknown, id = demoUser()): boolean {
  if (customerId == null) return false;
  const c = String(customerId);
  if (can('clients', id)) return true;
  if (!isStaff(id)) return false;
  return find('customers', c)?.created_by === id
    || table('jobs').some((j) => j.customer_id === c && !j.deleted_at && jobVisible(j, id))
    || table('quotes').some((q) => q.customer_id === c && q.created_by === id);
}
export function invoiceVisible(jobId: unknown, id = demoUser()): boolean {
  return can('invoices', id) || (jobId != null && jobIdVisible(jobId, id));
}
/** invoice_editable: « Modifier les factures », the mechanic of the job, or « Réserver » on a job one sees */
export function invoiceEditable(jobId: unknown, id = demoUser()): boolean {
  if (can('edit_invoices', id)) return true;
  if (jobId == null) return false;
  const j = find('jobs', jobId);
  if (j && (myTruckIds(id).includes(String(j.truck_id)) || j.created_by === id) && hasRole('mechanic', id)) return true;
  return can('book', id) && jobVisible(j, id);
}
/** job_actor: who may move a job forward (Je pars, Je suis arrivé, Terminer…) */
export function jobActor(j: DemoRow, id = demoUser()): boolean {
  return isOwner(id) || can('book', id) || myTruckIds(id).includes(String(j.truck_id)) || (j.created_by === id && isField(id));
}
export function truckHoursEditable(truckId: unknown, id = demoUser()): boolean {
  return isOwner(id) || can('hours', id) || (myTruckIds(id).includes(String(truckId)) && isStaff(id));
}

/** the « … _read » row rules: may this person read this row of this table? */
export function visible(name: string, r: DemoRow, id = demoUser()): boolean {
  switch (name) {
    case 'settings': case 'staff': case 'trucks': case 'truck_week': case 'truck_days': case 'services': case 'service_parts':
    case 'engine_specs': case 'inventory_items':
      return isStaff(id);
    case 'customers': return customerVisible(r.id, id) || (r.created_by === id && isStaff(id));
    case 'customer_notes': return customerVisible(r.customer_id, id);
    case 'vehicles': return (r.customer_id == null && r.created_by === id) || customerVisible(r.customer_id, id);
    case 'jobs': return jobVisible(r, id);
    case 'job_items': return jobIdVisible(r.job_id, id);
    case 'quotes': return (r.created_by === id && isStaff(id)) || can('book', id) || can('invoices', id);
    case 'invoices': return invoiceVisible(r.job_id, id);
    case 'payments': return invoiceVisible(r.job_id ?? find('invoices', r.invoice_id)?.job_id ?? null, id);
    case 'attachments': return r.kind === 'receipt' ? can('treasury', id) : r.kind === 'signature' ? r.job_id != null && jobIdVisible(r.job_id, id) : isStaff(id);
    case 'expenses': return can('treasury', id);
    case 'inventory_moves': return can('inventory', id);
    case 'shifts': return r.staff_id === id || can('map', id);
    case 'positions': return r.id === id || can('map', id);
    case 'trips': return r.staff_id === id || can('map', id) || jobIdVisible(r.job_id, id);
    case 'messages': return can('agenda', id) || (r.job_id != null && jobIdVisible(r.job_id, id));
    case 'incoming_texts': return isOwner(id) && (staffOf(id)?.prefs as { texts?: unknown } | undefined)?.texts === true;
    case 'incoming_calls': return isOwner(id);
    case 'activity': case 'invitations': return isOwner(id);
    case 'push_subs': return r.staff_id === id;
    default: return isStaff(id);
  }
}

/** the « … _ins / _upd » row rules of the tables the screens write directly (null: no rule of its own here) */
export function mayWrite(name: string, r: DemoRow, id = demoUser()): boolean {
  switch (name) {
    case 'settings': return can('settings', id);
    case 'trucks': return isOwner(id) || can('settings', id);
    case 'truck_week': case 'truck_days': return truckHoursEditable(r.truck_id, id);
    case 'services': return can('settings', id);
    case 'service_parts': return can('settings', id) || can('inventory', id);
    case 'engine_specs': case 'quotes': return isField(id);
    case 'customers': case 'vehicles': return isField(id);
    case 'customer_notes': return isField(id) && customerVisible(r.customer_id, id);
    case 'invoices': return invoiceEditable(r.job_id, id);
    case 'expenses': return can('treasury', id);
    case 'inventory_items': case 'inventory_moves': return can('inventory', id);
    default: return isStaff(id);
  }
}

/** the database's refusal when a right is missing (fail('not_allowed', …)) */
export function need(ok: boolean, message: string): void { if (!ok) refuse('not_allowed', message); }
