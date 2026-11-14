/* « Choisir sur la carte » — the first way to choose the moment (booking, moving a job): the days of the calendar page
   in a strip, a map that is always there, and the three blocks of the day chosen.
   « Tous les jours »: every coming appointment of the page around the new address. A day: that day's routes by the
   streets with the new appointment in its place for the block highlighted. Tapping a block picks it (the same choice
   as a calendar cell). From the phone's copy of the days; the scores are the server's (BlockPicker keeps them). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, Route, Car, Truck, ListOrdered } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { tinyDay, longDay, duration, clockRange, type BlockKey } from '../../lib/dates';
import { wide } from '../../app/media';
import { jobsBetween, customer, settings, activeTrucks, truckColor, staffName } from '../../data/select';
import { Pill } from '../../ui';
import { MapView, type MapMarker, type MapLine } from '../map/MapView';
import { assemble, UNPLACED_COLOR, type TruckRoute } from '../map/assemble';
import { fromDevice } from '../map/device';
import { useRoads, roadOf, roadTotal } from '../map/useRoads';
import { placeNewStop, NEW_STOP } from './preview';
import { isFar, momentsByKey, roadWords, type CellState, type Moment } from './logic';
import { dayChips, defaultBlock, dayCounts, overviewPins } from './momentDays';

export interface MomentMapProps {
  lat: number; lng: number; address: string;
  /** the days of the calendar page, each with its blocks as the calendar shows them */
  cells: { day: string; blocks: { key: BlockKey; start: number; end: number; state: CellState; left: number }[] }[];
  /** every moment the server scored, the best first (none without the network) */
  list: (Moment & { drive_min: number; truck?: string | null })[];
  value: { day: string; block: BlockKey } | null;
  onPick: (day: string, block: BlockKey) => void;
  /** moving a job: it is not drawn at its old place */
  excludeJob?: string | null;
  truckId?: string | null;
}

const NEW_COLOR = '#111827';
const fmtKm = (n: number, l: string) => new Intl.NumberFormat(l === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 }).format(n);

export function MomentMap(p: MomentMapProps) {
  const l = lang.value;
  const days = p.cells.map((c) => c.day);
  const moments = useMemo(() => momentsByKey(p.list), [p.list]);

  /* the day shown: the one of the moment chosen (from the list or the calendar too), or the one tapped here */
  const [sel, setSel] = useState<string | null>(p.value?.day ?? null);
  useEffect(() => { if (p.value) setSel(p.value.day); }, [p.value?.day, p.value?.block]);
  const row = sel ? p.cells.find((c) => c.day === sel) : undefined;
  const day = row ? row.day : null;
  const hi: BlockKey | null = row ? (p.value && p.value.day === row.day ? p.value.block : defaultBlock(row.blocks, row.day, p.list)) : null;

  /* the appointments already there (the phone's copy) */
  const jobs = days.length ? jobsBetween(days[0], days[days.length - 1]) : [];
  const chips = dayChips(p.cells, p.list, dayCounts(jobs, days, p.excludeJob));
  const pins = useMemo(() => (day ? [] : overviewPins(jobs, days, { exclude: p.excludeJob, posOf: (j) => customer(j.customer_id) })), [day, jobs, days.join('|'), p.excludeJob]);

  /* the strip follows the day shown (sideways only: the page does not jump) */
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = strip.current;
    const on = box?.querySelector<HTMLElement>('.mm-day.is-on');
    if (box && on) box.scrollLeft = on.offsetLeft - (box.clientWidth - on.clientWidth) / 2;
  }, [day, days[0]]);

  /* ---------- a day: its routes, the new stop in each block ---------- */
  const truckOf = (block: BlockKey) => p.truckId || (day ? moments.get(`${day}|${block}`)?.truck : null) || null;
  const base = useMemo(() => {
    if (!day) return null;
    const d = fromDevice(day);
    return p.excludeJob ? { ...d, jobs: d.jobs.filter((j) => j.id !== p.excludeJob) } : d;
  }, [day, p.excludeJob, jobs]);
  const placedOf = (block: BlockKey) => placeNewStop(base!, { day: day!, block, truckId: truckOf(block), lat: p.lat, lng: p.lng, name: '', address: p.address });
  const perBlock = useMemo(() => {
    const out = {} as Record<string, { n: number; total: number; extraKm: number } | null>;
    if (!base || !row) return out;
    for (const c of row.blocks) {
      if (c.state === 'closed' || c.state === 'started') { out[c.key] = null; continue; }
      const pl = placedOf(c.key);
      const mine = pl.after.jobs.filter((j) => j.truck_id === pl.truckId);
      const n = mine.find((j) => j.id === NEW_STOP)?.order;
      out[c.key] = pl.truckId && n ? { n, total: mine.length, extraKm: pl.extraKm } : null;
    }
    return out;
  }, [base, row?.blocks.map((c) => c.key + c.state).join('|'), p.lat, p.lng, p.truckId, moments]);
  const placed = useMemo(() => (base && hi ? placedOf(hi) : null), [base, hi, p.lat, p.lng, p.truckId, moments]);
  const after = useMemo(() => (base ? assemble(placed ? placed.after : base, { nameOf: staffName }) : null), [base, placed]);
  const before = useMemo(() => (placed ? assemble(placed.before, { nameOf: staffName }) : null), [placed]);
  const trA: TruckRoute | undefined = placed ? after?.trucks.find((x) => x.id === placed.truckId) : undefined;
  const trB: TruckRoute | undefined = placed ? before?.trucks.find((x) => x.id === placed.truckId) : undefined;
  // the streets: only for a day (the overview has no lines)
  useRoads(day && after ? [...after.trucks, ...(trB ? [trB] : [])] : []);

  /* ---------- what the map draws ---------- */
  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const home = settings.value.booking?.home;
  const blockName = (b: string) => t(`common.blocks.${b}`);
  const newPin = (n: number | string | null, sub?: string): MapMarker => ({ id: NEW_STOP, kind: 'job', lat: p.lat, lng: p.lng, color: NEW_COLOR, number: n, active: true,
    label: t('booking.preview.newLabel'), sub, title: t('booking.preview.newLabel') });
  if (!day || !after) {
    // the overview: the starts, every coming appointment, the new address
    if (home && home.lat != null && home.lng != null) markers.push({ id: 'home', kind: 'home', lat: home.lat, lng: home.lng, label: home.label || t('booking.preview.start'), title: home.address || '' });
    for (const tr of activeTrucks.value) if (tr.start) markers.push({ id: `start-${tr.id}`, kind: 'customer', lat: tr.start.lat, lng: tr.start.lng, color: truckColor(tr.id), label: tr.start.label || t('booking.preview.start'), title: tr.start.address || '' });
    for (const pin of pins) {
      const open = chips.find((c) => c.day === pin.day)?.open;
      markers.push({ id: pin.id, kind: 'job', lat: pin.lat, lng: pin.lng, color: pin.truckId ? truckColor(pin.truckId) : UNPLACED_COLOR, number: Number(pin.day.slice(8)),
        /* the date in the dot only: a label on every dot hid the map where appointments are close together */
        title: `${tinyDay(pin.day, l)}, ${blockName(pin.block).toLowerCase()}`, onClick: open ? () => setSel(pin.day) : undefined });
    }
    markers.push(newPin(null));
  } else {
    let homeDrawn = false;
    for (const tr of after.trucks) {
      if (!tr.stops.length) continue;
      if (tr.from && tr.start) markers.push({ id: `start-${tr.id}`, kind: 'customer', lat: tr.from[0], lng: tr.from[1], color: tr.color, label: tr.start.label || t('booking.preview.start'), title: tr.start.address });
      else if (tr.from && !homeDrawn) { homeDrawn = true; markers.push({ id: 'home', kind: 'home', lat: tr.from[0], lng: tr.from[1], label: after.home?.label || t('booking.preview.start'), title: after.home?.address || '' }); }
      for (const s of tr.stops) {
        if (!s.hasPos) continue;
        if (s.id === NEW_STOP) markers.push(newPin(s.n, blockName(s.block)));
        else markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: s.n, done: s.done, label: s.name || undefined, sub: blockName(s.block), title: `${s.n}. ${s.name}` });
      }
      for (const leg of tr.legs) lines.push({ points: roadOf(leg), color: tr.color, weight: 4, opacity: leg.kind === 'done' ? 0.32 : 0.85 });
    }
    for (const s of after.unplaced) if (s.hasPos && s.id !== NEW_STOP) markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: UNPLACED_COLOR, number: '', label: s.name || undefined, sub: blockName(s.block), title: s.name });
    if (!markers.some((m) => m.id === NEW_STOP)) {
      if (!homeDrawn && home && home.lat != null && home.lng != null) markers.push({ id: 'home', kind: 'home', lat: home.lat, lng: home.lng, label: home.label || t('booking.preview.start'), title: home.address || '' });
      markers.push(newPin(hi ? '1' : null, hi ? blockName(hi) : undefined));
    }
  }

  /* ---------- the facts of the moment highlighted (as « Voir sur la carte » says them) ---------- */
  const roadA = trA ? roadTotal(trA) : null;
  const mine = trA?.stops.find((s) => s.id === NEW_STOP);
  // the route is the car's or the truck's: never a vehicle's or a mechanic's name
  const both = activeTrucks.value.some((x) => x.tire_machine === false) && activeTrucks.value.some((x) => x.tire_machine !== false);
  const kindOf = (id: string | null | undefined): 'car' | 'truck' => (activeTrucks.value.find((x) => x.id === id)?.tire_machine === false ? 'car' : 'truck');
  const truckName = both ? t(kindOf(placed?.truckId) === 'car' ? 'booking.kind.ofCar' : 'booking.kind.ofTruck') : t('booking.kind.ofRoute');

  const dayWords = day ? longDay(day, l) : '';
  return (
    <section class="mm" aria-labelledby="mm-title" data-testid="moment-map">
      <div class="bp-head"><h3 id="mm-title" class="bp-title"><Route size={18} aria-hidden="true" />{t('booking.mm.title')}</h3></div>

      {/* the days of the calendar page */}
      <div class="mm-days" ref={strip} role="group" aria-label={t('booking.mm.days')} data-testid="mm-days">
        <button type="button" class={`mm-day mm-day-all${day ? '' : ' is-on'}`} aria-pressed={!day} onClick={() => setSel(null)} data-testid="mm-day-all">
          <span class="mm-day-name">{t('booking.mm.all')}</span>
          <span class="mm-day-sub">{t('booking.mm.allSub')}</span>
        </button>
        {chips.map((c) => (
          <button key={c.day} type="button" class={`mm-day${c.day === day ? ' is-on' : ''}${c.far ? ' is-far' : ''}`} aria-pressed={c.day === day} disabled={!c.open && c.day !== day}
            onClick={() => setSel(c.day)} data-testid={`mm-day-${c.day}`}>
            <span class="mm-day-name">{tinyDay(c.day, l)}</span>
            <span class="mm-day-sub">{t('booking.mm.jobs', { n: c.jobs })}</span>
            {!c.open ? <span class="mm-day-sub">{t(`booking.picker.state.${c.shut === 'full' ? 'full' : 'closed'}`)}</span>
              : c.far ? <span class="mm-day-far"><Route size={13} aria-hidden="true" />{t('booking.mm.far')}</span>
              : c.add != null ? <span class="mm-day-add">{t('booking.mm.adds', { d: duration(c.add, l) })}</span> : null}
            {c.best && <span class="mm-day-best"><Pill tone="ok" dot={false}>{t('booking.picker.best')}</Pill></span>}
          </button>
        ))}
      </div>

      <MapView markers={markers} lines={lines} height={wide.value ? '420px' : '340px'} controls fitKey={day || 'all'}
        label={day ? t('booking.mm.mapDay', { day: dayWords }) : t('booking.mm.mapAll')} data-testid="mm-map" />

      {!day && <p class="faint small mm-hint" data-testid="mm-hint">{t('booking.mm.hintAll')}</p>}

      {/* the moment highlighted, in a few facts */}
      {day && placed && (
        <ul class="bp-preview-facts" data-testid="mm-facts">
          {trA && mine ? (
            <>
              <li><b>{t('booking.preview.stop', { n: mine.n, total: trA.total, truck: truckName })}</b></li>
              {roadA && <li>{t('booking.preview.day', { km: fmtKm(roadA.km, l), d: duration(roadA.minutes, l) })}</li>}
            </>
          ) : <li>{t('booking.preview.noTruck')}</li>}
        </ul>
      )}

      {/* the blocks of the day: a tap shows the route with the stop in that block, and chooses it */}
      {day && row && (
        <div class="bp-sugg-list mm-blocks" role="group" aria-label={t('booking.mm.blocks', { day: dayWords })} data-testid="mm-blocks">
          {row.blocks.map((c) => {
            const off = c.state === 'closed' || c.state === 'started';
            const on = !!p.value && p.value.day === day && p.value.block === c.key;
            const m = moments.get(`${day}|${c.key}`);
            const rank = perBlock[c.key];
            const tr = truckOf(c.key);
            const road = off || c.state === 'full' ? ''
              : m && m.add_min != null ? (m.add_km != null ? t('booking.mm.addsKm', { d: duration(m.add_min, l), km: fmtKm(m.add_km, l) }) : t('booking.mm.adds', { d: duration(m.add_min, l) }))
              : m ? roadWords(m, l).replace(/^./, (ch) => ch.toUpperCase())
              : rank ? t('booking.mm.addsLine', { km: fmtKm(rank.extraKm, l) }) : '';
            return (
              <button key={c.key} type="button" class={`bp-sugg-row mm-block${on ? ' is-on' : ''}${hi === c.key ? ' is-hi' : ''}`} aria-pressed={on} disabled={off}
                onClick={() => p.onPick(day, c.key)} data-testid={`mm-block-${c.key}`}>
                <span class="bp-sugg-main">
                  <span class="bp-sugg-title">{blockName(c.key)}, {clockRange(c.start, c.end, l)}</span>
                  {off || c.state === 'full' ? <span class="bp-sugg-sub">{t(`booking.picker.state.${c.state}`, { d: duration(c.left, l) })}</span> : (
                    <>
                      {both && tr && <span class={`bp-kind-tag is-${kindOf(tr)}`}>{kindOf(tr) === 'car' ? <Car size={16} aria-hidden="true" /> : <Truck size={16} aria-hidden="true" />}{t(`booking.kind.with.${kindOf(tr)}`)}</span>}
                      {rank && <span class="bp-order-tag"><ListOrdered size={16} aria-hidden="true" />{rank.total === 1 ? t('booking.picker.orderOnly') : t('booking.picker.order', { n: rank.n, total: rank.total })}</span>}
                      {road && <span class="bp-sugg-sub">{road}</span>}
                      {isFar(m) && <span class="mm-block-far" data-testid="mm-block-far"><Route size={14} aria-hidden="true" />{t('booking.far.legend')}</span>}
                    </>
                  )}
                </span>
                <span class="bp-tick" aria-hidden="true">{on && <Check size={22} />}</span>
              </button>
            );
          })}
          {!row.blocks.some((c) => c.state !== 'closed' && c.state !== 'started') && <p class="muted small bp-note mm-none">{t('booking.mm.noBlock')}</p>}
        </div>
      )}
    </section>
  );
}
