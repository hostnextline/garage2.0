// A short pass/fail summary for `node --test` (the full report goes to the log file through the « spec » reporter).
// One line per test file, the failing tests by name with the first lines of their error, then the totals.
// SUMMARY_STEPS=1 also lists every top-level test (the 17 steps of the end-to-end test).
import path from 'node:path';

const STEPS = !!process.env.SUMMARY_STEPS;
const root = process.cwd();
const rel = (f) => (f ? path.relative(root, f) : '(unknown file)');
const secs = (ms) => (ms == null ? '' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

function why(err) {
  if (!err) return '';
  // the runner wraps the real error: ERR_TEST_FAILURE { cause }
  const real = err.cause && typeof err.cause === 'object' ? err.cause : err;
  let msg = String(real.message || err.message || real || '').trim();
  if (!msg && typeof err.cause === 'string') msg = err.cause;
  const lines = msg.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  const head = lines.slice(0, 12).join('\n           ');
  // where it happened: the first line of the stack that is in the project's tests
  const at = String(real.stack || '').split('\n').map((l) => l.trim()).find((l) => /^at /.test(l) && /tests\//.test(l) && !/node_modules/.test(l));
  return head + (lines.length > 12 ? '\n           …' : '') + (at ? `\n           ${at.replace(root + '/', '')}` : '');
}

export default async function* summary(source) {
  const files = new Map();   // file -> { pass, fail, skip, ms, lines: [] }
  const order = [];
  const of = (f) => { const k = rel(f); if (!files.has(k)) { files.set(k, { pass: 0, fail: 0, skip: 0, todo: 0, ms: 0, lines: [], steps: [] }); order.push(k); } return files.get(k); };
  const t0 = Date.now();
  for await (const ev of source) {
    const d = ev.data || {};
    if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
    const f = of(d.file);
    const top = d.nesting === 0;
    const ms = d.details?.duration_ms;
    const suite = d.details?.type === 'suite';
    if (ev.type === 'test:pass') {
      // a file in which no test ran (the pattern matched nothing there) is reported as one passing « test » named like the file
      if (top && d.file && (d.name === d.file || path.resolve(root, String(d.name)) === d.file)) { f.empty = true; continue; }
      if (d.skip !== undefined) { if (top) f.skip++; if (top && STEPS) f.steps.push(`   skip  ${d.name}`); continue; }
      if (d.todo !== undefined) { if (top) f.todo++; continue; }
      if (top && !suite) { f.pass++; f.ms += ms || 0; if (STEPS) f.steps.push(`   ok    ${d.name}  (${secs(ms)})`); }
    } else {
      const err = d.details?.error;
      const sub = err && /subtests? failed/i.test(String(err.message || '')) && err.failureType === 'subtestsFailed';
      if (top) { f.fail++; f.ms += ms || 0; if (STEPS) f.steps.push(`   FAIL  ${d.name}  (${secs(ms)})`); }
      if (sub) continue;   // its failing subtests are listed themselves
      const cancelled = err && (err.failureType === 'cancelledByParent' || err.failureType === 'hookFailed');
      f.lines.push(`   FAIL  ${'  '.repeat(d.nesting || 0)}« ${d.name} »  (${secs(ms)})${cancelled ? '  [' + err.failureType + ']' : ''}\n           ${why(err)}`);
    }
  }
  let pass = 0, fail = 0, skip = 0;
  let out = '\n';
  for (const k of order) {
    const f = files.get(k);
    pass += f.pass; fail += f.fail; skip += f.skip;
    if (f.empty && !f.pass && !f.fail) { out += `--    ${k}: no test ran here\n`; continue; }
    out += `${f.fail ? 'FAIL' : 'ok  '}  ${k}: ${f.pass} passed, ${f.fail} failed${f.skip ? `, ${f.skip} skipped` : ''}  (${secs(f.ms)})\n`;
    if (STEPS && f.steps.length) out += f.steps.join('\n') + '\n';
    if (f.lines.length) out += f.lines.join('\n') + '\n';
  }
  const none = pass + fail === 0;
  out += `\nTOTAL: ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''} in ${secs(Date.now() - t0)}  →  ${fail ? 'FAIL' : none ? 'NOTHING RAN (does the pattern match a test name?)' : 'PASS'}\n`;
  yield out;
}
