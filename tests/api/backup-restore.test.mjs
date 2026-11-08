// The nightly backup and the restore, end to end on the local copy: the backup script (as GitHub would run it, with
// a signed ticket), a mistake (a customer deleted, an invoice changed), then the restore brings them back.
// Everything made here is removed at the end.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from '../stack/node_modules/pg/lib/index.js';

const K = JSON.parse(readFileSync(new URL('../stack/keys.json', import.meta.url)));
const db = new pg.Pool({ host: '127.0.0.1', port: 54332, user: 'postgres', database: 'postgres', max: 2 });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const dir = mkdtempSync(join(tmpdir(), 'sauvegarde-'));
const OPS = new URL('../../ops/sauvegardes/', import.meta.url).pathname;
const env = { ...process.env, FONCTION: 'http://127.0.0.1:54331/functions/v1/backup', CLE: K.anon, TICKET_URL: 'http://127.0.0.1:8021/github/token?x=1' };
let ids = [];
after(async () => {
  await q(`delete from public.vehicles where customer_id = any($1)`, [ids]);
  await q(`delete from public.customers where id = any($1)`, [ids]);
  await q(`delete from public.activity`);
  await q(`delete from public.heartbeats`);
  rmSync(dir, { recursive: true, force: true });
  await db.end();
});

test('backup at night, a mistake in the day, the restore brings back what was lost without touching the rest', async () => {
  ids = (await q(`insert into public.customers (first_name, last_name, phone, notes) select 'Restau', 'Client ' || g, '438555' || lpad(g::text, 4, '0'), 'avant' from generate_series(1, 1500) g returning id`)).map((r) => r.id);
  await q(`insert into public.vehicles (customer_id, year, make, model) values ($1, 2019, 'Honda', 'Civic')`, [ids[0]]);
  const out = execFileSync('node', [join(OPS, 'sauvegarde.mjs'), join(dir, 'donnees')], { env, encoding: 'utf8' });
  assert.match(out, /Sauvegarde complète/);
  const saved = JSON.parse(readFileSync(join(dir, 'donnees', 'customers.json'), 'utf8'));
  assert.ok(saved.length >= 1500, 'every customer, beyond 1000 rows');
  assert.ok(!readFileSync(join(dir, 'donnees', '_resume.json'), 'utf8').includes('secrets'));
  // every table of the garage is in the backup (the Coffre too, Part 24), except the ones that must never be
  const resume = JSON.parse(readFileSync(join(dir, 'donnees', '_resume.json'), 'utf8'));
  const never = ['secrets', 'rate_limits', 'app_errors', 'heartbeats', 'local_migrations'];
  const all = (await q(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).map((r) => r.table_name);
  assert.deepEqual(Object.keys(resume.tables).sort(), all.filter((t) => !never.includes(t)).sort(), 'a new table must be added to TABLES (backup) and ORDRE (restaurer.mjs), or to « never »');
  // the pulse (Part 26): the backup says when it started and when it was through; health() tells the outside
  const beats = Object.fromEntries((await q(`select name, at, note from public.heartbeats`)).map((r) => [r.name, r]));
  assert.ok(beats.backup_started && beats.backup_done, 'backup_started and backup_done: ' + JSON.stringify(Object.keys(beats)));
  assert.ok(Date.now() - new Date(beats.backup_done.at).getTime() < 120000, 'just now');
  assert.match(beats.backup_done.note, /stripe_events$/, 'the last table');
  const health = (await fetch(`${env.FONCTION.replace('/functions/v1/backup', '')}/rest/v1/rpc/health`, { headers: { apikey: K.anon, authorization: `Bearer ${K.anon}` } }));
  const hv = await health.json();
  assert.equal(health.status, 200, JSON.stringify(hv));
  assert.deepEqual([hv.ok, typeof hv.backup_done, /^\d{14}$/.test(hv.schema)], [true, 'string', true], JSON.stringify(hv));
  // the day after: a customer deleted for good, another one changed, a new one added
  await q(`delete from public.vehicles where customer_id = $1`, [ids[0]]);
  await q(`delete from public.customers where id = $1`, [ids[0]]);
  await q(`update public.customers set notes = 'après' where id = $1`, [ids[1]]);
  const fresh = (await q(`insert into public.customers (first_name, phone) values ('Nouveau', '4385559999') returning id`))[0].id;
  ids.push(fresh);
  // restore (only what is missing): the deleted customer and his car come back; the change made after stays
  const sql = execFileSync('node', [join(OPS, 'restaurer.mjs'), join(dir, 'donnees'), '--tables', 'customers,vehicles'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(dir, 'r.sql'), sql);
  execFileSync('psql', ['-h', '127.0.0.1', '-p', '54332', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(dir, 'r.sql')], { encoding: 'utf8' });
  const back = await q(`select id, updated_at, phone_digits from public.customers where id = $1`, [ids[0]]);
  assert.equal(back.length, 1, 'the deleted customer is back');
  assert.equal(back[0].phone_digits, '4385550001', 'the computed phone digits are rebuilt');
  assert.equal(new Date(back[0].updated_at).getTime(), Date.parse(saved.find((c) => c.id === ids[0]).updated_at), 'restored as it was (no automatic touch)');
  assert.equal((await q(`select count(*) n from public.vehicles where customer_id = $1`, [ids[0]]))[0].n, '1', 'his car too');
  assert.equal((await q(`select notes from public.customers where id = $1`, [ids[1]]))[0].notes, 'après', 'a newer change is not overwritten');
  assert.equal((await q(`select count(*) n from public.customers where id = $1`, [fresh]))[0].n, '1', 'a customer added after the backup stays');
  // full return (--remplacer): the changed note goes back to the backup's version
  const sql2 = execFileSync('node', [join(OPS, 'restaurer.mjs'), join(dir, 'donnees'), '--tables', 'customers', '--remplacer'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(dir, 'r2.sql'), sql2);
  execFileSync('psql', ['-h', '127.0.0.1', '-p', '54332', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(dir, 'r2.sql')], { encoding: 'utf8' });
  assert.equal((await q(`select notes from public.customers where id = $1`, [ids[1]]))[0].notes, 'avant');
});
