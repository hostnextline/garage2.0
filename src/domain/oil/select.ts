/* « Rappels d’huile »: the list from this device's copy (redrawn when a visit, a car, a service or the day changes).
   The visits with an oil change and each car's last one are worked out once per change and shared by the list, the
   « Plus » badge and every car line (a customer's file shows several cars: one scan, not one per car). */
import { computed } from '@preact/signals';
import { rowsOf } from '../../data/store';
import { allJobs, servicesList } from '../../data/select';
import type { Customer, InventoryItem, InventoryMove, JobItem, Vehicle } from '../../data/types';
import { lastOilFrom, lastOursByCar, oilJobIds, oilRows, toCall } from './due';
import { deniedJobs } from './followup';
import { currentDay } from './clock';

/** the appointments with an oil change */
const oilJobs = computed(() => oilJobIds(rowsOf<JobItem>('job_items'), servicesList.value, rowsOf<InventoryMove>('inventory_moves'),
  rowsOf<InventoryItem>('inventory_items'), deniedJobs(rowsOf<Vehicle>('vehicles'))));
/** each car's last oil change done by us */
const oursByCar = computed(() => lastOursByCar(allJobs.value, oilJobs.value, rowsOf<Vehicle>('vehicles')));

export const oilList = computed(() => oilRows({
  today: currentDay.value, jobs: allJobs.value, items: rowsOf<JobItem>('job_items'), services: servicesList.value,
  vehicles: rowsOf<Vehicle>('vehicles'), customers: rowsOf<Customer>('customers'), oilJobs: oilJobs.value
}));
/** how many customers to call today (the number on the « Plus » tile) */
export const callCount = computed(() => toCall(oilList.value).length);
/** a car's last oil change (ours or the day its owner gave), for its file */
export function lastOil(v: Vehicle) {
  return lastOilFrom(v, oursByCar.value.get(v.id), currentDay.value);
}
