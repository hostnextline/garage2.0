/* « Réserver »: asks the garde-route question, makes a new caller's file and cars, sends one appointment per car,
   then says what happened and goes where it should (outcome.ts). A second tap while it runs does nothing. */
import { useRef, type MutableRef } from 'preact/hooks';
import { navigate } from '../../platform/router';
import { t } from '../../lib/i18n';
import { vehicle as vehicleRow, customer as customerRow, settings } from '../../data/select';
import { bookJob, walkIn, errorMessage, saveCustomer, saveVehicle, suggestBlocks, type Suggestion } from '../../data/api';
import { net } from '../../data/sync';
import { farQuestion, farLimits } from '../../domain/moment/logic';
import { choiceWords, type BlockChoice } from '../../domain/moment/choice';
import { toast, ask, run } from '../../ui';
import { notifyCustomer, wantsText } from '../../shared/moment/notify';
import { customerPatch, emptyDraft } from '../../shared/customers/CustomerFields';
import { carIsEmpty, carRow } from '../../shared/vehicles/VehicleBits';
import { plannedCars } from './draft';
import { showsFix } from './check';
import { visitJobs, kindFor, callerUpdate, type VisitBase } from './visit';
import type { Customer } from '../../data/types';
import { sendVisit } from './send';
import { outcome } from './outcome';
import { farOfAnswer, inTime } from './far';
import { calmScroll } from './motion';
import type { Booking } from './useBooking';

/** what is said after the booking: the window asked for; « Réserver quand même »: the day, the app gives the window */
function whenSaid(c: BlockChoice, forced: boolean, l: 'fr' | 'en'): string {
  return choiceWords(forced && c.block === 'day' && !c.win_flex ? { day: c.day, block: 'day' } : c, l);
}
const FAR_WAIT_MS = 4000;
/** the same moment (day, block, window or « flexible ») */
const sameChoice = (x: BlockChoice | null, y: BlockChoice | null): boolean =>
  x === y || (!!x && !!y && x.day === y.day && x.block === y.block && (x.win_start ?? null) === (y.win_start ?? null) && !!x.win_flex === !!y.win_flex);

export interface Anchors { moment: MutableRef<HTMLElement | null> }
/** the panel to fix for a new caller: the name and number, or the cars */
const panelOf = (testid: string) => (typeof document === 'undefined' ? null : document.querySelector(`[data-testid="${testid}"]`));

export function useSubmit(b: Booking, at: Anchors): () => Promise<void> {
  const sending = useRef(false);
  // the form as it is on screen now: « Réserver » reads it again after waiting (the garde-route answer can take a few
  // seconds), so what was typed meanwhile is what gets booked
  const live = useRef(b);
  live.current = b;
  // the garde-route question answered « Réserver quand même » for this moment: not asked again on a second try
  const farOk = useRef<string | null>(null);
  // a new caller's file and cars, made once (a refused moment can be chosen again without making them twice); what was
  // sent, so a name or a number fixed before the next try goes to the same file
  const made = useRef<{ customer: string; sent: Partial<Customer>; cars: Record<string, string> } | null>(null);

  /** true: go on (not far, no answer in time, or the person said so) */
  const farAsk = async (c: BlockChoice, b: Booking): Promise<boolean> => {
    const key = `${c.day}|${c.block}`;
    if (farOk.current === key) return true;
    let q = farQuestion(b.d.far, c, 'book');
    const { lat, lng } = b.d.place;
    if (!q && net.value.online && lat != null && lng != null) {
      const rows = await inTime<Suggestion[]>(suggestBlocks(lat, lng, b.allMinutes, c.day, 1, null, b.need, b.need ? null : b.d.kind), FAR_WAIT_MS, []);
      q = farQuestion(farOfAnswer(rows, c, b.effTruck, farLimits(settings.value.booking), b.l), c, 'book');
    }
    if (!q) return true;
    const yes = await ask(q);
    if (yes) farOk.current = key; else calmScroll(at.moment.current);
    return yes;
  };

  const makeCaller = (b: Booking) => run(async () => {
    const { first, last, phone } = b.d.caller;
    const patch = customerPatch(emptyDraft({ first_name: first, last_name: last, phone, place: b.d.place }));
    const m = made.current;
    if (!m) made.current = { customer: await saveCustomer(patch), sent: patch, cars: {} };
    else {
      // only what was fixed; an address left empty keeps the file's (booking-a-09)
      const fix = callerUpdate(m.sent, patch);
      if (fix) { await saveCustomer({ ...fix, id: m.customer }); m.sent = { ...m.sent, ...fix }; }
    }
    const mm = made.current!;
    for (const c of b.d.callCars) {
      if (carIsEmpty(c.draft)) continue;
      const row = carRow(c.draft, mm.customer);
      const json = JSON.stringify(row);
      if (mm.cars[c.id] !== json) { await saveVehicle({ ...row, id: c.id }); mm.cars[c.id] = json; }
    }
    b.act({ t: 'made', customerId: mm.customer, cars: Object.keys(mm.cars) });
    return mm;
  });

  const go = async () => {
    const tapped = live.current;
    const choice = tapped.a.walkIn ? null : tapped.d.choice;
    if (choice && !(await farAsk(choice, tapped))) return;
    // what is on screen now. The moment changed or something was taken off while waiting: nothing is booked, the
    // next tap asks for what is there
    const b = live.current;
    if (b.miss || !sameChoice(b.a.walkIn ? null : b.d.choice, choice)) return;
    const { a, d, l, bt } = b;
    let cid = d.customerId;
    if (!cid) { const m = await makeCaller(b); if (!m) return; cid = m.customer; }
    const carOf = (k: string) => (k && (vehicleRow(k) || made.current?.cars[k]) ? k : null);
    const cars = plannedCars(d, b.belongs);
    const base: VisitBase = {
      customer_id: cid, truck_id: b.effTruck || null, notes: d.notes.trim() || null,
      address: d.place.address.trim() || null, unit: d.place.unit?.trim() || null, postal_code: d.place.postal_code || null, lat: d.place.lat, lng: d.place.lng,
      // the estimate goes with the visit's first appointment only: once a car of it is booked, the others go without it
      // (the server refuses an estimate already booked: quote_done)
      card_on_file: !!d.card, quote_id: d.bookedIds.length ? null : b.quote?.id ?? null, source: b.quote ? 'quote' : a.walkIn ? 'walk_in' : 'phone', vehicle_kind: kindFor(b.need, cars.length, d.kind)
    };
    const jobs = visitJobs(cars, base, { choice, taxes: settings.value.taxes, carOf });
    const results = await sendVisit(jobs, { walkIn: a.walkIn, choice, mayForce: b.mayForce }, {
      book: bookJob, walkIn, message: errorMessage,
      askForce: (msg) => ask({ title: bt('force.title'), text: `${msg} ${t('booking.force.text')}`, ok: t('booking.force.ok'), cancel: bt('force.cancel'), danger: true })
    });
    // « Réserver quand même »: the server gives the window from where the stop ends up, so the words say the day
    const forced = results.some((r) => r.status === 'booked' && r.sentForced);
    const when = choice ? whenSaid(choice, forced, l) : '';
    const o = outcome(results, { total: jobs.length, walkIn: a.walkIn, day: choice?.day ?? null, when }, { t, bt });
    for (const x of o.toasts) toast(x.text, { kind: x.kind, ms: x.ms });
    // the screen's state first (what was booked leaves it), then where the eyes go
    if (!o.go && o.done.length) b.act({ t: 'booked', keys: o.done, ids: jobs.filter((j) => o.done.includes(j.key)).map((j) => j.job.id!) });
    if (o.banner || o.windowGone) { b.act({ t: 'refused', banner: o.banner, windowGone: o.windowGone }); calmScroll(at.moment.current); }
    if (o.go) navigate(o.go, { replace: true });
    // the customer's confirmation, for each appointment the server answered (a window: said above the text to send by hand)
    const sms = choice && choice.block === 'day' ? whenSaid(choice, forced, l) : null;
    for (const id of o.texts) if (wantsText('booking', id)) void notifyCustomer('booking', id, { customerId: cid, when: sms });
    // the texts are on, but this customer has no cell number: the office can ask for one
    const who = customerRow(cid);
    if (o.go && jobs.length === 1 && o.texts.length === 1 && !wantsText('booking', o.texts[0]) && settings.value.messages?.on?.booking && who && !who.phone) toast(t('booking.sms.noPhone'));
  };

  return async () => {
    if (sending.current) return;
    if (b.miss) {
      // the new caller's name, number or cars: the tap shows what to fix, and where
      if (showsFix(b.miss)) {
        b.act({ t: 'tried' });
        if (b.miss === 'cars' && b.badCar && b.badCar !== b.d.car) b.act({ t: 'car', key: b.badCar, mint: '' });
        calmScroll(panelOf(b.miss === 'cars' ? 'call-car' : 'call-who'));
      }
      return;
    }
    sending.current = true;
    try { await go(); } finally { sending.current = false; }
  };
}
