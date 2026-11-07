/* client.html#suivi=<token>: the mechanic on the way. Asks every 15 s while the page is on screen, stops once the
   trip is over. The map (Leaflet) is loaded only when there is a trip to show. */
import type { ComponentType } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CircleCheck, Clock, Link2Off, CircleSlash, CalendarDays, Phone, Languages } from 'lucide-preact';
import { Button } from '../ui/Button';
import { callTrack, ClientError, type TrackAnswer, type Garage } from './api';
import { ct, pickLang, type CLang } from './i18n';
import { trackView, isFinal, headline, type TrackView } from './track-state';
import { nbClock, telHref } from './format';
import { linkHash, replaceHash, remember, recall, rememberGarage, recallGarage } from './link';
import { Header, Footer, Note, CallUs, Skeleton, garageName } from './ui';
import { ErrorState } from './ViewPage';

const EVERY = 15000;
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
  const [ans, setAns] = useState<{ a: TrackAnswer; at: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true, over = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const ask = async () => {
      if (busy.current || over || document.visibilityState === 'hidden') return;
      busy.current = true;
      try {
        const a = await callTrack(p.token);
        if (!alive) return;
        setAns({ a, at: Date.now() });
        setNow(Date.now());
        setErr(null);
        rememberGarage(a.garage);
        if (a.status === 'active') remember('suivi', p.token);
        if (isFinal(trackView(a, Date.now()).kind)) { over = true; if (timer) clearInterval(timer); }
      } catch (e) {
        if (alive) setErr(e instanceof ClientError ? e.code : 'server');
      } finally {
        busy.current = false;
      }
    };
    kick.current = () => { void ask(); };
    void ask();
    timer = setInterval(() => void ask(), EVERY);
    const onVis = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); void ask(); } };
    document.addEventListener('visibilitychange', onVis);
    // the minutes left go down between two answers
    const tick = setInterval(() => setNow(Date.now()), 20000);
    return () => { alive = false; if (timer) clearInterval(timer); clearInterval(tick); document.removeEventListener('visibilitychange', onVis); };
  }, [p.token]);

  const view: TrackView | null = ans ? trackView(ans.a, ans.at, now) : null;
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
  const jobToken = recall('t');

  // on the way: the map on the whole screen, the arrival in a card at the bottom (Uber style)
  if (view && view.kind === 'active') return <Active view={view} l={l} lost={!!err} garage={garage} jobToken={jobToken} onLang={switchLang} />;
  return (
    <div class="cl">
      <Header garage={garage} l={l} />
      <main class="cl-wrap cl-main" id="main">
        {!view && !err && <Skeleton l={l} />}
        {!view && err && <ErrorState code={err} l={l} garage={garage} onRetry={() => { setErr(null); kick.current(); }} />}
        {view && <Over view={view} l={l} garage={garage} jobToken={jobToken} />}
      </main>
      <Footer garage={garage} l={l} onLang={switchLang} />
    </div>
  );
}

function Active(p: { view: TrackView; l: CLang; lost: boolean; garage: Garage | null; jobToken: string | null; onLang: () => void }) {
  const { view, l } = p;
  const hasMap = !!(view.pos || view.dest);
  const tel = telHref(p.garage?.phone);
  const soon = !!view.eta && view.eta.left <= 1;
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
        <button type="button" class="cl-uber-lang" onClick={p.onLang} aria-label={ct(l, 'otherLangLabel')} data-testid="client-lang"><Languages aria-hidden="true" />{l === 'en' ? 'FR' : 'EN'}</button>
      </div>
      <section class="cl-uber-card" ref={card} aria-live="polite">
        <div class="cl-uber-eta" data-testid="track-eta">
          {view.eta && !soon && <b class="cl-uber-min">{view.eta.left}<small>{'\u00a0'}min</small></b>}
          <span class="cl-uber-when">{soon ? ct(l, 'track.etaSoon') : view.eta ? ct(l, 'track.etaAt', { time: nbClock(view.eta.minute, l) }) : ct(l, 'track.etaNone')}</span>
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
        {p.jobToken && <Button variant="ghost" block icon={<CalendarDays />} href={`#t=${p.jobToken}${l === 'en' ? '&l=en' : ''}`} data-testid="track-see-job">{ct(l, 'track.seeAppointment')}</Button>}
      </section>
    </div>
  );
}

function Over(p: { view: TrackView; l: CLang; garage: Garage | null; jobToken: string | null }) {
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
      {p.jobToken && <Button variant="ghost" icon={<CalendarDays />} href={`#t=${p.jobToken}${l === 'en' ? '&l=en' : ''}`} data-testid="track-see-job">{ct(l, 'track.seeAppointment')}</Button>}
    </section>
  );
}
