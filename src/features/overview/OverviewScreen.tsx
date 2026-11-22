/* Vue d'ensemble (#/overview): today on one screen. The appointments of the day by block (time, customer, car, truck,
   status) and the map with each truck's numbered stops and its route from where it leaves. The phone's copy, with the
   server's map laid over it (useTeamMap: live positions of the mechanics, every 30 s).
   Computer: the list on the left, the map on the right. Phone: the map on top, the list under it.
   Touch a stop on the map: its appointment is picked out in the list; touch an appointment: its job opens. */
import { useMemo, useState } from 'preact/hooks';
import { CalendarPlus, ListOrdered, Map as MapIcon } from 'lucide-preact';
import type { ScreenProps } from '../../platform/router';
import { may } from '../../domain/rights';
import { wide } from '../../platform/media';
import { t, lang } from '../../lib/i18n';
import { today, longDay } from '../../lib/dates';
import { jobsOn, staffName, truck as truckRow, truckColor, job as jobRow } from '../../data/select';
import { Page, Panel, Rows, Button, Empty } from '../../ui';
import { useRoads, roadOf } from '../../shared/map/useRoads';
import { MapView } from '../../shared/map/MapView';
import { assemble } from '../../shared/map/assemble';
import { roadNote } from '../../shared/moment/roadNote';
import { MoveHost } from '../../shared/jobs/MoveHost';
import { DayOrderHost, openDayOrder } from '../../shared/jobs/DayOrderHost';
import { mayOrderDay } from '../../domain/jobs/dayOrder';
import { dayCounts } from '../../domain/jobs/counts';
import { overviewRows } from './rows';
import { mapMarks } from './marks';
import { useTeamMap } from './useTeamMap';
import { JobRow } from './JobRow';
import './overview.css';

/** a truck's name and colour on the list, for a job the map does not show yet */
function truckOf(id: string): { name: string; color: string } | null {
  const tr = truckRow(id);
  return tr ? { name: tr.name, color: truckColor(id) } : null;
}

export default function OverviewScreen(_p: ScreenProps) {
  const day = today();
  const l = lang.value;
  const isWide = wide.value;
  const [selected, setSelected] = useState<string | null>(null);
  const data = useTeamMap(day);
  // assembled again only when the map's data really changed (useTeamMap gives back the same map while it draws the same)
  const m = useMemo(() => assemble(data, { nameOf: staffName, measuredOf: (id) => jobRow(id)?.eta_measured }), [data]);
  // the routes by the streets, like « Carte » (today: the traffic of now); nothing between the stops until the route
  // planner answers, never a straight line
  useRoads(m.trucks, day);
  // a road not drawn yet (or that cannot be): said under the map, like « Carte » and the pickers (map.roadNote)
  const note = roadNote(m.trucks.filter((tr) => tr.stops.some((s) => s.hasPos)), day);
  const jobs = jobsOn(day).filter((j) => j.status !== 'cancelled' && j.status !== 'no_show');
  const rows = overviewRows(jobs, m, truckOf);
  const counts = dayCounts(jobs);

  function pick(id: string) {
    setSelected(id);
    document.querySelector(`[data-ov-job="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const { markers, lines } = mapMarks(m, { selected, pick, onSite: (name) => t('map.people.onSite', { name }), road: (leg) => roadOf(leg, day) });

  const date = longDay(day, l);
  const sub = `${date.charAt(0).toUpperCase()}${date.slice(1)}, ${t('overview.counts', { booked: counts.booked, live: counts.live, done: counts.done })}`;
  const map = (
    <figure class="overview-map glass" data-testid="overview-map">
      <MapView markers={markers} lines={lines} height={isWide ? 'calc(100vh - 190px)' : '300px'} full={isWide} label={t('overview.mapLabel')}
        onBackgroundClick={() => setSelected(null)} />
      {note && <p class="small muted overview-road" data-testid="overview-road">{note}</p>}
      {may.map() && <figcaption><Button size="sm" variant="ghost" icon={<MapIcon />} href="#/map">{t('overview.openMap')}</Button></figcaption>}
    </figure>
  );
  const list = !rows.length ? (
    <Panel><Empty title={t('overview.empty')} text={t('overview.emptyText')}
      action={may.book() ? <Button variant="primary" icon={<CalendarPlus />} href="#/book">{t('overview.book')}</Button> : undefined} /></Panel>
  ) : (
    <>
      {/* by block; the jobs booked by arrival window ('day') in one list, in the order of their arrival */}
      {(['am', 'pm', 'eve', 'day'] as const).map((b) => {
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
    <Page title={t('overview.title')} sub={sub} help={t(may.book() ? 'overview.helpMove' : 'overview.help')} wide={isWide} data-testid="overview-screen"
      actions={mayOrderDay(day) ? <Button size="sm" variant="secondary" icon={<ListOrdered size={16} />} onClick={() => openDayOrder(day)} data-testid="overview-reorg">{t('reorg.open')}</Button> : undefined}>
      {isWide ? (
        <div class="overview-layout">
          <div class="overview-list stack">{list}</div>
          <div class="overview-side">{map}</div>
        </div>
      ) : (
        <div class="stack">{map}{list}</div>
      )}
      {/* « Déplacer » from a row's menu: the sheet on this screen; the list is the phone's copy, it follows by itself */}
      <MoveHost />
      {/* « Réorganiser la journée »: the sheet on this screen; the list is the phone's copy, it follows by itself */}
      <DayOrderHost />
    </Page>
  );
}
