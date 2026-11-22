/* « Les camions » beside the map: a tap on a truck shows only its route (a second tap: everyone again), its progress, its
   road by the streets (while it is asked « Route en cours de calcul… », when no planner answers « Route indisponible pour
   l'instant », when none ever will « Route impossible à tracer », on the same line: nothing moves when the road comes), where it leaves from, its next arrival; « À placer »;
   « Départ des camions » with « Changer »; and per truck the « Départ et heure » button (TruckDaySheet). */
import { useState } from 'preact/hooks';
import { Truck, Settings2 } from 'lucide-preact';
import { t, lang, type Lang } from '../../lib/i18n';
import { clock, today } from '../../lib/dates';
import { can, isOwner, myTrucks, preview } from '../../data/auth';
import { IconButton, Button, Help, Pill } from '../../ui';
import { UNPLACED_COLOR, type Assembled, type TruckRoute } from '../../shared/map/assemble';
import type { RoadState } from '../../shared/map/useRoads';
import { TruckDaySheet } from './TruckDaySheet';
import { cap, kmText, durText } from './stopWords';

type Road = { km: number; minutes: number } | null;

/** « Départ et heure »: the owner, the « hours » right, or the truck's own driver (as Horaires); never on a day already
    gone (the server would write nothing for it, or today's hours instead) */
export function mayEditDay(truckId: string, day: string, now: string = today()): boolean {
  return day >= now && (isOwner() || can('hours') || myTrucks().includes(truckId)) && !preview.value;
}

/** the words where a truck's road is said: the road, or why it is not drawn (null: nothing to say) */
export function roadLine(road: Road, state: RoadState, l: Lang = lang.value): { text: string; note: boolean } | null {
  if (road) return { text: t('map.legend.road', { km: kmText(road.km, l), time: durText(road.minutes) }, l), note: false };
  if (state === 'asking') return { text: t('map.roadNote.asking', undefined, l), note: true };
  if (state === 'down') return { text: t('map.roadNote.none', undefined, l), note: true };
  if (state === 'never') return { text: t('map.roadNote.never', undefined, l), note: true };
  return null;
}

export function Legend(p: { m: Assembled; day: string; focus: string | null; onFocus: (id: string) => void; plain?: boolean; roadOf: (tr: TruckRoute) => Road; roadState?: (tr: TruckRoute) => RoadState }) {
  const { m } = p;
  const [editing, setEditing] = useState<string | null>(null);
  if (!m.trucks.length && !m.unplaced.length) return null;
  return (
    <section class={`panel ${p.plain ? 'panel-plain' : 'glass'} panel-flush map-legend`} data-tour="map-legend" data-testid="map-legend">
      <div class="panel-head">
        <h2 class="panel-title">{t('map.legend.title')} <Help text={t('map.legend.help')} /></h2>
      </div>
      <div class="rows" role="list">
        {m.trucks.map((tr) => (
          <div key={tr.id} class="map-legend-item">
            <LegendRow tr={tr} road={p.roadOf(tr)} state={p.roadState ? p.roadState(tr) : 'none'} on={p.focus === tr.id} onClick={() => p.onFocus(tr.id)} />
            {mayEditDay(tr.id, p.day) && <IconButton icon={<Settings2 />} label={t('map.truckDay.open', { name: tr.name })} onClick={() => setEditing(tr.id)} data-testid={`legend-edit-${tr.id}`} />}
          </div>
        ))}
        {editing && <TruckDaySheet truckId={editing} day={p.day} onClose={() => setEditing(null)} />}
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

function LegendRow(p: { tr: TruckRoute; road: Road; state: RoadState; on: boolean; onClick: () => void }) {
  const { tr } = p;
  const l = lang.value;
  const progress = tr.total ? t('map.legend.progress', { n: tr.done, total: tr.total }) : t('map.legend.noStops');
  const sub = tr.driverName ? t('map.legend.withDriver', { driver: tr.driverName, progress }) : cap(progress);
  const said = roadLine(p.road, p.state, l);
  const road = said ? said.text : null;
  const finished = tr.total > 0 && tr.done === tr.total;
  // « Vraies routes » on, a trip before the next stop not measured yet: no time, the words say why (final-guess G1)
  const unsure = !finished && tr.nextEta == null && !!tr.next?.unsure && tr.next.status === 'booked';
  return (
    <button type="button" class="row-item map-legend-row" aria-pressed={p.on} onClick={p.onClick} data-testid={`legend-${tr.id}`}
      aria-label={`${tr.name}. ${sub}.${road ? ` ${road}.` : ''} ${p.on ? t('map.legend.focusOff') : t('map.legend.focusOn', { name: tr.name })}`}>
      <span class="map-swatch" style={{ '--c': tr.color }} aria-hidden="true"><Truck size={18} /></span>
      <span class="row-main">
        <span class="row-title">{tr.name}</span>
        <span class="row-sub">{sub}</span>
        {said && (said.note
          ? <span class="row-sub map-road faint" data-testid={`road-note-${tr.id}`}>{said.text}</span>
          : <span class="row-sub map-road" data-testid={`road-${tr.id}`}>{said.text}</span>)}
        {unsure && <span class="row-sub faint" data-testid={`legend-unsure-${tr.id}`}>{cap(t('map.legend.next'))}, {t('jobs.order.etaUnmeasured')}</span>}
        {tr.start && <span class="row-sub" data-testid={`legend-from-${tr.id}`}>{t('map.legend.leaves', { place: tr.start.label || tr.start.address || t('map.legend.ownStart', { name: tr.name }) })}</span>}
      </span>
      <span class="row-end">
        {finished ? <Pill tone="done">{t('map.legend.dayDone')}</Pill>
          : tr.nextEta != null ? <span class="map-eta"><b class="num">{clock(tr.nextEta, l)}</b><small>{t('map.legend.next')}</small></span> : null}
      </span>
    </button>
  );
}
