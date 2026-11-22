// The files of « ops » and of the publishing workflow, read as text: no server needed, runs anywhere
// (node --test ops/tests/fichiers.test.mjs). Each test names the mistake it keeps from coming back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path, { join } from 'node:path';

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
  // every migration added since the rebuild was cut (acf46c3 has up to 20261115000100), in the order of their names; one of
  // them, 20261119000100_heures, is already on live (aa1b4e6): the runbook names it as « not to apply ». The ones of a
  // later Part with its own runbook (Part 28: ops/live/PARTIE28.md) are that runbook's, not CUTOVER's
  const rb28 = existsSync(join(ROOT, 'ops/live/PARTIE28.md')) ? lire('ops/live/PARTIE28.md') : '';
  const neuves = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql') && f > '20261115000100_zzz' && !rb28.includes(f)).sort();
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

test('Part 27 alone, from today\'s live (the rebuild went live 2026-11-21): its runbook names what runs and what changes; the try and the fingerprint only read (merge-main F6)', () => {
  const rb = lire('ops/live/PARTIE27.md');
  const cut = lire('ops/live/CUTOVER.md');
  // CUTOVER says the rebuild's night is done and points to this runbook before anyone follows its sections 1-5 again
  assert.ok(cut.indexOf('ops/live/PARTIE27.md') >= 0 && cut.indexOf('ops/live/PARTIE27.md') < cut.indexOf('## 0. '), 'CUTOVER.md points to PARTIE27.md at its top');
  assert.match(lire('CLAUDE.md'), /REBUILD \(« refonte »\) IS LIVE since 2026-11-21/);
  // what runs today: the app d7b6c0d2, the functions and migrations at 837c89d8
  for (const x of ['d7b6c0d2', '837c89d8', '`20261119000200`', 'fonctions_avant_27.sql', 'ESSAI OK', 'lock_timeout', 'Le retour'])
    assert.ok(rb.includes(x), 'PARTIE27.md speaks of ' + x);
  // the one migration Part 27 added to live's (and nothing else in supabase/migrations is newer, but Part 28's: ops/live/PARTIE28.md)
  const rb28 = existsSync(join(ROOT, 'ops/live/PARTIE28.md')) ? lire('ops/live/PARTIE28.md') : '';
  const neuves = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql') && f > '20261119000100_zzz' && !rb28.includes(f));
  assert.deepEqual(neuves, ['20261119000200_vraies_routes.sql']);
  // the four functions it redeploys exist, the order: drive first (it needs the migration)
  const order = ['`drive`', '`book`', '`enroute`', '`backup`'].map((f) => rb.indexOf(f));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), 'drive, book, enroute, backup, in that order');
  for (const f of ['drive', 'book', 'enroute', 'backup']) assert.ok(existsSync(join(ROOT, 'supabase/functions', f, 'index.ts')), f);
  // the files it names are in the repository; the fingerprint only reads; the try ends by undoing everything
  for (const f of ['ops/live/partie27/essai-partie27.sql', 'ops/live/partie27/empreinte-21.sql', 'ops/live/partie27/empreinte-21.local-main.txt', 'ops/live/partie27/essai-local.mjs'])
    assert.ok(rb.includes(f) && existsSync(join(ROOT, f)), f);
  const fp = lire('ops/live/partie27/empreinte-21.sql').replace(/--.*$/gm, '');
  assert.ok(!/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|do)\b\s/i.test(fp), 'the fingerprint only reads');
  assert.equal(lire('ops/live/partie27/empreinte-21.local-main.txt').trim().split('\n').length, 22);
  const essai = lire('ops/live/partie27/essai-partie27.sql');
  assert.match(essai, /raise exception 'ESSAI OK[^']*'/);
  assert.ok(!/\b(drop|truncate|delete from)\b/i.test(essai.replace(/--.*$/gm, '')), 'the try sends no DROP, TRUNCATE or DELETE');
});

test('Part 28 after Part 27 (REARRANGE.md §6.5, §7.3 b): its own runbook from today\'s live names its migration, what it needs first, the try, told_install, the three functions in their order, the way back; its read-only files only read; CUTOVER.md and CLAUDE.md point to it', () => {
  const rb = lire('ops/live/PARTIE28.md');
  for (const x of ['`20261122000100_reorganiser.sql`', '`20261119000200`', 'ESSAI OK', 'lock_timeout', 'told_install', 'a-avertir.sql', 'Le retour',
    '5e23639e', '837c89d8', '6f91d6f9'])
    assert.ok(rb.includes(x), 'PARTIE28.md speaks of ' + x);
  // Part 28's migration is the only one after Part 27's, and Part 27's is named by its version only (it is live: not to apply)
  const after27 = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql') && f > '20261119000200_zzz').sort();
  assert.deepEqual(after27, ['20261122000100_reorganiser.sql']);
  assert.ok(!rb.includes('20261119000200_vraies_routes.sql'), 'Part 27 is not one of this runbook\'s migrations');
  // the try comes before the real thing, the functions after the migration, told_install again after them, the app last
  const at = ['## 1. ', 'essai-partie28.sql', '## 2. ', '## 3. ', '## 4. ', '## 5. '].map((x) => rb.indexOf(x));
  assert.ok(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), 'the try, the migration, the functions, told_install again, the app, the way back');
  // its functions: notify, book, client, in that order, each a function of this tree; nothing else is redeployed
  const s2 = rb.slice(rb.indexOf('## 2. '), rb.indexOf('## 3. '));
  const order = ['`notify`', '`book`', '`client`'].map((f) => s2.indexOf(f));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), 'notify, book, client, in that order');
  for (const f of ['notify', 'book', 'client']) assert.ok(existsSync(join(ROOT, 'supabase/functions', f, 'index.ts')), f);
  const named = [...s2.matchAll(/`([a-z]+)`/g)].map((m) => m[1]).filter((f) => existsSync(join(ROOT, 'supabase/functions', f, 'index.ts')));
  assert.deepEqual([...new Set(named)], ['notify', 'book', 'client'], 'section 2 redeploys these three only');
  // the way back: the list of who is owed his hour comes first, then the app, then the functions; the migration stays
  const back = rb.slice(rb.indexOf('## 5. '));
  assert.ok(back.indexOf('a-avertir.sql') < back.indexOf('Vercel') && back.indexOf('Vercel') < back.indexOf('837c89d8'));
  assert.match(back, /jamais de DROP/);
  // the files it names are there; avant.sql and a-avertir.sql only read; the try ends by undoing everything and removes nothing
  for (const f of ['ops/live/partie28/avant.sql', 'ops/live/partie28/essai-partie28.sql', 'ops/live/partie28/a-avertir.sql'])
    assert.ok(rb.includes(f) && existsSync(join(ROOT, f)), f);
  for (const f of ['ops/live/partie28/avant.sql', 'ops/live/partie28/a-avertir.sql']) {
    const q = lire(f).replace(/--.*$/gm, '');
    assert.ok(!/\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|do)\b\s/i.test(q), f + ' only reads');
  }
  const essai = lire('ops/live/partie28/essai-partie28.sql');
  assert.match(essai, /raise exception 'ESSAI OK : reorganiser \(rien n''est gardé\)[^']*'/);
  assert.match(essai, /20261122000100_reorganiser\.sql/);
  assert.match(essai, /set_config\('lock_timeout', '5s', true\)/);
  assert.ok(!/\b(drop|truncate|delete from)\b/i.test(essai.replace(/--.*$/gm, '')), 'the try sends no DROP, TRUNCATE or DELETE');
  // CUTOVER.md's top note and CLAUDE.md's live section point to it
  const cut = lire('ops/live/CUTOVER.md');
  assert.ok(cut.indexOf('ops/live/PARTIE28.md') >= 0 && cut.indexOf('ops/live/PARTIE28.md') < cut.indexOf('## 0. '), 'CUTOVER.md points to PARTIE28.md at its top');
  assert.match(lire('CLAUDE.md'), /ops\/live\/PARTIE28\.md/, 'CLAUDE.md names PARTIE28.md beside PARTIE27.md');
});

test('the full test workflow checks the types of the server functions (deno check), after the stack is installed (infra-15)', () => {
  const y = lire('.github/workflows/tests-complets.yml');
  const i = y.indexOf('deno check --quiet supabase/functions/*/index.ts');
  assert.ok(i > 0 && i > y.indexOf('bash tests/stack/install.sh') && i < y.indexOf('node --test --test-concurrency=1'), 'after install.sh (it brings Deno), before the API tests');
  assert.match(lire('tests/stack/start.sh'), /\$S\/node_modules\/\.bin\/deno/, 'the same Deno the stack runs the functions with');
  assert.ok(!/deno check/.test(lire('.github/workflows/deploy.yml')), 'not in the publishing path (the owner\'s decision, infra-10)');
});

test('the cutover asks for the unit tests on the garage\'s clock, as publishing does; never under UTC while the tests have no clock of their own (ops-r2-1)', () => {
  const rb = lire('ops/live/CUTOVER.md');
  const vite = lire('vite.config.ts');
  // the unit tests set no clock of their own (vite.config.ts test.env.TZ): under UTC six of them are red, and the runbook
  // says « stop at the first gap ». The owner would stop at step 0 on a good tree, or learn to ignore a red check.
  const testTz = /test:\s*\{[\s\S]*?\benv:\s*\{[\s\S]*?\bTZ\b/.test(vite);
  if (!testTz) assert.ok(!/TZ=UTC npm test/.test(rb), 'CUTOVER.md asks for « TZ=UTC npm test », red until vite.config.ts sets test.env.TZ');
  // the same clock as « Publier l'app » (deploy.yml): what passes there passes here
  assert.match(lire('.github/workflows/deploy.yml'), /TZ: America\/Toronto/);
  assert.match(rb, /`TZ=America\/Toronto npm test`/, 'CUTOVER.md step 0.1 runs the unit tests on the garage\'s clock');
});

test('a push to main that publishes nothing still runs the unit tests that read those files (ops-r2-2)', () => {
  // the folders outside src/ that the unit tests read (an import, a glob from the root, a path built from __dirname)
  const { dirname, resolve, relative } = path;
  const lus = new Set();
  const marche = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) marche(p);
      else if (/\.test\.tsx?$/.test(e.name)) {
        const txt = lire(p);
        for (const m of txt.matchAll(/['"`]((?:\.\.\/)+[^'"`]+)['"`]/g)) {
          const r = relative(ROOT, resolve(ROOT, dirname(p), m[1])).split('/')[0];
          if (r && r !== 'src' && r !== '..' && existsSync(join(ROOT, r))) lus.add(r);
        }
        for (const m of txt.matchAll(/['"`]!?\/([a-z][\w.-]*)\//g)) if (m[1] !== 'src' && existsSync(join(ROOT, m[1]))) lus.add(m[1]);
      }
    }
  };
  marche('src');
  assert.ok(lus.has('supabase'), 'the unit tests read supabase/ (errors.test, server-texts.test, webpush.test, config.test…)');
  const deploy = lire('.github/workflows/deploy.yml');
  const ign = [...deploy.match(/paths-ignore:\n((?:\s+- '[^']+'\n)+)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const sautes = [...lus].filter((d) => ign.some((x) => x === d + '/**' || x.startsWith(d + '/')));
  if (!sautes.length) return;   // every folder they read publishes (and so is tested) on main
  // a workflow apart from publishing (infra-10: the publishing path stays as it is) runs the types and the unit tests
  // on the garage's clock for a push to main touching these folders, and publishes nothing
  const autres = readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f) && f !== 'deploy.yml').map((f) => lire('.github/workflows/' + f));
  const garde = autres.find((y) => /push:\n\s+branches: \[main\]\n\s+paths:/.test(y));
  assert.ok(garde, 'a workflow runs the unit tests on a push to main that deploy.yml skips (' + sautes.join(', ') + ')');
  const chemins = [...garde.match(/paths:\n((?:\s+- '[^']+'\n)+)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const d of sautes) assert.ok(chemins.includes(d + '/**'), `it watches ${d}/**`);
  assert.match(garde, /run: npx tsc --noEmit && npm test\n\s+env:\n\s+TZ: America\/Toronto/, 'the same checks, on the garage\'s clock');
  assert.ok(!/git push|secrets\.|contents: write|continue-on-error/.test(garde), 'it publishes nothing and writes nothing');
  assert.match(garde, /permissions:\n\s+contents: read/);
});
