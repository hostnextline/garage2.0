/* « Par où commencer »: the first steps of each role, worked out from the real data. Pure (no app state): the screen
   gathers the data (guide-data.ts), this file decides what is done. Tested in checklist.test.ts. */

export type Role = 'owner' | 'office' | 'mechanic' | 'treasurer';
export const ROLE_ORDER: Role[] = ['owner', 'office', 'mechanic', 'treasurer'];

export interface GuideInput {
  me: { id: string; roles: Role[]; owner: boolean; trucks: string[] };
  company: { name?: string | null; phone?: string | null; address?: string | null; tps_no?: string | null; tvq_no?: string | null };
  taxesOn: boolean;
  services: { active: boolean; price_cents: number | null }[];
  trucks: { id: string; name: string; active: boolean; driver_id: string | null }[];
  /** truck ids that have working hours (a week with at least one range) */
  trucksWithHours: string[];
  staff: { id: string; active: boolean }[];
  /** invitations waiting to be accepted (null: unknown) */
  invitations: number | null;
  /** texts (GoHighLevel) and card payments (Stripe) connected (null: unknown, e.g. no signal) */
  secrets: { ghl: boolean | null; stripe: boolean | null };
  jobs: { created_by?: string | null; truck_id: string | null; status: string }[];
  shifts: { staff_id: string }[];
  expenses: { receipt_id: string | null }[];
  /** steps this person saw, read or confirmed (by step id) */
  marks: Record<string, string | undefined>;
  /** tours this person finished (by role) */
  tours: Partial<Record<Role, string>>;
}

export type StepKind = 'data' | 'visit' | 'confirm' | 'read' | 'tour';
export interface Detail { key: string; vars?: Record<string, string | number>; list?: string[] }
export interface GuideStep {
  id: string;
  role: Role;
  kind: StepKind;
  /** null: can't tell right now (needs the server) */
  done: boolean | null;
  /** what is missing, or what to do now (an i18n key under guide.detail, with its values) */
  detail: Detail | null;
  /** the screen to open, and the element to show on it */
  href: string;
  anchor?: string;
  /** a confirm step that waits for the person's « C'est vérifié » */
  canConfirm?: boolean;
}

/** the person's roles, the most responsible first (an owner is always « owner ») */
export function rolesOf(me: { roles: Role[]; owner: boolean }): Role[] {
  const set = new Set<Role>(me.roles || []);
  if (me.owner) set.add('owner');
  const list = ROLE_ORDER.filter((r) => set.has(r));
  return list.length ? list : ['office'];
}
export function mainRole(me: { roles: Role[]; owner: boolean }): Role { return rolesOf(me)[0]; }

const has = (s: string | null | undefined) => !!s && String(s).trim().length > 0;

function ownerSteps(x: GuideInput): GuideStep[] {
  const c = x.company;
  const missing = [
    !has(c.name) && 'name', !has(c.phone) && 'phone', !has(c.address) && 'address',
    x.taxesOn && !has(c.tps_no) && 'tps', x.taxesOn && !has(c.tvq_no) && 'tvq'
  ].filter(Boolean) as string[];

  const active = x.services.filter((s) => s.active);
  const unpriced = active.filter((s) => s.price_cents == null).length;
  const pricesOk = active.length > 0 && unpriced === 0;
  const servicesDone = pricesOk && !!x.marks.services;
  const servicesDetail: Detail | null = !active.length ? { key: 'noServices' } : unpriced ? { key: 'unpriced', vars: { n: unpriced } } : servicesDone ? null : { key: 'confirmPrices' };

  const trucks = x.trucks.filter((t) => t.active);
  const noDriver = trucks.find((t) => !t.driver_id);
  const noHours = trucks.find((t) => !x.trucksWithHours.includes(t.id));
  const trucksDetail: Detail | null = !trucks.length ? { key: 'noTruck' } : noDriver ? { key: 'noDriver', vars: { name: noDriver.name } } : noHours ? { key: 'noHours', vars: { name: noHours.name } } : null;

  const others = x.staff.filter((s) => s.active && s.id !== x.me.id).length;
  const teamDone = others > 0 || (x.invitations ?? 0) > 0;

  return [
    { id: 'company', role: 'owner', kind: 'data', done: missing.length === 0, detail: missing.length ? { key: 'missing', list: missing } : null, href: '/settings/company', anchor: 'settings-company' },
    { id: 'services', role: 'owner', kind: 'confirm', done: servicesDone, detail: servicesDetail, href: '/settings/services', anchor: 'settings-services', canConfirm: pricesOk && !servicesDone },
    { id: 'trucks', role: 'owner', kind: 'data', done: trucks.length > 0 && !trucksDetail, detail: trucksDetail, href: '/hours', anchor: 'hours-grid' },
    { id: 'team', role: 'owner', kind: 'data', done: teamDone, detail: teamDone ? null : { key: 'alone' }, href: '/team', anchor: 'team-invite' },
    { id: 'texts', role: 'owner', kind: 'data', done: x.secrets.ghl, detail: x.secrets.ghl == null ? { key: 'offline' } : null, href: '/settings/connect', anchor: 'settings-connect' },
    { id: 'cards', role: 'owner', kind: 'data', done: x.secrets.stripe, detail: x.secrets.stripe == null ? { key: 'offline' } : null, href: '/settings/connect', anchor: 'settings-connect' },
    { id: 'booking', role: 'owner', kind: 'data', done: x.jobs.length > 0, detail: null, href: '/book', anchor: 'book-customer' }
  ];
}

function officeSteps(x: GuideInput): GuideStep[] {
  return [
    { id: 'book', role: 'office', kind: 'data', done: x.jobs.some((j) => j.created_by === x.me.id), detail: null, href: '/book', anchor: 'book-customer' },
    { id: 'customers', role: 'office', kind: 'visit', done: !!x.marks.customers, detail: null, href: '/customers', anchor: 'customers-search' },
    { id: 'agenda', role: 'office', kind: 'visit', done: !!x.marks.agenda, detail: null, href: '/agenda', anchor: 'agenda-day' }
  ];
}

function mechanicSteps(x: GuideInput, nextJobId: string | null): GuideStep[] {
  const mine = x.me.trucks;
  const finished = x.jobs.some((j) => !!j.truck_id && mine.includes(j.truck_id) && j.status === 'done');
  return [
    { id: 'day', role: 'mechanic', kind: 'data', done: x.shifts.some((s) => s.staff_id === x.me.id), detail: null, href: '/', anchor: 'today-shift' },
    { id: 'job', role: 'mechanic', kind: 'data', done: finished || !!x.marks.job, detail: mine.length ? null : { key: 'noTruckMine' },
      href: nextJobId ? `/job/${nextJobId}` : '/', anchor: nextJobId ? 'job-bigstep' : 'today-next' },
    { id: 'offline', role: 'mechanic', kind: 'read', done: !!x.marks.offline, detail: null, href: '/guide?faq=offline' }
  ];
}

function treasurerSteps(x: GuideInput): GuideStep[] {
  return [
    { id: 'expense', role: 'treasurer', kind: 'data', done: x.expenses.some((e) => !!e.receipt_id), detail: null, href: '/treasury', anchor: 'treasury-add' },
    { id: 'report', role: 'treasurer', kind: 'visit', done: !!x.marks.report, detail: null, href: '/treasury', anchor: 'treasury-report' }
  ];
}

/** every first step of this person, role after role (no step twice), the guided tour of the main role last */
export function computeChecklist(x: GuideInput, nextJobId: string | null = null): GuideStep[] {
  const roles = rolesOf(x.me);
  const out: GuideStep[] = [];
  const seen = new Set<string>();
  for (const r of roles) {
    const list = r === 'owner' ? ownerSteps(x) : r === 'office' ? officeSteps(x) : r === 'mechanic' ? mechanicSteps(x, nextJobId) : treasurerSteps(x);
    for (const s of list) {
      // an owner who also does the office's work: « la première réservation » already covers « ta première réservation »
      if (s.id === 'book' && seen.has('booking')) continue;
      if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
    }
  }
  const main = roles[0];
  out.push({ id: 'tour', role: main, kind: 'tour', done: !!x.tours[main], detail: null, href: '/guide' });
  return out;
}

/** the next step to suggest: the first one not done (steps we can't check right now are not suggested) */
export function nextStep(steps: GuideStep[]): GuideStep | null {
  return steps.find((s) => s.done === false) || null;
}
export function progress(steps: GuideStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done === true).length, total: steps.length };
}
