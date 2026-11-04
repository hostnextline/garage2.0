/* The tracking map: the mechanic (a pulsing dot), the customer's place, the planned route. Leaflet and its style are
   loaded with this file only. The map follows the truck until the customer moves it (« Recentrer » brings it back). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Crosshair } from 'lucide-preact';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ct, type CLang } from './i18n';
import type { TrackView } from './track-state';

const HOUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>';
const MONTREAL: [number, number] = [45.5017, -73.5673];

interface Live {
  L: typeof Leaflet; map: Leaflet.Map; dot: Leaflet.Marker | null; home: Leaflet.Marker | null;
  line: Leaflet.Polyline | null; casing: Leaflet.Polyline | null; fitting: boolean; fitted: boolean;
}

export default function TrackMap(p: { view: TrackView; l: CLang }) {
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
        const map = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, tapHold: false } as Leaflet.MapOptions);
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
      if (!st.casing) st.casing = L.polyline(route, { className: 'cl-route-casing', weight: 9, opacity: 0.9, interactive: false }).addTo(map);
      else st.casing.setLatLngs(route);
      if (!st.line) st.line = L.polyline(route, { className: 'cl-route', weight: 5, opacity: 0.95, interactive: false, dashArray: dashed ? '2 10' : undefined }).addTo(map);
      else { st.line.setLatLngs(route); st.line.setStyle({ dashArray: dashed ? '2 10' : '' }); }
    }
    if (v.dest) {
      const at: [number, number] = [v.dest.lat, v.dest.lng];
      if (!st.home) st.home = L.marker(at, { icon: L.divIcon({ className: 'cl-pin', html: `<span class="cl-home">${HOUSE}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] }), title: ct(p.l, 'track.home'), alt: ct(p.l, 'track.home'), keyboard: false, zIndexOffset: 100 }).addTo(map);
      else st.home.setLatLng(at);
    }
    if (v.pos) {
      const at: [number, number] = [v.pos.lat, v.pos.lng];
      if (!st.dot) st.dot = L.marker(at, { icon: L.divIcon({ className: 'cl-pin', html: '<span class="cl-dot"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }), title: ct(p.l, 'track.truck'), alt: ct(p.l, 'track.truck'), keyboard: false, zIndexOffset: 200 }).addTo(map);
      else st.dot.setLatLng(at);
    } else if (st.dot) { st.dot.remove(); st.dot = null; }
    if (!touchedRef.current) fit(st, v, !st.fitted);
  }, [ready, p.view.pos?.lat, p.view.pos?.lng, p.view.dest?.lat, p.view.dest?.lng, p.view.route.length, p.l]);

  const recenter = () => {
    const st = live.current;
    if (!st) return;
    setTouched(false);
    fit(st, p.view, true);
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
function fit(st: Live, v: TrackView, whole: boolean) {
  const { L, map } = st;
  const pts: [number, number][] = [];
  if (v.pos) pts.push([v.pos.lat, v.pos.lng]);
  if (v.dest) pts.push([v.dest.lat, v.dest.lng]);
  if (whole) for (const r of v.route) pts.push(r);
  if (!pts.length) return;
  st.fitting = true;
  try {
    if (pts.length === 1) map.setView(pts[0], 15, { animate: false });
    else map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16, animate: false });
    st.fitted = true;
  } finally {
    st.fitting = false;
  }
}
