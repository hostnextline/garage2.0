/* « Choisir sur la carte » — the first way to choose the moment (booking, moving a job): the days of the calendar page
   in a strip, a map that is always there, and the three blocks of the day chosen.
   « Tous les jours »: every coming appointment of the page around the new address. A day: that day's routes by the
   streets with the new appointment in its place for the block highlighted. Tapping a block picks it (the same choice
   as a calendar cell). From the phone's copy of the days; the scores are the server's (BlockPicker keeps them).
   « Vraies routes » OFF (the rollback state): the new stop where the phone's estimate puts it (placeNewStop: the place
   and the number only, never a km of it); what a block adds is the server's row, else, for the block highlighted, what
   the map's own roads say (roadAdded: one planner for both totals), else nothing.
   ON: the phone decides nothing by straight line: the vehicle, the place and the order come from the server's row
   (placeOn; blocks mode says nothing of the order, so the new stop is a pin without a number), what it adds is the row's
   (blockAdds: « route pas encore mesurée » while a trip is not measured). The roads are asked for the day shown and the
   words under the map say when they are not drawn yet (roadNote). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, Route, ListOrdered } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { tinyDay, longDay, duration, clockRange, type BlockKey } from '../../lib/dates';
import { wide } from '../../platform/media';
import { allJobs, jobsBetween, customer, settings, activeTrucks, truckColor, staffName, roadsOn } from '../../data/select';
import { Pill } from '../../ui';
import { MapView, type MapMarker, type MapLine } from '../map/MapView';
import { assemble, UNPLACED_COLOR, type TruckRoute } from '../map/assemble';
import { useRoads, roadOf, roadTotal, roadAdded } from '../map/useRoads';
import { placeNewStop, placeOn, fmtKm, NEW_STOP, NEW_STOP_COLOR, type PlacedOn } from './preview';
import { dayOf } from './deviceDay';
import { MapHover } from './RoutePreview';
import { roadNote } from './roadNote';
import { groupBox } from './hooks';
import { bothKinds, kindOf as kindOfTruck } from './vehicles';
import { KindTag } from './parts';
import { isFar, momentsByKey, roadWords, type CellState, type Moment } from '../../domain/moment/logic';
import { blockAdds, dayFromRow, rowOfTruck, serverRank, type ServerPlace } from '../../domain/moment/serverPlace';
import { dayChips, defaultBlock, dayCounts, overviewPins } from '../../domain/moment/days';

export interface MomentMapProps {
  lat: number; lng: number; address: string;
  /** the days of the calendar page, each with its blocks as the calendar shows them */
  cells: { day: string; blocks: { key: BlockKey; start: number; end: number; state: CellState; left: number }[] }[];
  /** every moment the server scored, the best first (none without the network) */
  list: (Moment & ServerPlace & { drive_min: number; truck?: string | null })[];
  value: { day: string; block: BlockKey } | null;
  onPick: (day: string, block: BlockKey) => void;
  /** moving a job: it is not drawn at its old place */
  excludeJob?: string | null;
  truckId?: string | null;
  /** computers: no map in the page; it opens in a window beside the picker for the day or the moment under the mouse.
      `hoverProps` are the mouse handlers of a moment (BlockPicker owns that window) */
  pop?: boolean;
  hoverProps?: (day: string, block: BlockKey) => Record<string, unknown>;
}


const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function MomentMap(p: MomentMapProps) {
  const l = lang.value;
  const onRoads = roadsOn.value;
  const days = p.cells.map((c) => c.day);
  const moments = useMemo(() => momentsByKey(p.list), [p.list]);

  /* the day shown: the one of the moment chosen (from the list or the calendar too), or the one tapped here */
  const [sel, setSel] = useState<string | null>(p.value?.day ?? null);
  useEffect(() => { if (p.value) setSel(p.value.day); }, [p.value?.day, p.value?.block]);
  const row = sel ? p.cells.find((c) => c.day === sel) : undefined;
  const day = row ? row.day : null;
  const hi: BlockKey | null = row ? (p.value && p.value.day === row.day ? p.value.block : defaultBlock(row.blocks, row.day, p.list)) : null;

  /* the appointments already there (the phone's copy) */
  // kept while the store does not change, so the memos below that depend on it hold between drawings
  const all = allJobs.value;
  const first = days[0], last = days[days.length - 1];
  const jobs = useMemo(() => (first ? jobsBetween(first, last) : []), [all, first, last]);
  const chips = dayChips(p.cells, p.list, dayCounts(jobs, days, p.excludeJob));
  const pins = useMemo(() => (day && !p.pop ? [] : overviewPins(jobs, days, { exclude: p.excludeJob, posOf: (j) => customer(j.customer_id) })), [day, p.pop, jobs, days.join('|'), p.excludeJob]);

  /* the strip follows the day shown (sideways only: the page does not jump) */
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = strip.current;
    const on = box?.querySelector<HTMLElement>('.mm-day.is-on');
    if (box && on) box.scrollLeft = on.offsetLeft - (box.clientWidth - on.clientWidth) / 2;
  }, [day, days[0]]);

  /* ---------- a day: its routes, the new stop in each block ---------- */
  const truckOf = (block: BlockKey) => p.truckId || (day ? moments.get(`${day}|${block}`)?.truck : null) || null;
  /** the server's row of a block of the day shown (none: offline, or a block it did not offer) */
  const rowOf = (block: BlockKey) => (day ? moments.get(`${day}|${block}`) ?? null : null);
  const base = useMemo(() => (day ? dayOf(day, p.excludeJob) : null), [day, p.excludeJob, jobs]);
  const placedOf = (block: BlockKey): PlacedOn => {
    const spot = { day: day!, block, truckId: truckOf(block), lat: p.lat, lng: p.lng, name: '', address: p.address, row: rowOf(block) };
    if (onRoads) return placeOn(base!, spot);
    const pl = placeNewStop(base!, spot);
    return { before: pl.before, after: pl.after, truckId: pl.truckId, rank: null };
  };
  /* « Arrêt n sur N » of each block: off, the phone's estimate (as before); on, only the server's (window mode: never here) */
  const perBlock = useMemo(() => {
    const out = {} as Record<string, { n: number; total: number } | null>;
    if (!base || !row) return out;
    for (const c of row.blocks) {
      if (c.state === 'closed' || c.state === 'started') { out[c.key] = null; continue; }
      if (onRoads) { out[c.key] = serverRank(rowOf(c.key), truckOf(c.key)); continue; }
      const pl = placeNewStop(base, { day: day!, block: c.key, truckId: truckOf(c.key), lat: p.lat, lng: p.lng, name: '', address: p.address });
      const mine = pl.after.jobs.filter((j) => j.truck_id === pl.truckId);
      const n = mine.find((j) => j.id === NEW_STOP)?.order;
      out[c.key] = pl.truckId && n ? { n, total: mine.length } : null;
    }
    return out;
  }, [base, row?.blocks.map((c) => c.key + c.state).join('|'), p.lat, p.lng, p.truckId, moments, onRoads]);
  const placed = useMemo(() => (base && hi ? placedOf(hi) : null), [base, hi, p.lat, p.lng, p.truckId, moments, onRoads]);
  const after = useMemo(() => (base ? assemble(placed ? placed.after : base, { nameOf: staffName }) : null), [base, placed]);
  const before = useMemo(() => (placed ? assemble(placed.before, { nameOf: staffName }) : null), [placed]);
  const trA: TruckRoute | undefined = placed && placed.truckId ? after?.trucks.find((x) => x.id === placed.truckId) : undefined;
  const trB: TruckRoute | undefined = placed && placed.truckId ? before?.trucks.find((x) => x.id === placed.truckId) : undefined;
  /* the streets, for the day shown (its usual hours: build-maps « For the lead »); only for a day (the overview has no
     lines). Off: the day without the stop too, for what it adds (the same planner for both totals, roadAdded) */
  const drawn = day && after && !p.pop ? after.trucks : [];
  useRoads(day && after && !p.pop ? [...after.trucks, ...(trB && !onRoads ? [trB] : [])] : [], day);
  const note = day ? roadNote(drawn.filter((tr) => tr.stops.some((s) => s.hasPos)), day) : '';

  /* ---------- what the map draws ---------- */
  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const home = settings.value.booking?.home;
  const blockName = (b: string) => t(`common.blocks.${b}`);
  const newPin = (n: number | string | null, sub?: string): MapMarker => ({ id: NEW_STOP, kind: 'job', lat: p.lat, lng: p.lng, color: NEW_STOP_COLOR, number: n, active: true,
    label: t('booking.preview.newLabel'), sub, title: t('booking.preview.newLabel') });
  const overview = (): MapMarker[] => {
    // the overview: the starts, every coming appointment, the new address
    const out: MapMarker[] = [];
    if (home && home.lat != null && home.lng != null) out.push({ id: 'home', kind: 'home', lat: home.lat, lng: home.lng, label: home.label || t('booking.preview.start'), title: home.address || '' });
    for (const tr of activeTrucks.value) if (tr.start) out.push({ id: `start-${tr.id}`, kind: 'customer', lat: tr.start.lat, lng: tr.start.lng, color: truckColor(tr.id), label: tr.start.label || t('booking.preview.start'), title: tr.start.address || '' });
    for (const pin of pins) {
      const open = chips.find((c) => c.day === pin.day)?.open;
      out.push({ id: pin.id, kind: 'job', lat: pin.lat, lng: pin.lng, color: pin.truckId ? truckColor(pin.truckId) : UNPLACED_COLOR, number: Number(pin.day.slice(8)),
        /* the date in the dot only: a label on every dot hid the map where appointments are close together */
        title: `${tinyDay(pin.day, l)}, ${blockName(pin.block).toLowerCase()}`, onClick: open && !p.pop ? () => setSel(pin.day) : undefined });
    }
    out.push(newPin(null));
    return out;
  };
  /* computers: « Tous les jours » under the mouse opens the overview in the map window */
  const [allAt, setAllAt] = useState<{ at: DOMRect; group: DOMRect | null } | null>(null);
  if (p.pop) {
    // no map in the page: nothing to draw here
  } else if (!day || !after) {
    markers.push(...overview());
  } else {
    let homeDrawn = false;
    for (const tr of after.trucks) {
      if (!tr.stops.length) continue;
      if (tr.from && tr.start) markers.push({ id: `start-${tr.id}`, kind: 'customer', lat: tr.from[0], lng: tr.from[1], color: tr.color, label: tr.start.label || t('booking.preview.start'), title: tr.start.address });
      else if (tr.from && !homeDrawn) { homeDrawn = true; markers.push({ id: 'home', kind: 'home', lat: tr.from[0], lng: tr.from[1], label: after.home?.label || t('booking.preview.start'), title: after.home?.address || '' }); }
      // switch on with the server's order (window mode): each stop keeps its place in the server's route
      const numberOf = (x: TruckRoute['stops'][number]): number | string => (onRoads && placed?.rank && tr.id === placed.truckId ? x.order ?? '' : x.n);
      for (const s of tr.stops) {
        if (!s.hasPos) continue;
        if (s.id === NEW_STOP) markers.push(newPin(onRoads && placed?.rank ? placed.rank.n : s.n, blockName(s.block)));
        else { const n = numberOf(s); markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: n, done: s.done, label: s.name || undefined, sub: blockName(s.block), title: n === '' ? s.name : `${n}. ${s.name}` }); }
      }
      for (const leg of tr.legs) lines.push({ points: roadOf(leg, day), color: tr.color, weight: 4, opacity: leg.kind === 'done' ? 0.32 : 0.85 });
    }
    for (const s of after.unplaced) if (s.hasPos && s.id !== NEW_STOP) markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: UNPLACED_COLOR, number: '', label: s.name || undefined, sub: blockName(s.block), title: s.name });
    if (!markers.some((m) => m.id === NEW_STOP)) {
      if (!homeDrawn && home && home.lat != null && home.lng != null) markers.push({ id: 'home', kind: 'home', lat: home.lat, lng: home.lng, label: home.label || t('booking.preview.start'), title: home.address || '' });
      // switch on: its place is not known (no number); off, alone that day (« 1 »)
      markers.push(newPin(hi ? (onRoads ? '' : '1') : null, hi ? blockName(hi) : undefined));
    }
  }

  /* ---------- the facts of the moment highlighted (as « Voir sur la carte » says them) ---------- */
  const roadA = trA ? roadTotal(trA, day) : null;
  const mine = trA?.stops.find((s) => s.id === NEW_STOP);
  /* off, a block the server said nothing of: what the stop adds by the streets, for the block highlighted only (the map
     has its roads), from two totals of the same planner (never a straight-line km) */
  const addedHi = !onRoads && trA && mine ? roadAdded(trA, trB, day) : null;
  // the route is the car's or the truck's: never a vehicle's or a mechanic's name
  const both = bothKinds(activeTrucks.value);
  const kindOf = (id: string | null | undefined) => kindOfTruck(activeTrucks.value, id);
  const truckName = both ? t(kindOf(placed?.truckId) === 'car' ? 'booking.kind.ofCar' : 'booking.kind.ofTruck') : t('booking.kind.ofRoute');
  // on: the day of the vehicle drawn with this appointment, from its own row (never another vehicle's: L1)
  const hiDay = onRoads && hi && placed ? dayFromRow(rowOfTruck(rowOf(hi), placed.truckId || p.truckId), l) : '';

  const dayWords = day ? longDay(day, l) : '';
  // a day under the mouse: the window shows its best moment
  const hoverDay = (d: string) => {
    if (!p.pop || !p.hoverProps) return {};
    const r = p.cells.find((c) => c.day === d);
    const b = r ? (p.value && p.value.day === d ? p.value.block : defaultBlock(r.blocks, d, p.list)) : null;
    return b ? p.hoverProps(d, b) : {};
  };
  return (
    <section class="mm" aria-labelledby="mm-title" data-testid="moment-map">
      <div class="bp-head"><h3 id="mm-title" class="bp-title"><Route size={18} aria-hidden="true" />{t('booking.mm.title')}</h3></div>

      {/* the days of the calendar page */}
      <div class="mm-days" ref={strip} role="group" aria-label={t('booking.mm.days')} data-testid="mm-days">
        <button type="button" class={`mm-day mm-day-all${day ? '' : ' is-on'}`} aria-pressed={!day} onClick={() => setSel(null)} data-testid="mm-day-all"
          {...(p.pop ? { onMouseMove: (e: MouseEvent) => { const el = e.currentTarget as HTMLElement; if (!allAt) setAllAt({ at: el.getBoundingClientRect(), group: groupBox(el) }); }, onMouseLeave: () => setAllAt(null) } : {})}>
          <span class="mm-day-name">{t('booking.mm.all')}</span>
          <span class="mm-day-sub">{t('booking.mm.allSub')}</span>
        </button>
        {chips.map((c) => (
          <button key={c.day} type="button" class={`mm-day${c.day === day ? ' is-on' : ''}${c.far ? ' is-far' : ''}`} aria-pressed={c.day === day} disabled={!c.open && c.day !== day}
            onClick={() => setSel(c.day)} data-testid={`mm-day-${c.day}`} {...(c.open ? hoverDay(c.day) : {})}>
            <span class="mm-day-name">{tinyDay(c.day, l)}</span>
            <span class="mm-day-sub">{t('booking.mm.jobs', { n: c.jobs })}</span>
            {!c.open ? <span class="mm-day-sub">{t(`booking.picker.state.${c.shut === 'full' ? 'full' : 'closed'}`)}</span>
              : c.far ? <span class="mm-day-far"><Route size={13} aria-hidden="true" />{t('booking.mm.far')}</span>
              : c.add != null ? <span class="mm-day-add">{t('booking.mm.adds', { d: duration(c.add, l) })}</span>
              : c.unmeasured ? <span class="mm-day-add" data-testid="mm-day-unmeasured">{t('booking.mm.unmeasured')}</span> : null}
            {c.best && <span class="mm-day-best"><Pill tone="ok" dot={false}>{t('booking.picker.best')}</Pill></span>}
          </button>
        ))}
      </div>

      {p.pop ? (
        <>
          <p class="faint small mm-hint" data-testid="mm-hint">{t('booking.mm.hintHover')}</p>
          {allAt && <MapHover at={allAt.at} group={allAt.group} title={t('booking.mm.mapAll')} markers={overview()} data-testid="mm-hover-all" />}
        </>
      ) : (
        <>
      <MapView markers={markers} lines={lines} height={wide.value ? '420px' : '340px'} controls fitKey={day || 'all'}
            label={day ? t('booking.mm.mapDay', { day: dayWords }) : t('booking.mm.mapAll')} data-testid="mm-map" />

          {!day && <p class="faint small mm-hint" data-testid="mm-hint">{t('booking.mm.hintAll')}</p>}

          {/* the moment highlighted, in a few facts */}
          {day && placed && (
            <ul class="bp-preview-facts" data-testid="mm-facts">
              {onRoads ? (
                <>
                  <li><b>{placed.rank ? t('booking.preview.stop', { n: placed.rank.n, total: placed.rank.total, truck: truckName })
                    : placed.truckId ? t('booking.preview.stopLater', { truck: truckName })
                    : after?.trucks.length ? t(both ? 'booking.preview.noVehicleYet' : 'booking.preview.noTruckYet') : t('booking.preview.noTruck')}</b></li>
                  {hiDay && <li data-testid="mm-facts-day">{hiDay}</li>}
                </>
              ) : trA && mine ? (
                <>
                  <li><b>{t('booking.preview.stop', { n: mine.n, total: trA.total, truck: truckName })}</b></li>
                  {roadA && <li>{t('booking.preview.day', { km: fmtKm(roadA.km, l), d: duration(roadA.minutes, l) })}</li>}
                </>
              ) : <li>{t('booking.preview.noTruck')}</li>}
            </ul>
          )}
          {day && note && <p class="faint small mm-hint" data-testid="mm-road">{note}</p>}
        </>
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
            // on: the row of this block's own vehicle, never a number while a trip is not measured (blockAdds)
            const mr = onRoads ? rowOfTruck(m, tr) : null;
            const road = off || c.state === 'full' ? ''
              : onRoads ? (mr ? cap(blockAdds(mr, l) || roadWords(mr, l)) : '')
              : m && m.add_min != null ? (m.add_km != null && Number.isFinite(m.add_km) ? t('booking.mm.addsKm', { d: duration(m.add_min, l), km: fmtKm(m.add_km, l) }) : t('booking.mm.adds', { d: duration(m.add_min, l) }))
              : m ? cap(roadWords(m, l))
              // off, no row: only the block highlighted, by the map's own roads (one planner), else nothing
              : c.key === hi && addedHi ? t('booking.mm.addsKm', { d: duration(addedHi.minutes, l), km: fmtKm(addedHi.km, l) }) : '';
            return (
              <button key={c.key} type="button" class={`bp-sugg-row mm-block${on ? ' is-on' : ''}${hi === c.key ? ' is-hi' : ''}`} aria-pressed={on} disabled={off}
                onClick={() => p.onPick(day, c.key)} data-testid={`mm-block-${c.key}`} {...(p.pop && p.hoverProps && !off ? p.hoverProps(day, c.key) : {})}>
                <span class="bp-sugg-main">
                  <span class="bp-sugg-title">{blockName(c.key)}, {clockRange(c.start, c.end, l)}</span>
                  {off || c.state === 'full' ? <span class="bp-sugg-sub">{t(`booking.picker.state.${c.state}`, { d: duration(c.left, l) })}</span> : (
                    <>
                      {both && tr && <KindTag kind={kindOf(tr)} size={16} />}
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
