/* The customer's signature, as strokes of the finger (points in CSS pixels of the pad). Saved as a PNG cut to the
   ink, dark ink on a transparent background whatever the theme, at most 600 px wide. Never a photo: only the strokes.
   The geometry is pure (tested); exportSignature() draws with a canvas. */

export interface Pt { x: number; y: number }
export type Stroke = Pt[];
export interface Box { x: number; y: number; w: number; h: number }

export const INK = {
  /** line width on the pad, CSS px */
  line: 2.6,
  /** at least this much ink (total length of the strokes, CSS px) … */
  minLength: 60,
  /** … spread over at least this much (the larger side of the ink, CSS px): a dot or a tick is not a signature */
  minSize: 30
};
export const SAVE = { maxWidth: 600, pad: 8, scale: 2, color: '#111418' };

export function strokeLength(strokes: Stroke[]): number {
  let n = 0;
  for (const s of strokes) for (let i = 1; i < s.length; i++) n += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  return n;
}

/** the box around the ink, line width included; null when there is no ink */
export function inkBox(strokes: Stroke[], line = INK.line): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  if (x0 === Infinity) return null;
  const h = line / 2;
  return { x: x0 - h, y: y0 - h, w: x1 - x0 + line, h: y1 - y0 + line };
}

/** enough ink to be a signature (not a tap, not a short line) */
export function hasEnoughInk(strokes: Stroke[], rules: { minLength: number; minSize: number } = INK): boolean {
  const box = inkBox(strokes, 0);
  if (!box) return false;
  return strokeLength(strokes) >= rules.minLength && Math.max(box.w, box.h) >= rules.minSize;
}

export interface TrimPlan {
  /** size of the saved picture, px */
  width: number; height: number;
  /** a pad point (x, y) is drawn at ((x + dx) * scale, (y + dy) * scale) */
  dx: number; dy: number; scale: number;
}
/** where the ink goes in the saved picture: cut to the ink with a small margin, sharp (2×) but never wider than maxWidth */
export function trimPlan(box: Box, o: { maxWidth?: number; pad?: number; scale?: number } = {}): TrimPlan {
  const maxWidth = o.maxWidth ?? SAVE.maxWidth, pad = o.pad ?? SAVE.pad, want = o.scale ?? SAVE.scale;
  const w = Math.max(1, box.w + 2 * pad), h = Math.max(1, box.h + 2 * pad);
  const scale = Math.min(want, maxWidth / w);
  return { width: Math.min(maxWidth, Math.max(1, Math.round(w * scale))), height: Math.max(1, Math.round(h * scale)), dx: pad - box.x, dy: pad - box.y, scale };
}

/** draws strokes smoothly (through the middle of each segment); a single point is a dot */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], map: (p: Pt) => Pt, width: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  for (const s of strokes) {
    if (!s.length) continue;
    const pts = s.map(map);
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
}

/** the PNG to keep: cut to the ink, at most 600 px wide, dark ink on transparent. null when there is no ink. */
export function exportSignature(strokes: Stroke[]): { dataUrl: string; width: number; height: number } | null {
  const box = inkBox(strokes);
  if (!box) return null;
  const plan = trimPlan(box);
  const c = document.createElement('canvas');
  c.width = plan.width; c.height = plan.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.strokeStyle = SAVE.color;
  drawStrokes(ctx, strokes, (p) => ({ x: (p.x + plan.dx) * plan.scale, y: (p.y + plan.dy) * plan.scale }), INK.line * plan.scale);
  return { dataUrl: c.toDataURL('image/png'), width: plan.width, height: plan.height };
}
