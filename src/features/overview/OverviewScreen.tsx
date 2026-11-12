/* Vue d'ensemble (#/overview): today on one screen. The appointments of the day by block (time, customer, car, truck,
   status) and the map with each truck's numbered stops and its route from where it leaves. The map comes from the
   server (team_map, every 30 s; live positions of the mechanics), else from the phone's copy.
   Computer: the list on the left, the map on the right. Phone: the map on top, the list under it.
   Touch a stop on the map: its appointment is picked out in the list; touch an appointment: its job opens. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CalendarPlus, Map as MapIcon } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { may } from '../../app/routes';
import { wide } from '../../app/media';
import { t, lang } from '../../lib/i18n';
import { today, longDay, clock } from '../../lib/dates';
import { rpcNow } from '../../data/api';
import { jobsOn, customer as customerRow, customerName, vehicle as vehicleRow, vehicleLabel, itemsOf, staffName } from '../../data/select';
import type { JobStatus } from '../../data/types';
import { Page, Panel, Rows, RowItem, Button, Empty, StatusPill } from '../../ui';
import { useRoads, roadOf } from '../map/useRoads';
import { MapView, type MapMarker, type MapLine } from '../map/MapView';
import { assemble, normalize, UNPLACED_COLOR, type TeamMapAnswer } from '../map/assemble';
import { fromDevice } from '../map/device';
import { dayCounts } from '../../app/more';
import { overviewRows, type OverviewRow } from './rows';
import './overview.css';

const REFRESH_MS = 30000;

export default function OverviewScreen(_p: ScreenProps) {
  const day = today();
  const l = lang.value;
  const isWide = wide.value;
  const [data, setData] = useState<TeamMapAnswer>(() => fromDevice(day));
  const [selected, setSelected] = useState<string | null>(null);

  /* the map of the day from the server, now and every 30 s (the phone's copy until then, or without signal) */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const d = normalize(await rpcNow<unknown>('team_map', { p_day: day }));
        if (alive) setData(d);
      } catch { if (alive) setData((cur) => cur.jobs.length ? cur : fromDevice(day)); }
    };
    void load();
    const timer = setInterval(() => { void load(); }, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [day]);

  const m = useMemo(() => assemble(data, { nameOf: staffName }), [data]);
  // the routes by the streets, like « Carte » (straight lines only until the route planner answers)
  useRoads(m.trucks);
  const jobs = jobsOn(day).filter((j) => j.status !== 'cancelled' && j.status !== 'no_show');
  const rows = overviewRows(jobs, m);
  const counts = dayCounts(jobs);

  /* the map: the start, each truck's numbered stops and route, the mechanics now */
  const markers: MapMarker[] = [];
  if (m.home) markers.push({ id: 'home', kind: 'home', lat: m.home.lat, lng: m.home.lng, label: m.home.label, title: [m.home.label, m.home.address].filter(Boolean).join(', ') });
  const lines: MapLine[] = [];
  for (const tr of m.trucks) {
    if (tr.start) markers.push({ id: `start-${tr.id}`, kind: 'customer', lat: tr.start.lat, lng: tr.start.lng, color: tr.color, label: tr.start.label || tr.name, title: [tr.start.label, tr.start.address].filter(Boolean).join(', ') });
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: s.n, done: s.done, active: selected === s.id,
        label: selected === s.id ? s.name : undefined, title: `${s.n}. ${s.name}`, onClick: () => pick(s.id) });
    }
    for (const leg of tr.legs) lines.push({ points: roadOf(leg), color: tr.color, dashed: leg.kind === 'trip', opacity: leg.kind === 'done' ? 0.35 : 0.85 });
  }
  for (const s of m.unplaced) {
    if (s.hasPos) markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: UNPLACED_COLOR, number: '?', active: selected === s.id, title: s.name, onClick: () => pick(s.id) });
  }
  for (const p of m.people) markers.push({ id: `p-${p.id}`, kind: 'person', lat: p.lat, lng: p.lng, color: p.color, label: p.name, sub: p.onSite ? t('map.people.onSite', { name: p.onSite.name }) : undefined });

  function pick(id: string) {
    setSelected(id);
    if (typeof document !== 'undefined') document.querySelector(`[data-ov-job="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const date = longDay(day, l);
  const sub = `${date.charAt(0).toUpperCase()}${date.slice(1)}, ${t('overview.counts', { booked: counts.booked, live: counts.live, done: counts.done })}`;
  const map = (
    <figure class="overview-map glass" data-testid="overview-map">
      <MapView markers={markers} lines={lines} height={isWide ? 'calc(100vh - 190px)' : '300px'} full={isWide} label={t('overview.mapLabel')}
        onBackgroundClick={() => setSelected(null)} />
      {may.map() && <figcaption><Button size="sm" variant="ghost" icon={<MapIcon />} href="#/map">{t('overview.openMap')}</Button></figcaption>}
    </figure>
  );
  const list = !rows.length ? (
    <Panel><Empty title={t('overview.empty')} text={t('overview.emptyText')}
      action={may.book() ? <Button variant="primary" icon={<CalendarPlus />} href="#/book">{t('overview.book')}</Button> : undefined} /></Panel>
  ) : (
    <>
      {(['am', 'pm', 'eve'] as const).map((b) => {
        const inBlock = rows.filter((r) => r.job.block === b);
        if (!inBlock.length) return null;
        return (
          <Panel key={b} title={t(`common.blocks.${b}`)} sub={t('overview.inBlock', { n: inBlock.length })} flush data-testid={`overview-${b}`}>
            <Rows>{inBlock.map((r) => <JobRow key={r.job.id} r={r} on={selected === r.job.id} />)}</Rows>
          </Panel>
        );
      })}
    </>
  );
  return (
    <Page title={t('overview.title')} sub={sub} help={t('overview.help')} wide={isWide} data-testid="overview-screen">
      {isWide ? (
        <div class="overview-layout">
          <div class="overview-list stack">{list}</div>
          <div class="overview-side">{map}</div>
        </div>
      ) : (
        <div class="stack">{map}{list}</div>
      )}
    </Page>
  );
}

function JobRow(p: { r: OverviewRow; on: boolean }) {
  const { job: j, n, color, truckName } = p.r;
  const l = lang.value;
  const c = customerRow(j.customer_id);
  const car = vehicleLabel(vehicleRow(j.vehicle_id));
  const work = itemsOf(j.id).filter((i) => i.status !== 'declined').map((i) => i.description).filter(Boolean);
  const what = [car, work.slice(0, 2).join(', ') + (work.length > 2 ? '…' : '') || (j.problem || '').slice(0, 60)].filter(Boolean).join(', ');
  return (
    <div class={`overview-row${p.on ? ' is-on' : ''}`} data-ov-job={j.id}>
      <RowItem href={`#/job/${j.id}`} chevron data-testid={`overview-job-${j.id}`}
        start={<span class="overview-n" style={{ '--c': color }} aria-label={n != null ? t('overview.stop', { n }) : t('overview.unplaced')}>{j.status === 'done' ? '✓' : n ?? '?'}</span>}
        title={<><span class="num overview-time">{j.eta_min != null ? clock(j.eta_min, l) : '—'}</span> {customerName(c) || '—'}</>}
        sub={<>{what && <span class="overview-what">{what}</span>}<span class="overview-truck">{truckName}</span></>}
        end={<StatusPill status={j.status as JobStatus} />} />
    </div>
  );
}

