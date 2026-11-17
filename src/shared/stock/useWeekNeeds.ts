/* The needs of a week from the phone's copy of the data (shared by « Besoins de la semaine » and the card on
   « La journée »). Worked out in a computed signal that reads every table it uses, so a line added to a job, an
   engine sheet confirmed or a service changed while the screen is open shows at once (a memo on the jobs and the
   stock alone missed them). The job lines, the services' parts and the engine sheets are indexed once per run. */
import { useEffect, useMemo } from 'preact/hooks';
import { computed, useComputed } from '@preact/signals';
import { today, addDays, type Day } from '../../lib/dates';
import { allJobs, service, vehicle, inventoryList, trucks } from '../../data/select';
import { can, myTrucks } from '../../data/auth';
import { holdsEveryJob } from '../../domain/stock/scope';
import { rowsOf } from '../../data/store';
import type { EngineSpec, JobItem, ServicePart } from '../../data/types';
import { engineRef, ensureEngineRef } from '../../domain/vehicles/engineRef';
import { sheetOf } from '../../domain/vehicles/sheet';
import { weekNeeds, defaultWeekOf, type WeekNeeds } from '../../domain/stock/needs';

function groupBy<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    const list = m.get(k);
    if (list) list.push(r); else m.set(k, [r]);
  }
  return m;
}

/** the order of a job's lines (the same as `itemsOf` in data/select.ts) */
export const byLineOrder = (a: JobItem, b: JobItem) => a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at));

/** the needs of the week starting on `from` (Sunday): only the days from today on (what is still to come) */
export function useWeekNeeds(from: Day): WeekNeeds {
  useEffect(() => { void ensureEngineRef(); }, []);
  const now = today();
  const start = from < now ? now : from;
  const needs = useMemo(() => computed<WeekNeeds>(() => {
    // each job's lines as `itemsOf` gives them (no deleted line, in the job's order), so ties keep the order of before
    const items = groupBy(rowsOf<JobItem>('job_items').filter((i) => !i.deleted_at), (i) => i.job_id);
    for (const list of items.values()) list.sort(byLineOrder);
    const parts = groupBy(rowsOf<ServicePart>('service_parts').filter((p) => !p.deleted_at), (p) => p.service_id);
    // the first sheet of a key, as `specByKey` finds it
    const specs = new Map<string, EngineSpec>();
    for (const s of rowsOf<EngineSpec>('engine_specs')) if (!s.deleted_at && !specs.has(s.key)) specs.set(s.key, s);
    return {
      ...weekNeeds({
        from: start, to: addDays(from, 6), jobs: allJobs.value, itemsOf: (id) => items.get(id) || [],
        service: (id) => service(id), partsOf: (id) => parts.get(id) || [], vehicle: (id) => vehicle(id),
        spec: (k) => (k ? specs.get(k) : undefined),
        // the sheet the car's file and the job card show (R166): its own, else the one confirmed for a car alike
        sheet: (v) => (v.spec_key && specs.get(v.spec_key)) || sheetOf(v)?.spec,
        refRows: engineRef.value.rows, inventory: inventoryList.value
      }),
      from
    };
  }), [from, start]);
  return needs.value;
}

/** true when this phone holds every truck's appointments (else the needs are its own truck's only) */
export function useHoldsEveryJob(): boolean {
  return holdsEveryJob(can('agenda'), myTrucks(), trucks.value.map((x) => x.id));
}

/** the week to open: this one, or from Thursday the coming one when something is booked in it. Read through a
    computed signal: « Inventaire » re-rendered at every job saved anywhere (it read every job), now only when the
    week itself changes */
export function useDefaultWeek(): Day {
  return useComputed(() => defaultWeekOf(today(), allJobs.value)).value;
}
