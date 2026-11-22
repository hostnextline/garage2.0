/* The map of « Réorganiser la journée » (Part 30, K4; Hassan, 2026-11-22: « when i am rearranging the appointements, i want
   to be able to have the map open and showing me the changements in real time »). Opened by the sheet (DayOrderSheet):
   beside the lists on a computer, above them on a phone (« Carte » / « Masquer la carte »).
   - What it draws comes from ./draftMap.ts: each truck's stops numbered in the DRAFT order (the numbers change as soon
     as a stop is put down), the Carte's colour per truck, the stop just put down marked with its name, the stops under
     way and done as the Carte shows them, each truck's start; the arrival of each stop as its row says it.
   - The roads: each truck's route by the streets for the draft order, asked (useRoads, roads.ts) ROAD_WAIT_MS after the
     LAST change, never during a drag; at once when the map opens. Each leg already known is drawn at once (roads.ts keeps
     the legs by their two ends: going back to an order seen is instant); a leg not known yet draws NOTHING until its road
     comes (never a straight line), and the map says « Route en cours de calcul… » meanwhile.
   - A drag under way (`hold`): the map keeps its last drawing (no map work while the finger moves); redrawn after the drop.
   - A tap on a pin: `onPick` (the sheet shows that stop's row). Nothing is asked while the sheet (or the map) is closed:
     this component is not there then. */
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { staffName, job as jobRow } from '../../data/select';
import type { DayAnswer } from '../../data/dayOrder';
import { changedTrucks, movedOf, type Draft } from '../../domain/jobs/dayOrder';
import { MapView, type MapMarker, type MapLine } from '../map/MapView';
import { assemble, type Assembled, type TruckRoute } from '../map/assemble';
import { fromDevice } from '../map/device';
import { useRoads, roadOf, roadState } from '../map/useRoads';
import { etaUnsure } from './select';
import { draftAnswer, draftLayers, draftTrucks, numbersOf, routesKey, ROAD_WAIT_MS } from './draftMap';

export interface DayOrderMapProps {
  day: string;
  draft: Draft;
  /** the server's answer for THIS draft (null: not yet) */
  cur: DayAnswer | null;
  /** something changed (« fixé à … » only then, as on the rows) */
  judge: boolean;
  /** the stop just put down */
  marked: string | null;
  /** the stop pointed at (its row hovered or opened, its pin tapped) */
  spot: string | null;
  /** a drag under way: the last drawing stays, no road is asked */
  hold: boolean;
  /** a computer (beside the lists): the zoom buttons */
  wide: boolean;
  onPick: (id: string) => void;
  onBackground: () => void;
}

interface Frame { markers: MapMarker[]; lines: MapLine[]; note: string | null }

function DayOrderMapIn(p: DayOrderMapProps) {
  // the day as the phone has it (the Carte's own copy), every stop at its draft place; while a drag is under way nothing
  // is worked out again (not even the phone's rows read: nothing to draw again until the drop)
  const day = useRef<{ m: Assembled; routes: TruckRoute[]; key: string } | null>(null);
  if (!p.hold || !day.current) {
    const m = assemble(draftAnswer(fromDevice(p.day), p.draft), { nameOf: staffName });
    const routes = draftTrucks(m, p.draft);
    day.current = { m, routes, key: routesKey(routes) };
  }
  const { m, routes, key } = day.current;

  /* the roads of the trucks as they were a moment after the last change (at once the first time), never during a drag */
  const [asked, setAsked] = useState(routes);
  const askedKey = useRef(key);
  const latest = useRef(routes);
  latest.current = routes;
  useEffect(() => {
    if (p.hold || key === askedKey.current) return;
    const tm = setTimeout(() => { askedKey.current = key; setAsked(latest.current); }, ROAD_WAIT_MS);
    return () => clearTimeout(tm);
  }, [key, p.hold]);
  useRoads(asked, p.day);

  /* what is drawn: kept as it is while a drag is under way */
  const frame = useRef<Frame | null>(null);
  if (!p.hold || !frame.current) {
    const { markers, lines } = draftLayers(m, routes, {
      l: lang.value, cur: p.cur, judge: p.judge, changed: changedTrucks(p.draft), dragged: new Set(movedOf(p.draft)), auto: p.draft.auto,
      row: jobRow, unsure: etaUnsure, numbers: numbersOf(p.draft), marked: p.marked, spot: p.spot,
      road: (leg) => roadOf(leg, p.day), onPick: p.onPick
    });
    const states = routes.map((tr) => roadState(tr, p.day));
    const note = states.includes('asking') ? t('map.roadNote.asking') : states.includes('down') ? t('map.roadNote.none')
      : states.includes('never') ? t('map.roadNote.never') : null;
    frame.current = { markers, lines, note };
  }
  const f = frame.current;
  return (
    <div class="dayord-map-in">
      <MapView markers={f.markers} lines={f.lines} height="100%" full controls={p.wide} refit="focus" fitPadding={[40, 96, 40, 40]}
        label={t('reorg.mapLabel')} onBackgroundClick={p.onBackground} data-testid="dayorder-mapview" />
      {f.note && <p class="dayord-map-note" role="status" data-testid="dayorder-map-note">{f.note}</p>}
    </div>
  );
}

/** drawn again only when what it shows changes: a drag that only moves the ghost (the sheet draws again at each place under
    the pointer) never reaches the map */
export const DayOrderMap = memo(DayOrderMapIn);
