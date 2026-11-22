/* Which customers and coming appointments still have no position, and, once a position is found, which of them may
   still take it. Pure (the background work is locator.ts), tested in positions.test.ts and locator.test.ts. */
import type { Customer, Job } from '../../data/types';

export interface Task {
  /** the address folded: one lookup for the same address written on a customer and its appointments */
  key: string; address: string; postal: string | null; city: string | null;
  customerId: string | null; jobIds: string[];
}
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const addrKey = (a: string | null | undefined) => fold(String(a || '')).replace(/[^a-z0-9]+/g, ' ').trim();
export const COMING = new Set(['booked', 'en_route', 'on_site']);

/** where a coming appointment is: its own address, or its customer's when it has none (or the same one) */
export function jobPlace(j: Pick<Job, 'address' | 'lat' | 'lng' | 'postal_code'>, c: Customer | undefined): { address: string; postal: string | null; city: string | null; lat: number | null; lng: number | null; home: boolean } {
  const own = (j.address || '').trim();
  const home = !own || (!!c && addrKey(own) === addrKey(c.address));
  if (home && c) return { address: (c.address || own).trim(), postal: c.postal_code || j.postal_code || null, city: c.city || null, lat: j.lat ?? c.lat, lng: j.lng ?? c.lng, home: true };
  return { address: own, postal: j.postal_code || null, city: null, lat: j.lat, lng: j.lng, home: false };
}

/** what has no position yet: the coming appointments first (today on, nearest day first), then the customers;
    one task per address. `only` keeps the given appointments and customers (« Chercher »). */
export function missingPositions(jobs: Job[], customers: Customer[], day: string, only?: { jobs?: string[]; customers?: string[] }): Task[] {
  const byId = new Map(customers.map((c) => [c.id, c]));
  const tasks = new Map<string, Task>();
  const add = (address: string, postal: string | null, city: string | null, customerId: string | null, jobId: string | null) => {
    const key = addrKey(address);
    if (!key || !/[a-z]/.test(key)) return;
    let t = tasks.get(key);
    if (!t) { t = { key, address: address.trim(), postal, city, customerId: null, jobIds: [] }; tasks.set(key, t); }
    if (customerId && !t.customerId) t.customerId = customerId;
    if (jobId && !t.jobIds.includes(jobId)) t.jobIds.push(jobId);
    if (!t.postal && postal) t.postal = postal;
    if (!t.city && city) t.city = city;
  };
  const coming = jobs
    .filter((j) => !j.deleted_at && j.day >= day && COMING.has(j.status) && j.lat == null && (!only || !!only.jobs?.includes(j.id)))
    .sort((a, b) => a.day.localeCompare(b.day) || a.number - b.number);
  for (const j of coming) {
    const c = j.customer_id ? byId.get(j.customer_id) : undefined;
    const p = jobPlace(j, c);
    if (!p.address) continue;
    if (p.home) {
      if (c && c.lat != null) continue;                     // the customer's position is known: the appointment uses it
      add(p.address, p.postal, p.city, c ? c.id : null, j.id);
    } else add(p.address, p.postal, null, null, j.id);
  }
  for (const c of customers) {
    if (c.deleted_at || c.lat != null || !c.address?.trim()) continue;
    if (only && !only.customers?.includes(c.id)) continue;
    add(c.address, c.postal_code, c.city, c.id, null);
  }
  return [...tasks.values()];
}

/** what a position found for a task may still be written on, read from the rows as they are NOW (a lookup takes up to a
    few minutes): a customer or an appointment that got a position meanwhile, or whose address was changed meanwhile, is
    left alone (the position of the old address must never land on the corrected one) */
export function placeTargets(t: Task, customers: Customer[], jobs: Job[]): { customerId: string | null; jobIds: string[] } {
  const c = t.customerId ? customers.find((x) => x.id === t.customerId) : undefined;
  const customerId = c && c.lat == null && !c.deleted_at && addrKey(c.address) === t.key ? c.id : null;
  const jobIds = t.jobIds.filter((id) => {
    const j = jobs.find((x) => x.id === id);
    if (!j || j.lat != null || j.deleted_at) return false;
    const owner = j.customer_id ? customers.find((x) => x.id === j.customer_id) : undefined;
    return addrKey(jobPlace(j, owner).address) === t.key;
  });
  return { customerId, jobIds };
}

