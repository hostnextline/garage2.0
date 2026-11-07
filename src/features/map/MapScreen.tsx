/* La carte de l'équipe (#/map, ?day=YYYY-MM-DD): le départ des camions (la Centrale), chaque camion dans sa couleur avec ses arrêts numérotés
   et sa route par les rues (pas à vol d'oiseau: roads.ts), les mécanos en direct, les trajets en cours. Mise à jour toutes les 30 s (team_map); sans réseau, la
   dernière réponse reste (avec son heure), sinon la copie du téléphone.
   Téléphone: la carte prend tout l'écran, la liste monte du bas. Ordinateur: la carte et la liste côte à côte. */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { RefreshCw, Navigation, ChevronUp, ChevronDown, Check, Truck, X, LocateFixed, CalendarPlus, Settings2, MapPinOff } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { may } from '../../app/routes';
import { setQuery, href } from '../../app/router';
import { wide } from '../../app/media';
import { t, lang } from '../../lib/i18n';
import { today, addDays, longDay, clock, isValidDay, nowMinute } from '../../lib/dates';
import { rpcNow, errorMessage } from '../../data/api';
import { isNetworkError, flush } from '../../data/sync';
import { locateMissing } from '../../app/locator';
import { access, can } from '../../data/auth';
import { staffName, job as jobRow, customer as customerRow } from '../../data/select';
import { Page, Seg, Banner, Empty, Button, IconButton, StatusPill, Help, Pill, toast } from '../../ui';
import { MapView, type MapMarker, type MapLine } from './MapView';
import { assemble, normalize, minuteOf, UNPLACED_COLOR, type TeamMapAnswer, type Stop, type TruckRoute, type Assembled } from './assemble';
import type { JobStatus } from '../../data/types';
import { fromDevice } from './device';
import { routeThrough, knownLeg, knownTotal, allKnown, type LatLng } from './roads';
import { ago, minutesSince } from './ago';
import './map.css';

const REFRESH_MS = 30000;
const STALE_MIN = 15;
interface Loaded { data: TeamMapAnswer; at: number; source: 'server' | 'device' }
/* the last answer of each day, for this person (kept while the app is open; never written to the phone) */
const memory = new Map<string, { data: TeamMapAnswer; at: number }>();
const memKey = (day: string) => `${access.value?.id || ''}|${day}`;

type Focus = string | null;   // a truck id, 'unplaced', or null (everyone)

export default function MapScreen({ query }: ScreenProps) {
  const q = query.get('day');
  const day = isValidDay(q) ? q : today();
  const isWide = wide.value;
  const live = day === today();
  const [loaded, setLoaded] = useState<Loaded>(() => first(day));
  const [status, setStatus] = useState<'loading' | 'ok' | 'offline' | 'refused'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [focus, setFocus] = useState<Focus>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pan, setPan] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const [reload, setReload] = useState(0);

  /* the answer of the server, now and every 30 s (paused while the app is hidden) */
  useEffect(() => {
    let alive = true;
    setLoaded(first(day));
    setStatus('loading');
    setFocus(null); setSelected(null); setPan(null);
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setBusy(true);
      try {
        const data = normalize(await rpcNow<unknown>('team_map', { p_day: day }));
        if (!alive) return;
        const at = Date.now();
        memory.set(memKey(day), { data, at });
        setLoaded({ data, at, source: 'server' });
        setStatus('ok'); setError(null);
      } catch (e) {
        if (!alive) return;
        if (isNetworkError(e)) setStatus('offline');
        else { setStatus('refused'); setError(errorMessage(e)); }
      } finally {
        if (alive) { setBusy(false); setNow(Date.now()); }
      }
    };
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    const onShow = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onShow); };
  }, [day, reload]);

  const m: Assembled = useMemo(() => {
    const a = assemble(loaded.data, { nameOf: staffName });
    return live ? a : { ...a, people: [], trips: [], trucks: a.trucks.filter((tr) => tr.total > 0).map((tr) => ({ ...tr, trip: null, legs: tr.legs.map((l) => (l.kind === 'trip' ? { ...l, kind: 'todo' as const } : l)) })) };
  }, [loaded, live]);

  /* the road route of each truck (Centrale → stops, in order): asked once per truck, then kept */
  const [, setRoadsIn] = useState(0);
  const waypoints = (tr: TruckRoute): LatLng[] => [...(tr.from ? [tr.from] : []), ...tr.stops.filter((s) => s.hasPos).map((s) => [s.lat!, s.lng!] as LatLng)];
  const routeSig = m.trucks.map((tr) => `${tr.id}:${waypoints(tr).map((p) => p.join(',')).join(';')}`).join('|');
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const tr of m.trucks) {
        const pts = waypoints(tr);
        if (pts.length < 2 || (allKnown(pts) && knownTotal(pts))) continue;
        const r = await routeThrough(pts);
        if (!alive) return;
        if (r) setRoadsIn((n) => n + 1);
        await new Promise((res) => setTimeout(res, 350));   // gentle with the free route planner
      }
    })();
    return () => { alive = false; };
  }, [routeSig]);
  const roadOf = (tr: TruckRoute) => { const pts = waypoints(tr); return pts.length >= 2 ? knownTotal(pts) : null; };

  const truckOf = (id: string | null) => m.trucks.find((tr) => tr.id === id) || null;
  const allStops: (Stop & { color: string; truckName: string })[] = [
    ...m.trucks.flatMap((tr) => tr.stops.map((s) => ({ ...s, color: tr.color, truckName: tr.name }))),
    ...m.unplaced.map((s) => ({ ...s, color: UNPLACED_COLOR, truckName: t('map.legend.unplaced') }))
  ];
  const sel = selected ? allStops.find((s) => s.id === selected) || null : null;
  const dimTruck = (truckId: string | null) => focus != null && (focus === 'unplaced' ? truckId != null && !!truckOf(truckId) : focus !== truckId);

  /* what the map draws */
  const markers: MapMarker[] = [];
  if (m.home) markers.push({ id: 'home', kind: 'home', lat: m.home.lat, lng: m.home.lng, label: m.home.label, title: [m.home.label, m.home.address].filter(Boolean).join(', ') });
  // a truck that leaves from its own address: its start, in its colour
  for (const tr of m.trucks) {
    if (!tr.start) continue;
    const name = tr.start.label || t('map.legend.ownStart', { name: tr.name });
    markers.push({ id: `start-${tr.id}`, kind: 'customer', lat: tr.start.lat, lng: tr.start.lng, color: tr.color, label: name, dim: dimTruck(tr.id),
      title: [name, tr.start.address].filter(Boolean).join(', ') });
  }
  for (const tr of m.trucks) {
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      const tripHere = tr.trip && tr.trip.jobId === s.id && !s.done ? tr.trip : null;
      const etaMin = tripHere ? minuteOf(tripHere.etaAt) : null;
      markers.push({
        id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: s.n, done: s.done,
        active: selected === s.id || !!tripHere, dim: dimTruck(tr.id),
        label: selected === s.id ? s.name : tripHere && etaMin != null ? t('map.tripLabel', { time: clock(etaMin, lang.value) }) : undefined,
        sub: selected === s.id ? tr.name : undefined,
        title: `${t('map.stop.number', { n: s.n })}, ${s.name}`, onClick: () => choose(s.id, false)
      });
    }
  }
  for (const s of m.unplaced) {
    if (!s.hasPos) continue;
    markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: UNPLACED_COLOR, number: '?', active: selected === s.id, dim: focus != null && focus !== 'unplaced',
      label: selected === s.id ? s.name : undefined, title: `${t('map.legend.unplaced')}, ${s.name}`, onClick: () => choose(s.id, false) });
  }
  for (const p of m.people) {
    const age = minutesSince(p.at, now);
    const stale = age != null && age >= STALE_MIN;
    markers.push({ id: `p:${p.id}`, kind: 'person', lat: p.lat, lng: p.lng, color: p.color, label: p.name, sub: stale ? t('map.people.stale', { ago: ago(p.at, now) }) : ago(p.at, now),
      dim: stale || (focus != null && focus !== p.truckId), title: p.name });
  }
  const lines: MapLine[] = [];
  for (const tr of m.trucks) {
    const dim = dimTruck(tr.id);
    for (const leg of tr.legs) {
      // by the streets once the route planner answered (the live trip already follows them)
      const road = leg.kind !== 'trip' && leg.points.length === 2 ? knownLeg(leg.points[0], leg.points[1]) : null;
      lines.push({ points: road || leg.points, color: tr.color, dashed: leg.kind === 'trip', weight: leg.kind === 'trip' ? 5 : 4,
        opacity: dim ? 0.14 : leg.kind === 'done' ? 0.32 : leg.kind === 'trip' ? 0.95 : 0.8 });
    }
  }
  const fitIds: string[] | null = pan ? [pan]
    : focus === 'unplaced' ? m.unplaced.filter((s) => s.hasPos).map((s) => s.id)
    : focus ? (() => { const tr = truckOf(focus); if (!tr) return null; const ids = tr.stops.filter((s) => s.hasPos).map((s) => s.id); const p = m.people.find((x) => x.id === tr.driverId || x.truckId === tr.id); if (p) ids.push(`p:${p.id}`); return ids.length ? ids : null; })()
    : null;

  function choose(id: string, fromList: boolean) {
    setSelected(id);
    setPan(fromList ? id : null);
    if (fromList && !isWide) setOpen(false);
  }
  function toggleFocus(id: string) {
    setPan(null);
    setFocus((f) => (f === id ? null : id));
  }
  const recenter = () => { setPan(null); setFocus(null); setSelected(null); setFitKey((k) => k + 1); };

  /* appointments of the day whose address has no position yet: said on the map, with « Trouver » */
  const lost = [...m.trucks.flatMap((tr) => tr.stops), ...m.unplaced].filter((s) => !s.hasPos && !s.done);
  const [finding, setFinding] = useState(false);
  const findLost = async () => {
    setFinding(true);
    try {
      const r = await locateMissing({ only: { jobs: lost.map((s) => s.id) }, force: true });
      if (r.offline) toast(t('map.lost.offline'), { kind: 'bad' });
      else if (r.found) {
        toast(t('map.lost.found', { n: r.found }), { kind: 'ok' });
        // the positions found are on this phone already: on the map now; the server's answer follows
        setLoaded((cur) => ({ ...cur, data: { ...cur.data, jobs: cur.data.jobs.map((j) => {
          if (j.lat != null && j.lng != null) return j;
          const row = jobRow(j.id);
          const c = row?.customer_id ? customerRow(row.customer_id) : undefined;
          const p = r.placed[j.id] || (row?.lat != null && row?.lng != null ? { lat: row.lat, lng: row.lng } : c?.lat != null && c?.lng != null ? { lat: c.lat, lng: c.lng } : null);
          return p ? { ...j, lat: p.lat, lng: p.lng } : j;
        }) } }));
        void flush().catch(() => undefined).finally(() => setReload((n) => n + 1));
      }
      else toast(t('map.lost.none'), { kind: 'bad' });
    } finally { setFinding(false); }
  };

  /* words */
  const updated = t('map.updated', { time: clock(nowMinuteOf(loaded.at), lang.value) });
  const summary = t('map.summary', { trucks: t('map.trucksCount', { n: m.trucks.length }), stops: t('map.stopsCount', { n: m.count }) });
  const daySwitch = (
    <Seg label={t('map.dayLabel')} value={day} onValue={(d) => setQuery({ day: d === today() ? null : d })} data-testid="map-day"
      options={[{ value: addDays(today(), -1), label: t('map.days.yesterday') }, { value: today(), label: t('map.days.today') }, { value: addDays(today(), 1), label: t('map.days.tomorrow') }]} />
  );
  const notices = (
    <>
      {status === 'offline' && <Banner kind="warn" data-testid="map-offline">{loaded.source === 'server' ? t('map.offline', { time: clock(nowMinuteOf(loaded.at), lang.value) }) : t('map.offlineDevice')}</Banner>}
      {status === 'refused' && <Banner kind="bad" title={t('map.refused')} action={<Button size="sm" onClick={() => setReload((n) => n + 1)}>{t('common.retry')}</Button>}>{error}</Banner>}
      {!m.home && (status === 'ok' || loaded.source === 'server') && (
        <Banner kind="info" action={can('settings') ? <Button size="sm" icon={<Settings2 size={16} />} href="#/settings/booking">{t('map.noHomeAction')}</Button> : undefined}>{t('map.noHome')}</Banner>
      )}
    </>
  );

  /* one short line about freshness (and the trouble, if any) */
  const timeOf = clock(nowMinuteOf(loaded.at), lang.value);
  const line = status === 'offline' ? (loaded.source === 'server' ? t('map.offlineShort', { time: timeOf }) : t('map.offlineDeviceShort'))
    : status === 'refused' ? t('map.refused')
    : loaded.source === 'device' ? (busy ? t('map.updating') : t('map.device'))
    : updated;
  const warnLine = status === 'offline' || status === 'refused';
  const empty = (
    <Empty title={t('map.empty.title')} text={t('map.empty.text')}
      action={may.book() ? <Button variant="primary" icon={<CalendarPlus size={18} />} href={href('/book', { day })}>{t('map.empty.book')}</Button> : undefined} />
  );
  const closeCard = () => { setSelected(null); setPan(null); };

  return (
    <Page title={t('map.title')} sub={longDay(day, lang.value)} help={t('map.help')} data-testid="map-screen"
      actions={isWide ? <div class="row">{daySwitch}<IconButton icon={<RefreshCw class={busy ? 'spin-slow' : ''} />} label={t('map.refresh')} onClick={() => setReload((n) => n + 1)} data-testid="map-refresh" /></div> : undefined}>
      <Stage wide={isWide}>
        <div class="map-canvas">
          <MapView markers={markers} lines={lines} height="100%" full focus={fitIds} fitKey={fitKey} controls={isWide} label={t('map.label')}
            fitPadding={isWide ? [lost.length ? 110 : 56, 150, 56, 56] : [lost.length ? 170 : 84, 96, 140, 32]} onBackgroundClick={() => { if (selected) closeCard(); }} data-testid="map-view" />
          <div class="map-overlay">
            {!isWide && daySwitch}
            <IconButton class="map-fab" icon={<LocateFixed />} label={t('map.recenter')} onClick={recenter} data-testid="map-recenter" />
          </div>
          {lost.length > 0 && (
            <div class="map-lost glass-strong" role="status" data-testid="map-lost">
              <MapPinOff size={18} aria-hidden="true" />
              <span class="grow">{t('map.lost.text', { n: lost.length })}</span>
              {may.book() && <Button size="sm" busy={finding} onClick={() => void findLost()} data-testid="map-lost-find">{t('map.lost.find')}</Button>}
            </div>
          )}
        </div>
        {isWide ? (
          <aside class="map-side" aria-label={t('map.legend.title')}>
            <p class={`small map-line ${warnLine ? 'map-warn' : 'muted'}`} aria-live="polite" data-testid="map-status">{line}</p>
            {notices}
            {sel && <StopCard stop={sel} truck={truckOf(sel.truckId)} onClose={closeCard} />}
            <Legend m={m} focus={focus} onFocus={toggleFocus} roadOf={roadOf} />
            {m.count === 0 ? <div class="panel glass map-empty">{empty}</div> : <StopList m={m} focus={focus} selected={selected} onChoose={(id) => choose(id, true)} />}
          </aside>
        ) : (
          <PullUp open={open} onOpen={setOpen} summary={summary} status={line} warn={warnLine}
            card={sel ? <StopCard plain stop={sel} truck={truckOf(sel.truckId)} onClose={closeCard} /> : null}>
            {notices}
            <Legend plain m={m} focus={focus} onFocus={toggleFocus} roadOf={roadOf} />
            {m.count === 0 ? empty : <StopList plain m={m} focus={focus} selected={selected} onChoose={(id) => choose(id, true)} />}
            <div class="map-status small muted">
              <span>{updated}</span>
              <Button size="sm" variant="ghost" icon={<RefreshCw size={16} class={busy ? 'spin-slow' : ''} />} onClick={() => setReload((n) => n + 1)} data-testid="map-refresh">{t('map.refresh')}</Button>
            </div>
          </PullUp>
        )}
      </Stage>
    </Page>
  );
}

const kmText = (km: number) => (lang.value === 'en' ? km.toFixed(km < 10 ? 1 : 0) : km.toFixed(km < 10 ? 1 : 0).replace('.', ','));
const durText = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

function first(day: string): Loaded {
  const c = memory.get(memKey(day));
  return c ? { data: c.data, at: c.at, source: 'server' } : { data: fromDevice(day), at: Date.now(), source: 'device' };
}
const nowMinuteOf = (ms: number) => nowMinute(new Date(ms));

/* the space under the title down to the bottom of the screen (phone: under the bottom bar too) */
function Stage(p: { wide: boolean; children: ComponentChildren }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = el.current;
    if (!box) return;
    const set = () => {
      const top = Math.max(0, Math.round(box.getBoundingClientRect().top + (window.scrollY || 0)));
      box.style.setProperty('--stage-top', `${top}px`);
    };
    set();
    window.addEventListener('resize', set);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    const head = box.parentElement?.querySelector('.page-head');
    const banners = document.querySelector('.shell-banners');
    if (ro && head) ro.observe(head);
    if (ro && banners) ro.observe(banners);
    return () => { window.removeEventListener('resize', set); ro?.disconnect(); };
  }, [p.wide]);
  return <div ref={el} class={`map-stage${p.wide ? ' is-wide' : ''}`}>{p.children}</div>;
}

/* phone: the list rises from the bottom (tap or drag the handle) */
function PullUp(p: { open: boolean; onOpen: (v: boolean) => void; summary: string; status: string; warn?: boolean; card: ComponentChildren; children: ComponentChildren }) {
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  return (
    <section class={`map-pull glass-strong${p.open ? ' is-open' : ''}`} aria-label={p.summary} data-testid="map-pull">
      <button type="button" class="map-pull-handle" aria-expanded={p.open} data-testid="map-pull-handle"
        aria-label={p.open ? t('map.pull.close') : t('map.pull.open')}
        onPointerDown={(e) => { drag.current = { y: e.clientY, moved: false }; dragged.current = false; }}
        onPointerMove={(e) => { const d = drag.current; if (d && Math.abs(e.clientY - d.y) > 18) d.moved = true; }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null;
          if (d && d.moved) { dragged.current = true; const dy = e.clientY - d.y; if (dy < -18) p.onOpen(true); else if (dy > 18) p.onOpen(false); }
        }}
        onPointerCancel={() => { drag.current = null; }}
        onClick={() => { if (dragged.current) { dragged.current = false; return; } p.onOpen(!p.open); }}>
        <span class="map-grip" aria-hidden="true" />
        <span class="grow map-pull-sum">
          <b>{p.summary}</b>
          <span class={`small ${p.warn ? 'map-warn' : 'muted'}`}>{p.status}</span>
        </span>
        {p.open ? <ChevronDown size={22} aria-hidden="true" /> : <ChevronUp size={22} aria-hidden="true" />}
      </button>
      {p.card && <div class="map-pull-card">{p.card}</div>}
      {p.open && <div class="map-pull-body stack">{p.children}</div>}
    </section>
  );
}

function Legend(p: { m: Assembled; focus: Focus; onFocus: (id: string) => void; plain?: boolean; roadOf: (tr: TruckRoute) => { km: number; minutes: number } | null }) {
  const { m } = p;
  if (!m.trucks.length && !m.unplaced.length) return null;
  return (
    <section class={`panel ${p.plain ? 'panel-plain' : 'glass'} panel-flush map-legend`} data-tour="map-legend" data-testid="map-legend">
      <div class="panel-head">
        <h2 class="panel-title">{t('map.legend.title')} <Help text={t('map.legend.help')} /></h2>
      </div>
      <div class="rows" role="list">
        {m.trucks.map((tr) => <LegendRow key={tr.id} tr={tr} road={p.roadOf(tr)} on={p.focus === tr.id} onClick={() => p.onFocus(tr.id)} />)}
        {m.unplaced.length > 0 && (
          <button type="button" class="row-item map-legend-row" aria-pressed={p.focus === 'unplaced'} onClick={() => p.onFocus('unplaced')} data-testid="legend-unplaced"
            aria-label={p.focus === 'unplaced' ? t('map.legend.focusOff') : t('map.legend.focusOn', { name: t('map.legend.unplaced') })}>
            <span class="map-swatch" style={{ '--c': UNPLACED_COLOR }} aria-hidden="true">?</span>
            <span class="row-main">
              <span class="row-title">{t('map.legend.unplaced')}</span>
              <span class="row-sub">{t('map.legend.unplacedSub', { n: m.unplaced.length })}</span>
            </span>
          </button>
        )}
        {m.home && (
          <div class="row-item map-legend-row map-legend-start" role="listitem" data-testid="legend-start">
            <span class="map-swatch is-home" aria-hidden="true"><img src="./logo-his.png" alt="" width={26} height={26} draggable={false} /></span>
            <span class="row-main">
              <span class="row-title">{t('map.legend.start')}</span>
              <span class="row-sub">{[m.home.label, m.home.address].filter(Boolean).join(', ')}</span>
            </span>
            {can('settings') && (
              <span class="row-end">
                <Button size="sm" variant="ghost" href="#/settings/booking" label={t('map.legend.changeStart')} data-testid="legend-start-change">{t('map.legend.change')}</Button>
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
function LegendRow(p: { tr: TruckRoute; road: { km: number; minutes: number } | null; on: boolean; onClick: () => void }) {
  const { tr } = p;
  const progress = tr.total ? t('map.legend.progress', { n: tr.done, total: tr.total }) : t('map.legend.noStops');
  const sub = tr.driverName ? t('map.legend.withDriver', { driver: tr.driverName, progress }) : cap(progress);
  const road = p.road ? t('map.legend.road', { km: kmText(p.road.km), time: durText(p.road.minutes) }) : null;
  const finished = tr.total > 0 && tr.done === tr.total;
  return (
    <button type="button" class="row-item map-legend-row" aria-pressed={p.on} onClick={p.onClick} data-testid={`legend-${tr.id}`}
      aria-label={`${tr.name}. ${sub}.${road ? ` ${road}.` : ''} ${p.on ? t('map.legend.focusOff') : t('map.legend.focusOn', { name: tr.name })}`}>
      <span class="map-swatch" style={{ '--c': tr.color }} aria-hidden="true"><Truck size={18} /></span>
      <span class="row-main">
        <span class="row-title">{tr.name}</span>
        <span class="row-sub">{sub}</span>
        {road && <span class="row-sub map-road" data-testid={`road-${tr.id}`}>{road}</span>}
        {tr.start && <span class="row-sub" data-testid={`legend-from-${tr.id}`}>{t('map.legend.leaves', { place: tr.start.label || tr.start.address || t('map.legend.ownStart', { name: tr.name }) })}</span>}
      </span>
      <span class="row-end">
        {finished ? <Pill tone="done">{t('map.legend.dayDone')}</Pill>
          : tr.nextEta != null ? <span class="map-eta"><b class="num">{clock(tr.nextEta, lang.value)}</b><small>{t('map.legend.next')}</small></span> : null}
      </span>
    </button>
  );
}

function StopList(p: { m: Assembled; focus: Focus; selected: string | null; onChoose: (id: string) => void; plain?: boolean }) {
  const groups: { id: string; name: string; color: string; stops: Stop[] }[] = [
    ...p.m.trucks.filter((tr) => tr.stops.length).map((tr) => ({ id: tr.id, name: tr.name, color: tr.color, stops: tr.stops })),
    ...(p.m.unplaced.length ? [{ id: 'unplaced', name: t('map.legend.unplaced'), color: UNPLACED_COLOR, stops: p.m.unplaced }] : [])
  ].filter((g) => !p.focus || g.id === p.focus);
  return (
    <>
      {groups.map((g) => (
        <section key={g.id} class={`panel ${p.plain ? 'panel-plain' : 'glass'} panel-flush map-stops`} data-testid={`stops-${g.id}`}>
          <div class="panel-head"><h2 class="panel-title">{t('map.stops.title', { name: g.name })}</h2></div>
          <div class="rows" role="list">
            {g.stops.map((s) => (
              <button key={s.id} type="button" role="listitem" class={`row-item map-stop${p.selected === s.id ? ' is-selected' : ''}${s.done ? ' is-done' : ''}`} onClick={() => p.onChoose(s.id)} data-testid={`stop-${s.id}`}>
                <span class="map-n" style={{ '--c': g.color }} aria-label={t('map.stop.number', { n: s.n })}>{s.done ? <Check size={16} strokeWidth={3} /> : g.id === 'unplaced' ? '?' : s.n}</span>
                <span class="row-main">
                  <span class="row-title">{s.name}</span>
                  <span class="row-sub">{s.hasPos ? whenOf(s) : t('map.stops.noPos')}</span>
                </span>
                <span class="row-end"><StatusPill status={s.status as JobStatus} /></span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function StopCard(p: { stop: Stop & { color: string; truckName: string }; truck: TruckRoute | null; onClose: () => void; plain?: boolean }) {
  const s = p.stop;
  const trip = p.truck?.trip && p.truck.trip.jobId === s.id && !s.done ? p.truck.trip : null;
  const etaMin = trip ? minuteOf(trip.etaAt) : null;
  const dest = s.hasPos ? `${s.lat},${s.lng}` : s.address;
  return (
    <section class={`panel ${p.plain ? 'panel-plain' : 'glass'} map-card`} aria-live="polite" data-testid="map-card">
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <span class="map-n is-big" style={{ '--c': s.color }} aria-hidden="true">{s.done ? <Check size={18} strokeWidth={3} /> : s.truckId && p.truck ? s.n : '?'}</span>
        <div class="grow">
          <h3 class="map-card-title">{s.name}</h3>
          <p class="small muted" style={{ margin: '2px 0 0' }}>{s.address || t('map.stop.noAddress')}</p>
        </div>
        <IconButton icon={<X />} label={t('map.stop.close')} onClick={p.onClose} />
      </div>
      <div class="row-wrap map-card-meta">
        <StatusPill status={s.status as JobStatus} />
        <span class="small">{p.truck ? `${p.truck.name}, ${t('map.stop.number', { n: s.n }).toLowerCase()}` : t('map.stop.unplaced')}</span>
      </div>
      <p class="small" style={{ margin: 0 }}>
        {etaMin != null
          ? (trip!.km != null ? t('map.stop.etaKm', { time: clock(etaMin, lang.value), km: fmtKm(trip!.km) }) : t('map.stop.eta', { time: clock(etaMin, lang.value) }))
          : whenOf(s)}
      </p>
      <div class="row-wrap">
        <Button variant="primary" href={`#/job/${encodeURIComponent(s.id)}`} data-testid="map-open-job">{t('map.stop.open')}</Button>
        {dest && <Button icon={<Navigation size={18} />} href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`} target="_blank">{t('map.stop.directions')}</Button>}
      </div>
    </section>
  );
}

function whenOf(s: Stop): string {
  const block = t(`common.blocks.${s.block}`);
  return s.etaMin != null ? t('map.stops.when', { block, time: clock(s.etaMin, lang.value) }) : block;
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const fmtKm = (km: number) => new Intl.NumberFormat(lang.value === 'en' ? 'en-CA' : 'fr-CA', { maximumFractionDigits: 1 }).format(km);
