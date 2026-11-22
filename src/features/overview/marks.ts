/* What the map of « Vue d'ensemble » draws: the start, each truck's start and numbered stops with its route, the jobs
   no truck could take (« ? »), the mechanics now. Pure: the screen gives the words and what a tap does. */
import type { MapMarker, MapLine } from '../../shared/map/MapView';
import { UNPLACED_COLOR, type Assembled, type Leg, type LatLng } from '../../shared/map/assemble';

export function mapMarks(m: Assembled, o: { selected: string | null; pick: (id: string) => void; onSite: (name: string) => string; road: (leg: Leg) => LatLng[] }): { markers: MapMarker[]; lines: MapLine[] } {
  const { selected, pick } = o;
  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  if (m.home) markers.push({ id: 'home', kind: 'home', lat: m.home.lat, lng: m.home.lng, label: m.home.label, title: [m.home.label, m.home.address].filter(Boolean).join(', ') });
  for (const tr of m.trucks) {
    if (tr.start) markers.push({ id: `start-${tr.id}`, kind: 'customer', lat: tr.start.lat, lng: tr.start.lng, color: tr.color, label: tr.start.label || tr.name, title: [tr.start.label, tr.start.address].filter(Boolean).join(', ') });
    for (const s of tr.stops) {
      if (!s.hasPos) continue;
      markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: tr.color, number: s.n, done: s.done, active: selected === s.id,
        label: selected === s.id ? s.name : undefined, title: `${s.n}. ${s.name}`, onClick: () => pick(s.id) });
    }
    for (const leg of tr.legs) lines.push({ points: o.road(leg), color: tr.color, dashed: leg.kind === 'trip', opacity: leg.kind === 'done' ? 0.35 : 0.85 });
  }
  for (const s of m.unplaced) {
    if (s.hasPos) markers.push({ id: s.id, kind: 'job', lat: s.lat!, lng: s.lng!, color: UNPLACED_COLOR, number: '?', active: selected === s.id, title: s.name, onClick: () => pick(s.id) });
  }
  for (const p of m.people) markers.push({ id: `p-${p.id}`, kind: 'person', lat: p.lat, lng: p.lng, color: p.color, label: p.name, sub: p.onSite ? o.onSite(p.onSite.name) : undefined });
  return { markers, lines };
}
