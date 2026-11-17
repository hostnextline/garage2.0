/* The booking form as data: what the person has typed, car by car. Pure (no Preact, no signals, no server): the screen
   keeps one Draft and changes it only through `reduce`, so every rule below is a plain unit test (draft.test.ts).

   The work is kept PER CAR, in `work`, keyed by the car: a vehicle on file, a car of a new caller (its id is the one
   its file will get), or NO_CAR (nothing chosen yet). Each entry has its own job id, made once: a car booked by a first
   tap leaves the plan for good, and a second tap after a refusal sends the other cars with their own ids, never an id
   already used (`exists`). */
import type { ItemDraft, FarInfo } from '../../domain/moment/logic';
import type { BlockChoice, VehicleKind } from '../../domain/moment/choice';
import { sameAsk, type SeenFor } from './far';
import type { PlaceValue } from '../../shared/places/AddressField';
import type { AddDraft, AddMode } from '../../shared/vehicles/VehicleBits';

/** the key of the work typed while no car is chosen */
export const NO_CAR = '';
export interface Work { jobId: string; items: ItemDraft[]; dur: number | null; problem: string }
/** a car of a new caller, not saved yet: its id is already the one its file will have */
export interface CallCar { id: string; draft: AddDraft; mode: AddMode }
export interface Caller { first: string; last: string; phone: string }
/** where the address of the appointment comes from: the customer's file, typed for this appointment, a copied job */
export type PlaceFrom = 'none' | 'file' | 'typed' | 'job';
export const EMPTY_PLACE: PlaceValue = { address: '', unit: null, postal_code: null, lat: null, lng: null };

export interface Draft {
  customerId: string | null;
  /** the car on screen (its work is the one the services panel shows) */
  car: string;
  work: Record<string, Work>;
  caller: Caller;
  callCars: CallCar[];
  /** a new caller: « Chercher un client qu'on connaît » is open instead of the name and number */
  searchKnown: boolean;
  /** « Réserver » was tapped once: the fields to fix say so */
  tried: boolean;
  place: PlaceValue;
  /** the customer whose file the address was taken from (or kept for) */
  placeOwner: string | null;
  placeFrom: PlaceFrom;
  notes: string;
  /** « carte au dossier »: null until the customer's file (or a copy) says it */
  card: boolean | null;
  choice: BlockChoice | null;
  /** the person picked a moment (the address bar is not read again when the garage's mode arrives late) */
  touched: boolean;
  /** a new number asks the picker for its suggestions again */
  reload: number;
  blockError: string | null;
  far: FarInfo | null;
  /** the picker scored the moment chosen (far or not), when, and for which address, work and vehicle (m2): « Réserver »
      need not ask the server again while that is still what it would ask (booking-r2-1) */
  farSeen: SeenFor | null;
  truckId: string | null;
  kind: VehicleKind;
  /** the appointments this form booked (or kept on the phone to send), for the cars that left it. An estimate goes
      with the first one only, and its own appointment does not make the estimate « already booked » for the cars
      still to book (booking-a-08 with several cars) */
  bookedIds: string[];
  /** the new caller's file this form made: « Changer » back to the caller keeps what was said for them */
  madeId: string | null;
  /** the person typed or chose something here (rows arriving, the address bar, the calendar's own news do not count):
      leaving would lose it (x-reactivity-19: the incoming-call banner asks first) */
  typed: boolean;
}

export type Action =
  | { t: 'items'; items: ItemDraft[]; mint: string }
  | { t: 'dur'; dur: number | null; mint: string }
  | { t: 'problem'; text: string; mint: string }
  | { t: 'notes'; text: string }
  | { t: 'car'; key: string | null; mint: string }
  | { t: 'pickCustomer'; id: string | null }
  | { t: 'customerRow'; id: string; cars: string[]; place: PlaceValue; card: boolean }
  | { t: 'queryCustomer'; id: string }
  | { t: 'made'; customerId: string; cars: string[] }
  | { t: 'place'; place: PlaceValue }
  | { t: 'placeFile'; place: PlaceValue }
  | { t: 'caller'; patch: Partial<Caller> }
  | { t: 'searchKnown'; on: boolean }
  | { t: 'tried' }
  | { t: 'addCallCar'; id: string; mint: string }
  | { t: 'removeCallCar' }
  | { t: 'callCar'; patch?: Partial<AddDraft>; mode?: AddMode }
  | { t: 'quote'; customerId: string | null; vehicleId: string | null; items: ItemDraft[]; notes: string | null; mint: string }
  | { t: 'copy'; customerId: string | null; place: PlaceValue; fromJob: boolean; vehicleId: string | null; items: ItemDraft[]; problem: string; notes: string; card: boolean; mint: string }
  | { t: 'choice'; choice: BlockChoice }
  | { t: 'presetChoice'; choice: BlockChoice }
  | { t: 'clearChoice' }
  | { t: 'mode'; bar: BlockChoice | null; windows: boolean }
  | { t: 'kind'; kind: VehicleKind }
  | { t: 'far'; far: FarInfo | null; seen?: SeenFor | null }
  | { t: 'truck'; id: string | null }
  | { t: 'card'; on: boolean }
  | { t: 'refused'; banner: string | null; windowGone?: boolean; again?: boolean }
  | { t: 'booked'; keys: string[]; ids: string[] };

export function initialDraft(o: { customerId: string | null; car: string; place: PlaceValue; caller: Caller; callCar: CallCar | null; choice: BlockChoice | null }): Draft {
  return {
    customerId: o.customerId, car: o.car, work: {}, caller: o.caller, callCars: o.callCar ? [o.callCar] : [], searchKnown: false, tried: false,
    place: o.place, placeOwner: o.customerId, placeFrom: o.customerId ? 'file' : 'none', notes: '', card: null,
    choice: o.choice, touched: false, reload: 0, blockError: null, far: null, farSeen: null, truckId: null, kind: null, bookedIds: [], madeId: null, typed: false
  };
}

/* ---------- the work of a car ---------- */
export const hasWork = (w: Pick<Work, 'items' | 'problem'> | undefined): boolean => !!w && (w.items.length > 0 || w.problem.trim() !== '');
const blank = (jobId: string): Work => ({ jobId, items: [], dur: null, problem: '' });
/** the work of a car (an empty one when nothing was typed for it) */
export function workOf(d: Draft, key: string): Work { return d.work[key] || blank(''); }
/** how many things a car has to do (its lines, and its problem) */
export const workCount = (w: Work | undefined): number => (w ? w.items.length + (w.problem.trim() ? 1 : 0) : 0);

function setWork(d: Draft, key: string, patch: Partial<Work>, mint: string): Draft {
  const w = d.work[key] || blank(mint);
  return { ...d, work: { ...d.work, [key]: { ...w, ...patch } } };
}
/** the work of `from` goes onto `to` (after the lines `to` already has); `from` is left with nothing */
function moveWork(work: Record<string, Work>, from: string, to: string): Record<string, Work> {
  const a = work[from];
  if (from === to || !hasWork(a) && a?.dur == null) return work;
  const next = { ...work };
  delete next[from];
  const b = work[to];
  if (!b || (!hasWork(b) && b.dur == null)) next[to] = { ...a!, jobId: b?.jobId || a!.jobId };
  else {
    const problem = [b.problem.trim(), a!.problem.trim()].filter(Boolean).join('\n');
    next[to] = { ...b, items: [...b.items, ...a!.items], problem, dur: b.dur ?? a!.dur };
  }
  return next;
}
/** only the work of these cars stays (plus the one on screen) */
function keepOnly(work: Record<string, Work>, keep: (key: string) => boolean): Record<string, Work> {
  return Object.fromEntries(Object.entries(work).filter(([k]) => keep(k)));
}

/** choosing a car. From « no car », the work in hand goes with it (an estimate's lines, services ticked before the
    car); between two cars, each keeps its own work */
function chooseCar(d: Draft, key: string): Draft {
  if (key === d.car) return d;
  const work = d.car === NO_CAR ? moveWork(d.work, NO_CAR, key) : d.work;
  return { ...d, car: key, work };
}

/* ---------- the customer ---------- */
/** the customer's row is on the device: their address (unless one was typed for this appointment before the customer
    was known: « C'est lui » keeps the address said during the call), their only car, their card */
function customerRow(d: Draft, a: Extract<Action, { t: 'customerRow' }>): Draft {
  if (d.customerId !== a.id) return d;
  let next = d;
  if (d.placeOwner !== a.id) {
    const keep = (d.placeFrom === 'typed' || d.placeFrom === 'job') && d.place.address.trim() !== '';
    next = keep ? { ...next, placeOwner: a.id } : { ...next, place: a.place, placeOwner: a.id, placeFrom: 'file' };
  }
  if (!a.cars.includes(next.car)) {
    const to = a.cars.length === 1 ? a.cars[0] : NO_CAR;
    next = { ...next, car: to, work: moveWork(next.work, next.car, to) };
  }
  // the work of cars that are not this customer's is not theirs to book
  next = { ...next, work: keepOnly(next.work, (k) => k === NO_CAR || k === next.car || a.cars.includes(k)) };
  return next.card == null ? { ...next, card: a.card } : next;
}

/** what only a person does on the form (never the rows arriving, the address bar, the picker's own news, nor the car
    chosen by itself for a customer with one car) */
const BY_PERSON: ReadonlySet<Action['t']> = new Set<Action['t']>(['items', 'dur', 'problem', 'notes', 'pickCustomer', 'place', 'placeFile', 'caller',
  'searchKnown', 'addCallCar', 'removeCallCar', 'callCar', 'choice', 'kind', 'truck', 'card']);

export function reduce(d: Draft, a: Action): Draft {
  const next = step(d, a);
  return next !== d && !next.typed && BY_PERSON.has(a.t) ? { ...next, typed: true } : next;
}

function step(d: Draft, a: Action): Draft {
  switch (a.t) {
    case 'items': return setWork(d, d.car, { items: a.items }, a.mint);
    case 'dur': return setWork(d, d.car, { dur: a.dur }, a.mint);
    case 'problem': return setWork(d, d.car, { problem: a.text }, a.mint);
    case 'notes': return { ...d, notes: a.text };
    case 'car': return chooseCar(d, a.key ?? NO_CAR);
    case 'pickCustomer': {
      if (a.id === d.customerId) return d;
      // the work on screen stays; the other cars' work was for the other customer
      const work = keepOnly(d.work, (k) => k === d.car || k === NO_CAR);
      // an address typed before anybody was chosen (a new caller, then « C'est lui ») stays; one changed for another
      // customer goes back to the file of the one chosen now
      if (a.id) return { ...d, customerId: a.id, work, placeFrom: d.customerId ? 'file' : d.placeFrom };
      // back to nobody: a new caller is back to their first car; the address and the card go with the customer. The
      // caller's own file, made by a first try: the address said during the call stays (it is theirs, and the next
      // try sends it again)
      const to = d.callCars[0]?.id ?? NO_CAR;
      const back = { ...d, customerId: null, car: to, work: moveWork(work, d.car, to), placeOwner: null, card: null };
      if (d.customerId && d.customerId === d.madeId && d.place.address.trim()) return { ...back, placeFrom: 'typed' };
      return { ...back, place: EMPTY_PLACE, placeFrom: 'none' };
    }
    case 'customerRow': return customerRow(d, a);
    case 'queryCustomer': return d.customerId ? d : { ...d, customerId: a.id };
    // a new caller's file and cars are made: the screen now has this customer (a refused moment can be chosen again
    // without making them twice)
    case 'made': return { ...d, customerId: a.customerId, madeId: a.customerId, placeOwner: a.customerId, car: a.cars.includes(d.car) ? d.car : NO_CAR, work: a.cars.includes(d.car) ? d.work : moveWork(d.work, d.car, NO_CAR) };
    case 'place': return { ...d, place: a.place, placeFrom: 'typed' };
    case 'placeFile': return { ...d, place: a.place, placeFrom: 'file' };
    case 'caller': return { ...d, caller: { ...d.caller, ...a.patch } };
    case 'searchKnown': return { ...d, searchKnown: a.on };
    case 'tried': return d.tried ? d : { ...d, tried: true };
    case 'addCallCar': {
      const car: CallCar = { id: a.id, draft: { year: '', make: '', model: '', vin: '', extra: {} }, mode: 'ymm' };
      return { ...d, callCars: [...d.callCars, car], car: a.id, work: { ...d.work, [a.id]: blank(a.mint) } };
    }
    case 'removeCallCar': {
      const rest = d.callCars.filter((c) => c.id !== d.car);
      if (!rest.length || rest.length === d.callCars.length) return d;
      const work = { ...d.work };
      delete work[d.car];
      return { ...d, callCars: rest, car: rest[0].id, work };
    }
    case 'callCar':
      return { ...d, callCars: d.callCars.map((c) => (c.id === d.car ? { ...c, draft: a.patch ? { ...c.draft, ...a.patch } : c.draft, mode: a.mode ?? c.mode } : c)) };
    case 'quote': {
      // the estimate's row may come after something was typed: its lines go after them, nothing is lost
      const car = a.vehicleId ?? d.car;
      const moved = d.car === car ? d.work : moveWork(d.work, d.car, car);
      const cur = moved[car] || blank(a.mint);
      return { ...d, customerId: a.customerId ?? d.customerId, car, notes: d.notes || a.notes || '', work: { ...moved, [car]: { ...cur, items: [...cur.items, ...a.items] } } };
    }
    case 'copy': {
      const car = a.vehicleId ?? NO_CAR;
      const w = blank(a.mint);
      return {
        ...d, customerId: a.customerId ?? d.customerId, placeOwner: a.customerId ?? d.placeOwner, place: a.place, placeFrom: a.fromJob ? 'job' : 'file',
        car, work: { [car]: { ...w, items: a.items, problem: a.problem } }, notes: a.notes || d.notes, card: a.card
      };
    }
    case 'choice': return { ...d, choice: a.choice, touched: true, blockError: null };
    case 'presetChoice': return d.choice ? d : { ...d, choice: a.choice };
    case 'clearChoice': return { ...d, choice: null };
    // the garage's way of booking became known (or changed) while the form is open: the address is read again when
    // nothing was picked; a moment of the other mode can no longer be booked (the server would refuse it, bad_block)
    case 'mode': {
      if (!d.touched) return { ...d, choice: a.bar };
      const stale = d.choice && (d.choice.block === 'day') !== a.windows;
      return stale ? { ...d, choice: null } : d;
    }
    case 'kind': return { ...d, kind: a.kind, choice: null };
    case 'far': {
      const seen = a.seen ?? null;
      const same = d.farSeen === seen || (!!d.farSeen && !!seen && d.farSeen.day === seen.day && d.farSeen.block === seen.block && d.farSeen.at === seen.at && sameAsk(d.farSeen.ask, seen.ask));
      return d.far === a.far && same ? d : { ...d, far: a.far, farSeen: seen };
    }
    case 'truck': return { ...d, truckId: a.id };
    case 'card': return { ...d, card: a.on };
    // the moment was refused: the picker asks again (R79: every code of BLOCK_REFUSALS, so « Meilleur choix » never
    // offers the block just refused); a window that can no longer be kept is also taken off
    case 'refused': {
      const reload = a.windowGone || a.again ? d.reload + 1 : d.reload;
      return a.windowGone ? { ...d, choice: null, blockError: a.banner, reload } : { ...d, blockError: a.banner, reload };
    }
    // what was booked (or kept on the phone to be sent) leaves the screen: the rest can be tried again in another moment
    case 'booked': return { ...d, work: keepOnly(d.work, (k) => !a.keys.includes(k)), bookedIds: [...d.bookedIds, ...a.ids.filter((id) => !d.bookedIds.includes(id))] };
  }
}

/* ---------- reading the draft ---------- */
/** the cars to book, the car on screen first, then the others in the order their work was typed. `belongs`: the key
    is a car this appointment may name (the customer's, or a new caller's typed car); NO_CAR and the car on screen always
    may (what is shown is what is booked: a car whose file is not on this device goes without its file, as before) */
export interface PlannedCar { key: string; jobId: string; work: Work }
export function plannedCars(d: Draft, belongs: (key: string) => boolean): PlannedCar[] {
  const keys = [d.car, ...Object.keys(d.work).filter((k) => k !== d.car)];
  return keys.filter((k) => (k === NO_CAR || k === d.car || belongs(k)) && hasWork(d.work[k])).map((k) => ({ key: k, jobId: d.work[k].jobId, work: d.work[k] }));
}
/** the other cars of the appointment that have work (shown as « Aussi : … ») */
export function otherCars(d: Draft, belongs: (key: string) => boolean): PlannedCar[] {
  return plannedCars(d, belongs).filter((c) => c.key !== d.car);
}
