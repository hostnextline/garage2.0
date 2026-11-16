/* The jobs of each day, indexed once per change of the jobs: the week counts a day's jobs in several places (strip,
   column heads, the day's kind) and must not filter and sort the whole table for each. */
import { computed } from '@preact/signals';
import { allJobs, blocks, dayOrder } from '../../data/select';
import type { Job } from '../../data/types';
import type { Day } from '../../lib/dates';

const byDay = computed(() => {
  const out = new Map<Day, Job[]>();
  for (const j of allJobs.value) {
    const list = out.get(j.day);
    if (list) list.push(j); else out.set(j.day, [j]);
  }
  const order = dayOrder(blocks.value);
  for (const list of out.values()) list.sort(order);
  return out;
});
const NONE: readonly Job[] = [];
/** a day's jobs in the day's order (the same order as jobsOn), cancelled and no-shows included */
export function jobsOfDay(day: Day): readonly Job[] { return byDay.value.get(day) ?? NONE; }
