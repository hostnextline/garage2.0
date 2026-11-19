// Part 26 « Heures travaillées »: who reads the days of work, who corrects them, the rules of a correction, the history.
// Each test is rolled back at the end.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tx, pool, uuid } from './helpers.mjs';

after(() => pool.end());

/** the team: an owner, a treasurer (not owner), two mechanics, an office person without the map; one closed day of the
    first mechanic yesterday, and one forgotten day of his, closed by the night */
async function team(h) {
  const owner = await h.person('Hassan Proprio', ['owner']);
  const tres = await h.person('Ibra Trésorier', ['treasurer'], { rights: { map: false } });
  const mech = await h.person('Saleh Mécano', ['mechanic']);
  const mech2 = await h.person('Karim Mécano', ['mechanic'], { rights: { map: false } });
  const office = await h.person('Lina Bureau', ['office'], { rights: { map: false } });
  const day = uuid(), forgot = uuid();
  await h.as(null);
  await h.c.query(`insert into public.shifts (id, staff_id, started_at, ended_at) values
    ($1, $3, date_trunc('day', now()) - interval '2 days' + interval '8 hours', date_trunc('day', now()) - interval '2 days' + interval '16 hours'),
    ($2, $3, date_trunc('day', now()) - interval '1 day' + interval '8 hours', date_trunc('day', now()) + interval '3 hours 17 minutes')`, [day, forgot, mech]);
  return { owner, tres, mech, mech2, office, day, forgot };
}
const ago = (h, expr) => h.val(`select ${expr}`);

test('reading: your own days; the map’s people; the owners and the treasurer even without the map', () => tx(async (h) => {
  const g = await team(h);
  const count = async (who) => { await h.as(who); return Number(await h.val(`select count(*) from public.shifts where staff_id = $1`, [g.mech])); };
  assert.equal(await count(g.mech), 2, 'the mechanic: his own days');
  assert.equal(await count(g.mech2), 0, 'another mechanic without the map: nothing');
  assert.equal(await count(g.office), 0, 'the office without the map: nothing');
  assert.equal(await count(g.tres), 2, 'the treasurer: everyone, without the map right');
  assert.equal(await count(g.owner), 2, 'the owner: everyone');
  await h.as(g.mech2);
  assert.equal(await h.val(`select public.hours_all()`), false);
  await h.as(g.tres);
  assert.equal(await h.val(`select public.hours_all()`), true);
}));

test('only the owners and the treasurer correct; a mechanic cannot change his own hours, nor write the table', () => tx(async (h) => {
  const g = await team(h);
  const end = await ago(h, `date_trunc('day', now()) - interval '1 day' + interval '16 hours 30 minutes'`);
  const start = await ago(h, `date_trunc('day', now()) - interval '1 day' + interval '8 hours'`);
  for (const who of [g.mech, g.mech2, g.office]) {
    await h.as(who);
    const e = await h.fails(() => h.rpc('shift_save', { p_op: uuid(), p_shift: g.forgot, p_staff: null, p_start: start, p_end: end }));
    assert.equal(e?.hint, 'not_allowed');
    assert.equal((await h.fails(() => h.rpc('shift_remove', { p_op: uuid(), p_shift: g.day })))?.hint, 'not_allowed');
  }
  await h.as(g.mech);
  assert.ok(await h.fails(() => h.q(`update public.shifts set ended_at = now() - interval '20 hours' where id = $1`, [g.forgot])), 'no direct write');
  assert.ok(await h.fails(() => h.q(`insert into public.shifts (staff_id, started_at, ended_at) values ($1, now() - interval '3 hours', now())`, [g.mech])));
  await h.as(null);
  assert.equal(String(await h.val(`select ended_at - started_at from public.shifts where id = $1`, [g.forgot])).includes('19:17'), true, 'unchanged');
}));

test('the treasurer corrects a forgotten end: who, when, and the before / after kept; the same op twice changes nothing more', () => tx(async (h) => {
  const g = await team(h);
  const start = await ago(h, `date_trunc('day', now()) - interval '1 day' + interval '8 hours'`);
  const end = await ago(h, `date_trunc('day', now()) - interval '1 day' + interval '16 hours 30 minutes'`);
  await h.as(g.tres);
  const op = uuid();
  const r = await h.rpc('shift_save', { p_op: op, p_shift: g.forgot, p_staff: null, p_start: start, p_end: end });
  assert.equal(r.ok, true);
  assert.equal(r.rows.shifts.length, 1);
  assert.equal(r.rows.shifts[0].fixed_by, g.tres);
  await h.as(null);
  const row = await h.one(`select extract(epoch from ended_at - started_at)::int as sec, fixed_by, fixed_at is not null as fixed from public.shifts where id = $1`, [g.forgot]);
  assert.deepEqual(row, { sec: 8.5 * 3600, fixed_by: g.tres, fixed: true });
  const act = await h.q(`select actor, action, data from public.activity where entity = 'shifts' and entity_id = $1`, [g.forgot]);
  assert.equal(act.length, 1);
  assert.equal(act[0].actor, g.tres);
  assert.equal(act[0].action, 'hours_fix');
  assert.equal(act[0].data.staff, g.mech);
  assert.equal(act[0].data.before.length, 2);
  assert.equal(Date.parse(act[0].data.after[1]), new Date(end).getTime());
  await h.as(g.tres);
  const again = await h.rpc('shift_save', { p_op: op, p_shift: g.forgot, p_staff: null, p_start: start, p_end: end });
  assert.equal(again.ok, true);
  await h.as(null);
  assert.equal(Number(await h.val(`select count(*) from public.activity where entity = 'shifts' and entity_id = $1`, [g.forgot])), 1, 'sent twice: kept once');
  // the same hours again (new op): nothing changes, nothing written
  await h.as(g.owner);
  await h.rpc('shift_save', { p_op: uuid(), p_shift: g.forgot, p_staff: null, p_start: start, p_end: end });
  await h.as(null);
  assert.equal(Number(await h.val(`select count(*) from public.activity where entity = 'shifts' and entity_id = $1`, [g.forgot])), 1);
  assert.equal(await h.val(`select fixed_by from public.shifts where id = $1`, [g.forgot]), g.tres);
}));

test('the rules: both times, the end after the start, 24 hours at most, nothing in the future, no overlap', () => tx(async (h) => {
  const g = await team(h);
  const at = (expr) => ago(h, `date_trunc('day', now()) - interval '1 day' + interval '${expr}'`);
  await h.as(g.owner);
  const save = (start, end, shift = g.forgot, staff = null) => h.fails(() => h.rpc('shift_save', { p_op: uuid(), p_shift: shift, p_staff: staff, p_start: start, p_end: end }));
  assert.equal((await save(null, await at('16 hours')))?.hint, 'bad_hours');
  assert.equal((await save(await at('8 hours'), null))?.hint, 'bad_hours', 'a closed day keeps an end');
  assert.equal((await save(await at('16 hours'), await at('8 hours')))?.hint, 'bad_hours');
  assert.equal((await save(await at('8 hours'), await at('8 hours')))?.hint, 'bad_hours');
  assert.equal((await save(await at('-1 day'), await at('1 hour')))?.hint, 'too_long');
  assert.equal((await save(await at('8 hours'), await ago(h, `now() + interval '1 hour'`)))?.hint, 'future');
  assert.equal((await save(await ago(h, `now() + interval '1 hour'`), await ago(h, `now() + interval '2 hours'`), null, g.mech))?.hint, 'future');
  // over the day before yesterday (8 h – 16 h)
  const dby = (expr) => ago(h, `date_trunc('day', now()) - interval '2 days' + interval '${expr}'`);
  assert.equal((await save(await dby('15 hours'), await dby('18 hours'), null, g.mech))?.hint, 'overlap');
  assert.equal((await save(await dby('16 hours'), await dby('18 hours'), null, g.mech)), null, 'end to end is fine');
  // the forgotten day moved onto the day before yesterday: overlap; the day itself does not count against itself
  assert.equal((await save(await dby('7 hours'), await dby('9 hours')))?.hint, 'overlap');
  assert.equal((await save(await at('7 hours'), await at('17 hours'))), null);
  // someone who left the team; a day that no longer exists
  assert.equal((await save(await at('8 hours'), await at('9 hours'), null, uuid()))?.hint, 'no_staff');
  assert.equal((await save(await at('8 hours'), await at('9 hours'), uuid()))?.hint, 'no_shift_row');
}));

test('an open day: its start may change, its end stays for « Terminer ma journée »; it cannot be removed', () => tx(async (h) => {
  const g = await team(h);
  await h.as(g.mech2);
  await h.val(`select public.shift_start()`);
  await h.as(null);
  const open = await h.val(`select id from public.shifts where staff_id = $1 and ended_at is null`, [g.mech2]);
  await h.as(g.owner);
  const early = await ago(h, `now() - interval '2 hours'`);
  assert.equal((await h.fails(() => h.rpc('shift_save', { p_op: uuid(), p_shift: open, p_staff: null, p_start: early, p_end: early })))?.hint, 'still_open');
  const r = await h.rpc('shift_save', { p_op: uuid(), p_shift: open, p_staff: null, p_start: early, p_end: null });
  assert.equal(r.rows.shifts[0].ended_at, null);
  assert.equal((await h.fails(() => h.rpc('shift_remove', { p_op: uuid(), p_shift: open })))?.hint, 'still_open');
  // adding a day that runs into the open one
  const s3 = await ago(h, `now() - interval '3 hours'`), e1 = await ago(h, `now() - interval '1 hour'`);
  assert.equal((await h.fails(() => h.rpc('shift_save', { p_op: uuid(), p_shift: null, p_staff: g.mech2, p_start: s3, p_end: e1 })))?.hint, 'overlap');
  // the button still works after a correction
  await h.as(g.mech2);
  await h.val(`select public.shift_end()`);
  await h.as(null);
  assert.equal(Number(await h.val(`select count(*) from public.shifts where staff_id = $1 and ended_at is null`, [g.mech2])), 0);
}));

test('adding a forgotten day and removing a day started by mistake: kept in the history, gone from the hours', () => tx(async (h) => {
  const g = await team(h);
  const dby = (expr) => ago(h, `date_trunc('day', now()) - interval '3 days' + interval '${expr}'`);
  await h.as(g.owner);
  const r = await h.rpc('shift_save', { p_op: uuid(), p_shift: null, p_staff: g.mech2, p_start: await dby('9 hours'), p_end: await dby('17 hours') });
  assert.equal(r.ok, true);
  const added = r.id;
  await h.as(null);
  assert.deepEqual(await h.one(`select staff_id, created_by, fixed_by, extract(epoch from ended_at - started_at)::int as sec from public.shifts where id = $1`, [added]),
    { staff_id: g.mech2, created_by: g.owner, fixed_by: g.owner, sec: 8 * 3600 });
  assert.equal(await h.val(`select action from public.activity where entity = 'shifts' and entity_id = $1`, [added]), 'hours_add');
  await h.as(g.owner);
  const rm = await h.rpc('shift_remove', { p_op: uuid(), p_shift: g.day });
  assert.ok(rm.rows.shifts[0].deleted_at);
  await h.as(null);
  assert.equal(await h.val(`select action from public.activity where entity = 'shifts' and entity_id = $1`, [g.day]), 'hours_remove');
  assert.ok(await h.val(`select deleted_at is not null from public.shifts where id = $1`, [g.day]), 'kept in the database, marked removed');
  await h.as(g.owner);
  assert.equal((await h.fails(() => h.rpc('shift_remove', { p_op: uuid(), p_shift: g.day })))?.hint, 'no_shift_row', 'removed once');
  // a removed day no longer blocks its hours
  const two = (expr) => ago(h, `date_trunc('day', now()) - interval '2 days' + interval '${expr}'`);
  const s9 = await two('9 hours'), e10 = await two('10 hours');
  assert.equal((await h.fails(() => h.rpc('shift_save', { p_op: uuid(), p_shift: null, p_staff: g.mech, p_start: s9, p_end: e10 }))), null);
}));

test('the public has no access to the new functions', () => tx(async (h) => {
  const g = await team(h);
  await h.c.query(`select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`);
  await h.c.query('reset role'); await h.c.query('set local role anon');
  assert.ok(await h.fails(() => h.rpc('shift_remove', { p_op: uuid(), p_shift: g.day })));
  assert.ok(await h.fails(() => h.val(`select public.hours_all()`)));
}));
