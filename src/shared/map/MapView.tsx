/* A map (owner: map). Leaflet with OpenStreetMap tiles, loaded only when a map is shown.
   Markers: numbered stops in the truck's colour (a check when done), the Centrale with the H.I.S badge, people as a
   pulsing dot with their name, a customer's place (a pin). Lines in a colour, dashed for a trip on the way.
   The view fits the markers when they first come (and when the set of markers changes), not on every refresh, so a
   person who moved the map keeps their view. Light on purpose: used by the team map, the booking screen and the
   customer's tracking page (no data layer, no dictionary: words come from props or the page's language).
   Optional props: full (the big map: wheel zoom, one-finger drag on phones), focus (marker ids to fit),
   fitPadding, controls (zoom buttons), label (for screen readers), onBackgroundClick. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type * as Leaflet from 'leaflet';
import './mapview.css';

export interface MapMarker {
  id: string; lat: number; lng: number;
  kind: 'home' | 'job' | 'person' | 'customer';
  color?: string | null; label?: string; number?: number | string | null; done?: boolean; title?: string; onClick?: () => void;
  /** a second short line under the label (« il y a 2 min », « arrivée vers 10 h 40 ») */
  sub?: string;
  /** draws attention (the stop chosen, the destination of a trip) */
  active?: boolean;
  /** faded (another truck while one is chosen, a position that is getting old) */
  dim?: boolean;
}
export interface MapLine { points: [number, number][]; color?: string | null; dashed?: boolean; weight?: number; opacity?: number }
export interface MapViewProps {
  markers: MapMarker[]; lines?: MapLine[]; height?: string; class?: string; 'data-testid'?: string;
  full?: boolean;
  focus?: string[] | null;
  /** change it to fit the view again (a « Recentrer » button) */
  fitKey?: string | number;
  fitPadding?: [number, number, number, number];
  controls?: boolean;
  label?: string;
  onBackgroundClick?: () => void;
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

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const safeColor = (c: string | null | undefined, fallback: string) => (c && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i.test(c.trim()) ? c.trim() : fallback);
const isEn = () => typeof document !== 'undefined' && /^en/i.test(document.documentElement.lang || '');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function labelHtml(m: MapMarker): string {
  if (!m.label && !m.sub) return '';
  return `<span class="mv-label">${m.label ? `<b>${esc(m.label)}</b>` : ''}${m.sub ? `<small>${esc(m.sub)}</small>` : ''}</span>`;
}
function iconOf(L: LeafletNS, m: MapMarker): Leaflet.DivIcon {
  const cls = ['mv-mk', `mv-${m.kind}`, m.done && 'is-done', m.active && 'is-active', m.dim && 'is-dim', m.onClick && 'is-tap'].filter(Boolean).join(' ');
  if (m.kind === 'home') {
    return L.divIcon({ className: 'mv-icon', iconSize: [46, 46], iconAnchor: [23, 23],
      html: `<span data-mk="${esc(m.id)}" class="${cls}"><span class="mv-badge"><img src="./logo-his.png" alt="" draggable="false" /></span>${labelHtml(m)}</span>` });
  }
  if (m.kind === 'person') {
    return L.divIcon({ className: 'mv-icon', iconSize: [22, 22], iconAnchor: [11, 11],
      html: `<span data-mk="${esc(m.id)}" class="${cls}" style="--c:${safeColor(m.color, '#2F6FD0')}"><span class="mv-pulse"></span><span class="mv-dot"></span>${labelHtml(m)}</span>` });
  }
  if (m.kind === 'customer') {
    return L.divIcon({ className: 'mv-icon', iconSize: [30, 40], iconAnchor: [15, 38],
      html: `<span data-mk="${esc(m.id)}" class="${cls}" style="--c:${safeColor(m.color, '#D3000E')}"><span class="mv-pin"><span></span></span>${labelHtml(m)}</span>` });
  }
  const n = m.number == null || m.number === '' ? '' : String(m.number);
  return L.divIcon({ className: 'mv-icon', iconSize: [34, 34], iconAnchor: [17, 17],
    html: `<span data-mk="${esc(m.id)}" class="${cls}" style="--c:${safeColor(m.color, '#5D6B78')}"><span class="mv-num${n.length > 2 ? ' is-long' : ''}">${m.done ? CHECK : esc(n)}</span>${labelHtml(m)}</span>` });
}

interface State { L: LeafletNS; map: Leaflet.Map; layer: Leaflet.LayerGroup; sig: string; ids: string; focus: string; fitted: boolean }

export function MapView(p: MapViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const st = useRef<State | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  /* create the map once (and remove it when the screen goes) */
  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    setPhase('loading');
    loadLeaflet().then((L) => {
      if (!alive || !box.current) return;
      const full = !!latest.current.full;
      const map = L.map(box.current, {
        zoomControl: false, attributionControl: false, scrollWheelZoom: full, dragging: full || !L.Browser.mobile,
        touchZoom: true, doubleClickZoom: true, boxZoom: false, keyboard: true, zoomSnap: 0.5, minZoom: 3, maxZoom: 19
      });
      if (latest.current.controls !== false) L.control.zoom({ position: 'topleft', zoomInTitle: isEn() ? 'Zoom in' : 'Rapprocher', zoomOutTitle: isEn() ? 'Zoom out' : 'Éloigner' }).addTo(map);
      L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(map);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION, subdomains: 'abc' }).addTo(map);
      map.setView(MONTREAL, 11);
      map.on('click', () => latest.current.onBackgroundClick?.());
      const layer = L.layerGroup().addTo(map);
      st.current = { L, map, layer, sig: '', ids: '', focus: '', fitted: false };
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => {
          const s = st.current;
          if (!s) return;
          s.map.invalidateSize({ animate: false });
          if (!s.fitted) fit(s, true);
        });
        ro.observe(box.current);
      }
      setPhase('ready');
    }, () => { if (alive) setPhase('failed'); });
    return () => {
      alive = false;
      ro?.disconnect();
      const s = st.current;
      st.current = null;
      if (s) { try { s.map.off(); s.map.remove(); } catch { /* already gone */ } }
    };
  }, [attempt]);

  /* markers and lines: drawn again only when they really changed */
  useEffect(() => {
    const s = st.current;
    if (phase !== 'ready' || !s) return;
    const markers = (p.markers || []).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng) && Math.abs(m.lat) <= 90 && Math.abs(m.lng) <= 180);
    const lines = (p.lines || []).map((l) => ({ ...l, points: (l.points || []).filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1])) })).filter((l) => l.points.length >= 2);
    const sig = JSON.stringify([markers.map(({ onClick, ...m }) => [m, !!onClick]), lines]);
    if (sig !== s.sig) {
      s.sig = sig;
      const { L, layer } = s;
      layer.clearLayers();
      for (const l of lines) {
        const w = l.weight ?? 4;
        const op = l.opacity ?? 0.9;
        L.polyline(l.points, { className: 'mv-casing', weight: w + 4, opacity: Math.min(1, op + 0.05), interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
        L.polyline(l.points, { color: safeColor(l.color, '#5D6B78'), weight: w, opacity: op, dashArray: l.dashed ? '2 10' : undefined, interactive: false, lineCap: 'round', lineJoin: 'round', className: l.dashed ? 'mv-line is-dashed' : 'mv-line' }).addTo(layer);
      }
      for (const m of markers) {
        const tap = !!m.onClick;
        const mk = L.marker([m.lat, m.lng], {
          icon: iconOf(L, m), title: m.title || m.label || '', alt: m.title || m.label || '', keyboard: tap, interactive: tap, riseOnHover: tap,
          zIndexOffset: m.kind === 'person' ? (m.dim ? 400 : 950) : m.dim ? -800 : m.active ? 900 : m.kind === 'job' || m.kind === 'customer' ? 300 : 100
        });
        if (tap) {
          const id = m.id;
          mk.on('click', (e: Leaflet.LeafletMouseEvent) => {
            if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
            latest.current.markers.find((x) => x.id === id)?.onClick?.();
          });
          mk.on('keypress', (e: Leaflet.LeafletKeyboardEvent) => {
            const k = (e.originalEvent as KeyboardEvent | undefined)?.key;
            if (k === 'Enter' || k === ' ') latest.current.markers.find((x) => x.id === id)?.onClick?.();
          });
        }
        mk.addTo(layer);
      }
    }
    // a new set of markers (another day…) or a new focus: fit; the same markers moving: keep the person's view
    const ids = markers.map((m) => m.id).sort().join('|');
    const focus = `${(p.focus || []).join('|')}#${p.fitKey ?? ''}`;
    if (!s.fitted || ids !== s.ids || focus !== s.focus) {
      s.ids = ids; s.focus = focus;
      fit(s, !s.fitted);
    }
  }, [phase, p.markers, p.lines, (p.focus || []).join('|'), p.fitKey]);

  function fit(s: State, first: boolean) {
    const box0 = s.map.getContainer();
    if (!box0.clientWidth || !box0.clientHeight) return;   // not visible yet: done when it gets a size
    const cur = latest.current;
    const all = (cur.markers || []).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
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
