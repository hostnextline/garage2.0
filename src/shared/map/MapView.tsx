/* A map (owner: map). Leaflet with OpenStreetMap tiles, loaded only when a map is shown.
   Markers: numbered stops in the truck's colour (a check when done), the Centrale with the H.I.S badge, people as a
   pulsing dot with their name, a customer's place (a pin). Lines in a colour, dashed for a trip on the way.
   Only what changed is drawn again (markers.ts): a marker that moves is moved, a label that changes gets a new icon,
   the others stay as they are (a pulse keeps pulsing, a finger on a marker keeps its tap, the keyboard keeps its place).
   The view fits the markers when they first come, on a new focus and on « Recentrer » (fitKey); when the set of markers
   changes, it fits again too (refit 'markers', the default: a booking moment shown on another day), or only while the
   person has not moved the map themselves (refit 'focus': the team map, where a mechanic starting his shift must not
   throw the dispatcher's zoom away). Light on purpose: used by the team map, the booking screens, the closing sheet and
   Réglages (no data layer, no dictionary: words come from props or the page's language).
   Optional props: full (the big map: wheel zoom, one-finger drag on phones), focus (marker ids to fit),
   fitPadding, controls (zoom buttons), label (for screen readers), onBackgroundClick, refit. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type * as Leaflet from 'leaflet';
import { iconSpec, zIndexOf, drawable, markerSig, markerChange, sameLine, samePoints, safeColor, shouldFit, type MapMarker, type MapLine, type MarkerSig } from './markers';
import './mapview.css';

export type { MapMarker, MapLine } from './markers';
export interface MapViewProps {
  markers: MapMarker[]; lines?: MapLine[]; height?: string; class?: string; 'data-testid'?: string;
  full?: boolean;
  focus?: string[] | null;
  /** change it to fit the view again (a « Recentrer » button, another day) */
  fitKey?: string | number;
  fitPadding?: [number, number, number, number];
  controls?: boolean;
  label?: string;
  onBackgroundClick?: () => void;
  /** when a new set of markers fits the view again: always ('markers', the default), or only before the person moved the map ('focus') */
  refit?: 'markers' | 'focus';
}

type LeafletNS = typeof Leaflet;
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const MONTREAL: [number, number] = [45.5017, -73.5673];

let leafletP: Promise<LeafletNS> | null = null;
function loadLeaflet(): Promise<LeafletNS> {
  if (!leafletP) {
    leafletP = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([m]) => ((m as unknown as { default?: LeafletNS }).default ?? (m as unknown as LeafletNS)))
      .catch((e) => { leafletP = null; throw e; });
  }
  return leafletP;
}

const isEn = () => typeof document !== 'undefined' && /^en/i.test(document.documentElement.lang || '');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Drawn { mk: Leaflet.Marker; sig: MarkerSig }
interface DrawnLine { line: MapLine; casing: Leaflet.Polyline; stroke: Leaflet.Polyline }
interface State {
  L: LeafletNS; map: Leaflet.Map; layer: Leaflet.LayerGroup; zoom: Leaflet.Control.Zoom | null;
  markers: Map<string, Drawn>; lines: DrawnLine[]; ids: string; focus: string; fitKey: string; fitted: boolean; touched: boolean;
}

const divIcon = (L: LeafletNS, m: MapMarker) => { const s = iconSpec(m); return L.divIcon({ className: 'mv-icon', iconSize: s.size, iconAnchor: s.anchor, html: s.html }); };
const casingStyle = (l: MapLine): Leaflet.PolylineOptions => ({ className: 'mv-casing', weight: (l.weight ?? 4) + 4, opacity: Math.min(1, (l.opacity ?? 0.9) + 0.05), interactive: false, lineCap: 'round', lineJoin: 'round' });
const strokeStyle = (l: MapLine): Leaflet.PolylineOptions => ({ color: safeColor(l.color, '#5D6B78'), weight: l.weight ?? 4, opacity: l.opacity ?? 0.9, dashArray: l.dashed ? '2 10' : undefined, interactive: false, lineCap: 'round', lineJoin: 'round', className: l.dashed ? 'mv-line is-dashed' : 'mv-line' });

export function MapView(p: MapViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const st = useRef<State | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  /* create the map once (and remove it, its listeners and its layers when the screen goes) */
  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    let el: HTMLDivElement | null = null;
    const touch = () => { if (st.current) st.current.touched = true; };
    setPhase('loading');
    loadLeaflet().then((L) => {
      if (!alive || !box.current) return;
      el = box.current;
      const full = !!latest.current.full;
      const map = L.map(el, {
        zoomControl: false, attributionControl: false, scrollWheelZoom: full, dragging: full || !L.Browser.mobile,
        touchZoom: true, doubleClickZoom: true, boxZoom: false, keyboard: true, zoomSnap: 0.5, minZoom: 3, maxZoom: 19
      });
      L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(map);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION, subdomains: 'abc' }).addTo(map);
      map.setView(MONTREAL, 11);
      map.on('click', () => latest.current.onBackgroundClick?.());
      const layer = L.layerGroup().addTo(map);
      st.current = { L, map, layer, zoom: null, markers: new Map(), lines: [], ids: '', focus: '', fitKey: '', fitted: false, touched: false };
      // the person put a finger (or the mouse, or the wheel) on the map: from now on their view is theirs
      el.addEventListener('pointerdown', touch);
      el.addEventListener('wheel', touch, { passive: true });
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => {
          const s = st.current;
          if (!s) return;
          s.map.invalidateSize({ animate: false });
          if (!s.fitted) fit(s, true);
        });
        ro.observe(el);
      }
      setPhase('ready');
    }, () => { if (alive) setPhase('failed'); });
    return () => {
      alive = false;
      ro?.disconnect();
      el?.removeEventListener('pointerdown', touch);
      el?.removeEventListener('wheel', touch);
      const s = st.current;
      st.current = null;
      if (s) {
        s.layer.clearLayers();
        s.markers.clear();
        s.lines = [];
        s.map.off();
        s.map.remove();
      }
    };
  }, [attempt]);

  /* the zoom buttons and the big map's gestures follow the props (a tablet turned crosses the width of a computer) */
  useEffect(() => {
    const s = st.current;
    if (phase !== 'ready' || !s) return;
    const want = p.controls !== false;
    if (want && !s.zoom) s.zoom = s.L.control.zoom({ position: 'topleft', zoomInTitle: isEn() ? 'Zoom in' : 'Rapprocher', zoomOutTitle: isEn() ? 'Zoom out' : 'Éloigner' }).addTo(s.map);
    if (!want && s.zoom) { s.zoom.remove(); s.zoom = null; }
    const full = !!p.full;
    if (full) s.map.scrollWheelZoom.enable(); else s.map.scrollWheelZoom.disable();
    if (full || !s.L.Browser.mobile) s.map.dragging.enable(); else s.map.dragging.disable();
  }, [phase, p.controls, p.full]);

  /* markers and lines: only what changed */
  useEffect(() => {
    const s = st.current;
    if (phase !== 'ready' || !s) return;
    const { markers, lines } = drawable(p.markers, p.lines);
    drawLines(s, lines);
    drawMarkers(s, markers);
    const ids = markers.map((m) => m.id).sort().join('|');
    const focus = `${(p.focus || []).join('|')}#${p.fitKey ?? ''}`;
    const fitKey = String(p.fitKey ?? '');
    const focusChanged = s.fitted && focus !== s.focus;
    if (s.fitted && fitKey !== s.fitKey) s.touched = false;   // « Recentrer », another day: the view is the app's again
    if (shouldFit({ fitted: s.fitted, idsChanged: ids !== s.ids, focusChanged, refit: p.refit || 'markers', touched: s.touched })) fit(s, !s.fitted);
    s.ids = ids; s.focus = focus; s.fitKey = fitKey;
  }, [phase, p.markers, p.lines, (p.focus || []).join('|'), p.fitKey, p.refit]);

  function drawLines(s: State, lines: MapLine[]) {
    lines.forEach((l, i) => {
      const cur = s.lines[i];
      if (cur && sameLine(cur.line, l)) return;
      // dashed or not is a class of the drawn line, fixed when it is made
      if (cur && !!cur.line.dashed === !!l.dashed) {
        if (!samePoints(cur.line, l)) { cur.casing.setLatLngs(l.points); cur.stroke.setLatLngs(l.points); }
        cur.casing.setStyle(casingStyle(l));
        cur.stroke.setStyle(strokeStyle(l));
        cur.line = l;
        return;
      }
      if (cur) { cur.casing.remove(); cur.stroke.remove(); }
      s.lines[i] = { line: l, casing: s.L.polyline(l.points, casingStyle(l)).addTo(s.layer), stroke: s.L.polyline(l.points, strokeStyle(l)).addTo(s.layer) };
    });
    for (const gone of s.lines.splice(lines.length)) { gone.casing.remove(); gone.stroke.remove(); }
  }

  function drawMarkers(s: State, markers: MapMarker[]) {
    const seen = new Set<string>();
    for (const m of markers) {
      if (seen.has(m.id)) continue;   // the same id twice: the first one counts
      seen.add(m.id);
      const sig = markerSig(m);
      const cur = s.markers.get(m.id);
      const change = markerChange(cur?.sig, sig);
      if (change === 'none') continue;
      if (cur && change !== 'make') {
        if (change === 'icon') { cur.mk.setIcon(divIcon(s.L, m)); cur.mk.setZIndexOffset(zIndexOf(m)); }
        if (cur.sig.at !== sig.at) cur.mk.setLatLng([m.lat, m.lng]);
        cur.sig = sig;
        continue;
      }
      cur?.mk.remove();
      s.markers.set(m.id, { mk: makeMarker(s, m), sig });
    }
    for (const [id, d] of s.markers) if (!seen.has(id)) { d.mk.remove(); s.markers.delete(id); }
  }

  function makeMarker(s: State, m: MapMarker): Leaflet.Marker {
    const { L } = s;
    const tap = !!m.onClick;
    const mk = L.marker([m.lat, m.lng], { icon: divIcon(L, m), title: m.title || m.label || '', alt: m.title || m.label || '', keyboard: tap, interactive: tap, riseOnHover: tap, zIndexOffset: zIndexOf(m) });
    if (tap) {
      // the marker's click asks the props of now: a marker kept from an earlier drawing never calls an old handler
      const id = m.id;
      const fire = () => latest.current.markers.find((x) => x.id === id)?.onClick?.();
      mk.on('click', (e: Leaflet.LeafletMouseEvent) => { if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent); fire(); });
      mk.on('keypress', (e: Leaflet.LeafletKeyboardEvent) => { const k = (e.originalEvent as KeyboardEvent | undefined)?.key; if (k === 'Enter' || k === ' ') fire(); });
    }
    return mk.addTo(s.layer);
  }

  function fit(s: State, first: boolean) {
    const box0 = s.map.getContainer();
    if (!box0.clientWidth || !box0.clientHeight) return;   // not visible yet: done when it gets a size
    const cur = latest.current;
    const all = drawable(cur.markers).markers;
    const want = cur.focus && cur.focus.length ? all.filter((m) => cur.focus!.includes(m.id)) : all;
    const pts = (want.length ? want : all).map((m) => [m.lat, m.lng] as [number, number]);
    if (!pts.length) return;
    const [t, r, b, l] = cur.fitPadding || [36, 36, 36, 36];
    const animate = !first && !reduced();
    if (pts.length === 1) s.map.setView(pts[0], Math.max(s.map.getZoom(), 14), { animate });
    else s.map.fitBounds(s.L.latLngBounds(pts), { paddingTopLeft: [l, t], paddingBottomRight: [r, b], maxZoom: 15, animate });
    s.fitted = true;
  }

  const cls = ['mv', p.full && 'mv-full', p.class].filter(Boolean).join(' ');
  return (
    <div class="mv-wrap" style={{ height: p.height || '320px' }} data-testid={p['data-testid']}>
      <div ref={box} class={cls} role="region" aria-label={p.label || (isEn() ? 'Map' : 'Carte')} />
      {phase === 'loading' && <div class="mv-veil" aria-hidden="true"><span class="mv-spin" /></div>}
      {phase === 'failed' && (
        <div class="mv-veil mv-failed" role="status">
          <p>{isEn() ? 'The map can’t be shown (no connection?).' : 'La carte ne s’affiche pas (pas de réseau ?).'}</p>
          <button type="button" class="btn btn-secondary btn-sm" onClick={() => setAttempt((n) => n + 1)}>{isEn() ? 'Try again' : 'Réessayer'}</button>
        </div>
      )}
    </div>
  );
}
