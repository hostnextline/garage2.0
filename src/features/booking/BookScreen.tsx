/* Réserver (also « Appel entrant ») — one page, not a wizard: the customer, the car and the address, the services, the
   problem, the moment, then « Réserver ». The server picks the truck and the order of the stops.
   The address bar is read in address.ts; the form's state is draft.ts (through useBooking); « Réserver » is useSubmit.
   This file only lays the panels out: in the order of the form, or for a new caller in the order of the call (the
   name last), one column on a phone, two on a computer. */
import { useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import { type ScreenProps } from '../../platform/router';
import { wide } from '../../platform/media';
import { t } from '../../lib/i18n';
import { truckLabel } from '../../data/select';
import { Page, Button, Banner } from '../../ui';
import { useBooking, placeOf } from './useBooking';
import { useSubmit } from './useSubmit';
import { useSideColumn } from './useSideColumn';
import { backOf } from './address';
import { CustomerPanel } from './CustomerPanels';
import { VehiclePanel, CallAddressPanel, CallCarPanel, carName } from './CarPanels';
import { ServicesPanel, NotesPanel } from './WorkPanels';
import { OptionsPanel, TruckPanel } from './OptionPanels';
import { MomentPanel } from './MomentPanel';
import { SummaryPanel, BookStep } from './SummaryPanel';
import { broad } from './screen';
import './booking.css';

/** a new address (#/book → #/book?customer=…, a second booking) starts a fresh form: the frame keeps the screen when
    only the query changes */
export default function BookScreen(p: ScreenProps) {
  return <BookForm key={p.query.toString()} {...p} />;
}

function BookForm({ query }: ScreenProps) {
  const b = useBooking(query);
  const { a, d, act, bt, l, wm } = b;
  const moment = useRef<HTMLDivElement>(null);
  const submit = useSubmit(b, { moment });
  const side = useRef<HTMLElement>(null);
  // two columns on a computer; with « Plages d'arrivée » only when the time calendar has room beside the form
  const isWide = wide.value && (!wm || a.walkIn || broad.value);
  const winWide = isWide && wm && !a.walkIn;
  useSideColumn(side, isWide, winWide);

  const cust = b.cust;
  const filePlace = placeOf(d.customerId);
  const step = <BookStep b={b} onClick={submit} />;
  const momentPanel = a.walkIn ? null : (
    <MomentPanel key="moment" anchor={moment} act={act} title={bt('block.title')} sub={winWide ? undefined : bt('block.sub')} error={d.blockError}
      lat={d.place.lat} lng={d.place.lng} address={d.place.address} duration={b.allMinutes} truckId={b.effTruck} value={d.choice}
      need={b.need} kind={d.kind} openDay={b.openDay} reload={d.reload} />
  );
  const customer = <CustomerPanel key="customer" customerId={d.customerId} newCaller={b.needNew} searchKnown={d.searchKnown} caller={d.caller} tried={d.tried}
    autoFocus={!d.customerId && !b.quote && !a.call} act={act} />;
  const services = <ServicesPanel key="services" work={b.cur} sum={b.sum} lang={cust?.lang === 'en' ? 'en' : 'fr'} ui={l} bt={bt} act={act}
    forCar={b.needNew && d.callCars.length > 1 ? carName(d.car, d.callCars) : null} />;
  const notes = <NotesPanel key="notes" problem={b.cur.problem} notes={d.notes} hasLines={b.cur.items.length > 0} act={act} />;
  const truck = b.truckNeeded ? <TruckPanel key="truck" ids={b.pickFrom} truckId={d.truckId} act={act} /> : null;
  const options = a.walkIn ? null : <OptionsPanel key="options" pickTruck={b.mayPickTruck} truckId={d.truckId} card={d.card} act={act} />;
  const summary = (withStep: boolean) => <SummaryPanel key="summary" b={b} step={withStep ? step : null} />;
  const inMain = isWide ? null : momentPanel;

  let main: (VNode | null)[];
  if (b.needNew) {
    const address = <CallAddressPanel key="address" place={d.place} act={act} />;
    const car = <CallCarPanel key="car" d={d} bad={b.carIsBad} act={act} />;
    // the panels in the order of the call: what the caller talks about first; the name and the number last
    const order = a.start === 'car' ? [car, services, address, inMain, notes, customer]
      : a.start === 'job' ? [services, address, inMain, car, notes, customer]
      : [address, inMain, services, car, notes, customer];
    main = [...order, truck, options];
  } else {
    const vehicle = <VehiclePanel key="vehicle" d={d} others={b.others} filePlace={filePlace} fileHasAddress={!!cust?.address} quoteCar={b.quote?.vehicle_text ?? null} act={act} />;
    main = [customer, vehicle, services, notes, truck, options, inMain];
  }
  if (winWide) main.push(summary(false));

  const quote = b.quote;
  const title = a.walkIn ? t('booking.titleWalkIn') : quote ? t('booking.titleQuote', { n: quote.number }) : a.call ? t('booking.call.title') : t('booking.title');
  return (
    <Page title={title} sub={a.walkIn ? t('booking.subWalkIn') : bt('sub')} back={backOf(a, quote?.id ?? null)} help={bt('help')} wide={isWide} data-testid="book-screen">
      {b.copyOf && <Banner kind="info" title={t('booking.copy.title', { n: b.copyOf.number })} data-testid="book-copy">{t('booking.copy.text')}</Banner>}
      {quote && (
        <Banner kind={b.quoteDone ? 'warn' : 'info'} title={t('booking.quote.from', { n: quote.number })}
          action={b.quoteDone && quote.job_id ? <Button size="sm" href={`#/job/${quote.job_id}`}>{t('booking.quote.open')}</Button> : undefined}>
          {b.quoteDone ? t('booking.quote.converted') : [
            quote.contact_name ? t('booking.quote.contact', { name: quote.contact_name }) : '',
            quote.vehicle_text ? t('booking.quote.vehicle', { text: quote.vehicle_text }) : ''
          ].filter(Boolean).map((x) => <span key={x} class="book-quote-line">{x}</span>)}
        </Banner>
      )}
      {a.quoteId && !quote && <Banner kind="warn">{t('booking.quote.missing')}</Banner>}
      {b.mechanicOnly && b.own && <Banner kind="info">{t('booking.mechanicTruck', { name: truckLabel(b.own) })}</Banner>}
      <div class={`book${isWide ? ' book-wide' : ''}${winWide ? ' is-win' : ''}`}>
        <div class="book-main">{main}</div>
        {isWide && (
          <aside ref={side} class="book-side" aria-label={t('booking.summary.title')}>
            {momentPanel}
            {!winWide && summary(true)}
          </aside>
        )}
      </div>
      {(!isWide || winWide) && <div class={`book-bar glass-strong glass-thin${wide.value ? ' is-wide' : ''}`}>{step}</div>}
    </Page>
  );
}
