/* Réserver (also « Appel entrant ») — one page, not a wizard: the customer, the car and the address, the services, the problem, the block,
   then « Réserver ». The server picks the truck and the order of the stops.
   #/book?customer=ID · ?day=YYYY-MM-DD&block=am · ?quote=ID (an estimate becomes a job) · ?walkin=1 (the job starts now)
   · ?copy=JOB (« Coller » in the agenda: the same customer, car, address, work, problem and notes, in the block chosen)
   · ?call=1&start=address|car|job&phone=… (« Appel entrant », somebody new: the panels in the order of the call, the name
   asked last; the customer and the car are made when « Réserver » is tapped, then the booking; « Ajouter une autre voiture »:
   several cars, each with its own work, one appointment each in the same block).
   « Plages d'arrivée » (the garage books by 4-hour windows): the block is 'day' and the choice carries the window, or
   « flexible »; ?day=…&block=day opens that day in the picker (&win=840 or &flex=1: already chosen). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CalendarCheck, Wrench, RotateCcw, Search, UserPlus, Plus, Trash2 } from 'lucide-preact';
import { navigate, type ScreenProps } from '../../platform/router';
import { wide } from '../../platform/media';
import { t, lang } from '../../lib/i18n';
import { duration, today as todayOf } from '../../lib/dates';
import { money } from '../../lib/money';
import { job as jobRow, itemsOf, customer as customerRow, customerName, vehicle as vehicleRow, vehiclesOf, vehicleLabel, activeTrucks, truckLabel, truckColor, settings, service as serviceRow, blockLoad, windowsOn, jobWindow } from '../../data/select';
import { getRow } from '../../data/store';
import { bookJob, walkIn as walkInJob, errorMessage, saveCustomer, saveVehicle, type BookInput } from '../../data/api';
import { uuid } from '../../data/sync';
import { can, hasRole, isOwner, myTrucks } from '../../data/auth';
import type { Quote } from '../../data/types';
import { Page, Panel, Field, Input, PhoneInput, Textarea, Check, Chips, Stepper, Button, BigStep, Banner, Kv, Money, toast, ask } from '../../ui';
import { CustomerPicker } from '../../shared/customers/CustomerPicker';
import { VehiclePicker } from '../../shared/vehicles/VehiclePicker';
import { AddressField, type PlaceValue } from '../../shared/places/AddressField';
import { CarForm, EMPTY_CAR, carIsEmpty, carErrors, carRow, type AddDraft, type AddMode } from '../../shared/vehicles/VehicleBits';
import { customerPatch, emptyDraft } from '../../shared/customers/CustomerFields';
import { phoneOwners } from '../../shared/customers/dupes';
import { customersList } from '../../data/select';
import { phoneDigits } from '../../lib/text';
import type { CallStart } from './CallScreen';
import { OilHint } from '../../shared/jobs/CarFirst';
import { ServicePicker } from '../../shared/moment/ServicePicker';
import { BlockPicker, choiceWords, type BlockChoice, type VehicleKind, type FarInfo } from '../../shared/moment/BlockPicker';
import { winLen } from '../../domain/moment/choice';
import { broad } from './screen';
import { carDraftLabel, missingPiece, bookSummary, toItemInputs, draftsFromQuote, draftsFromJob, parseChoice, refusalCode, clampDuration, needsMachine, choicePayload, farQuestion, BLOCK_REFUSALS, type ItemDraft } from '../../domain/moment/logic';
import { blockPhrase } from '../../domain/moment/words';
import { notifyCustomer, wantsText } from '../../shared/moment/notify';
import { forgetRefusal, noLongWaitOffline } from '../../domain/moment/outbox';
import '../../shared/moment/booking.css';

/** the refusals « Réserver quand même » can go past */
const FULL = ['block_full', 'truck_full'];

const EMPTY_PLACE: PlaceValue = { address: '', unit: null, postal_code: null, lat: null, lng: null };
function placeOf(id: string | null): PlaceValue {
  const c = customerRow(id);
  if (!c) return EMPTY_PLACE;
  return { address: c.address || '', unit: c.unit || null, postal_code: c.postal_code || null, lat: c.lat ?? null, lng: c.lng ?? null };
}
/** a car of a new caller, not saved yet: its id is already the one its file will have */
interface CallCar { id: string; draft: AddDraft; mode: AddMode }
const samePlace = (a: PlaceValue, b: PlaceValue) => (a.address || '').trim() === (b.address || '').trim() && (a.unit || '') === (b.unit || '');

/** a new address (#/book → #/book?customer=…, a second booking) starts a fresh form: the frame keeps the screen when
    only the query changes */
export default function BookScreen(p: ScreenProps) {
  return <BookForm key={p.query.toString()} {...p} />;
}

function BookForm({ query }: ScreenProps) {
  const isWalkIn = query.get('walkin') === '1';
  const quoteId = query.get('quote');
  const l = lang.value;
  /* « Plages d'arrivée »: a day and its window instead of a block; the same texts without the word « bloc » */
  const wm = windowsOn.value;
  const bt = (k: string, vars?: Record<string, string | number>) => t(`booking.${wm ? 'win.' : ''}${k}`, vars);
  const quote = quoteId ? getRow<Quote>('quotes', quoteId) : undefined;

  const qCustomer = query.get('customer');
  /* « Appel entrant »: a new caller, the panels in the order of the call */
  const isCall = query.get('call') === '1';
  const callStart = (['address', 'car', 'job'].includes(query.get('start') || '') ? query.get('start') : 'address') as CallStart;
  // the name GoHighLevel knows for this number (the « Appel entrant » banner): first word = first name
  const [caller, setCaller] = useState(() => { const n = (query.get('name') || '').trim().split(/\s+/).filter(Boolean); return { first: n[0] || '', last: n.slice(1).join(' '), phone: query.get('phone') || '' }; });
  // the caller's cars (one, or several with « Ajouter une autre voiture »): each has its own work, like a known customer's cars
  const [cars, setCars] = useState<CallCar[]>(() => [{ id: uuid(), draft: EMPTY_CAR, mode: 'ymm' }]);
  const [callTried, setCallTried] = useState(false);
  const [searchKnown, setSearchKnown] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(() => (customerRow(qCustomer) ? qCustomer : null));
  // `vehicle=`: the car already chosen (« Rappels d’huile »), when it is that customer's
  const [vehicleId, setVehicleId] = useState<string | null>(() => (isCall && !customerRow(qCustomer) ? cars[0].id : qCustomer && vehicleRow(query.get('vehicle'))?.customer_id === qCustomer ? query.get('vehicle') : null));
  const [place, setPlace] = useState<PlaceValue>(() => placeOf(qCustomer));
  const [placeOwner, setPlaceOwner] = useState<string | null>(() => (customerRow(qCustomer) ? qCustomer : null));
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [problem, setProblem] = useState('');
  const [notes, setNotes] = useState('');
  /* the moment the address says: a block (« Réserver dans ce bloc »), unless it has started meanwhile; with « Plages
     d'arrivée » a day and its window (&win=, a unit of the agenda's time grid) or « flexible ». A day alone, and a
     copy (its window is decided below), open in the picker without a choice. */
  const barChoice = (windows: boolean): BlockChoice | null => {
    const c = isWalkIn ? null : parseChoice(query.get('day'), query.get('block'), { windows, win: query.get('win'), flex: query.get('flex'), len: winLen() });
    if (!c) return null;
    if (c.block === 'day') return c.day >= todayOf() && (c.win_start != null || c.win_flex) && !query.get('copy') ? c : null;
    return !blockLoad(c.day, c.block).started ? c : null;
  };
  const [choice, setChoice] = useState<BlockChoice | null>(() => barChoice(wm));
  /* the garage's way of booking can be known a moment after the first drawing (the settings arrive, the demo switches
     the windows on): the address is read again then. Before this, `&block=day&win=960` was read as a block, refused,
     and the screen opened with nothing chosen (or with whatever was tapped next). */
  const modeRead = useRef(wm);
  const touched = useRef(false);
  useEffect(() => {
    if (modeRead.current === wm) return;
    modeRead.current = wm;
    if (!touched.current) setChoice(barChoice(wm));
  }, [wm]);
  // « Plages d'arrivée »: the day the address says, opened in the picker
  const openDay = wm && !isWalkIn ? parseChoice(query.get('day'), query.get('block'), { windows: true })?.day ?? null : null;
  // asks the picker for its suggestions again (a window the server refused)
  const [reload, setReload] = useState(0);
  const [truckId, setTruckId] = useState<string | null>(null);
  const [durOverride, setDurOverride] = useState<number | null>(null);
  const [card, setCard] = useState<boolean | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  // « garde-route »: the moment chosen puts too much road in the truck's day (said by the block picker)
  const [far, setFar] = useState<FarInfo | null>(null);
  // the car or the truck (the switch above the moments offered); work for the tire machine is the truck's only
  const [kind, setKind] = useState<VehicleKind>(null);
  // one id for this booking: tapped twice after a lost answer, the server books it once
  const [jobId] = useState(() => uuid());
  /* each car of the customer has its own work: the other cars' services, kept while another car is chosen */
  const [carts, setCarts] = useState<Record<string, { items: ItemDraft[]; dur: number | null }>>({});
  // one id per car (a second tap after a lost answer books each car once)
  const ids = useRef<Record<string, string>>({});
  const idOf = (vid: string | null) => (vid === vehicleId || vid == null ? jobId : (ids.current[vid] ||= uuid()));
  const chooseVehicle = (id: string | null) => {
    if (id === vehicleId) return;
    const next = { ...carts };
    if (vehicleId && (items.length || durOverride != null)) next[vehicleId] = { items, dur: durOverride }; else if (vehicleId) delete next[vehicleId];
    const back = id ? next[id] : undefined;
    if (id) delete next[id];
    setCarts(next);
    setItems(back?.items || []);
    setDurOverride(back?.dur ?? null);
    setVehicleId(id);
  };
  const blockPanel = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLElement>(null);
  // two columns on a computer; with « Plages d'arrivée » only when the time calendar has room beside the form
  const isWide = wide.value && (!wm || isWalkIn || broad.value);
  // computer: the right column stays in view; its height follows where it starts on the screen, so « Réserver » is
  // always visible (before the page scrolls, the column starts lower)
  useEffect(() => {
    const el = side.current;
    if (!isWide || !el) return;
    let raf = 0;
    const update = () => { raf = 0; el.style.setProperty('--side-top', `${Math.max(0, Math.round(el.getBoundingClientRect().top))}px`); };
    const later = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    return () => { window.removeEventListener('scroll', later); window.removeEventListener('resize', later); if (raf) cancelAnimationFrame(raf); };
  }, [isWide]);
  /* « Plages d'arrivée » on a computer: the time calendar is taller than the screen can be, so the right column is as
     tall as it needs and the page scrolls; it stays in view by its bottom (a column taller than the window sticks
     where its last line shows, above the « Réserver » bar) */
  const winWide = isWide && wm && !isWalkIn;
  useEffect(() => {
    const el = side.current;
    if (!winWide || !el || typeof ResizeObserver !== 'function') return;
    const fit = () => el.style.setProperty('--side-stick', `${Math.min(12, window.innerHeight - el.offsetHeight - 108)}px`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [winWide]);

  /* ---------- an estimate becomes a job (once its row is on the device) ---------- */
  const fromQuote = useRef(false);
  useEffect(() => {
    if (!quote || fromQuote.current) return;
    fromQuote.current = true;
    // the customer's row may come a moment later: the address and the car follow it then
    if (quote.customer_id) setCustomerId(quote.customer_id);
    if (quote.vehicle_id) setVehicleId(quote.vehicle_id);
    setItems(draftsFromQuote(quote));
    if (quote.notes) setNotes((n) => n || quote.notes || '');
  }, [quote?.id]);

  /* ---------- #/book?copy=JOB: a copy of an appointment (its rows may arrive after the first drawing) ---------- */
  const copyOf = jobRow(query.get('copy'));
  const fromCopy = useRef(false);
  useEffect(() => {
    if (!copyOf || fromCopy.current) return;
    fromCopy.current = true;
    if (copyOf.customer_id) { setCustomerId(copyOf.customer_id); setPlaceOwner(copyOf.customer_id); }
    // the appointment's own address (it may differ from the customer's file)
    const own = (copyOf.address || '').trim();
    setPlace(own ? { address: own, unit: copyOf.unit || null, postal_code: copyOf.postal_code || null, lat: copyOf.lat ?? null, lng: copyOf.lng ?? null } : placeOf(copyOf.customer_id));
    if (copyOf.vehicle_id) setVehicleId(copyOf.vehicle_id);
    setItems(draftsFromJob(itemsOf(copyOf.id)));
    if (copyOf.problem) setProblem(copyOf.problem);
    if (copyOf.notes) setNotes(copyOf.notes);
    setCard(!!copyOf.card_on_file);
  }, [copyOf?.id]);
  /* « Plages d'arrivée »: pasted on a time of the agenda's grid (&win=), that window; pasted on a day, the copied
     appointment's own window (a flexible one stays flexible). The picker then checks it with the server for this
     address and this work: a window no longer possible that day is taken off, and said. */
  const copyWin = useRef(false);
  useEffect(() => {
    if (!copyOf || copyWin.current || !wm || !openDay || openDay < todayOf()) return;
    copyWin.current = true;
    const bar = parseChoice(openDay, 'day', { windows: true, win: query.get('win'), len: winLen() });
    if (bar?.win_start != null) { setChoice((c) => c || bar); return; }
    if (copyOf.win_flex && copyOf.win_start == null) { setChoice((c) => c || { day: openDay, block: 'day', win_flex: true }); return; }
    // an appointment of the block days: its block's hours are the window it had; a day with no window yet: the picker
    if (copyOf.block === 'day' && copyOf.win_start == null) return;
    const want = jobWindow(copyOf)[0];
    setChoice((c) => c || { day: openDay, block: 'day', win_start: want, win_end: want + winLen() });
  }, [copyOf?.id, wm, openDay]);

  /* ---------- #/book?customer=ID: the row may arrive after the first drawing (first start, slow network) ---------- */
  const qRow = customerRow(qCustomer);
  const fromQuery = useRef(false);
  useEffect(() => {
    if (fromQuery.current || !qRow) return;
    fromQuery.current = true;
    setCustomerId((cur) => cur || qRow.id);
  }, [qRow?.id]);

  /* ---------- the customer chosen: their address, their only car, their card ---------- */
  const cust = customerRow(customerId);
  useEffect(() => {
    if (!customerId || !cust) return;
    if (placeOwner !== customerId) { setPlace(placeOf(customerId)); setPlaceOwner(customerId); }
    const v = vehicleRow(vehicleId);
    if (!v || v.customer_id !== customerId) { const vs = vehiclesOf(customerId); setVehicleId(vs.length === 1 ? vs[0].id : null); }
    setCard((c) => (c == null ? !!cust.card_on_file : c));
  }, [customerId, !!cust]);
  const pickCustomer = (id: string | null) => {
    setCustomerId(id);
    if (!id) { setVehicleId(isCall ? cars[0].id : null); setPlace(EMPTY_PLACE); setPlaceOwner(null); setCard(null); }
    if (id !== customerId) setCarts({});
  };

  /* ---------- who may choose what ---------- */
  const mechanicOnly = !can('book') && hasRole('mechanic');
  const own = myTrucks().find((id) => activeTrucks.value.some((tr) => tr.id === id)) || myTrucks()[0] || null;
  const mayPickTruck = (isOwner() || hasRole('office')) && activeTrucks.value.length > 1;
  const effTruck = mechanicOnly ? own : isWalkIn ? (truckId || own) : truckId;

  /* ---------- what it takes, what it costs, what is missing ---------- */
  const custLang = (cust?.lang === 'en' ? 'en' : 'fr') as 'fr' | 'en';
  const sum = useMemo(() => bookSummary(items, settings.value.taxes, { override: durOverride, priceless: (id) => serviceRow(id)?.price_cents == null }), [items, durOverride, settings.value.taxes]);
  // the other cars with work (still the customer's), and the time of all the cars together for the block
  // a new caller: the customer counts once a first name and a full number are typed (made when « Réserver » is tapped)
  const needNew = isCall && !customerId;
  const cur = cars.find((c) => c.id === vehicleId) || cars[0];
  const others = Object.entries(carts)
    .filter(([vid, cart]) => cart.items.length > 0 && vid !== vehicleId && (needNew ? cars.some((c) => c.id === vid) : vehicleRow(vid)?.customer_id === customerId))
    .map(([vid, cart]) => ({ vehicleId: vid, items: cart.items, sum: bookSummary(cart.items, settings.value.taxes, { override: cart.dur, priceless: (id) => serviceRow(id)?.price_cents == null }) }));
  const need = needsMachine([...items, ...others.flatMap((o) => o.items)], (id) => !!serviceRow(id)?.needs_machine);
  const allMinutes = sum.minutes + others.reduce((n, o) => n + o.sum.minutes, 0);
  const allTotal = sum.total + others.reduce((n, o) => n + o.sum.total, 0);
  const callerOk = !!caller.first.trim() && !!phoneDigits(caller.phone);
  const workOf = (id: string) => (id === cur.id ? items.length + (problem.trim() ? 1 : 0) : carts[id]?.items.length || 0);
  /* a car typed must be right; one car may stay empty; with several, a car that has work must be said (an empty one
     without work is simply not made) */
  const carBad = (c: CallCar) => (carIsEmpty(c.draft) ? cars.length > 1 && workOf(c.id) > 0 : Object.values(carErrors(c.draft, c.mode)).some(Boolean));
  const carOk = !cars.some(carBad);
  /** a car's name: its file, else what is typed, else « Voiture 2 » */
  const carName = (id: string | null) => {
    const i = cars.findIndex((c) => c.id === id);
    return vehicleLabel(vehicleRow(id)) || (i >= 0 ? carDraftLabel(cars[i].draft) || t('booking.call.carN', { n: i + 1 }) : '') || '—';
  };
  const addCar = () => { const c: CallCar = { id: uuid(), draft: EMPTY_CAR, mode: 'ymm' }; setCars((cs) => [...cs, c]); chooseVehicle(c.id); };
  const removeCar = () => {
    const rest = cars.filter((c) => c.id !== cur.id);
    if (!rest.length) return;
    const next = { ...carts };
    delete next[cur.id];
    const back = next[rest[0].id];
    delete next[rest[0].id];
    setCarts(next); setItems(back?.items || []); setDurOverride(back?.dur ?? null); setCars(rest); setVehicleId(rest[0].id);
  };
  const miss = missingPiece({ customerId: customerId || (needNew && callerOk && carOk ? 'new' : null), items: others.length ? [...items, ...others.flatMap((o) => o.items)] : items, problem, choice }, isWalkIn);

  /* ---------- « Réserver » ---------- */
  const mayForce = isOwner() || hasRole('office');
  /** a new caller: the customer (with the address) and each car typed are made first, once (a car keeps the id it had
      on the screen); the booking follows */
  const made = useRef<{ customer: string; vehicles: string[] } | null>(null);
  const makeCaller = async (): Promise<{ customer: string; vehicles: string[] } | null> => {
    try {
      const m = (made.current ||= { customer: await saveCustomer(customerPatch(emptyDraft({ first_name: caller.first, last_name: caller.last, phone: caller.phone, place }))), vehicles: [] });
      for (const c of cars) if (!carIsEmpty(c.draft) && !m.vehicles.includes(c.id)) { await saveVehicle({ ...carRow(c.draft, m.customer), id: c.id }); m.vehicles.push(c.id); }
      // the screen now has this customer (a refused block can be chosen again without making them twice)
      setPlaceOwner(m.customer); setCustomerId(m.customer); setVehicleId(m.vehicles.includes(cur.id) ? cur.id : null);
      return m;
    } catch (e) {
      toast(errorMessage(e), { kind: 'bad' });
      return null;
    }
  };
  /** the car's file for an appointment: a car on file, or one just made (an empty car of a new caller has none) */
  const realCar = (id: string | null) => (id && (vehicleRow(id) || made.current?.vehicles.includes(id)) ? id : null);
  const submit = async () => {
    if (needNew) setCallTried(true);
    // a car to fix that is not the one on screen: show it
    if (needNew && callerOk && !carOk) { const bad = cars.find(carBad); if (bad && bad.id !== cur.id) chooseVehicle(bad.id); }
    if (miss) return;
    // a moment far from the truck's other stops: asked first (« Choisir un autre moment » leaves the screen as it is)
    const farAsk = isWalkIn ? null : farQuestion(far, choice, 'book');
    if (farAsk && !(await ask(farAsk))) { blockPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    let cid = customerId;
    if (!cid) { const m = await makeCaller(); if (!m) return; cid = m.customer; }
    const vid = realCar(vehicleId);
    const base = {
      id: jobId, customer_id: cid!, vehicle_id: vid, duration_min: sum.minutes, truck_id: effTruck || null,
      problem: problem.trim() || null, notes: notes.trim() || null,
      address: place.address.trim() || null, unit: place.unit?.trim() || null, postal_code: place.postal_code || null, lat: place.lat, lng: place.lng,
      card_on_file: !!card, quote_id: quote?.id ?? null, source: quote ? 'quote' : isWalkIn ? 'walk_in' : 'phone',
      vehicle_kind: need ? null : kind
    };
    const lines = toItemInputs(items);
    if (others.length) { await bookCars(base); return; }
    if (isWalkIn) {
      try {
        const r = await noLongWaitOffline(walkInJob(base, lines), { id: jobId });
        if (r.queued) { toast(t('booking.queuedWalkIn'), { ms: 9000 }); navigate('/', { replace: true }); return; }
        toast(t('booking.doneWalkIn'), { kind: 'ok' });
        navigate(`/job/${r.id}`, { replace: true });
      } catch (e) {
        toast(errorMessage(e), { kind: 'bad' });
        void forgetRefusal('walk_in', (a) => (a.p_job as { id?: string })?.id === jobId);
      }
      return;
    }
    const c = choice!;
    await book({ ...base, ...choicePayload(c) }, lines, c, false);
  };
  /** several cars: one appointment each (the car chosen now first, then the others), in the same block */
  const bookCars = async (base: Omit<BookInput, 'day' | 'block'>) => {
    const cars = [
      ...(items.length || problem.trim() ? [{ vehicleId, items, minutes: sum.minutes }] : []),
      ...others.map((o) => ({ vehicleId: o.vehicleId as string | null, items: o.items, minutes: o.sum.minutes }))
    ];
    const done: string[] = [];
    for (const [k, car] of cars.entries()) {
      const id = idOf(car.vehicleId);
      const job = { ...base, id, vehicle_id: realCar(car.vehicleId), duration_min: car.minutes, quote_id: k === 0 ? base.quote_id : null };
      const lines = toItemInputs(car.items);
      try {
        if (isWalkIn) {
          const r = await noLongWaitOffline(walkInJob(job, lines), { id });
          if (!r.queued) done.push(r.id);
        } else {
          const c = choice!;
          // the same day and the same window (or flexible) for each car
          const r = await bookOne({ ...job, ...choicePayload(c) }, lines, c, false);
          if (!r) break;
          if (r !== 'queued') done.push(r);
        }
      } catch (e) {
        toast(errorMessage(e), { kind: 'bad' });
        void forgetRefusal(isWalkIn ? 'walk_in' : 'book_job', (a) => (a.p_job as { id?: string })?.id === id);
        break;
      }
    }
    const left = cars.length - done.length;
    if (!done.length && left) return;
    toast(left ? bt('cars.partial', { n: done.length, total: cars.length }) : t('booking.cars.done', { n: done.length, when: isWalkIn ? '' : choiceWords(choice!, l) }), { kind: left ? 'bad' : 'ok', ms: 9000 });
    for (const id of done) if (!isWalkIn && wantsText('booking', id)) void notifyCustomer('booking', id, { customerId: base.customer_id, when: smsWhen(choice!) });
    if (!left) navigate(isWalkIn ? '/' : `/agenda/${choice!.day}`, { replace: true });
    // what was booked leaves the screen: the rest can be tried again in another block
    else { setCarts((cs) => { const n = { ...cs }; for (const car of cars) if (car.vehicleId && done.includes(idOf(car.vehicleId))) delete n[car.vehicleId]; return n; }); if (done.includes(jobId)) setItems([]); }
  };
  /** « Réserver quand même »: no window is asked for (the server gives it from where the stop ends up) */
  const forced = (job: BookInput, c: BlockChoice): BookInput => {
    const { win_start: _w, ...rest } = job;
    return { ...rest, ...choicePayload(c, true), force: true };
  };
  /** what is said after the booking: the window asked for; « Réserver quand même »: the day, the app gives the window */
  const whenSaid = (c: BlockChoice, force = false) => choiceWords(force && c.block === 'day' && !c.win_flex ? { day: c.day, block: 'day' } : c, l);
  /** the same above the text to send by hand, for a window only (a block: the sheet as before) */
  const smsWhen = (c: BlockChoice, force = false) => (c.block === 'day' ? whenSaid(c, force) : null);
  /** the window chosen can no longer be kept (`window_full`): said clearly, and the picker asks for that day's hours again */
  const windowGone = () => {
    const msg = t('booking.win.full');
    toast(msg, { kind: 'bad' });
    setChoice(null);
    setBlockError(msg);
    setReload((n) => n + 1);
    blockPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  /** one car in a block; a full block: the owner and the office may book anyway (after a warning). The job id, 'queued', or null */
  const bookOne = async (job: BookInput, lines: ReturnType<typeof toItemInputs>, c: BlockChoice, force: boolean): Promise<string | 'queued' | null> => {
    try {
      const r = await noLongWaitOffline(bookJob(force ? forced(job, c) : job, lines), { id: job.id! });
      return r.queued ? 'queued' : r.id;
    } catch (e) {
      const msg = errorMessage(e);
      const code = refusalCode(e);
      await forgetRefusal('book_job', (a) => (a.p_job as { id?: string })?.id === job.id);
      if (code === 'window_full') { windowGone(); return null; }
      if (!force && FULL.includes(code) && mayForce) {
        const yes = await ask({ title: bt('force.title'), text: `${msg} ${t('booking.force.text')}`, ok: t('booking.force.ok'), cancel: bt('force.cancel'), danger: true });
        if (yes) return bookOne(job, lines, c, true);
      } else toast(msg, { kind: 'bad' });
      if (BLOCK_REFUSALS.includes(code)) { setBlockError(`${msg} ${bt('refusedBlock')}`); blockPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return null;
    }
  };
  /** « Réserver »; a full block: the owner and the office may book anyway, after a warning */
  const book = async (job: BookInput, lines: ReturnType<typeof toItemInputs>, c: BlockChoice, force: boolean): Promise<void> => {
    try {
      const r = await noLongWaitOffline(bookJob(force ? forced(job, c) : job, lines), { id: jobId });
      if (r.queued) { toast(bt('queued'), { ms: 10000 }); navigate(`/agenda/${c.day}`, { replace: true }); return; }
      const wasForced = !!r.data?.forced;
      toast(wasForced ? t('booking.force.done', { when: whenSaid(c, force) }) : t('booking.done', { when: whenSaid(c, force) }), { kind: wasForced ? 'info' : 'ok', ms: wasForced ? 9000 : undefined });
      navigate(`/job/${r.id}`, { replace: true });
      if (wantsText('booking', r.id)) void notifyCustomer('booking', r.id, { customerId: job.customer_id, when: smsWhen(c, force) });
      // the texts are on, but this customer has no cell number: the office can ask for one
      else if (settings.value.messages?.on?.booking && cust && !cust.phone) toast(t('booking.sms.noPhone'));
    } catch (e) {
      const msg = errorMessage(e);
      const code = refusalCode(e);
      if (code === 'window_full') {
        await forgetRefusal('book_job', (a) => (a.p_job as { id?: string })?.id === jobId);
        windowGone();
        return;
      }
      if (!force && FULL.includes(code) && mayForce) {
        await forgetRefusal('book_job', (a) => (a.p_job as { id?: string })?.id === jobId);
        const yes = await ask({ title: bt('force.title'), text: `${msg} ${t('booking.force.text')}`, ok: t('booking.force.ok'), cancel: bt('force.cancel'), danger: true });
        if (yes) return book(job, lines, c, true);
        setBlockError(`${msg} ${bt('refusedBlock')}`);
        blockPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      toast(msg, { kind: 'bad' });
      if (BLOCK_REFUSALS.includes(code)) {
        const hint = bt('refusedBlock');
        setBlockError(msg.toLowerCase().includes(hint.toLowerCase().replace(/\.$/, '')) ? msg : `${msg} ${hint}`);
        blockPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      void forgetRefusal('book_job', (a) => (a.p_job as { id?: string })?.id === jobId);
    }
  };

  /* ---------- words ---------- */
  const title = isWalkIn ? t('booking.titleWalkIn') : quote ? t('booking.titleQuote', { n: quote.number }) : isCall ? t('booking.call.title') : t('booking.title');
  const back = quote ? `/quote/${quote.id}` : qCustomer ? `/customer/${qCustomer}` : isWalkIn ? '/' : isCall ? '/call' : '/agenda';
  const totalWords = allTotal > 0 ? money(allTotal, l) : '';
  const stepSub = miss ? (miss === 'customer' && needNew ? t(callerOk && !carOk ? 'booking.call.missingCar' : 'booking.call.missing') : miss === 'block' ? bt('missing.block') : t(`booking.missing.${miss}`))
    : isWalkIn ? [t('booking.walkInSub'), totalWords].filter(Boolean).join(', ')
    : [choice!.block === 'day' ? choiceWords(choice, l) : blockPhrase(choice!.day, choice!.block, todayOf(), l), totalWords].filter(Boolean).join(', ');
  const step = (
    <BigStep icon={isWalkIn ? <Wrench /> : <CalendarCheck />} label={isWalkIn ? t('booking.confirmWalkIn') : t('booking.confirm')} sub={stepSub}
      disabled={!!miss} onClick={submit} data-tour="book-confirm" data-testid="book-confirm" />
  );
  const quoteConverted = quote && (quote.status === 'converted' || !!quote.job_id);

  const truckChips = (label: string, hint?: string) => (
    <Field label={label} hint={hint} group>
      <Chips label={label} value={[truckId || '']} onValue={(v) => setTruckId(v[0] || null)}
        options={[...(isWalkIn ? [] : [{ value: '', label: t('booking.options.truckAuto') }]), ...activeTrucks.value.map((tr) => ({
          value: tr.id, label: <span class="row" style={{ gap: '6px' }}><span class="book-dot" style={{ background: truckColor(tr.id) }} aria-hidden="true" />{truckLabel(tr.id)}</span>
        }))]} />
    </Field>
  );

  const vehiclePanel = (
    <Panel title={t('booking.vehicle.title')} data-tour="book-vehicle">
      {!customerId ? <p class="muted" style={{ margin: 0 }}>{t('booking.vehicle.firstCustomer')}</p> : (
        <div class="stack">
          <Field label={t('booking.vehicle.vehicle')} group>
            <VehiclePicker customerId={customerId} value={vehicleId} onPick={chooseVehicle} />
            <OilHint vehicleId={vehicleId} />
            {others.length > 0 && (
              <div class="book-cars" data-testid="book-cars">
                <span class="small muted">{t('booking.cars.also')}</span>
                {others.map((o) => (
                  <button key={o.vehicleId} type="button" class="chip" onClick={() => chooseVehicle(o.vehicleId)} data-testid={`book-car-${o.vehicleId}`}>
                    {t('booking.cars.chip', { car: carName(o.vehicleId), n: o.items.length })}
                  </button>
                ))}
              </div>
            )}
          </Field>
          {quote?.vehicle_text && !vehicleId && <p class="faint small" style={{ margin: 0 }}>{t('booking.quote.vehicle', { text: quote.vehicle_text })}</p>}
          <AddressField label={t('booking.vehicle.address')} value={place} onValue={(v) => { setPlace(v); }} />
          <Field label={t('booking.vehicle.unit')} optional class="book-unit">
            <Input value={place.unit} onValue={(v) => setPlace({ ...place, unit: v || null })} autoComplete="address-line2" maxLength={20} />
          </Field>
          {!place.address.trim() && <p class="faint small" style={{ margin: 0 }}>{t('booking.vehicle.noAddress')}</p>}
          {cust && cust.address && !samePlace(place, placeOf(customerId)) && (
            <div><Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setPlace(placeOf(customerId))}>{t('booking.vehicle.reset')}</Button></div>
          )}
        </div>
      )}
    </Panel>
  );

  const servicesPanel = (
    <Panel title={t('booking.services.title')} sub={t('booking.services.sub')} data-tour="book-services">
      {needNew && cars.length > 1 && <p class="book-for" data-testid="book-services-for">{t('booking.call.workFor', { car: carName(cur.id) })}</p>}
      <ServicePicker value={items} onValue={setItems} lang={custLang} allowCustom hideTotal />
      <div class="book-duration" data-testid="book-duration">
        <Field label={t('booking.options.duration')} hint={durOverride != null ? bt('options.durationChanged') : bt('options.durationHint')} group>
          <div class="row-wrap">
            <Stepper value={sum.minutes} min={15} max={720} step={15} label={t('booking.options.duration')} format={(v) => duration(v, l)} onValue={(v) => setDurOverride(clampDuration(v))} />
            {durOverride != null && <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => setDurOverride(null)} data-testid="book-duration-reset">{t('booking.options.durationReset')}</Button>}
          </div>
        </Field>
      </div>
      <div class="book-sum" data-testid="book-services-sum">
        <span class="book-sum-time"><b class="num">{duration(sum.minutes, l)}</b> <span class="muted small">{items.length || durOverride ? t('booking.summary.workLabel') : t('booking.summary.problemOnly')}</span></span>
        <span class="book-sum-money">
          <Money cents={sum.total} large />
          <span class="muted small">{t('booking.summary.taxesLabel')}{sum.toConfirm ? `, ${t('booking.summary.toConfirm')}` : ''}</span>
        </span>
      </div>
    </Panel>
  );

  const notesPanel = (
    <Panel title={t('booking.notes.title')}>
      <div class="stack">
        <Field label={t('booking.notes.problem')} hint={t('booking.notes.problemHint')} optional={items.length > 0}>
          <Textarea value={problem} onValue={setProblem} rows={3} maxLength={2000} data-testid="book-problem" />
        </Field>
        <Field label={t('booking.notes.notes')} hint={t('booking.notes.notesHint')} optional>
          <Textarea value={notes} onValue={setNotes} rows={2} maxLength={2000} />
        </Field>
      </div>
    </Panel>
  );

  const showTruckChoice = isWalkIn ? (!own && activeTrucks.value.length > 0 && (can('book') || isOwner())) : mayPickTruck;
  const optionsPanel = (
    <details class="book-options glass panel" data-testid="book-options">
      <summary><span class="panel-title">{t('booking.options.title')}</span></summary>
      <div class="stack book-options-body">
        {showTruckChoice && truckChips(isWalkIn ? t('booking.options.walkInTruck') : t('booking.options.truck'), isWalkIn ? undefined : t('booking.options.truckHint'))}
        {!isWalkIn && <Check checked={!!card} onChange={setCard} label={t('booking.options.card')} hint={t('booking.options.cardHint')} />}
      </div>
    </details>
  );

  const blockSection = !isWalkIn && (
    <div ref={blockPanel} class="book-block-anchor">
      <Panel title={bt('block.title')} sub={winWide ? undefined : bt('block.sub')} data-tour="book-block">
        {blockError && <div style={{ marginBottom: 'var(--sp-3)' }}><Banner kind="bad">{blockError}</Banner></div>}
        <BlockPicker lat={place.lat} lng={place.lng} address={place.address} duration={allMinutes} truckId={effTruck} value={choice}
          need={need} kind={kind} onKind={(k) => { setKind(k); setChoice(null); }}
          onPick={(c) => { touched.current = true; setChoice(c); setBlockError(null); }} onClear={() => setChoice(null)} openDay={openDay} reload={reload} onFar={setFar} />
      </Panel>
    </div>
  );

  /* ---------- « Appel entrant »: a new caller's panels ---------- */
  const dupes = needNew ? phoneOwners(caller.phone, customersList.value) : [];
  const callerPanel = (
    <Panel title={t('booking.call.who')} sub={t('booking.call.whoSub')} data-testid="call-who">
      <div class="stack">
        <div class="call-names">
          <Field label={t('customers.form.first')} error={callTried && !caller.first.trim() ? t('booking.call.needFirst') : null}>
            <Input value={caller.first} onValue={(v) => setCaller((c) => ({ ...c, first: v }))} autoComplete="off" autoCapitalize="words" data-testid="call-first" />
          </Field>
          <Field label={t('customers.form.last')} optional>
            <Input value={caller.last} onValue={(v) => setCaller((c) => ({ ...c, last: v }))} autoComplete="off" autoCapitalize="words" data-testid="call-last" />
          </Field>
        </div>
        <Field label={t('customers.form.phone')} error={callTried && !phoneDigits(caller.phone) ? t('booking.call.needPhone') : null}>
          <PhoneInput value={caller.phone} onValue={(v) => setCaller((c) => ({ ...c, phone: v }))} />
        </Field>
        {dupes.length > 0 && (
          <Banner kind="warn" title={t('booking.call.already', { name: customerName(dupes[0]) })} data-testid="call-already"
            action={<Button size="sm" onClick={() => pickCustomer(dupes[0].id)} data-testid="call-same">{t('booking.call.isThem')}</Button>}>
            {t('booking.call.alreadyText')}
          </Banner>
        )}
        <div><Button size="sm" variant="ghost" icon={<Search />} onClick={() => setSearchKnown(true)} data-testid="call-search-known">{t('booking.call.searchKnown')}</Button></div>
      </div>
    </Panel>
  );
  const callAddressPanel = (
    <Panel title={t('booking.call.addressTitle')} sub={t('booking.call.addressSub')} data-testid="call-address">
      <div class="stack">
        <AddressField label={t('booking.vehicle.address')} value={place} onValue={setPlace} />
        <Field label={t('booking.vehicle.unit')} optional class="book-unit">
          <Input value={place.unit} onValue={(v) => setPlace({ ...place, unit: v || null })} autoComplete="address-line2" maxLength={20} />
        </Field>
      </div>
    </Panel>
  );
  const callCarPanel = (
    <Panel title={cars.length > 1 ? t('booking.call.carsTitle', { n: cars.length }) : t('booking.call.carTitle')} sub={cars.length > 1 ? t('booking.call.carsSub') : t('booking.call.carSub')} data-testid="call-car">
      <div class="stack">
        {cars.length > 1 && (
          <div class="book-cars" data-testid="call-cars">
            {cars.map((c, i) => (
              <button key={c.id} type="button" class="chip" aria-pressed={c.id === cur.id} onClick={() => chooseVehicle(c.id)} data-testid={`call-car-tab-${i + 1}`}>
                {t('booking.cars.chip', { car: carName(c.id), n: c.id === cur.id ? items.length : carts[c.id]?.items.length || 0 })}
              </button>
            ))}
          </div>
        )}
        <CarForm key={cur.id} value={cur.draft} onPatch={(patch) => setCars((cs) => cs.map((c) => (c.id === cur.id ? { ...c, draft: { ...c.draft, ...patch } } : c)))}
          mode={cur.mode} onMode={(m) => setCars((cs) => cs.map((c) => (c.id === cur.id ? { ...c, mode: m } : c)))} tried={callTried} />
        {callTried && cars.length > 1 && carIsEmpty(cur.draft) && carBad(cur) && <Banner kind="bad" data-testid="call-car-need">{t('booking.call.needCar')}</Banner>}
        <div class="row-wrap">
          <Button size="sm" icon={<Plus />} onClick={addCar} data-testid="call-car-add">{t('booking.call.addCar')}</Button>
          {cars.length > 1 && <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={removeCar} data-testid="call-car-remove">{t('booking.call.removeCar')}</Button>}
        </div>
      </div>
    </Panel>
  );
  const customerPanel = needNew && !searchKnown ? callerPanel : (
    <Panel title={t('booking.customer.title')} data-tour="book-customer">
      <CustomerPicker value={customerId} onPick={pickCustomer} allowCreate autoFocus={!customerId && !quote && !isCall} />
      {needNew && searchKnown && <div style={{ marginTop: 'var(--sp-3)' }}><Button size="sm" variant="ghost" icon={<UserPlus />} onClick={() => setSearchKnown(false)}>{t('booking.call.backNew')}</Button></div>}
    </Panel>
  );
  const block = !isWide ? blockSection : null;
  const callOrder = callStart === 'car' ? [callCarPanel, servicesPanel, callAddressPanel, block, notesPanel, customerPanel]
    : callStart === 'job' ? [servicesPanel, callAddressPanel, block, callCarPanel, notesPanel, customerPanel]
    : [callAddressPanel, block, servicesPanel, callCarPanel, notesPanel, customerPanel];

  const summaryPanel = (withStep: boolean) => (
    <Panel title={t('booking.summary.title')} class="book-summary">
      <Kv items={[
        [t('booking.summary.customer'), cust ? [customerName(cust), vehicleLabel(vehicleRow(vehicleId))].filter(Boolean).join(', ') : needNew && caller.first.trim() ? [`${caller.first} ${caller.last}`.trim(), carDraftLabel(cur.draft) || (cars.length > 1 ? carName(cur.id) : '')].filter(Boolean).join(', ') : null],
        [t('booking.summary.when'), isWalkIn ? t('booking.walkInSub') : choice ? choiceWords(choice, l) : bt('summary.noBlock')],
        [t('booking.services.title'), items.length ? `${t('booking.summary.services', { n: items.length })}, ${t('booking.summary.work', { d: duration(sum.minutes, l) })}` : problem.trim() ? t('booking.summary.problemOnly') : t('booking.summary.noWork')],
        ...others.map((o) => [carName(o.vehicleId), `${t('booking.summary.services', { n: o.items.length })}, ${t('booking.summary.work', { d: duration(o.sum.minutes, l) })}`] as [string, string]),
        [t('booking.summary.truckLabel'), effTruck ? truckLabel(effTruck) : null]
      ]} />
      <div class="book-total">
        <Money cents={allTotal} large />
        <span class="muted small">{t('booking.summary.taxesLabel')}{sum.toConfirm ? `, ${t('booking.summary.toConfirm')}` : ''}</span>
      </div>
      {withStep && step}
    </Panel>
  );

  return (
    <Page title={title} sub={isWalkIn ? t('booking.subWalkIn') : bt('sub')} back={back} help={bt('help')} wide={isWide} data-testid="book-screen">
      {copyOf && <Banner kind="info" title={t('booking.copy.title', { n: copyOf.number })} data-testid="book-copy">{t('booking.copy.text')}</Banner>}
      {quote && (
        <Banner kind={quoteConverted ? 'warn' : 'info'} title={t('booking.quote.from', { n: quote.number })}
          action={quoteConverted && quote.job_id ? <Button size="sm" href={`#/job/${quote.job_id}`}>{t('booking.quote.open')}</Button> : undefined}>
          {quoteConverted ? t('booking.quote.converted') : [
            quote.contact_name ? t('booking.quote.contact', { name: quote.contact_name }) : '',
            quote.vehicle_text ? t('booking.quote.vehicle', { text: quote.vehicle_text }) : ''
          ].filter(Boolean).map((x) => <span key={x} class="book-quote-line">{x}</span>)}
        </Banner>
      )}
      {quoteId && !quote && <Banner kind="warn">{t('booking.quote.missing')}</Banner>}
      {mechanicOnly && own && <Banner kind="info">{t('booking.mechanicTruck', { name: truckLabel(own) })}</Banner>}
      <div class={`book${isWide ? ' book-wide' : ''}${winWide ? ' is-win' : ''}`}>
        <div class="book-main">
          {needNew ? <>{callOrder}{(showTruckChoice || !isWalkIn) && optionsPanel}{winWide && summaryPanel(false)}</> : <>
            {customerPanel}
            {vehiclePanel}
            {servicesPanel}
            {notesPanel}
            {(showTruckChoice || !isWalkIn) && optionsPanel}
            {!isWide && blockSection}
            {winWide && summaryPanel(false)}
          </>}
        </div>
        {isWide && (
          <aside ref={side} class="book-side" aria-label={t('booking.summary.title')}>
            {blockSection}
            {!winWide && summaryPanel(true)}
          </aside>
        )}
      </div>
      {(!isWide || winWide) && <div class={`book-bar glass-strong glass-thin${wide.value ? ' is-wide' : ''}`}>{step}</div>}
    </Page>
  );
}
