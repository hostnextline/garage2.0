/* « Réserver »: asks the garde-route question, makes a new caller's file and cars, sends one appointment per car,
   then says what happened and goes where it should (outcome.ts). A second tap while it runs does nothing. */
import { useRef, type MutableRef } from 'preact/hooks';
import { navigate } from '../../platform/router';
import { t } from '../../lib/i18n';
import { vehicle as vehicleRow, customer as customerRow, settings, daySpan, windowOf, job as jobRow } from '../../data/select';
import { bookJob, walkIn, errorMessage, saveCustomer, saveVehicle, suggestBlocks, type Suggestion } from '../../data/api';
import { net } from '../../data/sync';
import { bookPreview } from '../../data/bookAt';
import { exactAtOf } from '../../domain/moment/exactAt';
import { jobPerson } from '../../domain/jobs/words';
import { lateWindow } from '../../shared/jobs/exactMove';
import { openBookedMapOn } from '../../shared/moment/BookedMap';
import { bookAtTime, type AtTimeDone } from './atTime';
import { atTimeSaid } from './atTimeSaid';
import { farQuestion, farLimits } from '../../domain/moment/logic';
import { choiceWords, type BlockChoice } from '../../domain/moment/choice';
import { toast, ask, run } from '../../ui';
import { notifyCustomer, wantsText } from '../../shared/moment/notify';
import { customerPatch, emptyDraft } from '../../shared/customers/CustomerFields';
import { carIsEmpty, carRow } from '../../shared/vehicles/VehicleBits';
import { plannedCars } from './draft';
import { showsFix } from './check';
import { visitJobs, kindFor, callerUpdate, placeAfterWait, type VisitBase } from './visit';
import { withPosition } from '../../shared/places/withPosition';
import type { PlaceValue } from '../../shared/places/place';
import type { Customer } from '../../data/types';
import { sendVisit } from './send';
import { outcome } from './outcome';
import { farOfAnswer, inTime, seenFine } from './far';
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
  const farAsk = async (c: BlockChoice, b: Booking, place: PlaceValue): Promise<boolean> => {
    const key = `${c.day}|${c.block}`;
    if (farOk.current === key) return true;
    let q = farQuestion(b.d.far, c, 'book');
    const { lat, lng } = place;
    // the picker scored this very moment a moment ago, not far, for this same address, work and vehicle: nothing more
    // to ask (m2; booking-r2-1: an address typed or located since, a service added, another vehicle is asked)
    const now = { lat, lng, minutes: b.allMinutes, need: b.need, kind: b.d.kind, truck: b.effTruck };
    if (!q && !seenFine(b.d.farSeen, b.d.far, c, now, Date.now()) && net.value.online && lat != null && lng != null) {
      const rows = await inTime<Suggestion[]>(suggestBlocks(lat, lng, b.allMinutes, c.day, 1, null, b.need, b.need ? null : b.d.kind), FAR_WAIT_MS, []);
      q = farQuestion(farOfAnswer(rows, c, b.effTruck, farLimits(settings.value.booking), b.l), c, 'book');
    }
    if (!q) return true;
    const yes = await ask(q);
    if (yes) farOk.current = key; else calmScroll(at.moment.current);
    return yes;
  };

  const makeCaller = (b: Booking, place: PlaceValue) => run(async () => {
    const { first, last, phone } = b.d.caller;
    const patch = customerPatch(emptyDraft({ first_name: first, last_name: last, phone, place }));
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
    // an address typed right before the tap: its position is found now (at most 2.5 s, never without signal), so the
    // new caller's file and the appointment are not saved without one (R164, customers-a-05)
    const found = await withPosition(tapped.d.place);
    if (choice && !(await farAsk(choice, tapped, found))) return;
    // what is on screen now. The moment changed or something was taken off while waiting: nothing is booked, the
    // next tap asks for what is there
    const b = live.current;
    if (b.miss || !sameChoice(b.a.walkIn ? null : b.d.choice, choice)) return;
    const { a, d, l, bt } = b;
    const place = placeAfterWait(d.place, found);
    let cid = d.customerId;
    if (!cid) { const m = await makeCaller(b, place); if (!m) return; cid = m.customer; }
    const carOf = (k: string) => (k && (vehicleRow(k) || made.current?.cars[k]) ? k : null);
    const cars = plannedCars(d, b.belongs);
    const base: VisitBase = {
      customer_id: cid, truck_id: b.effTruck || null, notes: d.notes.trim() || null,
      address: place.address.trim() || null, unit: place.unit?.trim() || null, postal_code: place.postal_code || null, lat: place.lat, lng: place.lng,
      // the estimate goes with the visit's first appointment only: once a car of it is booked, the others go without it
      // (the server refuses an estimate already booked: quote_done)
      card_on_file: !!d.card, quote_id: d.bookedIds.length ? null : b.quote?.id ?? null, source: b.quote ? 'quote' : a.walkIn ? 'walk_in' : 'phone', vehicle_kind: kindFor(b.need, cars.length, d.kind)
    };
    let jobs = visitJobs(cars, base, { choice, taxes: settings.value.taxes, carOf });
    /* « Réserver à l'heure choisie » (Part 30, K1–K3, the lead's correction of 2026-11-22: Hassan, « hours can change »): a
       time the server OFFERS books exactly as before (its window, no minute pinned: the planner stays free). Only a time it
       does not offer (« complet », taken anyway by the owner or the office: choice.full) is a forcing: the server's preview
       of that very minute, the warning when somebody would be late or the truck past its hours, « Réserver quand même à
       14 h » books AT that minute (pinned), then the new map of that day. No signal, an older server, several cars: as
       before Part 30 for a full time — the day alone, the app gives the window */
    let sent = choice;
    if (b.wm && choice?.full && !a.walkIn) {
      const minute = jobs.length === 1 ? exactAtOf(choice, daySpan.value, windowOf) : null;
      if (minute != null) {
        const v = jobs[0];
        const name = customerRow(cid)?.first_name || d.caller.first || '';
        const done = await bookAtTime({ job: v.job, lines: v.lines, at: minute, truck: b.effTruck || null, name, mayForce: b.mayForce }, {
          preview: bookPreview, book: (job, lines) => bookJob(job, lines), ask, online: () => net.value.online,
          nameOf: (id) => { const r = jobRow(id); return (r && jobPerson(r)) || t('booking.atTime.someone'); }, windowOf, lateWindow
        });
        if (done.kind !== 'fallback') { afterAtTime(done, v.job.day, cid, l); return; }
      }
      sent = { day: choice.day, block: 'day' };
      jobs = visitJobs(cars, base, { choice: sent, taxes: settings.value.taxes, carOf });
    }
    const results = await sendVisit(jobs, { walkIn: a.walkIn, choice: sent, mayForce: b.mayForce }, {
      book: bookJob, walkIn, message: errorMessage,
      askForce: (msg) => ask({ title: bt('force.title'), text: `${msg} ${t('booking.force.text')}`, ok: t('booking.force.ok'), cancel: bt('force.cancel'), danger: true })
    });
    // « Réserver quand même »: the server gives the window from where the stop ends up, so the words say the day
    const forced = results.some((r) => r.status === 'booked' && r.sentForced);
    const when = sent ? whenSaid(sent, forced, l) : '';
    const o = outcome(results, { total: jobs.length, walkIn: a.walkIn, day: sent?.day ?? null, when }, { t, bt });
    for (const x of o.toasts) toast(x.text, { kind: x.kind, ms: x.ms });
    // the screen's state first (what was booked leaves it), then where the eyes go
    if (!o.go && o.done.length) b.act({ t: 'booked', keys: o.done, ids: jobs.filter((j) => o.done.includes(j.key)).map((j) => j.job.id!) });
    if (o.banner || o.windowGone) { b.act({ t: 'refused', banner: o.banner, windowGone: o.windowGone, again: o.again }); calmScroll(at.moment.current); }
    if (o.go) navigate(o.go, { replace: true });
    // the customer's confirmation, for each appointment the server answered (a window: said above the text to send by hand)
    const sms = sent && sent.block === 'day' ? whenSaid(sent, forced, l) : null;
    for (const id of o.texts) if (wantsText('booking', id)) void notifyCustomer('booking', id, { customerId: cid, when: sms });
    // the texts are on, but this customer has no cell number: the office can ask for one
    const who = customerRow(cid);
    if (o.go && jobs.length === 1 && o.texts.length === 1 && !wantsText('booking', o.texts[0]) && settings.value.messages?.on?.booking && who && !who.phone) toast(t('booking.sms.noPhone'));
  };

  /** what follows a booking at a minute: the words, the booking text at once (as today), then where the eyes go — the new
      map of that day over its agenda when somebody else's hour changed (K3), else the appointment as today */
  const afterAtTime = (done: Exclude<AtTimeDone, { kind: 'fallback' }>, day: string, cid: string, l: 'fr' | 'en') => {
    const b = live.current;
    if (done.kind === 'refused') {
      const msg = errorMessage(done.error);
      toast(msg, { kind: 'bad' });
      b.act({ t: 'refused', banner: msg, windowGone: false, again: true });
      calmScroll(at.moment.current);
      return;
    }
    if (done.kind === 'stopped') {
      if (done.why === 'offline' || done.why === 'lost' || done.why === 'rounds') toast(t(`booking.atTime.${done.why}`), { kind: 'bad', ms: 8000 });
      calmScroll(at.moment.current);
      return;
    }
    const s = atTimeSaid(done, day, l, lateWindow);
    toast(s.text, { kind: s.kind, ms: s.ms });
    // a time the server did not offer, booked anyway at that minute: the new map of that day, over its agenda (« Voir le
    // rendez-vous » opens the appointment)
    openBookedMapOn(`/agenda/${day}`, { day, jobId: done.id, at: done.at,
      marks: (done.answer?.stops ?? []).map((x) => ({ id: x.id, late: x.late, lateMin: x.lateMin, delay: x.delay, etaAfter: x.etaAfter })) });
    // the customer's confirmation at once, as every booking (its window: the one of the minute it went to)
    if (wantsText('booking', done.id)) void notifyCustomer('booking', done.id, { customerId: cid, when: s.when });
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
