/* The signature pad: a finger (or a pen, or a mouse) draws in the box; « Effacer » starts again. One finger at a time;
   the page does not scroll while signing. The strokes are kept as points (see signature.ts), so the saved picture does
   not depend on the screen or the theme. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Eraser } from 'lucide-preact';
import { drawStrokes, INK, type Stroke, type Pt } from './signature';

export interface SignaturePadProps {
  strokes: Stroke[];
  onStrokes: (s: Stroke[]) => void;
  /** what the box is (for screen readers) */
  label: string;
  /** shown in the empty box */
  hint: string;
  clearLabel: string;
  height?: number;
  'data-testid'?: string;
}

export function SignaturePad(p: SignaturePadProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>(p.strokes);
  const drawing = useRef<{ id: number; stroke: Stroke } | null>(null);
  const onStrokes = useRef(p.onStrokes);
  onStrokes.current = p.onStrokes;
  // the hint leaves as soon as the finger touches the box
  const [touched, setTouched] = useState(false);

  const ctx = () => canvas.current?.getContext('2d') || null;
  const ink = () => (canvas.current ? getComputedStyle(canvas.current).color : '#111');
  const redraw = () => {
    const c = canvas.current, g = ctx();
    if (!c || !g) return;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.width / dpr, c.height / dpr);
    g.strokeStyle = ink();
    drawStrokes(g, strokes.current, (q) => q, INK.line);
  };
  // the canvas follows the size of its box (sharp on every screen, redrawn when the phone turns)
  useEffect(() => {
    const c = canvas.current, b = box.current;
    if (!c || !b) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      redraw();
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(b);
    return () => ro?.disconnect();
  }, []);
  // cleared (or replaced) from outside
  useEffect(() => {
    if (p.strokes !== strokes.current) { strokes.current = p.strokes; redraw(); }
    if (!p.strokes.length && !drawing.current) setTouched(false);
  }, [p.strokes]);

  const point = (e: PointerEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) * 10) / 10, y: Math.round((e.clientY - r.top) * 10) / 10 };
  };
  const segment = (a: Pt, b: Pt) => {
    const g = ctx();
    if (!g) return;
    g.strokeStyle = ink();
    g.lineWidth = INK.line; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  };
  const down = (e: PointerEvent) => {
    if (drawing.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { canvas.current?.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
    const s: Stroke = [point(e)];
    drawing.current = { id: e.pointerId, stroke: s };
    strokes.current = [...strokes.current, s];
    segment(s[0], { x: s[0].x + 0.01, y: s[0].y + 0.01 });
    if (!touched) setTouched(true);
  };
  const move = (e: PointerEvent) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    e.preventDefault();
    const evs = (typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null) || [e];
    for (const ev of evs.length ? evs : [e]) {
      const q = point(ev), last = d.stroke[d.stroke.length - 1];
      if (Math.abs(q.x - last.x) + Math.abs(q.y - last.y) < 0.8) continue;
      d.stroke.push(q);
      segment(last, q);
    }
  };
  const up = (e: PointerEvent) => {
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    drawing.current = null;
    onStrokes.current([...strokes.current]);
  };
  const clear = () => {
    strokes.current = [];
    drawing.current = null;
    redraw();
    setTouched(false);
    onStrokes.current([]);
  };
  const empty = !p.strokes.length && !touched;
  return (
    <div class="jobs-sign" ref={box} style={p.height ? { '--sign-h': `${p.height}px` } : undefined} data-testid={p['data-testid']}>
      <canvas ref={canvas} class="jobs-sign-canvas" role="img" aria-label={p.label}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} />
      <span class="jobs-sign-line" aria-hidden="true"><span>×</span></span>
      {empty && <span class="jobs-sign-hint" aria-hidden="true">{p.hint}</span>}
      <button type="button" class="btn btn-ghost btn-sm jobs-sign-clear" onClick={clear} disabled={!p.strokes.length} data-testid="sign-clear">
        <Eraser aria-hidden="true" /><span class="btn-txt">{p.clearLabel}</span>
      </button>
    </div>
  );
}
