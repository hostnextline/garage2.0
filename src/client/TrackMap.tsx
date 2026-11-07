/* The tracking map, kept plain (Uber style): grey streets, a black route, the truck (a black round with a van) and the
   customer's place (a black square). Leaflet and its style are loaded with this file only. The map follows the truck
   until the customer moves it (« Recentrer » brings it back). padBottom: room left for the card over the map. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Crosshair } from 'lucide-preact';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ct, type CLang } from './i18n';
import type { TrackView } from './track-state';

const VAN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';
const MONTREAL: [number, number] = [45.5017, -73.5673];

interface Live {
  L: typeof Leaflet; map: Leaflet.Map; dot: Leaflet.Marker | null; home: Leaflet.Marker | null;
  line: Leaflet.Polyline | null; casing: Leaflet.Polyline | null; fitting: boolean; fitted: boolean;
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
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
        }).addTo(map);
        map.setView(MONTREAL, 11);
        const st: Live = { L, map, dot: null, home: null, line: null, casing: null, fitting: false, fitted: false };
        const mark = () => { if (!st.fitting) setTouched(true); };
        map.on('dragstart', mark);
        map.on('zoomstart', mark);
        live.current = st;
        setReady(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; live.current?.map.remove(); live.current = null; };
  }, []);

  // draw what the last answer says; follow the truck unless the customer moved the map
  useEffect(() => {
    const st = live.current;
    if (!st || !ready) return;
    const { L, map } = st;
    const v = p.view;
    const route: [number, number][] = v.route.length >= 2 ? v.route : v.pos && v.dest ? [[v.pos.lat, v.pos.lng], [v.dest.lat, v.dest.lng]] : [];
    const dashed = v.route.length < 2;
    if (route.length >= 2) {
      if (!st.casing) st.casing = L.polyline(route, { className: 'cl-route-casing', weight: 8, opacity: 1, interactive: false }).addTo(map);
      else st.casing.setLatLngs(route);
      if (!st.line) st.line = L.polyline(route, { className: 'cl-route', weight: 5, opacity: 0.95, interactive: false, dashArray: dashed ? '2 10' : undefined }).addTo(map);
      else { st.line.setLatLngs(route); st.line.setStyle({ dashArray: dashed ? '2 10' : '' }); }
    }
    if (v.dest) {
      const at: [number, number] = [v.dest.lat, v.dest.lng];
      if (!st.home) st.home = L.marker(at, { icon: L.divIcon({ className: 'cl-pin', html: '<span class="cl-home"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }), title: ct(p.l, 'track.home'), alt: ct(p.l, 'track.home'), keyboard: false, zIndexOffset: 100 }).addTo(map);
      else st.home.setLatLng(at);
    }
    if (v.pos) {
      const at: [number, number] = [v.pos.lat, v.pos.lng];
      if (!st.dot) st.dot = L.marker(at, { icon: L.divIcon({ className: 'cl-pin', html: `<span class="cl-dot">${VAN}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] }), title: ct(p.l, 'track.truck'), alt: ct(p.l, 'track.truck'), keyboard: false, zIndexOffset: 200 }).addTo(map);
      else st.dot.setLatLng(at);
    } else if (st.dot) { st.dot.remove(); st.dot = null; }
    if (!touchedRef.current) fit(st, v, !st.fitted, p.padBottom || 48);
  }, [ready, p.view.pos?.lat, p.view.pos?.lng, p.view.dest?.lat, p.view.dest?.lng, p.view.route.length, p.l]);

  const recenter = () => {
    const st = live.current;
    if (!st) return;
    setTouched(false);
    fit(st, p.view, true, p.padBottom || 48);
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

/** the first time: the whole route; then what is left between the truck and the house */
function fit(st: Live, v: TrackView, whole: boolean, padBottom: number) {
  const { L, map } = st;
  const pts: [number, number][] = [];
  if (v.pos) pts.push([v.pos.lat, v.pos.lng]);
  if (v.dest) pts.push([v.dest.lat, v.dest.lng]);
  if (whole) for (const r of v.route) pts.push(r);
  if (!pts.length) return;
  st.fitting = true;
  try {
    if (pts.length === 1) { map.setView(pts[0], 15, { animate: false }); map.panBy([0, padBottom / 2 - 44], { animate: false }); }
    else map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 88], paddingBottomRight: [40, padBottom], maxZoom: 16, animate: false });
    st.fitted = true;
  } finally {
    st.fitting = false;
  }
}
