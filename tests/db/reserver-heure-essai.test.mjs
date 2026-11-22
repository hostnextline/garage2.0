// Part 30 « Réserver à l'heure choisie »: its runbook's two scripts tried on this copy (ops/live/PARTIE30.md): the try
// (essai-partie30.sql, always undone) and the way back (retour-partie30.sql). Each test runs in a transaction rolled back.
// Run: node --test tests/db/reserver-heure-essai.test.mjs (Mac: bash tests/stack/mac/db-tests.sh reserver-heure-essai)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tx, pool, futureDay, uuid } from './helpers.mjs';

after(() => pool.end());

const MIG = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const FILE = MIG + '20261122000300_reserver_heure.sql';
const OPS = fileURLToPath(new URL('../../ops/live/partie30/', import.meta.url));
const undo = () => readFileSync(OPS + 'retour-partie30.sql', 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, '');
const FIVE = ['book_job', 'book_preview', 'book_at', 'book_at_row', 'book_at_try'];
const state = (h) => h.q(`select md5(string_agg(p.proname || coalesce(p.proacl::text, '') || md5(p.prosrc), '' order by p.proname)) m
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [FIVE]);

/** an owner, one truck working every day 8 h – 20 h (the others of the copy left out), windows on, two coming appointments */
async function world(h) {
  const owner = await h.person('Hassan', ['owner']);
  const day = await futureDay(h, 4, 3);
  const tk = await h.truck('Camion', null, Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[480, 1200]]])));
  await h.as(null);
  await h.q(`update public.trucks set active = false where id <> $1 and active`, [tk]);
  await h.as(owner);
  assert.equal((await h.rpc('windows_switch', { p_op: uuid(), p_on: true })).ok, true);
  const a = await h.customer('A', 45.5150, -73.6400);
  const b = await h.customer('B', 45.5300, -73.6000);
  for (const [c, ws] of [[a, 540], [b, 780]]) {
    assert.equal((await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: c, day, block: 'day', duration_min: 60, win_start: ws }, p_items: [] })).ok, true);
  }
  return { owner, day, tk, a, b };
}
/** live's bookkeeping of migrations (absent from this copy): Part 29 there, Part 30 not */
async function liveBooks(h) {
  await h.as(null); await h.c.query('reset role');
  await h.c.query(`create schema if not exists supabase_migrations`);
  await h.c.query(`create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[])`);
  await h.c.query(`insert into supabase_migrations.schema_migrations (version, name) values ('20261122000200', 'garder_ordre') on conflict do nothing`);
  await h.c.query(`delete from supabase_migrations.schema_migrations where version = '20261122000300'`);
}
const run = async (h, sql) => {
  await h.c.query('savepoint e');
  let msg = null;
  try { await h.c.query(sql); } catch (e) { msg = e.message; }
  await h.c.query('rollback to savepoint e');
  return msg;
};

test('the try (essai-partie30.sql) on this copy, Part 30 undone first (retour-partie30.sql) and the download replaced by the file: « ESSAI OK : reserver_heure », every answer of the planner the same, no job number spent, one preview answered; nothing kept; its two refusals', (t) => tx(async (h) => {
  await world(h);
  await liveBooks(h);
  await h.c.query(undo());
  assert.equal((await h.q(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'book_job' and prosrc like '%Part 30%'`))[0].n, 0, 'Part 30 undone');
  const tmpl = readFileSync(OPS + 'essai-partie30.sql', 'utf8');
  const local = tmpl.replace(/  select \* into r from extensions\.http_get[\s\S]*?raise exception 'sha différent : %', sha; end if;\n/, "  body := current_setting('essai.body');\n");
  assert.ok(local !== tmpl && !local.includes('http_get'), 'the download replaced');
  await h.c.query(`select set_config('essai.body', $1, true)`, [readFileSync(FILE, 'utf8')]);
  const before = await state(h);
  const seq0 = await h.q(`select last_value from public.job_number_seq`);
  const msg = await run(h, local);
  assert.match(msg ?? '', /^ESSAI OK : reserver_heure \(rien n'est gardé\) ; (\d+) réponses du planificateur comparées, toutes les mêmes ; numéro de rendez-vous inchangé \(\d+\) ; aperçu d'une réservation à 17 h : /, msg);
  t.diagnostic(msg);
  const [, n] = /; (\d+) réponses /.exec(msg);
  assert.ok(Number(n) >= 14, `${n} answers`);
  assert.doesNotMatch(msg, /pas essayé/, 'the preview was asked');
  assert.deepEqual(await state(h), before, 'nothing kept');
  assert.deepEqual(await h.q(`select last_value from public.job_number_seq`), seq0, 'no job number spent');
  // its two refusals: Part 30 already there, Part 29 missing
  await h.c.query(readFileSync(FILE, 'utf8'));
  await h.c.query(`insert into supabase_migrations.schema_migrations (version, name) values ('20261122000300', 'reserver_heure')`);
  assert.match(await run(h, local) ?? '', /^ARRÊT : la Partie 30 \(20261122000300\) est déjà en ligne/);
  await h.c.query(`delete from supabase_migrations.schema_migrations where version in ('20261122000200', '20261122000300')`);
  assert.match(await run(h, local) ?? '', /^ARRÊT : la Partie 29 \(20261122000200\) n'est pas en ligne/);
}));

test('the way back (retour-partie30.sql) puts back Part 27’s book_job byte for byte and closes book_preview to the app: a minute is then not read (booked as before); the migration applied again is Part 30 again', () => tx(async (h) => {
  const w = await world(h);
  const p27 = readFileSync(MIG + '20261119000200_vraies_routes.sql', 'utf8');
  const head = "CREATE OR REPLACE FUNCTION public.book_job(p_op uuid, p_job jsonb, p_items jsonb DEFAULT '[]'::jsonb)";
  const fn = p27.slice(p27.indexOf(head), p27.indexOf('\nend $function$;', p27.indexOf(head)) + '\nend $function$;'.length);
  const body = fn.slice(fn.indexOf('$function$') + '$function$'.length, fn.lastIndexOf('$function$'));
  const same = async () => (await h.q(`select md5(prosrc) = md5($1) ok from pg_proc where pronamespace = 'public'::regnamespace and proname = 'book_job'`, [body]))[0].ok;
  await h.as(null); await h.c.query('reset role');
  assert.equal(await same(), false, 'Part 30 now');
  await h.c.query(undo());
  assert.equal(await same(), true, 'Part 27’s text, byte for byte');
  const priv = await h.q(`select has_function_privilege('authenticated', 'public.book_job(uuid, jsonb, jsonb)', 'execute') bj,
    has_function_privilege('authenticated', 'public.book_preview(jsonb, jsonb)', 'execute') pv,
    has_function_privilege('anon', 'public.book_job(uuid, jsonb, jsonb)', 'execute') anon`);
  assert.deepEqual(priv[0], { bj: true, pv: false, anon: false }, 'book_job the app’s, book_preview closed');
  await h.as(w.owner);
  const r = await h.rpc('book_job', { p_op: uuid(), p_job: { customer_id: w.a, day: w.day, block: 'day', duration_min: 60, arrive_at: 1020 }, p_items: [] });
  assert.equal(r.ok, true); assert.equal(r.exact, undefined, 'the booking of before');
  assert.equal((await h.q(`select arrive_at from public.jobs where id = $1`, [r.job_id]))[0].arrive_at, null, 'no minute read');
  // installed again: the body of the migration (its own grants)
  await h.as(null); await h.c.query('reset role');
  await h.c.query(readFileSync(FILE, 'utf8'));
  assert.equal(await same(), false);
  await h.as(w.owner);
  const pv = await h.rpc('book_preview', { p_job: { id: uuid(), customer_id: w.b, day: w.day, block: 'day', duration_min: 60, arrive_at: 1020 }, p_items: [] });
  assert.deepEqual([pv.ok, pv.exact, pv.at], [true, true, 1020], 'Part 30 again');
}));
