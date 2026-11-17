// The read-only questions of the cutover (ops/live/2026-11-16_verifications.sql), asked of the local database built from
// the migrations, as the runbook does at AVANT (ops/live/CUTOVER.md, section 1.2). Everything runs inside a transaction
// that is rolled back: nothing is left behind.
// Run: with the API tests of the local copy (it needs the database on 54332, or GARAGE_DB_PORT):
//   node --test --test-concurrency=1 ops/tests/verifications.test.mjs    (Mac: bash tests/stack/mac/api-tests.sh ops/tests/verifications.test.mjs)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let ROOT = new URL('.', import.meta.url).pathname;
while (!existsSync(join(ROOT, 'package.json'))) ROOT = join(ROOT, '..');
const { default: pg } = await import(join(ROOT, 'tests/stack/node_modules/pg/lib/index.js'));
const db = new pg.Pool({ host: '127.0.0.1', port: Number(process.env.GARAGE_DB_PORT || 54332), user: 'postgres', database: 'postgres', max: 2 });
after(() => db.end());

const FICHIER = readFileSync(join(ROOT, 'ops/live/2026-11-16_verifications.sql'), 'utf8');
/** one question of the file: from its header comment to « as <name>; » (without the « ; ») */
const question = (debut, fin) => {
  const i = FICHIER.indexOf(debut), j = FICHIER.indexOf(fin, i);
  assert.ok(i >= 0 && j > i, `the file holds ${debut} … ${fin}`);
  return FICHIER.slice(i, j + fin.length - 1);
};
const Q10 = question('-- Q10.', 'as q10_owners_and_column_rights;');
const F = question('-- F.', 'as fingerprint;');

/** runs fn(client) inside a transaction that is always rolled back */
async function essai(fn) {
  const c = await db.connect();
  try { await c.query('begin'); return await fn(c); } finally { await c.query('rollback').catch(() => {}); c.release(); }
}
const un = async (c, sql) => Object.values((await c.query(sql)).rows[0])[0];
const total = (owners) => Object.values(owners || {}).reduce((a, n) => a + Number(n), 0);

test('every question of the file runs on the local base, in a read-only transaction, one row each', async () => {
  const c = await db.connect();
  try {
    await c.query('begin read only');
    const r = await c.query(FICHIER);
    const res = (Array.isArray(r) ? r : [r]).filter((x) => x.command === 'SELECT');
    const noms = res.map((x) => x.fields[0]?.name);
    // Q5 and Q6 cannot be answered by SQL: the file says so in words
    for (const n of ['q1_migrations', 'q2_booking_mode', 'q3_postgres', 'q4_cron', 'q8_restore_and_tools', 'q9_before_refonte', 'q10_owners_and_column_rights', 'fingerprint'])
      assert.ok(noms.includes(n), 'the file answers ' + n);
    for (const x of res) assert.equal(x.rows.length, 1, 'one row: ' + x.fields.map((f) => f.name).join(','));
    const q10 = res.find((x) => x.fields[0].name === 'q10_owners_and_column_rights').rows[0].q10_owners_and_column_rights;
    assert.ok(total(q10.function_owners) > 100, 'the owners of the ~170 functions of public');
  } finally { await c.query('rollback').catch(() => {}); c.release(); }
});

test('Q10 counts the owners of the same functions as F: an extension installed in public is left out of both (ops-r2-3)', async () => {
  await essai(async (c) => {
    const avant = await un(c, Q10), fAvant = await un(c, F);
    // live may hold an extension in public (pg_trgm, http…): the local base has none there. Its functions are not ours:
    // F leaves them out (pg_depend deptype 'e'), so Q10 must too, else « un propriétaire différent : arrêt » is a false stop
    if (await un(c, `select exists (select 1 from pg_available_extensions where name = 'pg_trgm')`)) await c.query('create extension if not exists pg_trgm schema public');
    else {   // a Postgres without the contrib extensions: twelve functions made members of an extension by hand
      for (let n = 0; n < 12; n++) {
        await c.query(`create function public.ops_ext_${n}() returns int language sql as 'select 1'`);
        await c.query(`alter extension plpgsql add function public.ops_ext_${n}()`);
      }
    }
    const membres = Number(await un(c, `select count(*) from pg_depend d join pg_proc p on p.oid = d.objid
      where d.classid = 'pg_proc'::regclass and d.deptype = 'e' and p.pronamespace = 'public'::regnamespace`));
    assert.ok(membres > 10, 'pg_trgm put its functions in public');
    const apres = await un(c, Q10), fApres = await un(c, F);
    assert.deepEqual(fApres.md5.functions, fAvant.md5.functions, 'F already leaves them out');
    assert.deepEqual(apres.function_owners, avant.function_owners, 'Q10: the same owners, the same counts');
  });
});
