/* The blocks calendar (matin, après-midi, soir over two weeks): how a cell looks and how the arrows move. Pure: the
   loads come from the phone's copy (blockLoad), tested in blockCells.test.ts. */
import { cellState, type LoadLike } from '../../domain/moment/logic';
import { fitsJob, type KindAsk } from './vehicles';

export const keyOf = (day: string, block: string): string => `${day}|${block}`;

/** a block of a day for this booking: only the vehicles that can take the job count (a tire-machine job never sees the
    car's room, « Voiture » never the truck's, a vehicle chosen by hand only its own). `kinds` false (the garage has one
    kind): the kind asked says nothing, every vehicle counts as before. */
export function blockCell(load: LoadLike, dur: number, drive: number, a: KindAsk & { exclude?: string | null; kinds: boolean }) {
  const lanes = a.kinds ? load.trucks.filter((x) => fitsJob(x.truck, a)) : load.trucks;
  return cellState({ ...load, trucks: lanes }, dur, drive, { truckId: a.truckId, exclude: a.exclude, unknownMin: drive });
}

/** the arrows in the calendar: the index reached from `i` (one row per day, `perRow` blocks a row), kept inside;
    null for a key that does not move */
export function cellMove(i: number, key: string, perRow: number, count: number): number | null {
  let j: number;
  if (key === 'ArrowRight') j = i + 1;
  else if (key === 'ArrowLeft') j = i - 1;
  else if (key === 'ArrowDown') j = i + perRow;
  else if (key === 'ArrowUp') j = i - perRow;
  else if (key === 'Home') j = i - (i % perRow);
  else if (key === 'End') j = i - (i % perRow) + perRow - 1;
  else return null;
  return Math.max(0, Math.min(count - 1, j));
}
