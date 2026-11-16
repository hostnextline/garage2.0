/* « Plages d'arrivée », from 760 px: the day as a time grid, 15 minutes per unit, a column per truck. The jobs « À
   placer » and the ones with no time planned yet are listed above it; the trucks that do not work that day under it. */
import { useMemo } from 'preact/hooks';
import { Clock } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { today as todayOf, type Day, type Range } from '../../lib/dates';
import { truckLabel, truckColor, truckRanges, blocks } from '../../data/select';
import type { Job } from '../../data/types';
import { may } from '../../domain/rights';
import { unitCount, workedUnits, jobMinute } from '../../domain/moment/grid';
import { freeWords } from '../../domain/moment/words';
import type { BlockView } from './select';
import { blockMenu } from './actions';
import { useGridDrag } from './drag';
import { GridColumn, NowLine, TimeAxis, useOpeningScroll, useStableUnits, type Place } from './TimeGrid';
import { Meter } from './Meter';
import { Ticketed, UnplacedLane } from './Lanes';

export function DayGrid(p: { day: Day; v: BlockView }) {
  const l = lang.value;
  const { v, day } = p;
  const span: Range = [v.start, v.end];
  const drag = useGridDrag();
  const stable = useStableUnits();
  const places: Place[] = useMemo(() => [{ block: 'day', start: v.start, end: v.end, v }], [v]);
  const minute = (j: Job) => jobMinute(j, blocks.value);
  // a job with no arrival planned and no window has no place on the grid: listed above it
  const noTime = v.lanes.flatMap((x) => x.jobs.filter((j) => minute(j) == null));
  const first = v.lanes.flatMap((x) => x.jobs.map(minute)).reduce<number | null>((a, m) => (m == null ? a : a == null ? m : Math.min(a, m)), null);
  const scroll = useOpeningScroll(span, day, first, day === todayOf());
  return (
    <div class={`agenda-grid is-dayview${drag.job ? ' is-dragging' : ''}`} style={{ '--cols': Math.max(1, v.lanes.length), '--units': unitCount(span) }} role="group" aria-label={t('agenda.grid.day')} data-testid="grid-day">
      {v.unplaced.length > 0 && <UnplacedLane jobs={v.unplaced} grid />}
      {noTime.length > 0 && (
        <div class="agenda-lane is-notime" data-testid="lane-notime">
          <div class="agenda-lane-head"><Clock size={18} aria-hidden="true" /><span class="agenda-lane-name">{t('agenda.grid.noTime')}</span></div>
          <p class="agenda-unplaced-text">{t('agenda.grid.noTimeText')}</p>
          <div class="agenda-tickets agenda-grid-strip">{noTime.map((j) => <Ticketed key={j.id} job={j} />)}</div>
        </div>
      )}
      {v.closed && !v.lanes.length && !v.unplaced.length && <p class="muted small agenda-closed-text">{t('agenda.whole.closedText')}</p>}
      {v.lanes.length > 0 && (
        <>
          <div class="agenda-grid-head" onContextMenu={(e) => blockMenu(e as MouseEvent, day, v.key, v)}>
            <span class="agenda-grid-corner"><span class="sr-only">{t('agenda.grid.hours')}</span></span>
            {v.lanes.map(({ truck, cap, used }) => (
              <div key={truck.id} class="agenda-grid-colhd" style={{ '--tc': truckColor(truck.id) }} data-testid={`lane-${truck.id}`}>
                <span class="agenda-grid-colname"><span class="agenda-dot" aria-hidden="true" /><span class="agenda-lane-name">{truckLabel(truck.id)}</span></span>
                {!v.started && (
                  <span class="agenda-grid-colfill">
                    {cap > 0 && <Meter used={used} cap={cap} label={truckLabel(truck.id)} small />}
                    <span class={`agenda-cell-free${cap - used <= 0 ? ' is-full' : ''}`}>{freeWords(used, cap, l, false, true)}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div class="agenda-grid-scroll" ref={scroll}>
            <div class="agenda-grid-body">
              <TimeAxis span={span} />
              <div class="agenda-grid-cols">
                {v.lanes.map(({ truck, jobs }) => (
                  <GridColumn key={truck.id} day={day} span={span} truckId={truck.id} on={stable(truck.id, workedUnits(truckRanges(truck.id, day), span))} places={places}
                    jobs={jobs.filter((j) => minute(j) != null)} compact={false} drag={drag} />
                ))}
                <NowLine span={span} day={day} />
              </div>
            </div>
          </div>
        </>
      )}
      {!v.started && !v.closed && v.idle.length > 0 && (
        <ul class="agenda-grid-idle">
          {v.idle.map((tr) => (
            <li key={tr.id} style={{ '--tc': truckColor(tr.id) }} data-testid={`lane-idle-${tr.id}`}><span class="agenda-dot" aria-hidden="true" />{truckLabel(tr.id)} <span class="agenda-idle">{t('agenda.lane.closed')}</span></li>
          ))}
        </ul>
      )}
      {may.book() && v.open && !v.started && v.lanes.length > 0 && <p class="faint small agenda-hint">{t('agenda.grid.hint')}</p>}
    </div>
  );
}
