/* What the screens need to know about each customer, computed once per change of the data: the cars, the next
   appointment, the last visit, what is still owed, how recent the activity is, and the search index. */
import { computed } from '@preact/signals';
import { rowsOf } from '../../data/store';
import { customersList, allJobs, invoicesList, quotesList, customerName } from '../../data/select';
import type { Customer, CustomerNote, Invoice, Job, Vehicle } from '../../data/types';
import { today } from '../../lib/dates';
import { searchDoc, type SearchDoc } from './search';

export interface CustomerFacts {
  cars: Vehicle[];
  /** the next appointment not done yet (today or later) */
  next: Job | null;
  /** the last finished job */
  last: Job | null;
  /** what is still owed on finished invoices (cents) */
  owed: number;
  /** finished invoices not fully paid */
  unpaid: number;
  /** the most recent thing that happened (ms) */
  activity: number;
}
const ACTIVE = new Set(['booked', 'en_route', 'on_site']);
const BLOCK_ORDER: Record<string, number> = { am: 0, pm: 1, eve: 2 };
const ms = (iso: string | null | undefined): number => { const n = iso ? Date.parse(iso) : NaN; return Number.isFinite(n) ? n : 0; };
const noon = (day: string): number => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };

export function owedOn(v: Pick<Invoice, 'status' | 'total_cents' | 'paid_cents'>): number {
  return v.status === 'issued' ? Math.max(0, Number(v.total_cents || 0) - Number(v.paid_cents || 0)) : 0;
}
export function isUpcoming(j: Job, day = today()): boolean { return ACTIVE.has(j.status) && j.day >= day; }
export function jobOrder(a: Job, b: Job): number { return a.day.localeCompare(b.day) || (BLOCK_ORDER[a.block] ?? 9) - (BLOCK_ORDER[b.block] ?? 9) || (a.stop_order ?? 99) - (b.stop_order ?? 99); }

export const factsMap = computed<Map<string, CustomerFacts>>(() => {
  const day = today();
  const now = Date.now();
  const out = new Map<string, CustomerFacts>();
  const get = (id: string | null | undefined): CustomerFacts | null => {
    if (!id) return null;
    let f = out.get(id);
    if (!f) { f = { cars: [], next: null, last: null, owed: 0, unpaid: 0, activity: 0 }; out.set(id, f); }
    return f;
  };
  for (const c of customersList.value) get(c.id)!.activity = ms(c.created_at);
  for (const v of rowsOf<Vehicle>('vehicles')) { if (!v.deleted_at) get(v.customer_id)?.cars.push(v); }
  for (const j of allJobs.value) {
    const f = get(j.customer_id);
    if (!f) continue;
    if (isUpcoming(j, day)) { if (!f.next || jobOrder(j, f.next) < 0) f.next = j; }
    if (j.status === 'done' && (!f.last || jobOrder(j, f.last) > 0)) f.last = j;
    // a visit counts on its day; an appointment still to come counts when it was booked
    const at = j.day <= day ? noon(j.day) : Math.min(now, ms(j.created_at) || now);
    f.activity = Math.max(f.activity, at);
  }
  for (const v of invoicesList.value) {
    const f = get(v.customer_id);
    if (!f) continue;
    const o = owedOn(v);
    if (o > 0) { f.owed += o; f.unpaid++; }
    f.activity = Math.max(f.activity, Math.min(now, ms(v.issued_at)));
  }
  for (const n of rowsOf<CustomerNote>('customer_notes')) { if (!n.deleted_at) { const f = get(n.customer_id); if (f) f.activity = Math.max(f.activity, Math.min(now, ms(n.created_at))); } }
  for (const q of quotesList.value) { const f = get(q.customer_id); if (f) f.activity = Math.max(f.activity, Math.min(now, ms(q.created_at))); }
  for (const f of out.values()) f.cars.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
  return out;
});
const EMPTY: CustomerFacts = { cars: [], next: null, last: null, owed: 0, unpaid: 0, activity: 0 };
export function factsOf(id: string | null | undefined): CustomerFacts { return (id && factsMap.value.get(id)) || EMPTY; }

export const searchIndex = computed<Map<string, SearchDoc>>(() => {
  const m = new Map<string, SearchDoc>();
  const facts = factsMap.value;
  for (const c of customersList.value) m.set(c.id, searchDoc(c, facts.get(c.id)?.cars || []));
  return m;
});

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/* the two orders of the list, sorted once per change of the data (a search only filters them) */
function sortedBy(list: Customer[], keyOf: (c: Customer) => number | string, desc: boolean): Customer[] {
  const keyed = list.map((c) => ({ c, k: keyOf(c), n: customerName(c) }));
  keyed.sort((a, b) => (typeof a.k === 'number' ? (desc ? (b.k as number) - (a.k as number) : (a.k as number) - (b.k as number)) : collator.compare(a.k as string, b.k as string)) || collator.compare(a.n, b.n));
  return keyed.map((x) => x.c);
}
export const recentFirst = computed<Customer[]>(() => { const f = factsMap.value; return sortedBy(customersList.value, (c) => f.get(c.id)?.activity ?? 0, true); });
export const nameOrder = computed<Customer[]>(() => sortedBy(customersList.value, (c) => customerName(c), false));
