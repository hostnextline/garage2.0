/* The booking form's state: the draft (draft.ts), filled from the address bar and from the rows as they arrive on the
   device, and what the screen reads from it (who, what, how long, what is missing). No drawing here. */
import { useEffect, useMemo, useReducer, useRef } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { today as todayOf } from '../../lib/dates';
import { job as jobRow, itemsOf, customer as customerRow, vehicle as vehicleRow, vehiclesOf, activeTrucks, settings, service as serviceRow, blockLoad, windowsOn, jobWindow } from '../../data/select';
import { getRow } from '../../data/store';
import { uuid } from '../../data/sync';
import { can, hasRole, isOwner, myTrucks } from '../../data/auth';
import type { Quote } from '../../data/types';
import { phoneDigits } from '../../lib/text';
import { bookSummary, draftsFromQuote, draftsFromJob, parseChoice, needsMachine } from '../../domain/moment/logic';
import { winLen } from '../../domain/moment/choice';
import type { PlaceValue } from '../../shared/places/AddressField';
import { EMPTY_CAR, carIsEmpty, carErrors } from '../../shared/vehicles/VehicleBits';
import { readAddress, barChoice, openDayOf } from './address';
import { reduce, initialDraft, plannedCars, workOf, workCount, NO_CAR, EMPTY_PLACE, type Draft } from './draft';
import { missing, callerOk, carBad, type CallCarCheck } from './check';
import { carMinutes } from './visit';

/** the address on the customer's file */
export function placeOf(id: string | null): PlaceValue {
  const c = customerRow(id);
  if (!c) return EMPTY_PLACE;
  return { address: c.address || '', unit: c.unit || null, postal_code: c.postal_code || null, lat: c.lat ?? null, lng: c.lng ?? null };
}
/** an appointment's own address (it may differ from the customer's file), else the file's */
function placeOfJob(j: { address: string | null; unit: string | null; postal_code: string | null; lat: number | null; lng: number | null; customer_id: string | null }): { place: PlaceValue; fromJob: boolean } {
  const own = (j.address || '').trim();
  return own ? { place: { address: own, unit: j.unit || null, postal_code: j.postal_code || null, lat: j.lat ?? null, lng: j.lng ?? null }, fromJob: true } : { place: placeOf(j.customer_id), fromJob: false };
}
const GONE = ['cancelled', 'no_show'];

export function useBooking(query: URLSearchParams) {
  const a = useMemo(() => readAddress(query), [query]);
  const wm = windowsOn.value;
  const l = lang.value;
  /* « Plages d'arrivée »: the same texts without the word « bloc » */
  const bt = (k: string, vars?: Record<string, string | number>) => t(`booking.${wm ? 'win.' : ''}${k}`, vars);
  const bar = (windows: boolean) => barChoice(a, { windows, len: winLen(), today: todayOf(), started: (day, b) => blockLoad(day, b).started });

  const [d, act] = useReducer(reduce, null, (): Draft => {
    const known = customerRow(a.customerId) ? a.customerId : null;
    const callCar = a.call ? { id: uuid(), draft: EMPTY_CAR, mode: 'ymm' as const } : null;
    // `vehicle=`: the car already chosen (« Rappels d’huile »), when it is that customer's
    const asked = known && vehicleRow(a.vehicleId)?.customer_id === known ? a.vehicleId! : NO_CAR;
    return initialDraft({ customerId: known, car: callCar && !known ? callCar.id : asked, place: placeOf(known), caller: a.caller, callCar, choice: bar(wm) });
  });

  /* ---------- the garage's way of booking can be known a moment after the first drawing (the settings arrive): the
     address is read again then (`&block=day&win=960` read as a block would be refused) ---------- */
  const modeRead = useRef(wm);
  useEffect(() => {
    if (modeRead.current === wm) return;
    modeRead.current = wm;
    act({ t: 'mode', windows: wm, bar: bar(wm) });
  }, [wm]);

  /* ---------- an estimate becomes a job, once its row is on the device ---------- */
  const quote = a.quoteId ? getRow<Quote>('quotes', a.quoteId) : undefined;
  const fromQuote = useRef(false);
  useEffect(() => {
    if (!quote || fromQuote.current) return;
    fromQuote.current = true;
    act({ t: 'quote', customerId: quote.customer_id ?? null, vehicleId: quote.vehicle_id ?? null, items: draftsFromQuote(quote), notes: quote.notes ?? null, mint: uuid() });
  }, [quote?.id]);

  /* ---------- « Coller »: a copy of an appointment (its rows may arrive after the first drawing) ---------- */
  const copyOf = jobRow(a.copyId);
  const fromCopy = useRef(false);
  useEffect(() => {
    if (!copyOf || fromCopy.current) return;
    fromCopy.current = true;
    const at = placeOfJob(copyOf);
    act({ t: 'copy', customerId: copyOf.customer_id ?? null, place: at.place, fromJob: at.fromJob, vehicleId: copyOf.vehicle_id ?? null, items: draftsFromJob(itemsOf(copyOf.id)),
      problem: copyOf.problem || '', notes: copyOf.notes || '', card: !!copyOf.card_on_file, mint: uuid() });
  }, [copyOf?.id]);
  /* « Plages d'arrivée »: pasted on a time of the agenda's grid (&win=), that window; pasted on a day, the copied
     appointment's own window (a flexible one stays flexible). The picker then checks it with the server for this
     address and this work: a window no longer possible that day is taken off, and said. */
  const openDay = openDayOf(a, wm);
  const copyWin = useRef(false);
  useEffect(() => {
    if (!copyOf || copyWin.current || !wm || !openDay || openDay < todayOf()) return;
    copyWin.current = true;
    const w = parseChoice(openDay, 'day', { windows: true, win: a.win, len: winLen() });
    if (w?.win_start != null) { act({ t: 'presetChoice', choice: w }); return; }
    if (copyOf.win_flex && copyOf.win_start == null) { act({ t: 'presetChoice', choice: { day: openDay, block: 'day', win_flex: true } }); return; }
    // a day with no window yet: the picker; an appointment of the block days: its block's hours are the window it had
    if (copyOf.block === 'day' && copyOf.win_start == null) return;
    const want = jobWindow(copyOf)[0];
    act({ t: 'presetChoice', choice: { day: openDay, block: 'day', win_start: want, win_end: want + winLen() } });
  }, [copyOf?.id, wm, openDay]);

  /* ---------- #/book?customer=ID: the row may arrive after the first drawing (first start, slow network) ---------- */
  const qRow = customerRow(a.customerId);
  useEffect(() => { if (qRow) act({ t: 'queryCustomer', id: qRow.id }); }, [qRow?.id]);

  /* ---------- the customer chosen: their address, their only car, their card ---------- */
  const cust = customerRow(d.customerId);
  useEffect(() => {
    if (!d.customerId || !cust) return;
    act({ t: 'customerRow', id: d.customerId, cars: vehiclesOf(d.customerId).map((v) => v.id), place: placeOf(d.customerId), card: !!cust.card_on_file });
  }, [d.customerId, !!cust]);

  /* ---------- who drives ---------- */
  const mechanicOnly = !can('book') && hasRole('mechanic');
  const active = activeTrucks.value;
  const mine = myTrucks().filter((id) => active.some((x) => x.id === id));
  // the vehicle this person drives, when it is one (with « Routes partagées » every vehicle is everybody's: none)
  const own = mine.length === 1 ? mine[0] : mine.length === 0 && myTrucks().length === 1 ? myTrucks()[0] : null;
  // a walk-in names its vehicle; a mechanic books on his own. When that is not obvious, the person chooses
  const pickFrom = mechanicOnly ? mine : a.walkIn ? active.map((x) => x.id) : [];
  const fixed = mechanicOnly || a.walkIn ? own ?? (pickFrom.length === 1 ? pickFrom[0] : null) : null;
  const truckNeeded = !fixed && pickFrom.length > 1;
  const effTruck = d.truckId || fixed;
  const mayPickTruck = !a.walkIn && !mechanicOnly && (isOwner() || hasRole('office')) && active.length > 1;

  /* ---------- the cars, their work, the time and the price ---------- */
  const needNew = a.call && !d.customerId;
  const belongs = (k: string) => (needNew ? d.callCars.some((c) => c.id === k) : !!d.customerId && vehicleRow(k)?.customer_id === d.customerId);
  const planned = plannedCars(d, belongs);
  const others = planned.filter((c) => c.key !== d.car);
  const cur = workOf(d, d.car);
  const taxes = settings.value.taxes;
  const priceless = (id: string) => serviceRow(id)?.price_cents == null;
  const sum = useMemo(() => bookSummary(cur.items, taxes, { override: cur.dur, priceless }), [cur.items, cur.dur, taxes]);
  const otherSums = others.map((o) => ({ ...o, sum: bookSummary(o.work.items, taxes, { override: o.work.dur, priceless }) }));
  // the time of all the cars together for the moment (one car with nothing yet: the hour a problem alone books)
  const allMinutes = planned.length ? planned.reduce((n, c) => n + carMinutes(c, taxes), 0) : sum.minutes;
  const allTotal = sum.total + otherSums.reduce((n, o) => n + o.sum.total, 0);
  const toConfirm = sum.toConfirm || otherSums.some((o) => o.sum.toConfirm);
  const need = needsMachine([...cur.items, ...others.flatMap((o) => o.work.items)], (id) => !!serviceRow(id)?.needs_machine);

  /* ---------- what is missing ---------- */
  const callCars: CallCarCheck[] = d.callCars.map((c) => ({ id: c.id, state: carIsEmpty(c.draft) ? 'empty' : Object.values(carErrors(c.draft, c.mode)).some(Boolean) ? 'bad' : 'ok', work: workCount(d.work[c.id]) }));
  const carIsBad = (id: string) => callCars.some((c) => c.id === id && carBad(c, callCars.length));
  const badCar = callCars.find((c) => carBad(c, callCars.length))?.id ?? null;
  const quoteJob = quote?.job_id ? jobRow(quote.job_id) : undefined;
  // an estimate already booked is booked once: a second appointment only once the first one was cancelled
  const quoteDone = !!quote && (quote.status === 'converted' || !!quote.job_id) && !(quoteJob && GONE.includes(quoteJob.status));
  const miss = missing({
    walkIn: a.walkIn, quoteDone, customerId: d.customerId, newCaller: needNew, searchKnown: d.searchKnown, callerOk: callerOk(d.caller, phoneDigits),
    callCars, planned: planned.length, truckNeeded, truckId: d.truckId, choice: d.choice
  });

  return {
    a, d, act, l, wm, bt, quote, quoteDone, copyOf, openDay, cust, needNew, belongs, planned, others: otherSums, cur, sum, allMinutes, allTotal, toConfirm, need,
    mechanicOnly, own, pickFrom, truckNeeded, effTruck, mayPickTruck, mayForce: isOwner() || hasRole('office'), badCar, carIsBad, miss
  };
}
export type Booking = ReturnType<typeof useBooking>;
