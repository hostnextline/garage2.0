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

test('the full test workflow runs the tests of ops too (on the work branches; never in the publishing path)', () => {
  const y = lire('.github/workflows/tests-complets.yml');
  assert.match(y, /node --test --test-concurrency=1 tests\/db\/\*\.test\.mjs tests\/api\/\*\.test\.mjs ops\/tests\/\*\.test\.mjs/);
  assert.match(y, /branches-ignore: \[main, vercel, gh-pages, construction-v2\]/);
});

test('the nightly job of the backup repository: a refused push is told to the garage (--echec), only then; --fin comes after the push', () => {
  const y = lire('ops/sauvegardes/.github/workflows/sauvegarde.yml');
  const i = (x) => { const n = y.indexOf(x); assert.ok(n >= 0, 'sauvegarde.yml no longer holds: ' + x); return n; };
  assert.ok(i('run: node sauvegarde.mjs donnees') < i('git push') && i('git push') < i('run: node sauvegarde.mjs --fin donnees'));
  assert.match(y, /id: garder/);
  assert.match(y, /if: \$\{\{ failure\(\) && steps\.garder\.outcome == 'failure' \}\}\n\s+run: node sauvegarde\.mjs --echec donnees/);
  assert.match(y, /id-token: write/);
});

test('the Linux test stack (tests/stack/start.sh) fails when the functions (8011) or Postgres do not start, or a function does not load (R200)', () => {
  const sh = lire('tests/stack/start.sh');
  execFileSync('bash', ['-n', join(ROOT, 'tests/stack/start.sh')]);
  assert.match(sh, /^set -euo pipefail$/m);
  assert.match(sh, /up 8011 \|\| \{ echo "functions did not start[^}]*exit 1; \}/, 'no functions on 8011: exit 1 (it used to say so and go on)');
  assert.match(sh, /grep -q 'could not load' "\$RUN\/functions\.log"[\s\S]*?exit 1/, 'a function that does not load: exit 1');
  assert.match(sh, /pg_isready -h 127\.0\.0\.1 -p 54332 -q \|\| \{ echo "Postgres did not start[^}]*exit 1; \}/);
  const fin = sh.trim().split('\n').pop();
  assert.match(fin, /^echo "local Supabase/, 'success is said last, after every check');
});

test('publishing: the unit tests run on the garage\'s clock, the build takes APP_MIN_BUILT_AT, and a change outside the app publishes nothing (R01, R131, R132)', () => {
  const y = lire('.github/workflows/deploy.yml');
  assert.match(y, /run: npm test\n\s+env:\n\s+TZ: America\/Toronto/, 'npm test under UTC is red (bookedBy, moment logic): nothing would be published');
  assert.match(y, /APP_MIN_BUILT_AT: \$\{\{ vars\.APP_MIN_BUILT_AT \}\}/, 'vite.config.ts writes min_built_at from it');
  assert.match(lire('vite.config.ts'), /process\.env\.APP_MIN_BUILT_AT/);
  const ign = y.match(/paths-ignore:\n((?:\s+- '[^']+'\n)+)/);
  assert.ok(ign, 'paths-ignore on the push to main');
  const motifs = [...ign[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  // never a file the build or the publication reads: the app (src, public, the two pages), the build's settings, the
  // Vercel settings copied next to the app, the workflows themselves
  for (const x of motifs) assert.ok(!/^(src|public|index\.html|client\.html|vite\.config|package|tsconfig|vercel\.json|ops\/vercel|ops\/\*\*|\.github|\*\*)/.test(x), `${x} would keep a change of the app from being published`);
  assert.ok(motifs.includes('supabase/**') && motifs.includes('docs/**'));
  assert.match(y, /workflow_dispatch: \{\}/, 'Run workflow stays (O-16: not restricted)');
  assert.ok(!/github\.ref ==/.test(y), 'no branch restriction (the owner\'s decision O-16)');
  assert.match(lire('.github/workflows/tests-complets.yml'), /npm test\n\s+env:\n\s+TZ: America\/Toronto/);
});

test('the cutover runbook is exact for this tree: the six migrations in order, the twelve functions at one commit, what the owner does by hand, the way back (mise-a-niveau)', () => {
  const rb = lire('ops/live/CUTOVER.md');
  // every migration added since the live version (acf46c3 has up to 20261115000100), in the order of their names
  const neuves = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql') && f > '20261115000100_zzz').sort();
  assert.ok(neuves.length >= 6);
  let avant = -1;
  for (const f of neuves) {
    const i = rb.indexOf('`' + f + '`');
    assert.ok(i >= 0, `CUTOVER.md names the migration ${f}`);
    assert.ok(i > avant, `${f} comes after the one before it`);
    avant = i;
  }
  // every server function of the tree is named, and checked by its commit
  const fns = readdirSync(join(ROOT, 'supabase/functions'), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name).sort();
  assert.ok(rb.includes('`' + fns.join(' ') + '`') || fns.every((f) => rb.includes('`' + f + '`')), 'CUTOVER.md names every function: ' + fns.join(' '));
  assert.match(rb, new RegExp(`les ${fns.length}\\s+fonctions\\s+du\\s+serveur,\\s+toutes\\s+au\\s+même\\s+commit`));
  assert.match(rb, /\?version"` répond `\{"ok":true,"commit":"<C>"\}`/);
  assert.match(lire('supabase/functions/_shared/http.ts'), /searchParams\.has\('version'\)/, 'the functions do answer ?version');
  for (const x of ['charge.refunded', 'APP_MIN_BUILT_AT', 'Workflow permissions', 'ops_recon_baseline', '--neuve', '--echec', 'Ce qui ne se défait pas', 'cron.unschedule', 'Undo Rollback', 'GITHUB_OIDC_JWKS'])
    assert.ok(rb.includes(x), 'CUTOVER.md speaks of ' + x);
  assert.ok(!/select public\.snapshot_take/.test(rb), 'snapshot_take is in no migration: the runbook does not count on it (R202)');
  // the order of the night: backup, read-only questions, migrations, functions, by hand, the app
  const ordre = ['## 1. ', '### 1.1', '### 1.2', '## 2. ', '## 3. ', '## 4. ', '## 5. ', '## 7. '].map((x) => rb.indexOf(x));
  assert.ok(ordre.every((x, i) => x >= 0 && (i === 0 || x > ordre[i - 1])), 'backup, questions, migrations, functions, by hand, app, way back');
  // every file to copy into the backup repository exists
  for (const m of rb.matchAll(/\| `(ops\/sauvegardes\/[^`]+)` \|/g)) assert.ok(existsSync(join(ROOT, m[1])), m[1]);
});

test('the full test workflow checks the types of the server functions (deno check), after the stack is installed (infra-15)', () => {
  const y = lire('.github/workflows/tests-complets.yml');
  const i = y.indexOf('deno check --quiet supabase/functions/*/index.ts');
  assert.ok(i > 0 && i > y.indexOf('bash tests/stack/install.sh') && i < y.indexOf('node --test --test-concurrency=1'), 'after install.sh (it brings Deno), before the API tests');
  assert.match(lire('tests/stack/start.sh'), /\$S\/node_modules\/\.bin\/deno/, 'the same Deno the stack runs the functions with');
  assert.ok(!/deno check/.test(lire('.github/workflows/deploy.yml')), 'not in the publishing path (the owner\'s decision, infra-10)');
});
