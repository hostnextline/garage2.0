// The nightly backup and the restore (ops/sauvegardes), on the local copy of the server and against a pretend server
// made here (to play a table that changes while it is read, a server that does not know « done » yet, a bad
// reconciliation). Same style as tests/api/backup-restore.test.mjs; everything made here is removed at the end.
// Run: with the other API tests of the local copy (it needs the database on 54332 and the front door on 54331):
//   node --test --test-concurrency=1 ops/tests/sauvegardes.test.mjs      (Mac: bash tests/stack/mac/api-tests.sh ops/tests/sauvegardes.test.mjs)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync, statSync, readdirSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

// the repository's root: found from here, so this file may move
let ROOT = new URL('.', import.meta.url).pathname;
while (!existsSync(join(ROOT, 'package.json'))) ROOT = join(ROOT, '..');
const { default: pg } = await import(join(ROOT, 'tests/stack/node_modules/pg/lib/index.js'));
const K = JSON.parse(readFileSync(join(ROOT, 'tests/stack/keys.json')));
const db = new pg.Pool({ host: '127.0.0.1', port: 54332, user: 'postgres', database: 'postgres', max: 2 });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const OPS = join(ROOT, 'ops/sauvegardes');
const dir = mkdtempSync(join(tmpdir(), 'ops-sauvegarde-'));
const VRAI = { FONCTION: 'http://127.0.0.1:54331/functions/v1/backup', CLE: K.anon, TICKET_URL: 'http://127.0.0.1:8021/github/token?x=1' };
const psql = (f) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '54332', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const lire = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));

/** runs one of the two scripts; never throws: { code, out, err } */
function lancer(script, args, env = {}) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [join(OPS, script), ...args], { env: { ...process.env, ATTENTE_MS: '5', GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '', ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => ok({ code, out, err }));
  });
}
/** a pretend server: GitHub's ticket, the « backup » function and the « recon » function, answered by `jouer` */
async function faux(jouer) {
  const vus = [];
  const srv = createServer((req, res) => {
    let txt = '';
    req.on('data', (d) => { txt += d; });
    req.on('end', async () => {
      const dire = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.url.startsWith('/ticket')) return dire(200, { value: 'ticket-de-test' });
      const body = txt ? JSON.parse(txt) : {};
      const quoi = req.url.replace(/^\//, '');
      vus.push({ quoi, body, ticket: req.headers['x-github-oidc'], cle: req.headers.apikey });
      const [status, data] = await jouer(quoi, body, vus);
      dire(status, data);
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { vus, env: { FONCTION: `${base}/backup`, CLE: 'cle-test', TICKET_URL: `${base}/ticket?x=1` }, fermer: () => new Promise((ok) => srv.close(ok)) };
}
/** a « backup » function of the pretend server that serves these tables whole, one page each */
const tablesDe = (t) => Object.entries(t).map(([name, rows]) => ({ name, count: rows.length }));

const photos = [], clients = [];   // what these tests put in the database
before(async () => { await q('select 1'); });
after(async () => {
  await q(`delete from public.attachments where id = any($1)`, [photos]);
  await q(`delete from public.customers where id = any($1)`, [clients]);
  rmSync(dir, { recursive: true, force: true });
  await db.end();
});

// ---------------------------------------------------------------------------------------------------------------
// The pictures: one file each (x-branches-06: one attachments.json holding every picture stops the backup at 100 MB)
// ---------------------------------------------------------------------------------------------------------------
test('pictures: each one is a file of its own, attachments.json keeps the rows without them, and the restore gives back the same picture', async () => {
  // 25 pictures (two pages of 20 for the server of today), one of each kind, and one whose text is not plain base64
  const data = (i) => Buffer.from(`photo ${i} `.repeat(40 + i)).toString('base64');
  const mimes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf'];
  for (let i = 0; i < 25; i++) {
    const d = i === 7 ? 'ceci n’est pas du base64 !' : data(i);
    photos.push((await q(`insert into public.attachments (kind, mime, data, bytes) values ('receipt', $1, $2, $3) returning id`, [mimes[i % 5], d, Math.round(d.length * 0.75)]))[0].id);
  }
  const avant = await q(`select id, mime, data, updated_at from public.attachments where id = any($1)`, [photos]);
  const dos = join(dir, 'nuit', 'donnees');
  const r = await lancer('sauvegarde.mjs', [dos], VRAI);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /Sauvegarde complète/);
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' };
  const gardees = lire(dos, 'attachments.json').filter((x) => photos.includes(x.id));
  assert.equal(gardees.length, 25, 'every row of the pictures is kept');
  for (const a of avant) {
    const g = gardees.find((x) => x.id === a.id);
    const f = join(dos, 'photos', `${a.id}.${ext[a.mime]}`);
    if (a.id === photos[7]) {
      assert.equal(g.data, a.data, 'a text that is not plain base64 stays in its row: nothing is lost');
      assert.ok(!existsSync(f));
    } else {
      assert.ok(!('data' in g), 'the row is kept without its picture');
      assert.ok(readFileSync(f).equals(Buffer.from(a.data, 'base64')), 'the file is the picture itself, byte for byte');
    }
  }
  const resume = lire(dos, '_resume.json');
  assert.ok(resume.photos >= 24, 'the summary counts the pictures');
  assert.equal(resume.scripts['sauvegarde.mjs'], createHash('sha256').update(readFileSync(join(OPS, 'sauvegarde.mjs'))).digest('hex'), 'the summary says which script made the copy');
  assert.ok(!readdirSync(join(dos, 'photos')).some((f) => f.endsWith('.part')), 'no half-written picture is left');
  assert.ok(statSync(join(dos, 'attachments.json')).size < 25 * 400, 'attachments.json is light: the pictures are not in it');

  // the next night: one more picture. The others are not written again (their files are untouched)
  const vieux = join(dos, 'photos', `${photos[0]}.${ext[avant.find((a) => a.id === photos[0]).mime]}`);
  utimesSync(vieux, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
  const plus = (await q(`insert into public.attachments (kind, mime, data, bytes) values ('signature', 'image/png', $1, 12) returning id`, [Buffer.from('une signature').toString('base64')]))[0].id;
  photos.push(plus);
  const r2 = await lancer('sauvegarde.mjs', [dos], VRAI);
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.equal(statSync(vieux).mtime.toISOString(), '2026-01-01T00:00:00.000Z', 'a picture already kept is not written again');
  assert.equal(readFileSync(join(dos, 'photos', `${plus}.png`)).toString(), 'une signature');

  // a mistake in the day: two pictures deleted for good. The restore brings them back as they were
  await q(`delete from public.attachments where id = any($1)`, [[photos[0], photos[7]]]);
  const sql = await lancer('restaurer.mjs', [dos, '--tables', 'attachments']);
  assert.equal(sql.code, 0, sql.err);
  writeFileSync(join(dir, 'photos.sql'), sql.out);
  psql(join(dir, 'photos.sql'));
  for (const id of [photos[0], photos[7]]) {
    const back = (await q(`select data, updated_at from public.attachments where id = $1`, [id]))[0];
    const a = avant.find((x) => x.id === id);
    assert.equal(back.data, a.data, 'the same picture, character for character');
    assert.equal(new Date(back.updated_at).getTime(), new Date(a.updated_at).getTime(), 'restored as it was (no automatic touch)');
  }
  // a picture missing from the folder: the restore stops and names it (never a row without its picture)
  rmSync(vieux);
  const manque = await lancer('restaurer.mjs', [dos, '--tables', 'attachments']);
  assert.equal(manque.code, 1);
  assert.match(manque.err, new RegExp(`il manque la photo .*${photos[0]}`));
  assert.ok(!manque.out.includes('commit;'), 'the SQL written so far never commits');

  // a backup of before this change (every picture inside attachments.json) restores with the same script
  const vieuxDos = join(dir, 'avant', 'donnees');
  mkdirSync(vieuxDos, { recursive: true });
  const lignes = await q(`select to_jsonb(a) j from public.attachments a where id = any($1)`, [[photos[1], photos[2]]]);
  writeFileSync(join(vieuxDos, 'attachments.json'), JSON.stringify(lignes.map((x) => x.j)));
  await q(`delete from public.attachments where id = any($1)`, [[photos[1], photos[2]]]);
  const sql2 = await lancer('restaurer.mjs', [vieuxDos]);
  assert.equal(sql2.code, 0, sql2.err);
  writeFileSync(join(dir, 'avant.sql'), sql2.out);
  psql(join(dir, 'avant.sql'));
  assert.equal((await q(`select data from public.attachments where id = $1`, [photos[1]]))[0].data, avant.find((x) => x.id === photos[1]).data);
});

test('pictures: a server that sends the rows without their picture ({ light: true }) is asked for each picture once, never again the next night', async () => {
  const id = [randomUUID(), randomUUID()].sort();
  const img = { [id[0]]: Buffer.from('reçu un').toString('base64'), [id[1]]: Buffer.from('reçu deux, plus long').toString('base64') };
  const lignes = id.map((x) => ({ id: x, kind: 'receipt', mime: 'image/jpeg', bytes: Buffer.from(img[x], 'base64').length, job_id: null }));
  const s = await faux((quoi, b) => {
    if (b.action === 'tables') return [200, { ok: true, at: '2026-11-16T08:23:00.000Z', tables: [{ name: 'attachments', count: 2 }] }];
    if (b.action === 'rows') return [200, { ok: true, table: b.table, from: b.from, rows: b.light ? lignes : lignes.map((l) => ({ ...l, data: img[l.id] })), next: null }];
    if (b.action === 'picture') return [200, { ok: true, id: b.id, mime: 'image/jpeg', data: img[b.id] }];
    return [400, { ok: false, code: 'action', error: 'Action inconnue.' }];
  });
  const dos = join(dir, 'leger', 'donnees');
  const r = await lancer('sauvegarde.mjs', [dos], s.env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(readFileSync(join(dos, 'photos', `${id[1]}.jpg`)).toString(), 'reçu deux, plus long');
  assert.deepEqual(s.vus.filter((v) => v.body.action === 'picture').map((v) => v.body.id).sort(), id, 'each picture asked once');
  assert.ok(s.vus.every((v) => v.ticket === 'ticket-de-test' && v.cle === 'cle-test'), 'every call carries the ticket');
  s.vus.length = 0;
  const r2 = await lancer('sauvegarde.mjs', [dos], s.env);
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.equal(s.vus.filter((v) => v.body.action === 'picture').length, 0, 'the next night: no picture is downloaded again');
  // a picture replaced since (its row says another size): asked again
  img[id[0]] = Buffer.from('reçu un, repris en photo').toString('base64');
  lignes[0].bytes = Buffer.from(img[id[0]], 'base64').length;
  const r3 = await lancer('sauvegarde.mjs', [dos], s.env);
  assert.equal(r3.code, 0, r3.out + r3.err);
  assert.equal(readFileSync(join(dos, 'photos', `${id[0]}.jpg`)).toString(), 'reçu un, repris en photo');
  await s.fermer();
});

// ---------------------------------------------------------------------------------------------------------------
// A table that changes while it is read (pages by position: a row read twice, or fewer rows than counted)
// ---------------------------------------------------------------------------------------------------------------
test('a table that changed while it was read is read again: no row twice in the file, and a row deleted meanwhile does not cost the night', async () => {
  const c = ['a', 'b', 'c'].map((x) => ({ id: `0000000${x}`, first_name: x }));
  const j = ['x', 'y', 'z'].map((x) => ({ id: `1111111${x}`, number: x }));
  let lecturesC = 0, lecturesJ = 0, comptes = 0;
  const s = await faux((quoi, b) => {
    if (b.action === 'tables') { comptes++; return [200, { ok: true, at: '2026-11-16T08:23:00.000Z', tables: [{ name: 'customers', count: 3 }, { name: 'jobs', count: comptes === 1 ? 3 : 2 }, { name: 'counters', count: 1 }] }]; }
    if (b.action === 'rows' && b.table === 'customers') {
      if (b.from === 0) lecturesC++;
      // first reading: a customer was added before « b » between the two pages: « b » comes twice. Second reading: quiet.
      if (lecturesC === 1) return b.from === 0 ? [200, { ok: true, rows: [c[0], c[1]], next: 2 }] : [200, { ok: true, rows: [c[1], c[2]], next: null }];
      return b.from === 0 ? [200, { ok: true, rows: [c[0], c[1]], next: 2 }] : [200, { ok: true, rows: [c[2]], next: null }];
    }
    // a job deleted for good between the count and the reading: 2 rows where 3 were counted, and the fresh count says 2
    if (b.action === 'rows' && b.table === 'jobs') { lecturesJ++; return [200, { ok: true, rows: [j[0], j[2]], next: null }]; }
    if (b.action === 'rows' && b.table === 'counters') return [200, { ok: true, rows: [{ name: 'invoice', next_value: 12 }], next: null }];
    return [400, { ok: false, code: 'action', error: 'Action inconnue.' }];
  });
  const dos = join(dir, 'bouge', 'donnees');
  const r = await lancer('sauvegarde.mjs', [dos], s.env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(lire(dos, 'customers.json').map((x) => x.id), c.map((x) => x.id), 'each customer once');
  assert.equal(lecturesC, 2, 'the table was read again');
  assert.deepEqual(lire(dos, 'jobs.json').map((x) => x.id), [j[0].id, j[2].id]);
  assert.equal(lecturesJ, 2, 'read again with the fresh count');
  assert.deepEqual(lire(dos, '_resume.json').tables, { customers: 3, jobs: 2, counters: 1 });
  assert.match(r.out, /customers\s+a changé pendant la lecture/);
  await s.fermer();
});

test('rows really missing: the night is red, as before (and the file of that table is not written)', async () => {
  const s = await faux((quoi, b) => {
    if (b.action === 'tables') return [200, { ok: true, at: 'x', tables: [{ name: 'customers', count: 3 }] }];
    if (b.action === 'rows') return [200, { ok: true, rows: [{ id: '1' }, { id: '2' }], next: null }];
    return [400, { ok: false, code: 'action', error: 'Action inconnue.' }];
  });
  const dos = join(dir, 'manque', 'donnees');
  const r = await lancer('sauvegarde.mjs', [dos], s.env);
  assert.equal(r.code, 1);
  assert.match(r.err, /customers : 2 lignes reçues, 3 attendues/);
  assert.ok(!existsSync(join(dos, 'customers.json')) && !existsSync(join(dos, '_resume.json')));
  assert.ok(!r.out.includes('Sauvegarde complète'));
  await s.fermer();
});

test('a file too heavy for GitHub (100 MB a file) is said in plain words before the push; a heavy one is a warning', async () => {
  const gros = Array.from({ length: 300 }, (_, i) => ({ id: String(i).padStart(4, '0'), body: 'x'.repeat(10000) }));   // about 3 MB
  const s = await faux((quoi, b) => {
    if (b.action === 'tables') return [200, { ok: true, at: 'x', tables: [{ name: 'messages', count: gros.length }] }];
    if (b.action === 'rows') return [200, { ok: true, rows: gros, next: null }];
    return [400, { ok: false, code: 'action', error: 'Action inconnue.' }];
  });
  const dos = join(dir, 'lourd', 'donnees');
  const avis = await lancer('sauvegarde.mjs', [dos], { ...s.env, FICHIER_GROS_MO: '1', FICHIER_MAX_MO: '10' });
  assert.equal(avis.code, 0, avis.out + avis.err);
  assert.match(avis.out, /ATTENTION : .*messages\.json pèse 3 Mo/);
  const rouge = await lancer('sauvegarde.mjs', [dos], { ...s.env, FICHIER_GROS_MO: '1', FICHIER_MAX_MO: '2' });
  assert.equal(rouge.code, 1);
  assert.match(rouge.err, /messages\.json pèse 3 Mo : GitHub refuserait toute la sauvegarde de cette nuit/);
  await s.fermer();
});

// ---------------------------------------------------------------------------------------------------------------
// The end of a good night: « done », then the daily reconciliation
// ---------------------------------------------------------------------------------------------------------------
/** a folder as step 1 leaves it */
function nuitFaite(nom) {
  const dos = join(dir, nom, 'donnees');
  mkdirSync(dos, { recursive: true });
  writeFileSync(join(dos, '_resume.json'), JSON.stringify({ quand: '2026-11-16T08:23:00.000Z', tables: { customers: 120, jobs: 45, invoices: 30 } }));
  return dos;
}
const COMMIT = 'c0ffee1234567890c0ffee1234567890c0ffee12';

test('the end of the night: « done » says what was kept (tables, rows, commit), then the reconciliation runs; all is well = green', async () => {
  const s = await faux((quoi, b) => (quoi === 'backup' && b.action === 'done' ? [200, { ok: true }] : quoi === 'recon' && b.action === 'run' ? [200, { ok: true, status: 'ok' }] : [400, { ok: false, code: 'action', error: 'Action inconnue.' }]));
  const r = await lancer('sauvegarde.mjs', ['--fin', nuitFaite('fin-ok')], { ...s.env, COMMIT });
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(s.vus.map((v) => [v.quoi, v.body.action]), [['backup', 'done'], ['recon', 'run']], '« done » first, then the reconciliation');
  assert.deepEqual(s.vus[0].body, { action: 'done', tables: { customers: 120, jobs: 45, invoices: 30 }, rows: 195, commit: COMMIT });
  assert.deepEqual(s.vus[1].body, { action: 'run' });
  assert.ok(s.vus.every((v) => v.ticket === 'ticket-de-test'), 'both calls carry the GitHub ticket');
  assert.match(r.out, /Sauvegarde notée au garage : 3 tables, 195 lignes, commit c0ffee1/);
  assert.match(r.out, /Rapprochement : tout balance/);
  await s.fermer();
});

test('the end of the night on a server that does not know « done » nor « recon » yet (live before the cutover): two warnings, never a failure', async () => {
  // what live answers today: the « backup » function says « Action inconnue » (400), and no function « recon » exists (404)
  const s = await faux((quoi) => (quoi === 'backup' ? [400, { ok: false, code: 'action', error: 'Action inconnue.' }] : [404, { code: 'NOT_FOUND', message: 'Requested function was not found' }]));
  const r = await lancer('sauvegarde.mjs', ['--fin', nuitFaite('fin-avant')], { ...s.env, COMMIT });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /ATTENTION : Le serveur ne connaît pas encore « backup done »/);
  assert.match(r.out, /ATTENTION : Le serveur ne connaît pas encore le rapprochement/);
  assert.equal(s.vus.length, 2, 'asked once each: an unknown action is not tried again');
  await s.fermer();
  // the same with a « recon » function that exists but does not know « run »
  const s2 = await faux(() => [400, { ok: false, code: 'action', error: 'Action inconnue.' }]);
  const r2 = await lancer('sauvegarde.mjs', ['--fin', nuitFaite('fin-avant-2')], { ...s2.env, COMMIT });
  assert.equal(r2.code, 0, r2.out + r2.err);
  await s2.fermer();
});

test('the end of the night: a reconciliation that says « bad » ends RED (GitHub e-mails the owner), after « done » was said', async () => {
  const s = await faux((quoi, b) => (b.action === 'done' ? [200, { ok: true }] : [200, { ok: true, status: 'bad', findings: [{ severity: 'bad', message_fr: 'Facture 1042 : payé 120,00 $ mais les paiements font 100,00 $' }] }]));
  const r = await lancer('sauvegarde.mjs', ['--fin', nuitFaite('fin-bad')], { ...s.env, COMMIT });
  assert.equal(r.code, 1, 'red');
  assert.deepEqual(s.vus.map((v) => v.body.action), ['done', 'run']);
  assert.match(r.out, /RAPPROCHEMENT : des écarts à regarder \(statut « bad », 1 écart\)\. La sauvegarde de cette nuit est gardée/);
  assert.match(r.out, /\[bad\] Facture 1042/);
  await s.fermer();
  // « warn » is not red
  const s2 = await faux((quoi, b) => (b.action === 'done' ? [200, { ok: true }] : [200, { ok: true, status: 'warn' }]));
  const r2 = await lancer('sauvegarde.mjs', ['--fin', nuitFaite('fin-warn')], { ...s2.env, COMMIT });
  assert.equal(r2.code, 0, r2.out + r2.err);
  assert.match(r2.out, /Rapprochement : statut « warn »/);
  await s2.fermer();
});

test('the end of the night: a reconciliation that cannot run, or a « done » the server refuses, is red and says the copy is kept; the other call still goes', async () => {
  const s = await faux((quoi, b) => (b.action === 'done' ? [200, { ok: true }] : [500, { ok: false, code: 'server', error: 'Le serveur a eu un problème.' }]));
  const r = await lancer('sauvegarde.mjs', ['--fin', nuitFaite('fin-500')], { ...s.env, COMMIT });
  assert.equal(r.code, 1);
  assert.match(r.out, /ERREUR : le rapprochement n'a pas pu se faire \(server : .*\)\. La sauvegarde de cette nuit est gardée/);
  await s.fermer();
  const s2 = await faux((quoi, b) => (b.action === 'done' ? [403, { ok: false, code: 'not_allowed', error: 'Refusé.' }] : [200, { ok: true, status: 'ok' }]));
  const r2 = await lancer('sauvegarde.mjs', ['--fin', nuitFaite('fin-403')], { ...s2.env, COMMIT });
  assert.equal(r2.code, 1);
  assert.match(r2.out, /ERREUR : la sauvegarde est gardée, mais le garage n'a pas pu la noter \(not_allowed/);
  assert.deepEqual(s2.vus.map((v) => v.body.action), ['done', 'run'], 'the reconciliation still ran');
  await s2.fermer();
  // no copy to tell about (step 1 did not finish): red, nothing is called
  const s3 = await faux(() => [200, { ok: true }]);
  const r3 = await lancer('sauvegarde.mjs', ['--fin', join(dir, 'pas-de-nuit')], { ...s3.env, COMMIT });
  assert.equal(r3.code, 1);
  assert.match(r3.err, /Pas de sauvegarde à déclarer/);
  assert.equal(s3.vus.length, 0);
  await s3.fermer();
});

test('the end of the night against the functions of this copy: « done » and the reconciliation are accepted, or the server says it does not know them yet', async () => {
  // what the tables of the reconciliation hold before (they exist once its migration is merged): put back after
  const ops = (await q(`select c.relname t, (select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0] where i.indrelid = c.oid and i.indisprimary) k
                          from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'ops\\_%'`)).filter((x) => x.k);
  const avant = {};
  for (const { t, k } of ops) avant[t] = (await q(`select to_jsonb(x) ->> $1 as k from public.${t} x`, [k])).map((x) => x.k);
  const dos = join(dir, 'nuit', 'donnees');   // the copy of the first test
  assert.ok(existsSync(join(dos, '_resume.json')), 'the first test made a copy');
  const r = await lancer('sauvegarde.mjs', ['--fin', dos], { ...VRAI, COMMIT });
  try {
    assert.ok(/Sauvegarde notée au garage/.test(r.out) || /ne connaît pas encore « backup done »/.test(r.out), 'the « backup » function of this copy took « done » { tables, rows, commit } or does not know it: ' + r.out + r.err);
    assert.ok(/[Rr]approchement : |RAPPROCHEMENT : |ne connaît pas encore le rapprochement/.test(r.out), 'the « recon » function of this copy answered « run », or does not exist yet: ' + r.out + r.err);
    assert.ok(!/ERREUR/.test(r.out + r.err), 'no call was refused: ' + r.out + r.err);
    assert.equal(r.code, /RAPPROCHEMENT : des écarts/.test(r.out) ? 1 : 0);
  } finally {
    for (const { t, k } of [...ops].reverse()) await q(`delete from public.${t} x where not ((to_jsonb(x) ->> $1) = any($2))`, [k, avant[t]]).catch(() => {});
  }
});

// ---------------------------------------------------------------------------------------------------------------
// The restore: nothing is skipped in silence
// ---------------------------------------------------------------------------------------------------------------
test('restore: a file of the backup that the script does not know is an error, and so is a table asked for that is not there', async () => {
  const dos = join(dir, 'liste', 'donnees');
  mkdirSync(dos, { recursive: true });
  writeFileSync(join(dos, 'customers.json'), '[]\n');
  writeFileSync(join(dos, 'call_notes.json'), JSON.stringify([{ id: randomUUID(), body: 'une table ajoutée plus tard' }]));
  writeFileSync(join(dos, '_resume.json'), JSON.stringify({ quand: '2026-11-16T08:23:00.000Z', tables: { customers: 0, call_notes: 1 } }));
  const r = await lancer('restaurer.mjs', [dos]);
  assert.equal(r.code, 1, 'an unknown table file stops the restore');
  assert.match(r.err, /call_notes\.json est dans la sauvegarde mais restaurer\.mjs ne le connaît pas/);
  assert.equal(r.out, '', 'not a line of SQL was written');
  // naming the tables wanted still works beside it, and says so
  const r2 = await lancer('restaurer.mjs', [dos, '--tables', 'customers']);
  assert.equal(r2.code, 0, r2.err);
  assert.match(r2.err, /call_notes\.json .* pas dans la liste/);
  assert.match(r2.out, /commit;\n$/);
  // a table asked for by a name the script does not know, or whose file is not there
  const r3 = await lancer('restaurer.mjs', [dos, '--tables', 'customers,call_notes']);
  assert.equal(r3.code, 1);
  assert.match(r3.err, /« call_notes » n'est pas une table que restaurer\.mjs connaît/);
  const r4 = await lancer('restaurer.mjs', [dos, '--tables', 'vehicles']);
  assert.equal(r4.code, 1);
  assert.match(r4.err, /vehicles\.json n'est pas dans/);
  // an option written wrong is not taken for a folder
  const r5 = await lancer('restaurer.mjs', [dos, '--remplace']);
  assert.equal(r5.code, 1);
  assert.match(r5.err, /Option inconnue : --remplace/);
  // a table the summary announces but whose file is missing, or shorter than announced: the copy is not whole
  rmSync(join(dos, 'call_notes.json'));
  const r6 = await lancer('restaurer.mjs', [dos]);
  assert.equal(r6.code, 1);
  assert.match(r6.err, /_resume\.json annonce la table « call_notes » \(1 lignes\) mais call_notes\.json manque/);
  writeFileSync(join(dos, '_resume.json'), JSON.stringify({ quand: 'x', tables: { customers: 4 } }));
  const r7 = await lancer('restaurer.mjs', [dos]);
  assert.equal(r7.code, 1);
  assert.match(r7.err, /customers\.json a 0 lignes, _resume\.json en annonce 4/);
});

test('restore: the tables of the reconciliation and of the backup log are in the list (after the tables they tell about)', async () => {
  const dos = join(dir, 'ops', 'donnees');
  mkdirSync(dos, { recursive: true });
  for (const t of ['ops_backup_runs', 'ops_recon_runs', 'ops_recon_findings', 'customers']) writeFileSync(join(dos, `${t}.json`), JSON.stringify([{ id: randomUUID() }]));
  const r = await lancer('restaurer.mjs', [dos]);
  assert.equal(r.code, 0, r.err);
  const ordre = [...r.out.matchAll(/pg_temp\.remettre\('(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(ordre, ['customers', 'ops_backup_runs', 'ops_recon_runs', 'ops_recon_findings']);
});

test('restore with --remplacer: a row that an old backup holds twice does not break the restore, and what was made after the backup stays', async () => {
  const id = (await q(`insert into public.customers (first_name, phone, notes) values ('Double', '4385550101', 'avant') returning id`))[0].id;
  clients.push(id);
  const ligne = (await q(`select to_jsonb(c) j from public.customers c where id = $1`, [id]))[0].j;
  const dos = join(dir, 'double', 'donnees');
  mkdirSync(dos, { recursive: true });
  // the same row twice in one file (a table that changed while the script of before read it)
  writeFileSync(join(dos, 'customers.json'), JSON.stringify([ligne, ligne]));
  await q(`update public.customers set notes = 'après' where id = $1`, [id]);
  const apres = (await q(`insert into public.customers (first_name, phone) values ('Arrivé après', '4385550102') returning id`))[0].id;
  clients.push(apres);
  const r = await lancer('restaurer.mjs', [dos, '--remplacer']);
  assert.equal(r.code, 0, r.err);
  writeFileSync(join(dir, 'double.sql'), r.out);
  psql(join(dir, 'double.sql'));
  assert.equal((await q(`select notes from public.customers where id = $1`, [id]))[0].notes, 'avant', 'the row is back as the backup holds it');
  assert.equal((await q(`select count(*)::int n from public.customers where id = $1`, [apres]))[0].n, 1, '--remplacer deletes nothing: a customer made after the backup stays');
});
