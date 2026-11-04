/* STUB (owner: map) — a map (Leaflet, OpenStreetMap tiles): numbered stops, people, the Centrale, routes. */
export interface MapMarker {
  id: string; lat: number; lng: number;
  kind: 'home' | 'job' | 'person' | 'customer';
  color?: string | null; label?: string; number?: number | string | null; done?: boolean; title?: string; onClick?: () => void;
}
export interface MapLine { points: [number, number][]; color?: string | null; dashed?: boolean }
export interface MapViewProps { markers: MapMarker[]; lines?: MapLine[]; height?: string; class?: string; 'data-testid'?: string }
export function MapView(_p: MapViewProps) { return null; }
