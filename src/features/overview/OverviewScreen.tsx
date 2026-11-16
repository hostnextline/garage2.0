/* Vue d'ensemble (#/overview): today on one screen. The appointments of the day by block (time, customer, car, truck,
   status) and the map with each truck's numbered stops and its route from where it leaves. The phone's copy, with the
   server's map laid over it (useTeamMap: live positions of the mechanics, every 30 s).
   Computer: the list on the left, the map on the right. Phone: the map on top, the list under it.
   Touch a stop on the map: its appointment is picked out in the list; touch an appointment: its job opens. */
import { useMemo, useState } from 'preact/hooks';
import { CalendarPlus, Map as MapIcon } from 'lucide-preact';
import type { ScreenProps } from '../../platform/router';
import { may } from '../../domain/rights';
import { wide } from '../../platform/media';
import { t, lang } from '../../lib/i18n';
import { today, longDay } from '../../lib/dates';
import { jobsOn, staffName, truck as truckRow, truckColor } from '../../data/select';
import { Page, Panel, Rows, Button, Empty } from '../../ui';
import { useRoads, roadOf } from '../../shared/map/useRoads';
import { MapView } from '../../shared/map/MapView';
import { assemble } from '../../shared/map/assemble';
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
  const m = useMemo(() => assemble(data, { nameOf: staffName }), [data]);
  // the routes by the streets, like « Carte » (straight lines only until the route planner answers)
  useRoads(m.trucks);
  const jobs = jobsOn(day).filter((j) => j.status !== 'cancelled' && j.status !== 'no_show');
  const rows = overviewRows(jobs, m, truckOf);
  const counts = dayCounts(jobs);

  function pick(id: string) {
    setSelected(id);
    document.querySelector(`[data-ov-job="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const { markers, lines } = mapMarks(m, { selected, pick, onSite: (name) => t('map.people.onSite', { name }), road: roadOf });

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
