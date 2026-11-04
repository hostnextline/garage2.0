// A Code 39 barcode (like the VIN label in a car's door frame), drawn as pixels, and a fake camera video showing it
// (Y4M, the format Chromium can play as its camera: --use-file-for-fake-video-capture). Used by the VIN scan test.
const { writeFileSync } = require('node:fs');

// each character: 9 elements (bar, space, bar, space, bar, space, bar, space, bar), w = wide, n = narrow
const T = {
  0: 'nnnwwnwnn', 1: 'wnnwnnnnw', 2: 'nnwwnnnnw', 3: 'wnwwnnnnn', 4: 'nnnwwnnnw', 5: 'wnnwwnnnn', 6: 'nnwwwnnnn', 7: 'nnnwnnwnw', 8: 'wnnwnnwnn', 9: 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn'
};
/** the bars as a row of modules: true = black (narrow 1, wide 3, one narrow space between characters) */
function modules(text) {
  const out = [];
  [...`*${text}*`].forEach((ch, k) => {
    const p = T[ch];
    if (!p) throw new Error(`Code 39 has no « ${ch} »`);
    if (k) out.push(false);
    [...p].forEach((e, i) => { for (let n = 0; n < (e === 'w' ? 3 : 1); n++) out.push(i % 2 === 0); });
  });
  return out;
}
/** a video of a few seconds showing the barcode in the middle of a white frame (luma only: grey picture) */
function y4m(file, text, { w = 960, h = 540, frames = 30, module = 3 } = {}) {
  const row = modules(text);
  const bw = row.length * module, x0 = Math.max(10, Math.floor((w - bw) / 2)), bh = Math.floor(h * 0.45), y0 = Math.floor((h - bh) / 2);
  const Y = Buffer.alloc(w * h, 235);
  for (let y = y0; y < y0 + bh; y++) for (let i = 0; i < row.length; i++) if (row[i]) Y.fill(16, y * w + x0 + i * module, y * w + x0 + (i + 1) * module);
  const UV = Buffer.alloc((w / 2) * (h / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, UV, UV]);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`), ...Array(frames).fill(frame)]));
  return file;
}
module.exports = { modules, y4m };
