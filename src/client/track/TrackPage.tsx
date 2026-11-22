/* client.html#suivi=<token>: the mechanic on the way. On the way: the map on the whole screen and the arrival in a card
   at the bottom (Uber style); over: what happened and whom to call. The map (Leaflet) is loaded only when there is a
   trip to show. « Voir mon rendez-vous » only for the appointment of this trip (see appointmentOfTrip). */
import type { ComponentType } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CircleCheck, Clock, Link2Off, CircleSlash, CalendarDays, Phone, Languages } from 'lucide-preact';
import { Button } from '../../ui/Button';
import type { Garage } from '../api';
import { ct, pickLang, type CLang } from '../i18n';
import { nbClock, telHref } from '../format';
import { appointmentOfTrip, linkHash, recallGarage, replaceHash } from '../link';
import { CallUs, ErrorState, Footer, Header, Note, Skeleton, garageName } from '../ui';
import { arrival, headline, type TrackView } from './track-state';
import { useTrack } from './useTrack';

type MapProps = { view: TrackView; l: CLang; padBottom?: number };
let MapComp: ComponentType<MapProps> | null = null;
/** the map and Leaflet arrive only when a trip is shown (a separate, cached file) */
function LazyMap(p: MapProps) {
  const [Comp, setComp] = useState<ComponentType<MapProps> | null>(() => MapComp);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (Comp) return;
    let alive = true;
    import('./TrackMap').then((m) => { MapComp = m.default; if (alive) setComp(() => m.default); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);
  if (failed) return null;
  if (!Comp) return <div class="cl-map" aria-hidden="true" />;
  return <Comp {...p} />;
}

export function TrackPage(p: { token: string; linkLang: CLang | null; onLang: (l: CLang) => void }) {
  const { view, err, retry } = useTrack(p.token);
  const l = pickLang(p.linkLang, view?.lang);
  const garage: Garage | null = (view && (view.garage.name || view.garage.phone) ? view.garage : null) || recallGarage();

  useEffect(() => {
    document.documentElement.lang = l === 'en' ? 'en-CA' : 'fr-CA';
    document.title = `${ct(l, 'track.title')} – ${garageName(garage, l)}`;
  }, [l, garage?.name]);

  const switchLang = () => {
    const next: CLang = l === 'en' ? 'fr' : 'en';
    replaceHash(linkHash('suivi', p.token, next));
    p.onLang(next);
  };
  // a trip back to the Centrale has no appointment behind it
  const jobToken = view && !view.destLabel ? appointmentOfTrip(p.token) : null;
  const jobHref = jobToken ? linkHash('t', jobToken, l) : null;

  if (view && view.kind === 'active') return <Active view={view} l={l} lost={!!err} garage={garage} jobHref={jobHref} onLang={switchLang} />;
  return (
    <div class="cl">
      <Header garage={garage} l={l} />
      <main class="cl-wrap cl-main" id="main">
        {!view && !err && <Skeleton l={l} />}
        {!view && err && <ErrorState code={err} l={l} garage={garage} onRetry={retry} />}
        {view && <Over view={view} l={l} garage={garage} jobHref={jobHref} />}
      </main>
      <Footer garage={garage} l={l} onLang={switchLang} />
    </div>
  );
}

function Active(p: { view: TrackView; l: CLang; lost: boolean; garage: Garage | null; jobHref: string | null; onLang: () => void }) {
  const { view, l } = p;
  const hasMap = !!(view.pos || view.dest);
  const tel = telHref(p.garage?.phone);
  const eta = arrival(view, l);
  const card = useRef<HTMLElement>(null);
  const [pad, setPad] = useState(300);
  useEffect(() => {
    const el = card.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setPad(Math.round(el.getBoundingClientRect().height) + 32));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div class={`cl-uber${hasMap ? '' : ' is-nomap'}`} style={{ '--cl-card-h': `${pad - 32}px` } as Record<string, string>}>
      {hasMap && <LazyMap view={view} l={l} padBottom={pad} />}
      <div class="cl-uber-top">
        <span class="cl-uber-brand"><img src="./icons/icon-192.png" alt="" width={28} height={28} />{garageName(p.garage, l)}</span>
        <button type="button" class="cl-uber-lang" onClick={p.onLang} aria-label={ct(l, 'otherLangLabel')} data-testid="client-lang"><Languages aria-hidden="true" />{ct(l, 'otherLangShort')}</button>
      </div>
      <section class="cl-uber-card" ref={card} aria-live="polite">
        <div class="cl-uber-eta" data-testid="track-eta">
          {eta.left != null && <b class="cl-uber-min">{eta.left}<small>{'\u00a0'}{ct(l, 'track.min')}</small></b>}
          <span class="cl-uber-when">{eta.when}</span>
        </div>
        <h1 class="cl-uber-head" data-testid="track-headline">{headline(view, l)}</h1>
        <p class="cl-uber-upd" data-testid="track-updated">
          {view.posMinute != null ? ct(l, 'track.updated', { time: nbClock(view.posMinute, l) }) : ct(l, 'track.noPos')}
        </p>
        {p.lost && <Note kind="warn">{ct(l, 'track.lost')}</Note>}
        <div class="cl-uber-who">
          <span class="cl-uber-avatar" aria-hidden="true">{(view.mechanic || garageName(p.garage, l)).charAt(0).toUpperCase()}</span>
          <span class="cl-uber-name">
            <b>{view.mechanic || ct(l, 'track.onTheWayAnon')}</b>
            <span>{garageName(p.garage, l)}</span>
          </span>
          {tel && <a class="cl-uber-call" href={tel} aria-label={ct(l, 'call')} data-testid="client-call"><Phone aria-hidden="true" /></a>}
        </div>
        {p.jobHref && <Button variant="ghost" block icon={<CalendarDays />} href={p.jobHref} data-testid="track-see-job">{ct(l, 'track.seeAppointment')}</Button>}
      </section>
    </div>
  );
}

function Over(p: { view: TrackView; l: CLang; garage: Garage | null; jobHref: string | null }) {
  const { view, l } = p;
  const arrived = view.kind === 'arrived';
  const Icon = arrived ? CircleCheck : view.kind === 'expired' ? Clock : view.kind === 'cancelled' ? CircleSlash : Link2Off;
  const text = arrived
    ? [view.ended != null ? ct(l, 'track.arrivedAt', { time: nbClock(view.ended, l) }) : '', ct(l, 'track.arrivedText')].filter(Boolean).join(' ')
    : ct(l, view.kind === 'cancelled' ? 'track.cancelledText' : view.kind === 'expired' ? 'track.expiredText' : 'track.notFoundText');
  return (
    <section class="cl-panel glass cl-state" role={arrived ? 'status' : 'alert'} data-testid={`track-${view.kind}`}>
      <span class={`cl-state-icon${arrived ? ' is-ok' : ''}`} aria-hidden="true"><Icon /></span>
      <h1>{headline(view, l)}</h1>
      <p>{text}</p>
      <CallUs garage={p.garage} l={l} primary={!arrived} />
      {p.jobHref && <Button variant="ghost" icon={<CalendarDays />} href={p.jobHref} data-testid="track-see-job">{ct(l, 'track.seeAppointment')}</Button>}
    </section>
  );
}
