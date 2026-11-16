/* What MapView draws, as plain data: the props a screen gives (markers and lines), the HTML of a marker's icon, and what
   changed since the last drawing, so the map updates only the markers and lines that really changed (a moving dot, a
   label that went from « il y a 3 min » to « 4 min ») instead of drawing everything again. No Leaflet here: tested in
   markers.test.ts. */

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

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const safeColor = (c: string | null | undefined, fallback: string) => (c && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i.test(c.trim()) ? c.trim() : fallback);
const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** a marker's icon: its size, its anchor and its HTML (classes of mapview.css) */
export interface IconSpec { size: [number, number]; anchor: [number, number]; html: string }

function labelHtml(m: MapMarker): string {
  if (!m.label && !m.sub) return '';
  return `<span class="mv-label">${m.label ? `<b>${esc(m.label)}</b>` : ''}${m.sub ? `<small>${esc(m.sub)}</small>` : ''}</span>`;
}
export function iconSpec(m: MapMarker): IconSpec {
  const cls = ['mv-mk', `mv-${m.kind}`, m.done && 'is-done', m.active && 'is-active', m.dim && 'is-dim', m.onClick && 'is-tap'].filter(Boolean).join(' ');
  if (m.kind === 'home') {
    return { size: [46, 46], anchor: [23, 23],
      html: `<span data-mk="${esc(m.id)}" class="${cls}"><span class="mv-badge"><img src="./logo-his.png" alt="" draggable="false" /></span>${labelHtml(m)}</span>` };
  }
  if (m.kind === 'person') {
    return { size: [22, 22], anchor: [11, 11],
      html: `<span data-mk="${esc(m.id)}" class="${cls}" style="--c:${safeColor(m.color, '#2F6FD0')}"><span class="mv-pulse"></span><span class="mv-dot"></span>${labelHtml(m)}</span>` };
  }
  if (m.kind === 'customer') {
    return { size: [30, 40], anchor: [15, 38],
      html: `<span data-mk="${esc(m.id)}" class="${cls}" style="--c:${safeColor(m.color, '#D3000E')}"><span class="mv-pin"><span></span></span>${labelHtml(m)}</span>` };
  }
  const n = m.number == null || m.number === '' ? '' : String(m.number);
  return { size: [34, 34], anchor: [17, 17],
    html: `<span data-mk="${esc(m.id)}" class="${cls}" style="--c:${safeColor(m.color, '#5D6B78')}"><span class="mv-num${n.length > 2 ? ' is-long' : ''}">${m.done ? CHECK : esc(n)}</span>${labelHtml(m)}</span>` };
}

/** above or below the others: the people on top, a faded marker at the bottom, the chosen stop high */
export function zIndexOf(m: MapMarker): number {
  return m.kind === 'person' ? (m.dim ? 400 : 950) : m.dim ? -800 : m.active ? 900 : m.kind === 'job' || m.kind === 'customer' ? 300 : 100;
}

/** only what can be drawn: a real position, a line of at least two points */
export function drawable(markers: MapMarker[] = [], lines: MapLine[] = []): { markers: MapMarker[]; lines: MapLine[] } {
  return {
    markers: markers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng) && Math.abs(m.lat) <= 90 && Math.abs(m.lng) <= 180),
    lines: lines.map((l) => {
      const pts = l.points || [];
      const clean = pts.every((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1])) ? pts : pts.filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1]));
      return clean === pts ? l : { ...l, points: clean };
    }).filter((l) => l.points.length >= 2)
  };
}

/** a marker as drawn: `make` = what needs a new Leaflet marker (its tooltip and whether it can be tapped are fixed at creation),
    `icon` = what its icon shows, `at` = where it is */
export interface MarkerSig { make: string; icon: string; at: string }
export function markerSig(m: MapMarker): MarkerSig {
  return {
    make: `${m.kind}|${!!m.onClick}|${m.title || m.label || ''}`,
    icon: `${iconSpec(m).html}|${zIndexOf(m)}`,
    at: `${m.lat},${m.lng}`
  };
}
export type MarkerChange = 'none' | 'move' | 'icon' | 'make';
/** the smallest change that brings a drawn marker to what is asked now (a move and a new icon can both be needed: 'icon' then moves it too) */
export function markerChange(before: MarkerSig | undefined, now: MarkerSig): MarkerChange {
  if (!before || before.make !== now.make) return 'make';
  if (before.icon !== now.icon) return 'icon';
  return before.at !== now.at ? 'move' : 'none';
}

/** the same line as drawn before (the road of a leg is the same array while it is known: compared by reference first) */
export function sameLine(a: MapLine | undefined, b: MapLine): boolean {
  if (!a) return false;
  if (a.color !== b.color || !!a.dashed !== !!b.dashed || a.weight !== b.weight || a.opacity !== b.opacity) return false;
  if (a.points === b.points) return true;
  if (a.points.length !== b.points.length) return false;
  return a.points.every((p, i) => p[0] === b.points[i][0] && p[1] === b.points[i][1]);
}
/** the same points, whatever the style (a line whose colour only changed keeps its shape: only its style is set) */
export function samePoints(a: MapLine | undefined, b: MapLine): boolean {
  if (!a) return false;
  if (a.points === b.points) return true;
  return a.points.length === b.points.length && a.points.every((p, i) => p[0] === b.points[i][0] && p[1] === b.points[i][1]);
}

/** the view fits again: the first drawing; a new focus or « Recentrer » (fitKey); a new set of markers, unless the screen asked
    to keep the person's view once they moved the map (refit 'focus') */
export function shouldFit(o: { fitted: boolean; idsChanged: boolean; focusChanged: boolean; refit: 'markers' | 'focus'; touched: boolean }): boolean {
  if (!o.fitted || o.focusChanged) return true;
  if (!o.idsChanged) return false;
  return o.refit === 'markers' || !o.touched;
}
