/* Réserver — one page, not a wizard: the customer, the car and the address, the services, the problem, the block,
   then « Réserver ». The server picks the truck and the order of the stops.
   #/book?customer=ID · ?day=YYYY-MM-DD&block=am · ?quote=ID (an estimate becomes a job) · ?walkin=1 (the job starts now). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CalendarCheck, Wrench, RotateCcw } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { navigate } from '../../app/router';
import { wide } from '../../app/media';
import { t, lang } from '../../lib/i18n';
import { duration, today as todayOf } from '../../lib/dates';
import { money } from '../../lib/money';
import { customer as customerRow, customerName, vehicle as vehicleRow, vehiclesOf, vehicleLabel, activeTrucks, truckLabel, truckColor, settings, service as serviceRow, blockLoad } from '../../data/select';
import { getRow } from '../../data/store';
import { bookJob, walkIn as walkInJob, errorMessage, type BookInput } from '../../data/api';
import { uuid } from '../../data/sync';
import { can, hasRole, isOwner, myTrucks } from '../../data/auth';
import type { Quote } from '../../data/types';
import { Page, Panel, Field, Input, Textarea, Check, Chips, Stepper, Button, BigStep, Banner, Kv, Money, toast, ask } from '../../ui';
import { CustomerPicker } from '../customers/CustomerPicker';
import { VehiclePicker } from '../customers/VehiclePicker';
import { AddressField, type PlaceValue } from '../customers/AddressField';
import { ServicePicker, type ItemDraft } from './ServicePicker';
import { BlockPicker, choiceWords, type BlockChoice } from './BlockPicker';
import { missingPiece, bookSummary, toItemInputs, draftsFromQuote, parseChoice, refusalCode, clampDuration, BLOCK_REFUSALS } from './logic';
import { blockPhrase } from './when';
import { notifyCustomer, wantsText } from './notify';
import { forgetRefusal, noLongWaitOffline } from './outbox';
import './booking.css';

/** the refusals « Réserver quand même » can go past */
const FULL = ['block_full', 'truck_full'];

const EMPTY_PLACE: PlaceValue = { address: '', unit: null, postal_code: null, lat: null, lng: null };
function placeOf(id: string | null): PlaceValue {
  const c = customerRow(id);
  if (!c) return EMPTY_PLACE;
  return { address: c.address || '', unit: c.unit || null, postal_code: c.postal_code || null, lat: c.lat ?? null, lng: c.lng ?? null };
}
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
  const quote = quoteId ? getRow<Quote>('quotes', quoteId) : undefined;

  const qCustomer = query.get('customer');
  const [customerId, setCustomerId] = useState<string | null>(() => (customerRow(qCustomer) ? qCustomer : null));
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [place, setPlace] = useState<PlaceValue>(() => placeOf(qCustomer));
  const [placeOwner, setPlaceOwner] = useState<string | null>(() => (customerRow(qCustomer) ? qCustomer : null));
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [problem, setProblem] = useState('');
  const [notes, setNotes] = useState('');
  // a block from the address (« Réserver dans ce bloc »), unless it has started meanwhile
  const [choice, setChoice] = useState<BlockChoice | null>(() => {
    const c = isWalkIn ? null : parseChoice(query.get('day'), query.get('block'));
    return c && !blockLoad(c.day, c.block).started ? c : null;
  });
  const [truckId, setTruckId] = useState<string | null>(null);
  const [durOverride, setDurOverride] = useState<number | null>(null);
  const [card, setCard] = useState<boolean | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
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
  const isWide = wide.value;
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
    if (!id) { setVehicleId(null); setPlace(EMPTY_PLACE); setPlaceOwner(null); setCard(null); }
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
  const others = Object.entries(carts)
    .filter(([vid, cart]) => cart.items.length > 0 && vid !== vehicleId && vehicleRow(vid)?.customer_id === customerId)
    .map(([vid, cart]) => ({ vehicleId: vid, items: cart.items, sum: bookSummary(cart.items, settings.value.taxes, { override: cart.dur, priceless: (id) => serviceRow(id)?.price_cents == null }) }));
  const allMinutes = sum.minutes + others.reduce((n, o) => n + o.sum.minutes, 0);
  const allTotal = sum.total + others.reduce((n, o) => n + o.sum.total, 0);
  const miss = missingPiece({ customerId, items: others.length ? [...items, ...others.flatMap((o) => o.items)] : items, problem, choice }, isWalkIn);

  /* ---------- « Réserver » ---------- */
  const mayForce = isOwner() || hasRole('office');
  const submit = async () => {
    if (miss) return;
    const base = {
      id: jobId, customer_id: customerId!, vehicle_id: vehicleId, duration_min: sum.minutes, truck_id: effTruck || null,
      problem: problem.trim() || null, notes: notes.trim() || null,
      address: place.address.trim() || null, unit: place.unit?.trim() || null, postal_code: place.postal_code || null, lat: place.lat, lng: place.lng,
      card_on_file: !!card, quote_id: quote?.id ?? null, source: quote ? 'quote' : isWalkIn ? 'walk_in' : 'phone'
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
    await book({ ...base, day: c.day, block: c.block }, lines, c, false);
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
      const job = { ...base, id, vehicle_id: car.vehicleId, duration_min: car.minutes, quote_id: k === 0 ? base.quote_id : null };
      const lines = toItemInputs(car.items);
      try {
        if (isWalkIn) {
          const r = await noLongWaitOffline(walkInJob(job, lines), { id });
          if (!r.queued) done.push(r.id);
        } else {
          const c = choice!;
          const r = await bookOne({ ...job, day: c.day, block: c.block }, lines, c, false);
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
    toast(left ? t('booking.cars.partial', { n: done.length, total: cars.length }) : t('booking.cars.done', { n: done.length, when: isWalkIn ? '' : choiceWords(choice!, l) }), { kind: left ? 'bad' : 'ok', ms: 9000 });
    for (const id of done) if (!isWalkIn && wantsText('booking', id)) void notifyCustomer('booking', id, { customerId });
    if (!left) navigate(isWalkIn ? '/' : `/agenda/${choice!.day}`, { replace: true });
    // what was booked leaves the screen: the rest can be tried again in another block
    else { setCarts((cs) => { const n = { ...cs }; for (const car of cars) if (car.vehicleId && done.includes(idOf(car.vehicleId))) delete n[car.vehicleId]; return n; }); if (done.includes(jobId)) setItems([]); }
  };
  /** one car in a block; a full block: the owner and the office may book anyway (after a warning). The job id, 'queued', or null */
  const bookOne = async (job: BookInput, lines: ReturnType<typeof toItemInputs>, c: BlockChoice, force: boolean): Promise<string | 'queued' | null> => {
    try {
      const r = await noLongWaitOffline(bookJob(force ? { ...job, force: true } : job, lines), { id: job.id! });
      return r.queued ? 'queued' : r.id;
    } catch (e) {
      const msg = errorMessage(e);
      const code = refusalCode(e);
      await forgetRefusal('book_job', (a) => (a.p_job as { id?: string })?.id === job.id);
      if (!force && FULL.includes(code) && mayForce) {
        const yes = await ask({ title: t('booking.force.title'), text: `${msg} ${t('booking.force.text')}`, ok: t('booking.force.ok'), cancel: t('booking.force.cancel'), danger: true });
        if (yes) return bookOne(job, lines, c, true);
      } else toast(msg, { kind: 'bad' });
      if (BLOCK_REFUSALS.includes(code)) { setBlockError(`${msg} ${t('booking.refusedBlock')}`); blockPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return null;
    }
  };
  /** « Réserver »; a full block: the owner and the office may book anyway, after a warning */
  const book = async (job: BookInput, lines: ReturnType<typeof toItemInputs>, c: BlockChoice, force: boolean): Promise<void> => {
    try {
      const r = await noLongWaitOffline(bookJob(force ? { ...job, force: true } : job, lines), { id: jobId });
      if (r.queued) { toast(t('booking.queued'), { ms: 10000 }); navigate(`/agenda/${c.day}`, { replace: true }); return; }
      const forced = !!r.data?.forced;
      toast(forced ? t('booking.force.done', { when: choiceWords(c, l) }) : t('booking.done', { when: choiceWords(c, l) }), { kind: forced ? 'info' : 'ok', ms: forced ? 9000 : undefined });
      navigate(`/job/${r.id}`, { replace: true });
      if (wantsText('booking', r.id)) void notifyCustomer('booking', r.id, { customerId });
      // the texts are on, but this customer has no cell number: the office can ask for one
      else if (settings.value.messages?.on?.booking && cust && !cust.phone) toast(t('booking.sms.noPhone'));
    } catch (e) {
      const msg = errorMessage(e);
      const code = refusalCode(e);
      if (!force && FULL.includes(code) && mayForce) {
        await forgetRefusal('book_job', (a) => (a.p_job as { id?: string })?.id === jobId);
        const yes = await ask({ title: t('booking.force.title'), text: `${msg} ${t('booking.force.text')}`, ok: t('booking.force.ok'), cancel: t('booking.force.cancel'), danger: true });
        if (yes) return book(job, lines, c, true);
        setBlockError(`${msg} ${t('booking.refusedBlock')}`);
        blockPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      toast(msg, { kind: 'bad' });
      if (BLOCK_REFUSALS.includes(code)) {
        const hint = t('booking.refusedBlock');
        setBlockError(msg.toLowerCase().includes(hint.toLowerCase().replace(/\.$/, '')) ? msg : `${msg} ${hint}`);
        blockPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      void forgetRefusal('book_job', (a) => (a.p_job as { id?: string })?.id === jobId);
    }
  };

  /* ---------- words ---------- */
  const title = isWalkIn ? t('booking.titleWalkIn') : quote ? t('booking.titleQuote', { n: quote.number }) : t('booking.title');
  const back = quote ? `/quote/${quote.id}` : qCustomer ? `/customer/${qCustomer}` : isWalkIn ? '/' : '/agenda';
  const totalWords = allTotal > 0 ? money(allTotal, l) : '';
  const stepSub = miss ? t(`booking.missing.${miss}`)
    : isWalkIn ? [t('booking.walkInSub'), totalWords].filter(Boolean).join(', ')
    : [blockPhrase(choice!.day, choice!.block, todayOf(), l), totalWords].filter(Boolean).join(', ');
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
            {others.length > 0 && (
              <div class="book-cars" data-testid="book-cars">
                <span class="small muted">{t('booking.cars.also')}</span>
                {others.map((o) => (
                  <button key={o.vehicleId} type="button" class="chip" onClick={() => chooseVehicle(o.vehicleId)} data-testid={`book-car-${o.vehicleId}`}>
                    {t('booking.cars.chip', { car: vehicleLabel(vehicleRow(o.vehicleId)) || '—', n: o.items.length })}
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
      <ServicePicker value={items} onValue={setItems} lang={custLang} allowCustom hideTotal />
      <div class="book-duration" data-testid="book-duration">
        <Field label={t('booking.options.duration')} hint={durOverride != null ? t('booking.options.durationChanged') : t('booking.options.durationHint')} group>
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
      <Panel title={t('booking.block.title')} sub={t('booking.block.sub')} data-tour="book-block">
        {blockError && <div style={{ marginBottom: 'var(--sp-3)' }}><Banner kind="bad">{blockError}</Banner></div>}
        <BlockPicker lat={place.lat} lng={place.lng} duration={allMinutes} truckId={effTruck} value={choice}
          onPick={(c) => { setChoice(c); setBlockError(null); }} />
      </Panel>
    </div>
  );

  const summaryPanel = (
    <Panel title={t('booking.summary.title')} class="book-summary">
      <Kv items={[
        [t('booking.summary.customer'), cust ? [customerName(cust), vehicleLabel(vehicleRow(vehicleId))].filter(Boolean).join(', ') : null],
        [t('booking.summary.when'), isWalkIn ? t('booking.walkInSub') : choice ? choiceWords(choice, l) : t('booking.summary.noBlock')],
        [t('booking.services.title'), items.length ? `${t('booking.summary.services', { n: items.length })}, ${t('booking.summary.work', { d: duration(sum.minutes, l) })}` : problem.trim() ? t('booking.summary.problemOnly') : t('booking.summary.noWork')],
        ...others.map((o) => [vehicleLabel(vehicleRow(o.vehicleId)) || '—', `${t('booking.summary.services', { n: o.items.length })}, ${t('booking.summary.work', { d: duration(o.sum.minutes, l) })}`] as [string, string]),
        [t('booking.summary.truckLabel'), effTruck ? truckLabel(effTruck) : null]
      ]} />
      <div class="book-total">
        <Money cents={allTotal} large />
        <span class="muted small">{t('booking.summary.taxesLabel')}{sum.toConfirm ? `, ${t('booking.summary.toConfirm')}` : ''}</span>
      </div>
      {step}
    </Panel>
  );

  return (
    <Page title={title} sub={isWalkIn ? t('booking.subWalkIn') : t('booking.sub')} back={back} help={t('booking.help')} wide={isWide} data-testid="book-screen">
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
      <div class={`book${isWide ? ' book-wide' : ''}`}>
        <div class="book-main">
          <Panel title={t('booking.customer.title')} data-tour="book-customer">
            <CustomerPicker value={customerId} onPick={pickCustomer} allowCreate autoFocus={!customerId && !quote} />
          </Panel>
          {vehiclePanel}
          {servicesPanel}
          {notesPanel}
          {(showTruckChoice || !isWalkIn) && optionsPanel}
          {!isWide && blockSection}
        </div>
        {isWide && (
          <aside ref={side} class="book-side" aria-label={t('booking.summary.title')}>
            {blockSection}
            {summaryPanel}
          </aside>
        )}
      </div>
      {!isWide && <div class="book-bar glass-strong glass-thin">{step}</div>}
    </Page>
  );
}
