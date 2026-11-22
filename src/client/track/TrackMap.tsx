/* The tracking map, kept plain (Uber style): grey streets, a black route, the truck (a black round with a van) and the
   customer's place (a black square). Leaflet and its style are loaded with this file only. padBottom: room left for
   the card over the map.
   The truck glides from one position to the next (glide.ts), as if the map were never refreshed. The map is fitted
   once, at the start; after that it only pans, gently, when the truck comes near the edge of what is seen (or leaves
   it), so that the truck and the house are both in view; it never zooms in and out at each position. Once the
   customer moves or zooms the map, it is left alone until « Recentrer la carte ».
   The streets: TomTom's tiles when the app has its key; refused (TomTom's own answer to ONE plain request of a tile that
   failed: lib/tomtom.ts checkTile; no network is never a refusal) → OpenStreetMap's with its credit, once, for good on
   this page: never a blank map. The route: the server's road only (3 points or more: lib/tomtom.ts isRoadLine), else
   no line at all (never a straight one, not even dotted, and never the old server's two-point line). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Crosshair } from 'lucide-preact';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ct, type CLang } from '../i18n';
import { project, routeOf, type LatLng, type Pt, type Route, type TrackView } from './track-state';
import { glider, prefersReduced, type Glider } from './glide';
import { TOMTOM_KEY } from '../../lib/config';
import { tomtomTiles, tileWatch, checkTile, isRoadLine, OSM_ATTRIBUTION } from '../../lib/tomtom';

const VAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';
const MONTREAL: [number, number] = [45.5017, -73.5673];
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** TomTom's tiles on this page: refused once → a map made again takes OpenStreetMap's at once */
const tiles = tileWatch();
/** forgets that TomTom's tiles were refused (tests) */
export function forgetTiles() { tiles.forget(); }
/** the room kept around the map's free part: the sides, the brand bar at the top (the card is padBottom) */
const SIDE = 40;
const TOP = 88;
/** the truck nearer than this to the edge of the free part: the map pans */
const EDGE = 48;
/** the pan's length (s); a smaller pan is not worth it while the truck is still in view (px) */
const PAN_S = 1;
const MIN_PAN = 24;
/** a position within this time of the page coming back on screen is placed at once */
const BACK_MS = 10000;

interface Live {
  L: typeof Leaflet; map: Leaflet.Map; dot: Leaflet.Marker | null; home: Leaflet.Marker | null;
  line: Leaflet.Polyline | null; casing: Leaflet.Polyline | null; fitting: boolean; fitted: boolean;
  glide: Glider;
  /** the route measured (once per route) */
  route: Route | null; routeKey: string;
  /** the last position given to the dot, with its time (ms) */
  target: { lat: number; lng: number; at: number } | null;
  dest: LatLng | null;
  pad: number;
  /** until then, a position is placed at once (the page just came back on screen) */
  backUntil: number;
  /** our own pan runs until then: the edge is not looked at meanwhile */
  panUntil: number;
  /** a zoom is running (Leaflet moves the markers itself): the dot takes its place at the end */
  zooming: boolean;
  follow: () => boolean;
  fail: (e: unknown) => void;
  off: () => void;
}

export default function TrackMap(p: { view: TrackView; l: CLang; padBottom?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const [ready, setReady] = useState(false);
  const [touched, setTouched] = useState(false);
  const [failed, setFailed] = useState(false);
  const touchedRef = useRef(false);
  touchedRef.current = touched;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mod = await import('leaflet');
        const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
        if (!alive || !box.current) return;
        const map = L.map(box.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, tapHold: false } as Leaflet.MapOptions);
        map.attributionControl.setPrefix(false);
        // the page sends no Referer (client.html), but OpenStreetMap refuses tiles asked without one, and TomTom answers
        // its key only for the app's addresses: the tiles say where they are shown (the site only, never the address
        // with its fragment). TomTom's map when the app has its key, else OpenStreetMap's as before.
        const tt = TOMTOM_KEY && !tiles.down ? tomtomTiles(TOMTOM_KEY) : null;
        const osm = () => L.tileLayer(OSM_TILES, { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: OSM_ATTRIBUTION }).addTo(map);
        if (!tt) osm();
        else {
          const layer = L.tileLayer(tt.url, { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: tt.attribution }).addTo(map);
          const failed = (e: Leaflet.TileErrorEvent) => {
            if (!tiles.error(typeof navigator === 'undefined' || navigator.onLine !== false)) return;
            const url = e?.tile?.src || (e?.coords ? layer.getTileUrl(e.coords) : '');
            if (!url) { tiles.checked('network'); return; }
            // the request says the site's address itself (this page sends no Referer otherwise)
            void checkTile(url, (u, o) => fetch(u, o)).then((r) => {
              if (!tiles.checked(r) || !alive) return;
              // only our own listener: the credit's « remove » listener must hear the layer go (its words leave with it)
              layer.off('tileerror', failed);
              layer.remove();
              osm();
            });
          };
          layer.on('tileerror', failed);
        }
        map.setView(MONTREAL, 11);
        const st: Live = {
          L, map, dot: null, home: null, line: null, casing: null, fitting: false, fitted: false,
          glide: null as unknown as Glider, route: null, routeKey: '', target: null, dest: null, pad: 48,
          backUntil: 0, panUntil: 0, zooming: false,
          follow: () => !touchedRef.current,
          fail: (e) => { console.error('track map:', e); st.glide.stop(); if (alive) setFailed(true); },
          off: () => undefined
        };
        st.glide = glider((pt) => { try { moveDot(st, pt); } catch (e) { st.fail(e); } });
        // the customer moves or zooms the map: it is theirs until « Recentrer »
        const mark = () => { if (!st.fitting) { touchedRef.current = true; setTouched(true); } };
        map.on('dragstart', mark);
        map.on('zoomstart', mark);
        map.on('zoomstart', () => { st.zooming = true; });
        map.on('zoomend', () => {
          st.zooming = false;
          const w = st.glide.where();
          if (w) { try { moveDot(st, w); } catch (e) { st.fail(e); } }
        });
        // hidden: the glide ends at once (no frames for nothing); back on screen: the next position is placed at once
        const onVis = () => {
          if (document.visibilityState === 'hidden') st.glide.finish();
          else st.backUntil = Date.now() + BACK_MS;
        };
        document.addEventListener('visibilitychange', onVis);
        st.off = () => document.removeEventListener('visibilitychange', onVis);
        live.current = st;
        setReady(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      const st = live.current;
      live.current = null;
      if (st) { st.glide.stop(); st.off(); st.map.remove(); }
    };
  }, []);

  useEffect(() => { if (live.current) live.current.pad = p.padBottom || 48; });
  useEffect(() => { if (failed) live.current?.glide.stop(); }, [failed]);

  // draw what the last answer says. A Leaflet error here hides the map only: the card (time of arrival, call button)
  // stays, the Guard around the page never sees it (client-r2-1)
  useEffect(() => {
    const st = live.current;
    if (!st || !ready || failed) return;
    try { draw(st, p.view, p.l, !touchedRef.current, p.padBottom || 48); } catch (e) {
      console.error('track map:', e);
      st.glide.stop();
      setFailed(true);
    }
  }, [ready, p.view.pos?.lat, p.view.pos?.lng, p.view.pos?.at, p.view.dest?.lat, p.view.dest?.lng, p.view.route.length, p.l]);

  const recenter = () => {
    const st = live.current;
    if (!st) return;
    touchedRef.current = false;
    setTouched(false);
    try { fit(st, p.view, false, p.padBottom || 48); } catch (e) {
      console.error('track map:', e);
      st.glide.stop();
      setFailed(true);
    }
  };

  if (failed) return null;
  return (
    <div class="cl-map" data-testid="track-map">
      <div ref={box} style={{ position: 'absolute', inset: 0 }} role="region" aria-label={ct(p.l, 'track.map')} />
      {touched && (
        <button type="button" class="btn btn-secondary cl-recenter" onClick={recenter} data-testid="track-recenter">
          <Crosshair aria-hidden="true" />{ct(p.l, 'track.recenter')}
        </button>
      )}
    </div>
  );
}

/** the route, the house and the truck of the last answer; the first time, the view on the whole trip */
function draw(st: Live, v: TrackView, l: CLang, follow: boolean, padBottom: number) {
  const { L, map } = st;
  st.pad = padBottom;
  // the road the server worked out (3 points or more), or no line at all: the truck and the house still show (never a
  // straight line between them, not even a dotted one)
  const road: Pt[] = isRoadLine(v.route) ? v.route : [];
  const key = road.length ? `${road.length}:${road[0].join(',')}:${road[road.length - 1].join(',')}` : '';
  if (key !== st.routeKey) { st.routeKey = key; st.route = routeOf(road); }
  st.dest = v.dest;
  if (road.length) {
    if (!st.casing) st.casing = L.polyline(road, { className: 'cl-route-casing', weight: 8, opacity: 1, interactive: false }).addTo(map);
    else st.casing.setLatLngs(road);
    if (!st.line) st.line = L.polyline(road, { className: 'cl-route', weight: 5, opacity: 0.95, interactive: false }).addTo(map);
    else st.line.setLatLngs(road);
  } else {
    if (st.casing) { st.casing.remove(); st.casing = null; }
    if (st.line) { st.line.remove(); st.line = null; }
  }
  if (v.dest) {
    const at: [number, number] = [v.dest.lat, v.dest.lng];
    if (!st.home) st.home = L.marker(at, { icon: L.divIcon({ className: 'cl-pin', html: '<span class="cl-home"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }), title: ct(l, 'track.home'), alt: ct(l, 'track.home'), keyboard: false, zIndexOffset: 100 }).addTo(map);
    else st.home.setLatLng(at);
  }
  if (v.pos) {
    const target = { lat: v.pos.lat, lng: v.pos.lng };
    const at = Date.parse(v.pos.at);
    if (!st.dot) {
      st.dot = L.marker([target.lat, target.lng], { icon: L.divIcon({ className: 'cl-pin', html: `<span class="cl-dot">${VAN}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] }), title: ct(l, 'track.truck'), alt: ct(l, 'track.truck'), keyboard: false, zIndexOffset: 200 }).addTo(map);
      st.glide.to(target, { instant: true });
    } else if (!st.target || st.target.lat !== target.lat || st.target.lng !== target.lng) {
      const gap = st.target && Number.isFinite(at) && Number.isFinite(st.target.at) ? at - st.target.at : null;
      const instant = Date.now() < st.backUntil;
      st.backUntil = 0;
      st.glide.to(target, { gapMs: gap, route: st.route, instant });
    }
    st.target = { ...target, at };
  } else {
    if (st.dot) { st.dot.remove(); st.dot = null; }
    st.glide.stop();
    st.target = null;
  }
  if (follow && !st.fitted) fit(st, v, true, padBottom);
  else if (follow) { const w = st.glide.where(); if (w) keepInView(st, w); }
}

/** the dot where the glide is; the map pans when it comes near the edge */
function moveDot(st: Live, p: LatLng) {
  if (!st.dot || st.zooming) return;
  st.dot.setLatLng([p.lat, p.lng]);
  // Leaflet puts a marker on a whole pixel: at a truck's speed the dot would hop a pixel at a time; to the fraction
  // of a pixel it slides (a zoom or a new view puts it back on Leaflet's own pixel, where it rests anyway)
  const el = st.dot.getElement();
  if (el) st.L.DomUtil.setPosition(el, st.map.project([p.lat, p.lng]).subtract(st.map.getPixelOrigin()));   // latLngToLayerPoint rounds
  if (st.follow()) keepInView(st, p);
}

/** the truck near the edge of the free part of the map (or out of it): a gentle pan that puts the truck and the house
    in the middle of it. When they no longer fit at this zoom (he went the other way), once, a wider view — never a
    closer one. */
function keepInView(st: Live, p: LatLng) {
  const { L, map } = st;
  if (!st.fitted || st.fitting || st.zooming || Date.now() < st.panUntil) return;
  const size = map.getSize();
  const x0 = SIDE, y0 = TOP, x1 = size.x - SIDE, y1 = size.y - st.pad;
  const w = x1 - x0, h = y1 - y0;
  if (w < 120 || h < 120) return;
  const m = Math.min(EDGE, w / 5, h / 5);
  const d = map.latLngToContainerPoint([p.lat, p.lng]);
  if (d.x >= x0 + m && d.x <= x1 - m && d.y >= y0 + m && d.y <= y1 - m) return;
  const pts = [d];
  if (st.dest) pts.push(map.latLngToContainerPoint([st.dest.lat, st.dest.lng]));
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // the same free part as the first view: what fitted then still fits (no zoom out for a truck near the edge)
  if (maxX - minX > w || maxY - minY > h) {
    const ll: Pt[] = [[p.lat, p.lng]];
    if (st.dest) ll.push([st.dest.lat, st.dest.lng]);
    st.fitting = true;
    try {
      map.fitBounds(L.latLngBounds(ll), { paddingTopLeft: [SIDE, TOP], paddingBottomRight: [SIDE, st.pad], maxZoom: map.getZoom(), animate: false });
    } finally {
      st.fitting = false;
    }
    return;
  }
  const dx = Math.round((minX + maxX) / 2 - (x0 + x1) / 2), dy = Math.round((minY + maxY) / 2 - (y0 + y1) / 2);
  // still inside the free part and nothing much to gain (the truck and the house already fill it): no pan for a few
  // pixels, again and again
  const inside = d.x >= x0 && d.x <= x1 && d.y >= y0 && d.y <= y1;
  if (inside ? Math.abs(dx) < MIN_PAN && Math.abs(dy) < MIN_PAN : !dx && !dy) return;
  const reduced = prefersReduced();
  st.panUntil = Date.now() + (reduced ? 0 : PAN_S * 1000 + 200);
  map.panBy([dx, dy], { animate: !reduced, duration: PAN_S, easeLinearity: 0.5 });
}

/** whole: the whole route (the first time); else what is left: the truck where it is drawn, the route ahead of it and
    the house (« Recentrer la carte ») */
function fit(st: Live, v: TrackView, whole: boolean, padBottom: number) {
  const { L, map } = st;
  const pts: [number, number][] = [];
  const dot = st.glide.where() ?? (v.pos ? { lat: v.pos.lat, lng: v.pos.lng } : null);
  if (dot) pts.push([dot.lat, dot.lng]);
  if (v.dest) pts.push([v.dest.lat, v.dest.lng]);
  if (whole && isRoadLine(v.route)) for (const r of v.route) pts.push(r);
  else if (!whole && st.route) {
    const from = dot ? project(st.route, dot).along : 0;
    st.route.pts.forEach((r, i) => { if (st.route!.cum[i] >= from) pts.push(r); });
  }
  if (!pts.length) return;
  st.fitting = true;
  try {
    if (pts.length === 1) { map.setView(pts[0], 15, { animate: false }); map.panBy([0, padBottom / 2 - 44], { animate: false }); }
    else map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [SIDE, TOP], paddingBottomRight: [SIDE, padBottom], maxZoom: 16, animate: false });
    st.fitted = true;
  } finally {
    st.fitting = false;
  }
}
