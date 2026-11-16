// The files of « ops » and of the publishing workflow, read as text: no server needed, runs anywhere
// (node --test ops/tests/fichiers.test.mjs). Each test names the mistake it keeps from coming back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// the repository's root: found from here, so the file may move
let ROOT = new URL('.', import.meta.url).pathname;
while (!existsSync(join(ROOT, 'package.json'))) ROOT = join(ROOT, '..');
const lire = (f) => readFileSync(join(ROOT, f), 'utf8');

test('Vercel: the app itself may use the microphone (the dictation of Hermes), the camera and the position; nobody else', () => {
  const v = JSON.parse(lire('ops/vercel/vercel.json'));
  const tous = v.headers.find((h) => h.source === '/(.*)').headers;
  const pp = tous.find((h) => h.key === 'Permissions-Policy').value.split(',').map((s) => s.trim()).sort();
  assert.deepEqual(pp, ['camera=(self)', 'geolocation=(self)', 'microphone=(self)']);
  // the rest of the file is what it was (same headers, same caches)
  assert.deepEqual(tous.map((h) => h.key), ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy']);
  assert.equal(v.outputDirectory, 'public');
  assert.deepEqual(v.headers.map((h) => h.source), ['/(.*)', '/assets/(.*)', '/sw.js', '/version.json']);
});

test('publishing: the type check, then the unit tests, then the build, all before anything is pushed (and not the 40-minute suite)', () => {
  const y = lire('.github/workflows/deploy.yml');
  const ou = (x) => { const i = y.indexOf(x); assert.ok(i >= 0, 'deploy.yml no longer holds: ' + x); return i; };
  const types = ou('run: npx tsc --noEmit'), tests = ou('run: npm test'), build = ou('npm run build'), push = ou('git push');
  assert.ok(types < tests && tests < build && build < push, 'types, tests, build, then the two pushes');
  assert.equal(y.split('git push').length - 1, 2, 'two publications: the branch vercel and the branch gh-pages');
  // a failing step stops the job: none of the checks may be allowed to fail
  assert.ok(!/continue-on-error/.test(y), 'no step is allowed to fail in the publishing path');
  assert.ok(!/tests\/(e2e|db|api|stack)/.test(y), 'the whole suite is not in the publishing path (it runs on the other branches: tests-complets.yml)');
  assert.match(y, /branches: \[main\]/);
});

test('the Mac test stack (tests/stack/mac): every script parses, the stack lives in the folder the developer chose (HIS_STACK), never in a scratch path', () => {
  const M = 'tests/stack/mac';
  const scripts = ['install.sh', 'up.sh', 'db-tests.sh', 'api-tests.sh', 'e2e.sh', 'all.sh', 'down.sh', 'psql.sh', 'lib/common.sh', 'bin/pgtool'];
  for (const s of scripts) {
    assert.ok(existsSync(join(ROOT, M, s)), `${M}/${s} is there`);
    execFileSync('bash', ['-n', join(ROOT, M, s)]);   // throws on a syntax error
  }
  for (const s of ['lib/daemon.mjs', 'lib/summary.mjs']) execFileSync(process.execPath, ['--check', join(ROOT, M, s)]);
  for (const t of ['psql', 'pg_dump', 'pg_isready']) assert.ok(existsSync(join(ROOT, M, 'bin', t)), `bin/${t} (a link to pgtool)`);
  for (const s of [...scripts, 'README.md']) {
    const txt = lire(`${M}/${s}`);
    assert.ok(!/\/private\/tmp|scratchpad|garage2\.0-neuf/.test(txt), `${s} names no scratch folder nor somebody's copy`);
  }
  for (const s of ['lib/common.sh', 'install.sh', 'bin/pgtool']) assert.match(lire(`${M}/${s}`), /\$\{HIS_STACK:-\$HOME\/\.his-stack\}/, `${s}: one variable, default under the home folder`);
  assert.ok(existsSync(join(ROOT, M, 'README.md')));
});

test('the cutover: the runbook and the read-only questions are there; the questions write nothing', () => {
  const rb = lire('ops/live/CUTOVER.md');
  for (const x of ['raise exception', 'ESSAI OK', 'sha256', 'schema_migrations', 'Promote to Production', 'deployed.avant.json', 'fonctions_avant.sql', 'garage2.0-sauvegardes', '--fin'])
    assert.ok(rb.includes(x), 'CUTOVER.md speaks of ' + x);
  const sql = lire('ops/live/2026-11-16_verifications.sql').replace(/--.*$/gm, '');
  // read only: no statement that writes or changes the schema (the words inside a query string are checked too)
  assert.ok(!/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|vacuum|copy|call|do)\b\s/i.test(sql.replace(/\bupdated?_at\b/g, '')), 'the questions only read');
  assert.ok(!/\b(nextval|setval|set_config|pg_terminate_backend|pg_cancel_backend)\s*\(/i.test(sql), 'no function that changes something');
  assert.equal((sql.match(/\bselect\b/gi) || []).length > 0, true);
  assert.match(sql, /as fingerprint;/);
});
