// Renders the two pictures behind the H.I.S glass, with a seeded random (always the same pictures), in headless Chromium:
//   night: a highway at night in long exposure (tail lights, headlights, the city far away, street lamps);
//   day: a showroom in daylight (tall windows, the polished floor, the red of the logo high on the right).
// node tests/tools/render-backdrops.cjs src/ui/styles/backdrops 2048 0.84
const { chromium } = require('playwright');
const fs = require('node:fs'); const path = require('node:path');
const OUT = path.resolve(process.argv[2] || '.'); const SIZE = Number(process.argv[3] || 2048); const Q = Number(process.argv[4] || 0.84);

const scene = String.raw`
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function layer(W, H) { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
function blurInto(ctx, src, px, op = 'source-over', alpha = 1) { ctx.save(); ctx.filter = 'blur(' + px + 'px)'; ctx.globalCompositeOperation = op; ctx.globalAlpha = alpha; ctx.drawImage(src, 0, 0); ctx.restore(); }
function bezierPoint(p0, p1, p2, p3, t) { const u = 1 - t; return [u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0], u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]]; }

function night(W) {
  const H = W, r = rng(20261104), main = layer(W, H), c = main.getContext('2d'), k = W / 2048;
  // the sky over the city, the asphalt below
  let g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#04050A'); g.addColorStop(0.38, '#0A0C14'); g.addColorStop(0.5, '#14110F'); g.addColorStop(0.56, '#0A0A0C'); g.addColorStop(1, '#030304');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const glow = (ctx, x, y, rx, ry, col) => { ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
  const VP = [W * 1.02, H * 0.5];
  glow(c, VP[0] * 0.92, VP[1], W * 0.7, H * 0.09, 'rgba(255,150,70,0.13)');
  glow(c, W * 0.9, H * 0.04, W * 0.6, H * 0.46, 'rgba(255,26,36,0.30)');
  glow(c, W * 0.02, H * 0.96, W * 0.45, H * 0.38, 'rgba(150,6,16,0.30)');
  glow(c, W * 0.2, H * 0.3, W * 0.42, H * 0.3, 'rgba(105,125,160,0.09)');
  // the city far away: small lights, denser near the vanishing point
  const far = layer(W, H), f = far.getContext('2d');
  const cols = [['255,176,72', 0.46], ['255,242,220', 0.24], ['255,60,50', 0.2], ['160,196,255', 0.10]];
  const pick = () => { let x = r(), a = 0; for (const [col, p] of cols) { a += p; if (x < a) return col; } return cols[0][0]; };
  for (let i = 0; i < 520; i++) {
    const x = W * (1 - Math.pow(r(), 1.7) * 1.05), y = H * (0.475 + gauss(r) * 0.022 * (0.4 + x / W)) - H * 0.01, rad = (1.6 + r() * r() * 7) * k * (0.5 + x / W), a = 0.3 + r() * 0.65, col = pick();
    const rg = f.createRadialGradient(x, y, 0, x, y, rad * 2.2); rg.addColorStop(0, 'rgba(' + col + ',' + a + ')'); rg.addColorStop(0.35, 'rgba(' + col + ',' + a * 0.6 + ')'); rg.addColorStop(1, 'rgba(' + col + ',0)');
    f.fillStyle = rg; f.beginPath(); f.arc(x, y, rad * 2.2, 0, Math.PI * 2); f.fill();
  }
  blurInto(c, far, 1.6 * k, 'lighter');
  // the highway in long exposure: lanes that meet far away on the right
  const trails = layer(W, H), t = trails.getContext('2d');
  const lane = (y0, dy1, col, bright, gap) => {
    const p0 = [-W * 0.12, y0], p1 = [W * 0.22, y0 - H * 0.16 + dy1], p2 = [W * 0.62, VP[1] + (y0 - H) * 0.05 + H * 0.035], p3 = [VP[0], VP[1] + (y0 - H) * 0.01 + H * 0.004];
    for (const off of [0, gap]) {
      for (const [lw, a, bl] of [[30 * k, 0.07 * bright, 16 * k], [7 * k, 0.4 * bright, 3 * k], [1.7 * k, 0.95 * bright, 0]]) {
        t.save(); t.filter = bl ? 'blur(' + bl + 'px)' : 'none'; t.globalCompositeOperation = 'lighter';
        const lg = t.createLinearGradient(p0[0], 0, p3[0], 0);
        const s0 = r() * 0.08, s1 = 0.9 + r() * 0.1;
        lg.addColorStop(0, 'rgba(' + col + ',0)'); lg.addColorStop(s0 + 0.04, 'rgba(' + col + ',' + a + ')'); lg.addColorStop(s1 - 0.1, 'rgba(' + col + ',' + a + ')'); lg.addColorStop(s1, 'rgba(' + col + ',' + a * 0.15 + ')'); lg.addColorStop(1, 'rgba(' + col + ',0)');
        t.strokeStyle = lg; t.lineWidth = lw; t.lineCap = 'round';
        t.beginPath(); t.moveTo(p0[0], p0[1] + off); t.bezierCurveTo(p1[0], p1[1] + off * 0.8, p2[0], p2[1] + off * 0.25, p3[0], p3[1] + off * 0.05); t.stroke(); t.restore();
      }
    }
  };
  // going away: tail lights, red; coming: headlights, warm and cold white
  for (let i = 0; i < 9; i++) lane(H * (0.93 + i * 0.016 + r() * 0.006), (r() - 0.5) * H * 0.03, i % 4 === 3 ? '255,110,40' : '255,32,40', 0.55 + r() * 0.45, 9 * k);
  for (let i = 0; i < 7; i++) lane(H * (0.83 + i * 0.014 + r() * 0.006), (r() - 0.5) * H * 0.03, i % 2 ? '220,232,255' : '255,238,210', 0.45 + r() * 0.45, 7 * k);
  c.drawImage(trails, 0, 0);
  // street lamps along the road, big near the camera, tiny far away
  const lamps = layer(W, H), l = lamps.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const tt = Math.pow(i / 15, 1.6), x = -W * 0.05 + (VP[0] + W * 0.05) * tt, y = H * 0.62 - (H * 0.62 - VP[1] + H * 0.03) * Math.pow(tt, 0.7) - H * 0.03, rad = (70 - 64 * tt) * k;
    const rg = l.createRadialGradient(x, y, 0, x, y, rad); rg.addColorStop(0, 'rgba(255,190,110,0.5)'); rg.addColorStop(0.55, 'rgba(255,170,80,0.18)'); rg.addColorStop(1, 'rgba(255,160,70,0)');
    l.fillStyle = rg; l.beginPath(); l.arc(x, y, rad, 0, Math.PI * 2); l.fill();
  }
  blurInto(c, lamps, 2 * k, 'lighter');
  // lens bokeh close to the camera, soft
  const near = layer(W, H), n = near.getContext('2d');
  for (let i = 0; i < 22; i++) {
    const x = r() * W, y = H * (0.08 + r() * 0.5), rad = W * (0.02 + r() * 0.05), a = 0.035 + r() * 0.08, col = pick();
    const rg = n.createRadialGradient(x, y, rad * 0.2, x, y, rad); rg.addColorStop(0, 'rgba(' + col + ',' + a * 0.7 + ')'); rg.addColorStop(0.85, 'rgba(' + col + ',' + a + ')'); rg.addColorStop(1, 'rgba(' + col + ',0)');
    n.fillStyle = rg; n.beginPath(); n.arc(x, y, rad, 0, Math.PI * 2); n.fill();
  }
  blurInto(c, near, 4 * k, 'lighter');
  // the lights on the wet asphalt
  c.save(); c.globalAlpha = 0.16; c.filter = 'blur(' + 22 * k + 'px)'; c.globalCompositeOperation = 'lighter'; c.translate(0, H * 1.9); c.scale(1, -0.9); c.drawImage(trails, 0, 0); c.restore();
  // vignette
  const v = c.createRadialGradient(W * 0.55, H * 0.5, W * 0.18, W * 0.5, H * 0.5, W * 0.8); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
  c.fillStyle = v; c.fillRect(0, 0, W, H);
  return main;
}

function day(W) {
  // the showroom in daylight: tall windows, the light on the polished floor, the red of the logo high on the right
  const H = W, r = rng(4112026), main = layer(W, H), c = main.getContext('2d'), k = W / 2048;
  let g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#EEF0F3'); g.addColorStop(0.5, '#DADEE3'); g.addColorStop(0.64, '#C6CBD2'); g.addColorStop(1, '#A7AEB8');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const glow = (ctx, x, y, rx, ry, col) => { ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
  const sh = layer(W, H), s = sh.getContext('2d');
  for (const fx of [0.02, 0.215, 0.415, 0.615, 0.815]) {
    const x = W * (fx + (r() - 0.5) * 0.015), w = W * (0.13 + r() * 0.03);
    const lg = s.createLinearGradient(0, 0, 0, H * 0.62); lg.addColorStop(0, 'rgba(255,255,255,1)'); lg.addColorStop(0.6, 'rgba(255,252,246,0.7)'); lg.addColorStop(1, 'rgba(255,255,255,0.12)');
    s.fillStyle = lg; s.fillRect(x, 0, w, H * 0.62);
  }
  blurInto(c, sh, 26 * k, 'source-over', 0.9);
  const ml = layer(W, H), m = ml.getContext('2d');
  m.fillStyle = 'rgba(48,60,76,0.42)';
  for (const fx of [0.19, 0.39, 0.59, 0.79, 0.99]) m.fillRect(W * fx, 0, 30 * k, H * 0.62);
  m.fillStyle = 'rgba(48,60,76,0.3)'; m.fillRect(0, H * 0.615, W, 14 * k);
  blurInto(c, ml, 10 * k);
  // the polished floor
  c.save(); c.globalAlpha = 0.34; c.filter = 'blur(' + 30 * k + 'px)'; c.translate(0, H * 1.24); c.scale(1, -0.6); c.drawImage(sh, 0, 0); c.drawImage(ml, 0, 0); c.restore();
  glow(c, W * 0.95, H * 0.03, W * 0.52, H * 0.36, 'rgba(226,10,22,0.26)');
  glow(c, W * 0.86, H * 0.74, W * 0.34, H * 0.07, 'rgba(226,10,22,0.2)');
  glow(c, W * 0.03, H * 0.97, W * 0.5, H * 0.36, 'rgba(66,82,104,0.24)');
  glow(c, W * 0.12, H * 0.2, W * 0.34, H * 0.38, 'rgba(255,236,208,0.28)');
  return main;
}
window.renderAll = (W, q) => ({ night: night(W).toDataURL('image/webp', q), day: day(W).toDataURL('image/webp', q) });
`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: scene });
  const out = await page.evaluate(([w, q]) => window.renderAll(w, q), [SIZE, Q]);
  for (const [name, url] of Object.entries(out)) {
    const buf = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, `his-${name}.webp`), buf);
    console.log(name, Math.round(buf.length / 1024) + ' KB');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
