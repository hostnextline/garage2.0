/* « Rappels d’huile »: the list from this device's copy (redrawn when a visit, a car or a service changes). */
import { computed } from '@preact/signals';
import { rowsOf } from '../../data/store';
import { allJobs, servicesList } from '../../data/select';
import { today } from '../../lib/dates';
import type { Customer, InventoryItem, InventoryMove, JobItem, Vehicle } from '../../data/types';
import { lastOilOf, oilRows, toCall } from './due';

export const oilList = computed(() => oilRows({
  today: today(), jobs: allJobs.value, items: rowsOf<JobItem>('job_items'), services: servicesList.value,
  vehicles: rowsOf<Vehicle>('vehicles'), customers: rowsOf<Customer>('customers'),
  moves: rowsOf<InventoryMove>('inventory_moves'), stock: rowsOf<InventoryItem>('inventory_items')
}));
/** how many customers to call today (the number on the « Plus » tile) */
export const callCount = computed(() => toCall(oilList.value).length);
/** a car's last oil change (ours or the day its owner gave), for its file */
export function lastOil(v: Vehicle) {
  return lastOilOf(v, { today: today(), jobs: allJobs.value, items: rowsOf<JobItem>('job_items'), services: servicesList.value,
    moves: rowsOf<InventoryMove>('inventory_moves'), stock: rowsOf<InventoryItem>('inventory_items') });
}
