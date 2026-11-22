/* La carte de l'équipe (#/map, ?day=YYYY-MM-DD): le départ des camions (la Centrale), chaque camion dans sa couleur avec ses arrêts numérotés
   et sa route par les rues (pas à vol d'oiseau: roads.ts), les mécanos en direct, les trajets en cours. Mise à jour toutes les 30 s (useTeamMap); sans
   réseau, la dernière réponse reste (avec son heure), sinon la copie du téléphone.
   Téléphone: la carte prend tout l'écran, la liste monte du bas. Ordinateur: la carte et la liste côte à côte.
   The screen only composes: the data (useTeamMap), what the map draws (layers.ts), the legend, the list, the card. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { RefreshCw, LocateFixed, CalendarPlus, Settings2, MapPinOff, ListOrdered } from 'lucide-preact';
import { may } from '../../domain/rights';
import { setQuery, href, type ScreenProps } from '../../platform/router';
import { wide } from '../../platform/media';
import { t, lang } from '../../lib/i18n';
import { today, addDays, longDay, clock, isValidDay, nowMinute } from '../../lib/dates';
import { flush } from '../../data/sync';
import { can } from '../../data/auth';
import { staffName, job as jobRow } from '../../data/select';
import { locateMissing } from '../../shared/customers/locator';
import { Page, Seg, Banner, Empty, Button, IconButton, run, toast } from '../../ui';
import { MapView } from '../../shared/map/MapView';
import { assemble, minuteOf, UNPLACED_COLOR, type Assembled, type Leg, type TruckRoute } from '../../shared/map/assemble';
import { forDay } from '../../shared/map/teamMapData';
import { useTeamMap } from '../../shared/map/useTeamMap';
import { teamMarkers, teamLines, fitIds } from '../../shared/map/layers';
import { useRoads, roadOf, roadTotal, roadState } from '../../shared/map/useRoads';
import { MoveHost } from '../../shared/jobs/MoveHost';
import { DayOrderHost, openDayOrder } from '../../shared/jobs/DayOrderHost';
import { mayOrderDay } from '../../domain/jobs/dayOrder';
import { MapDay } from './MapDay';
import { Stage, PullUp } from './MapStage';
import { Legend } from './MapLegend';
import { StopList } from './StopList';
import { StopCard, type ChosenStop } from './StopCard';
import { lostStops, findable, findFailed } from './stopWords';
import './map.css';

const timeOf = (ms: number) => minuteOf(new Date(ms).toISOString()) ?? nowMinute(new Date(ms));

export default function MapScreen({ query }: ScreenProps) {
  const q = query.get('day');
  const day = isValidDay(q) ? q : today();
  const isWide = wide.value;
  const live = day === today();
  const tm = useTeamMap(day);
  const [now, setNow] = useState(() => Date.now());
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pan, setPan] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const [finding, setFinding] = useState(false);

  // another day: nothing chosen, everyone in view (a refresh keeps what the person chose)
  useEffect(() => { setFocus(null); setSelected(null); setPan(null); }, [day]);
  // the ages of the positions (« il y a 3 min ») follow each answer
  useEffect(() => { setNow(Date.now()); }, [tm.at, tm.status, tm.busy]);

  const m: Assembled = useMemo(() => forDay(assemble(tm.data, { nameOf: staffName, measuredOf: (id) => jobRow(id)?.eta_measured }), live), [tm.data, live]);

  /* the road route of each truck (its start → stops, in order) and of a live trip without one: asked once for THIS day
     (today with the traffic of now, another day for its usual hours), then kept */
  useRoads(m.trucks, day);

  const truckOf = (id: string | null) => m.trucks.find((tr) => tr.id === id) || null;
  const allStops: ChosenStop[] = [
    ...m.trucks.flatMap((tr) => tr.stops.map((s) => ({ ...s, color: tr.color, truckName: tr.name }))),
    ...m.unplaced.map((s) => ({ ...s, color: UNPLACED_COLOR, truckName: t('map.legend.unplaced') }))
  ];
  const sel = selected ? allStops.find((s) => s.id === selected) || null : null;

  /* choosing in the list goes to the stop; a tap on the map or closing the card leaves the view where it is */
  function choose(id: string, fromList: boolean) {
    setSelected(id);
    if (fromList) setPan(id);
    if (fromList && !isWide) setOpen(false);
  }
  function toggleFocus(id: string) {
    setPan(null);
    setFocus((f) => (f === id ? null : id));
  }
  const recenter = () => { setPan(null); setFocus(null); setSelected(null); setFitKey((k) => k + 1); };
  const closeCard = () => setSelected(null);

  const ui = { selected, focus, pan, now, onChoose: (id: string) => choose(id, false), road: (leg: Leg) => roadOf(leg, day) };
  const totalOf = (tr: TruckRoute) => roadTotal(tr, day);
  const stateOf = (tr: TruckRoute) => roadState(tr, day);
  const markers = teamMarkers(m, ui);
  const lines = teamLines(m, ui);

  /* appointments of the day whose address has no position yet: said on the map, with « Trouver » for those the locator will look for */
  const lost = lostStops([...m.trucks.flatMap((tr) => tr.stops), ...m.unplaced]);
  const toFind = findable(lost, day, today(), (id) => !!jobRow(id));
  const findLost = async () => {
    setFinding(true);
    try {
      let r: Awaited<ReturnType<typeof locateMissing>>;
      // « pas de réseau » only for no network; a real failure says what it is (mh-8)
      try { r = await locateMissing({ only: { jobs: toFind.map((s) => s.id) }, force: true }); }
      catch (e) { toast(findFailed(e), { kind: 'bad' }); return; }
      if (r.offline) toast(t('map.lost.offline'), { kind: 'bad' });
      else if (r.found) {
        toast(t('map.lost.found', { n: r.found }), { kind: 'ok' });
        // the positions found are on this phone already: on the map now; the server's answer follows
        tm.place(r.placed);
        await run(() => flush(), { quiet: true });
        await tm.refresh();
      } else toast(t('map.lost.none'), { kind: 'bad' });
    } finally { setFinding(false); }
  };

  /* words */
  const at = clock(timeOf(tm.at), lang.value);
  const updated = t('map.updated', { time: at });
  const summary = t('map.summary', { trucks: t('map.trucksCount', { n: m.trucks.length }), stops: t('map.stopsCount', { n: m.count }) });
  const onDay = (d: string) => setQuery({ day: d === today() ? null : d });
  // any day with the « Agenda » right (plan ahead, look back); otherwise yesterday, today, tomorrow (the server's rule too)
  const daySwitch = can('agenda')
    ? <MapDay day={day} onDay={onDay} />
    : (
      <Seg label={t('map.dayLabel')} value={day} onValue={onDay} data-testid="map-day"
        options={[{ value: addDays(today(), -1), label: t('map.days.yesterday') }, { value: today(), label: t('map.days.today') }, { value: addDays(today(), 1), label: t('map.days.tomorrow') }]} />
    );
  const notices = (
    <>
      {tm.status === 'offline' && <Banner kind="warn" data-testid="map-offline">{tm.source === 'server' ? t('map.offline', { time: at }) : t('map.offlineDevice')}</Banner>}
      {tm.status === 'refused' && <Banner kind="bad" title={t('map.refused')} action={<Button size="sm" onClick={() => tm.refresh()}>{t('common.retry')}</Button>}>{tm.error}</Banner>}
      {!m.home && (tm.status === 'ok' || tm.source === 'server') && (
        <Banner kind="info" action={can('settings') ? <Button size="sm" icon={<Settings2 size={16} />} href="#/settings/booking">{t('map.noHomeAction')}</Button> : undefined}>{t('map.noHome')}</Banner>
      )}
    </>
  );

  /* one short line about freshness (and the trouble, if any) */
  const line = tm.status === 'offline' ? (tm.source === 'server' ? t('map.offlineShort', { time: at }) : t('map.offlineDeviceShort'))
    : tm.status === 'refused' ? t('map.refused')
    : tm.source === 'device' ? (tm.busy ? t('map.updating') : t('map.device'))
    : updated;
  const warnLine = tm.status === 'offline' || tm.status === 'refused';
  const empty = (
    <Empty title={t('map.empty.title')} text={t('map.empty.text')}
      action={may.book() ? <Button variant="primary" icon={<CalendarPlus size={18} />} href={href('/book', { day })}>{t('map.empty.book')}</Button> : undefined} />
  );
  const spin = tm.busy ? 'spin-slow' : '';
  // « Réorganiser la journée » of the day shown (Part 28): the phone's rows, never this map's (team_map)
  const reorg = mayOrderDay(day)
    ? <Button size="sm" variant="secondary" icon={<ListOrdered size={16} />} onClick={() => openDayOrder(day)} data-testid="map-reorg">{t('reorg.open')}</Button>
    : null;

  return (
    <Page title={t('map.title')} sub={longDay(day, lang.value)} help={t(may.book() ? 'map.helpMove' : 'map.help')} data-testid="map-screen"
      actions={isWide ? <div class="row">{daySwitch}<IconButton icon={<RefreshCw class={spin} />} label={t('map.refresh')} onClick={() => tm.refresh()} data-testid="map-refresh" /></div> : undefined}>
      <Stage wide={isWide}>
        <div class="map-canvas">
          <MapView markers={markers} lines={lines} height="100%" full focus={fitIds(m, ui)} fitKey={`${day}#${fitKey}`} refit="focus" controls={isWide} label={t('map.label')}
            fitPadding={isWide ? [lost.length ? 110 : 56, 150, 56, 56] : [lost.length ? 170 : 84, 96, 140, 32]} onBackgroundClick={() => { if (selected) closeCard(); }} data-testid="map-view" />
          <div class="map-overlay">
            {!isWide && daySwitch}
            <IconButton class="map-fab" icon={<LocateFixed />} label={t('map.recenter')} onClick={recenter} data-testid="map-recenter" />
          </div>
          {lost.length > 0 && (
            <div class="map-lost glass-strong" role="status" data-testid="map-lost">
              <MapPinOff size={18} aria-hidden="true" />
              <span class="grow">{t('map.lost.text', { n: lost.length })}</span>
              {may.book() && toFind.length > 0 && <Button size="sm" busy={finding} onClick={() => findLost()} data-testid="map-lost-find">{t('map.lost.find')}</Button>}
            </div>
          )}
        </div>
        {isWide ? (
          <aside class="map-side" aria-label={t('map.legend.title')}>
            {reorg}
            <p class={`small map-line ${warnLine ? 'map-warn' : 'muted'}`} aria-live="polite" data-testid="map-status">{line}</p>
            {notices}
            {sel && <StopCard stop={sel} truck={truckOf(sel.truckId)} onClose={closeCard} />}
            <Legend m={m} day={day} focus={focus} onFocus={toggleFocus} roadOf={totalOf} roadState={stateOf} />
            {m.count === 0 ? <div class="panel glass map-empty">{empty}</div> : <StopList m={m} focus={focus} selected={selected} onChoose={(id) => choose(id, true)} />}
          </aside>
        ) : (
          <PullUp open={open} onOpen={setOpen} summary={summary} status={line} warn={warnLine}
            card={sel ? <StopCard plain stop={sel} truck={truckOf(sel.truckId)} onClose={closeCard} /> : null}>
            {reorg}
            {notices}
            <Legend plain m={m} day={day} focus={focus} onFocus={toggleFocus} roadOf={totalOf} roadState={stateOf} />
            {m.count === 0 ? empty : <StopList plain m={m} focus={focus} selected={selected} onChoose={(id) => choose(id, true)} />}
            <div class="map-status small muted">
              <span>{updated}</span>
              <Button size="sm" variant="ghost" icon={<RefreshCw size={16} class={spin} />} onClick={() => tm.refresh()} data-testid="map-refresh">{t('map.refresh')}</Button>
            </div>
          </PullUp>
        )}
      </Stage>
      {/* « Déplacer » from a stop (its card, its menu): the sheet on the map; moved, the server's day is asked again so the
          stop leaves it at once (the list is the server's answer, asked every 30 s otherwise) */}
      <MoveHost onMoved={() => { void tm.refresh(); }} />
      {/* « Réorganiser la journée »: saved, the server's day is asked again (the map is its answer) */}
      <DayOrderHost onSaved={() => { void tm.refresh(); }} />
    </Page>
  );
}
