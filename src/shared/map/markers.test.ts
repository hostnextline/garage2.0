import { describe, it, expect } from 'vitest';
import { iconSpec, drawable, markerSig, markerChange, sameLine, samePoints, shouldFit, esc, safeColor, type MapMarker, type MapLine } from './markers';

const stop: MapMarker = { id: 'j1', kind: 'job', lat: 45.5, lng: -73.6, color: '#D3000E', number: 2, title: 'Arrêt 2, Julie', onClick: () => undefined };

describe('what the map draws', () => {
  it('a stop: its number in its colour, the words escaped, a check when done', () => {
    const s = iconSpec(stop);
    expect(s.html).toContain('data-mk="j1"');
    expect(s.html).toContain('--c:#D3000E');
    expect(s.html).toContain('>2<');
    expect(iconSpec({ ...stop, done: true }).html).toContain('<svg');
    expect(iconSpec({ ...stop, label: '<b>x</b>' }).html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(safeColor('red;background:url(x)', '#000')).toBe('#000');
    expect(esc(`"'`)).toBe('&quot;&#39;');
  });
  it('keeps only what can be drawn', () => {
    const d = drawable([stop, { ...stop, id: 'bad', lat: NaN }], [{ points: [[45.5, -73.6]] }, { points: [[45.5, -73.6], [45.6, -73.7]] }]);
    expect(d.markers.map((m) => m.id)).toEqual(['j1']);
    expect(d.lines).toHaveLength(1);
  });
  it('a dot that moves is moved; a label that changes gets a new icon; a new title or tap makes a new marker', () => {
    const a = markerSig(stop);
    expect(markerChange(a, markerSig({ ...stop }))).toBe('none');
    expect(markerChange(a, markerSig({ ...stop, lat: 45.51 }))).toBe('move');
    expect(markerChange(a, markerSig({ ...stop, sub: 'il y a 4 min' }))).toBe('icon');
    expect(markerChange(a, markerSig({ ...stop, dim: true }))).toBe('icon');
    expect(markerChange(a, markerSig({ ...stop, onClick: undefined }))).toBe('make');
    expect(markerChange(undefined, a)).toBe('make');
  });
  it('a line is the same while its road and style are (the road of a leg is the same array: compared by reference first)', () => {
    const pts: [number, number][] = [[45.5, -73.6], [45.6, -73.7]];
    const l: MapLine = { points: pts, color: '#D3000E', weight: 4, opacity: 0.8 };
    expect(sameLine(l, { ...l })).toBe(true);
    expect(sameLine(l, { ...l, points: [[45.5, -73.6], [45.6, -73.7]] })).toBe(true);
    expect(sameLine(l, { ...l, opacity: 0.14 })).toBe(false);
    expect(samePoints(l, { ...l, opacity: 0.14 })).toBe(true);
    expect(sameLine(l, { ...l, points: [[45.5, -73.6], [45.55, -73.65], [45.6, -73.7]] })).toBe(false);
  });
  it('the view fits on the first drawing, a new focus, « Recentrer »; a new set of markers keeps the person’s view on the team map', () => {
    const base = { fitted: true, idsChanged: false, focusChanged: false, refit: 'focus' as const, touched: true };
    expect(shouldFit({ ...base, fitted: false })).toBe(true);
    expect(shouldFit({ ...base, focusChanged: true })).toBe(true);
    expect(shouldFit({ ...base, idsChanged: true })).toBe(false);                 // a mechanic started his shift: the zoom stays
    expect(shouldFit({ ...base, idsChanged: true, touched: false })).toBe(true);   // nobody moved the map yet: show everything
    expect(shouldFit({ ...base, idsChanged: true, refit: 'markers' })).toBe(true); // the other maps: as before
    expect(shouldFit(base)).toBe(false);
  });
});
