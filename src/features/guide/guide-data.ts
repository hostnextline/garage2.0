/* What « Par où commencer » reads: the real data of the app (settings, trucks, jobs…), what the server says about the
   connected services (owner, with signal), and what this person did on this device (screens seen, tours finished,
   « Plus tard »), kept in localStorage under their access id. */
import { signal, effect, untracked } from '@preact/signals';
import { me, preview, isOwner } from '../../data/auth';
import { rowsOf } from '../../data/store';
import { settings, trucks, staffList, allJobs, expensesList, jobsOn } from '../../data/select';
import { net } from '../../data/sync';
import { team } from '../../data/api';
import { route } from '../../app/router';
import { today } from '../../lib/dates';
import type { Service, TruckWeek, Shift } from '../../data/types';
import { rolesOf, type GuideInput, type Role } from './checklist';

/* ---------- this person, on this device ---------- */
export interface Local { marks: Record<string, string>; tours: Partial<Record<Role, string>>; later: number | null }
const EMPTY: Local = { marks: {}, tours: {}, later: null };
/** bumps when the stored state changes, so the screens redraw */
export const localRev = signal(0);
const key = (id: string) => `his.guide.${id}`;

export function readLocal(id: string | null | undefined): Local {
  void localRev.value;
  if (!id) return EMPTY;
  try {
    const v = JSON.parse(localStorage.getItem(key(id)) || 'null') as Partial<Local> | null;
    return { marks: { ...(v?.marks || {}) }, tours: { ...(v?.tours || {}) }, later: typeof v?.later === 'number' ? v.later : null };
  } catch { return { ...EMPTY, marks: {}, tours: {} }; }
}
function writeLocal(patch: (l: Local) => Local) {
  const a = me.value;
  // « Voir l'app comme… »: the owner looks at someone else's steps, nothing is written for them
  if (!a || preview.value) return;
  try { localStorage.setItem(key(a.id), JSON.stringify(patch(readLocal(a.id)))); } catch { /* private mode: the steps stay to do */ }
  localRev.value++;
}
export function markStep(stepId: string) {
  const a = me.value;
  if (!a || readLocal(a.id).marks[stepId]) return;
  writeLocal((l) => ({ ...l, marks: { ...l.marks, [stepId]: new Date().toISOString() } }));
}
export function markTour(role: Role) { writeLocal((l) => ({ ...l, tours: { ...l.tours, [role]: new Date().toISOString() } })); }
/** « Plus tard »: the card on Today comes back in a week */
export function snooze(days = 7) { writeLocal((l) => ({ ...l, later: Date.now() + days * 86400000 })); }
export function snoozed(now = Date.now()): boolean {
  const l = readLocal(me.value?.id);
  return !!l.later && l.later > now;
}

/* ---------- screens seen count as « learned » (the agenda, a customer file, the report) ---------- */
let watching = false;
export function watchScreens() {
  if (watching) return;
  watching = true;
  effect(() => {
    const p = route.value.path;
    if (!me.value || preview.value) return;
    const step = p === '/customers' || p.startsWith('/customer/') ? 'customers' : p === '/agenda' || p.startsWith('/agenda/') ? 'agenda' : null;
    if (step) untracked(() => markStep(step));
  });
}

/* ---------- what only the server knows (owner, with signal); my access also says yes/no for the two services ---------- */
export interface Checks { ghl: boolean | null; stripe: boolean | null; invitations: number | null; at: number }
export const checks = signal<Checks | null>(null);
let asking = false;
/** texts (GoHighLevel) and card payments (Stripe) connected, invitations waiting; at most every `maxAge` ms */
export async function refreshChecks(maxAge = 10 * 60 * 1000) {
  const a = me.value;
  if (!a || !isOwner() || preview.value || !net.value.online || asking) return;
  if (checks.value && Date.now() - checks.value.at < maxAge) return;
  asking = true;
  try {
    const s = await team<{ ghl?: { on?: boolean }; stripe?: { on?: boolean } }>('secrets');
    let invitations: number | null = null;
    if (!staffList.value.some((x) => x.active && x.id !== a.id)) {
      const l = await team<{ invitations?: unknown[] }>('list');
      invitations = l.ok ? (l.invitations || []).length : null;
    }
    checks.value = { ghl: s.ok ? !!s.ghl?.on : null, stripe: s.ok ? !!s.stripe?.on : null, invitations, at: Date.now() };
  } catch {
    /* no answer: those two steps stay « à vérifier » */
  } finally {
    asking = false;
  }
}

/* ---------- everything the checklist needs ---------- */
export function guideInput(): GuideInput | null {
  const a = me.value;
  if (!a) return null;
  const s = settings.value;
  const local = readLocal(a.id);
  const withHours = new Set(rowsOf<TruckWeek>('truck_week').filter((w) => !w.deleted_at && (w.ranges || []).some((r) => Number(r[1]) > Number(r[0]))).map((w) => w.truck_id));
  const c = checks.value;
  return {
    me: { id: a.id, roles: (a.roles || []) as Role[], owner: !!a.owner, trucks: a.trucks || [] },
    company: s.company || {},
    taxesOn: s.taxes?.enabled !== false,
    services: rowsOf<Service>('services').filter((x) => !x.deleted_at).map((x) => ({ active: !!x.active, price_cents: x.price_cents })),
    trucks: trucks.value.map((t) => ({ id: t.id, name: t.name, active: !!t.active, driver_id: t.driver_id })),
    trucksWithHours: [...withHours],
    staff: staffList.value.map((x) => ({ id: x.id, active: !!x.active })),
    invitations: c?.invitations ?? null,
    // the server's fresh answer when we have one, else what my access said at sign-in (also without signal)
    secrets: { ghl: c?.ghl ?? (typeof a.texts_online === 'boolean' ? a.texts_online : null), stripe: c?.stripe ?? (typeof a.card_online === 'boolean' ? a.card_online : null) },
    jobs: allJobs.value.map((j) => ({ created_by: j.created_by ?? null, truck_id: j.truck_id, status: j.status })),
    shifts: rowsOf<Shift>('shifts').filter((x) => !x.deleted_at).map((x) => ({ staff_id: x.staff_id })),
    expenses: expensesList.value.map((e) => ({ receipt_id: e.receipt_id })),
    marks: local.marks,
    tours: local.tours
  };
}

export function myRoles(): Role[] { const a = me.value; return a ? rolesOf({ roles: (a.roles || []) as Role[], owner: !!a.owner }) : ['office']; }

/** the job a mechanic opens next: today's first job still to do on his trucks, else the next one, else the last one */
export function nextJobId(): string | null {
  const a = me.value;
  if (!a) return null;
  const mine = a.trucks || [];
  const live = ['booked', 'en_route', 'on_site'];
  const ok = (j: { truck_id: string | null }) => !mine.length || (!!j.truck_id && mine.includes(j.truck_id));
  const t = today();
  const todays = jobsOn(t).filter((j) => ok(j) && live.includes(j.status));
  if (todays.length) return todays[0].id;
  const pool = allJobs.value.filter(ok);
  const next = pool.filter((j) => j.day >= t && live.includes(j.status)).sort((x, y) => x.day.localeCompare(y.day))[0];
  if (next) return next.id;
  return pool.slice().sort((x, y) => y.day.localeCompare(x.day))[0]?.id ?? null;
}
