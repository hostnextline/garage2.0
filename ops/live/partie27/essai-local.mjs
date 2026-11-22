// Runs essai-partie27.sql on the LOCAL test database (Mac stack, port 54352), on a database built WITHOUT Part 27,
// inside a transaction that is rolled back. The download and the sha check are replaced by the local file's text.
// usage: GARAGE_DB_PORT=54352 node essai-local.mjs <helpers.mjs> <Part 27 file> [<old Part 27 file for the control>]
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const [helpersPath, p27, oldP27] = process.argv.slice(2);
const { tx, pool, futureDay } = await import(helpersPath);
const tmpl = readFileSync(new URL('./essai-partie27.sql', import.meta.url), 'utf8');
const local = tmpl.replace(/  select \* into r from extensions\.http_get[\s\S]*?raise exception 'sha différent : %', sha; end if;\n/, "  body := current_setting('essai.body');\n");
assert.ok(local !== tmpl && !local.includes('http_get'), 'the download replaced');
const WEEK = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1200]]]));
const PTS = [[45.5150, -73.6400], [45.5700, -73.7500], [45.4474, -73.4363], [45.6000, -73.5500], [45.5300, -73.6100], [45.4800, -73.5800], [45.5500, -73.7000], [45.5100, -73.5200]];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function essai(h, body) {
  await h.as(null); await h.c.query('reset role');
  await h.c.query(`select set_config('essai.body', $1, false)`, [body]);
  await h.c.query('savepoint e');
  let msg = null;
  try { await h.c.query(local); } catch (e) { msg = e.message; }
  await h.c.query('rollback to savepoint e');
  return msg;
}
const out = [];
await tx(async (h) => {
  const owner = await h.person('Hassan', ['owner']);
  const t1 = await h.truck('Camion', null, WEEK);
  const t2 = await h.truck('Voiture', null, WEEK);
  await h.as(null);
  await h.q(`update public.trucks set tire_machine = false where id = $1`, [t2]);
  const cs = [];
  for (const [i, p] of PTS.entries()) cs.push(await h.customer('C' + i, ...p));
  await h.as(owner);
  let n = 1;
  for (const [k, [ahead, block, dur]] of [[1, 'am', 45], [1, 'am', 60], [1, 'pm', 30], [2, 'am', 45], [2, 'eve', 40], [3, 'pm', 60], [4, 'am', 30], [5, 'pm', 45], [6, 'am', 60], [8, 'eve', 30]].entries()) {
    const day = await h.val(`select (public.local_today() + $1::int)::text`, [ahead]);
    const r = await h.rpc('book_job', { p_op: id(9000 + n), p_job: { id: id(n), customer_id: cs[k % cs.length], day, block, duration_min: dur }, p_items: [] }).catch((e) => ({ ok: false, e: e.hint || e.message }));
    n++;
    if (r.ok === false && r.e !== 'block_full') throw new Error(JSON.stringify(r));
  }
  const booked = await h.val(`select count(*) from public.jobs where status = 'booked' and day >= public.local_today()`);
  out.push(`blocks mode, ${booked} booked: ` + await essai(h, readFileSync(p27, 'utf8')));
  // window mode, the tire truck leaving at 13 h on one coming day (main's S38 case)
  await h.as(owner);
  assert.equal((await h.rpc('windows_switch', { p_op: id(9999), p_on: true })).ok, true);
  await h.as(null);
  const d3 = await h.val(`select (public.local_today() + 3)::text`);
  await h.q(`insert into public.truck_days (truck_id, day, ranges) values ($1, $2, '[[780, 1200]]') on conflict do nothing`, [t1, d3]);
  out.push('window mode: ' + await essai(h, readFileSync(p27, 'utf8')));
  if (oldP27) out.push('CONTROL, window mode, the OLD Part 27 (rc1 text): ' + await essai(h, readFileSync(oldP27, 'utf8')));
});
await pool.end();
console.log(out.join('\n'));
