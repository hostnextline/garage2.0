/* « La nouvelle journée » (Part 30, K3; Hassan, 2026-11-22: « … still let me book it, then show me the new map »): after a
   booking at a minute that changed the day (forced: somebody late or the truck past its hours; or somebody's hour moved),
   the NEW map of that day: every vehicle's route in its new order (from the phone's copy, which the booking's answer
   just updated), numbered stops, the new appointment marked « Nouveau », the ones pushed later and the ones now late
   marked (from the booking's own answer), and the routes by the streets only when they come — never a straight line
   (Hassan's rule, 2026-11-19: useRoads / roadOf draw nothing between two stops before a real road is there; roadNote says
   why). Under the map, each vehicle's stops in order with the same marks. « Voir le rendez-vous » / « Fermer ».
   It lives in its own little root (openBookedMap), so it opens over whatever screen the booking went to. */
import { render } from 'preact';
import { useMemo } from 'preact/hooks';
import { signal, effect } from '@preact/signals';
import { t, lang } from '../../lib/i18n';
import { clock, duration, longDay } from '../../lib/dates';
import { navigate, route } from '../../platform/router';
import { whenHistorySettled } from '../../platform/history';
import { Sheet, Button, Banner } from '../../ui';
import { MapView, type MapMarker, type MapLine } from '../map/MapView';
import { assemble, type TruckRoute } from '../map/assemble';
import { useRoads, roadOf } from '../map/useRoads';
import { staffName } from '../../data/select';
import { dayOf } from './deviceDay';
import { roadNote } from './roadNote';
import { NEW_STOP_COLOR } from './preview';
import './booking.css';

/** what the booking's answer says of each stop it touched */
export interface BookedMark { id: string; late: boolean; lateMin: number; delay: number; etaAfter: number | null }
export interface BookedMapAsk {
  day: string;
  /** the new appointment */
  jobId: string;
  at: number;
  marks: BookedMark[];
}
/** the mark of a stop: the new one, late, pushed later, or nothing */
export type MarkKind = 'new' | 'late' | 'pushed' | null;
export function markOf(id: string, a: Pick<BookedMapAsk, 'jobId' | 'marks'>): { kind: MarkKind; mark: BookedMark | null } {
  if (id === a.jobId) return { kind: 'new', mark: null };
  const m = a.marks.find((x) => x.id === id) ?? null;
  if (!m) return { kind: null, mark: null };
  if (m.late) return { kind: 'late', mark: m };
  if (m.delay > 0) return { kind: 'pushed', mark: m };
  return { kind: null, mark: m };
}
/** the short words under a marked stop (on the map and in the list) */
export function markWords(kind: MarkKind, m: BookedMark | null, at: number, l: 'fr' | 'en'): string {
  if (kind === 'new') return clock(at, l);
  if (kind === 'late' && m) return t('booking.atTime.map.late', { by: duration(m.lateMin, l) }, l);
  if (kind === 'pushed' && m && m.etaAfter != null) return t('booking.atTime.map.pushed', { eta: clock(m.etaAfter, l) }, l);
  return '';
}

const LATE_COLOR = '#D3000E';

export function BookedMap(p: { ask: BookedMapAsk; onClose: () => void; onSee: () => void }) {
  const l = lang.value;
  const a = p.ask;
  const view = useMemo(() => assemble(dayOf(a.day), { nameOf: staffName }), [a.day, a.jobId]);
  const routes = view.trucks.filter((tr) => tr.stops.length);
  const drawn = routes.filter((tr) => tr.stops.some((s) => s.hasPos));
  useRoads(drawn, a.day);
  const note = roadNote(drawn, a.day);
  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const seen = new Set<string>();
  for (const tr of drawn) {
    if (tr.from) {
      const key = `${tr.from[0]},${tr.from[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        markers.push({ id: `from-${tr.id}`, kind: tr.start ? 'customer' : 'home', lat: tr.from[0], lng: tr.from[1], color: tr.color,
          label: tr.start?.label || view.home?.label || t('booking.preview.start'), title: tr.start?.address || view.home?.address || '' });
      }
    }
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      const { kind, mark } = markOf(s.id, a);
      const words = markWords(kind, mark, a.at, l);
      markers.push({
        id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, number: s.n, done: s.done, title: `${s.n}. ${s.name}`,
        color: kind === 'new' ? NEW_STOP_COLOR : kind === 'late' ? LATE_COLOR : tr.color,
        active: kind === 'new' || kind === 'late',
        label: kind === 'new' ? t('booking.atTime.map.new') : kind ? s.name : undefined,
        sub: words || undefined
      });
    }
    // nothing between two stops until a real road comes (roadOf answers [] meanwhile: never a straight line)
    for (const leg of tr.legs) lines.push({ points: roadOf(leg, a.day), color: tr.color, weight: 4, opacity: leg.kind === 'done' ? 0.32 : 0.85 });
  }
  const day = longDay(a.day, l);
  const see = () => p.onSee();
  return (
    <Sheet open wide onClose={p.onClose} onNavigate={p.onClose} title={t('booking.atTime.map.title')} sub={day.charAt(0).toUpperCase() + day.slice(1)} data-testid="booked-map"
      footer={<>
        <Button onClick={p.onClose} data-testid="booked-map-close">{t('booking.atTime.map.close')}</Button>
        <Button variant="primary" onClick={see} data-testid="booked-map-see">{t('booking.atTime.map.see')}</Button>
      </>}>
      <div class="stack">
        <p class="small" style={{ margin: 0 }}>{t('booking.atTime.map.lead')}</p>
        <MapView markers={markers} lines={lines} height="380px" label={t('booking.atTime.map.mapLabel')} data-testid="booked-map-map" />
        {note && <p class="faint small" style={{ margin: 0 }} data-testid="booked-map-road">{note}</p>}
        {!routes.length && <Banner kind="info">{t('booking.atTime.map.none')}</Banner>}
        {routes.map((tr) => <TruckList key={tr.id} tr={tr} ask={a} />)}
        <ul class="bp-booked-legend" aria-hidden="true">
          <li><span class="bp-booked-dot is-new" />{t('booking.atTime.map.legendNew')}</li>
          <li><span class="bp-booked-dot is-pushed" />{t('booking.atTime.map.legendPushed')}</li>
          <li><span class="bp-booked-dot is-late" />{t('booking.atTime.map.legendLate')}</li>
        </ul>
      </div>
    </Sheet>
  );
}

/** a vehicle's stops in their new order, with the marks */
function TruckList(p: { tr: TruckRoute; ask: BookedMapAsk }) {
  const l = lang.value;
  return (
    <section class="bp-booked-truck" style={{ '--c': p.tr.color }} data-testid={`booked-map-truck-${p.tr.id}`}>
      <h4 class="bp-booked-name">{p.tr.name}</h4>
      <ol class="bp-booked-stops">
        {p.tr.stops.map((s) => {
          const { kind, mark } = markOf(s.id, p.ask);
          const words = markWords(kind, mark, p.ask.at, l);
          return (
            <li key={s.id} class={`bp-booked-stop${kind ? ` is-${kind}` : ''}${s.done ? ' is-done' : ''}`} data-testid={`booked-map-stop-${s.id}`} data-n={s.n} data-mark={kind ?? ''}>
              <i>{s.n}</i>
              <span>{kind === 'new' ? t('booking.atTime.map.new') : s.name}</span>
              {s.etaMin != null && kind !== 'new' && !words && <small>{clock(s.etaMin, l)}</small>}
              {words && <small>{words}</small>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------- the host: its own root, over any screen ---------- */
const shown = signal<BookedMapAsk | null>(null);
let host: HTMLElement | null = null;
function BookedMapHost() {
  const a = shown.value;
  if (!a) return null;
  const close = () => { shown.value = null; };
  return <BookedMap ask={a} onClose={close} onSee={() => { close(); navigate(`/job/${a.jobId}`); }} />;
}
/** shows the new map of that day (over whatever screen is there) */
export function openBookedMap(a: BookedMapAsk) {
  if (typeof document === 'undefined') return;
  if (!host) {
    host = document.createElement('div');
    host.dataset.owner = 'booked-map';
    document.body.appendChild(host);
    render(<BookedMapHost />, host);
  }
  shown.value = a;
}
/** goes to `path` (replacing the screen: the booking is done) and shows the new map there once that screen is in place —
    never before: the navigation closes the sheets open on the screen it leaves, and the map must not be one of them */
export function openBookedMapOn(path: string, a: BookedMapAsk) {
  navigate(path, { replace: true });
  let done = false;
  let stop: (() => void) | null = null;
  const show = () => {
    if (done) return;
    done = true;
    stop?.();
    whenHistorySettled(() => setTimeout(() => openBookedMap(a), 0));
  };
  stop = effect(() => { if (route.value.path === path) show(); });
  if (done) stop();
  // a screen that never comes (a route refused): shown where the person is, a moment later
  setTimeout(show, 2500);
}
/** (tests) the map shown now, or null */
export function bookedMapShown(): BookedMapAsk | null { return shown.value; }
export function closeBookedMap() { shown.value = null; }
