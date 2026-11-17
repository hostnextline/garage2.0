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
  // 25 pictures (two pages of 20 for the server of today), one of each kind the server takes (no SVG since
  // refonte_acces: attachments_no_svg), and one whose text is not plain base64
  const data = (i) => Buffer.from(`photo ${i} `.repeat(40 + i)).toString('base64');
  const mimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  for (let i = 0; i < 25; i++) {
    const d = i === 7 ? 'ceci n’est pas du base64 !' : data(i);
    photos.push((await q(`insert into public.attachments (kind, mime, data, bytes) values ('receipt', $1, $2, $3) returning id`, [mimes[i % mimes.length], d, Math.round(d.length * 0.75)]))[0].id);
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
  // a copy of its own (never the one another test left): step 1 of the night against this copy's « backup » function
  const dos = join(dir, 'nuit-vraie', 'donnees');
  const copie = await lancer('sauvegarde.mjs', [dos], VRAI);
  assert.equal(copie.code, 0, copie.out + copie.err);
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
  for (const t of ['ops_backup_runs', 'ops_recon_runs', 'ops_recon_findings', 'ops_recon_baseline', 'customers']) writeFileSync(join(dos, `${t}.json`), JSON.stringify([{ id: randomUUID() }]));
  const r = await lancer('restaurer.mjs', [dos]);
  assert.equal(r.code, 0, r.err);
  const ordre = [...r.out.matchAll(/pg_temp\.remettre\('(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(ordre, ['customers', 'ops_backup_runs', 'ops_recon_runs', 'ops_recon_findings', 'ops_recon_baseline']);
});

test('restore: every table the « backup » function hands out is one the restore knows (R07: ops_recon_baseline stopped a full restore)', () => {
  const fn = readFileSync(join(ROOT, 'supabase/functions/backup/handler.ts'), 'utf8');
  const liste = fn.match(/export const TABLES = \[([\s\S]*?)\] as const/);
  assert.ok(liste, 'TABLES is found in backup/handler.ts');
  const tables = [...liste[1].replace(/\/\/.*$/gm, '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
  assert.ok(tables.includes('ops_recon_baseline') && tables.length > 30);
  const ordre = readFileSync(join(OPS, 'restaurer.mjs'), 'utf8').match(/const ORDRE = \[([\s\S]*?)\];/)[1];
  const connues = [...ordre.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(tables.filter((t) => !connues.includes(t)), [], 'a table of the backup missing from ORDRE stops every full restore');
  assert.deepEqual(connues, tables, 'the same tables, in the same order (a table after the ones it points to)');
});

test('restore --remplacer of the settings: the night\'s values come back, but the public booking page stays open or closed as it is now (R111)', async () => {
  const avant = (await q(`select to_jsonb(s) j from public.settings s where id = 1`))[0].j;
  try {
    // that night: booking open, another home; today: the owner closed the booking page
    const nuit = { ...avant, booking: { ...(avant.booking || {}), home: { label: 'Centrale (sauvegarde)' }, web: { ...((avant.booking || {}).web || {}), on: true } } };
    await q(`update public.settings set booking = jsonb_set(booking, '{web}', coalesce(booking->'web', '{}'::jsonb) || '{"on": false}') where id = 1`);
    const dos = dossier('web-on', { settings: [nuit] });
    const r = await restaurer(dos, ['--tables', 'settings', '--remplacer']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.sql, '', 'the SQL ran: ' + r.sql);
    const b = (await q(`select booking from public.settings where id = 1`))[0].booking;
    assert.equal(b.home.label, 'Centrale (sauvegarde)', 'the night\'s settings are back');
    assert.equal(b.web.on, false, 'the booking page stays closed: only the owner opens it (web_switch)');
    // and the other way: open today, closed that night
    await q(`update public.settings set booking = jsonb_set(booking, '{web,on}', 'true') where id = 1`);
    const r2 = await restaurer(dossier('web-on-2', { settings: [{ ...nuit, booking: { ...nuit.booking, web: { ...nuit.booking.web, on: false } } }] }), ['--tables', 'settings', '--remplacer']);
    assert.equal(r2.sql, '', 'the SQL ran: ' + r2.sql);
    assert.equal((await q(`select booking->'web'->'on' v from public.settings where id = 1`))[0].v, true);
  } finally {
    await q(`update public.settings s set booking = ($1::jsonb)->'booking' where id = 1`, [avant]);
  }
});

test('restore: an SVG picture of an old backup (the server refuses them now) is left in the backup, said, and does not stop the restore', async () => {
  const ok = randomUUID(), svg = randomUUID();
  photos.push(ok, svg);
  const dos = dossier('svg', { attachments: [
    { id: ok, kind: 'receipt', mime: 'image/png', data: Buffer.from('un reçu').toString('base64'), bytes: 7 },
    { id: svg, kind: 'receipt', mime: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64'), bytes: 6 }] });
  const r = await restaurer(dos, ['--tables', 'attachments']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.sql, '', 'the SQL ran: ' + r.sql);
  assert.match(r.err, new RegExp(`1 photo SVG ne revient pas .*${svg}`));
  assert.equal((await q(`select count(*)::int n from public.attachments where id = $1`, [ok]))[0].n, 1, 'the other picture is back');
  assert.equal((await q(`select count(*)::int n from public.attachments where id = $1`, [svg]))[0].n, 0);
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

// ---------------------------------------------------------------------------------------------------------------
// The restore across a change of the schema (infra-01), the numbers after a restore (infra-05), and the app's
// « Effacer » undone (infra-06)
// ---------------------------------------------------------------------------------------------------------------
/** a backup folder made here: { table: rows } (a _resume.json that counts them) */
function dossier(nom, tables) {
  const dos = join(dir, nom, 'donnees');
  mkdirSync(dos, { recursive: true });
  for (const [t, rows] of Object.entries(tables)) writeFileSync(join(dos, `${t}.json`), JSON.stringify(rows));
  writeFileSync(join(dos, '_resume.json'), JSON.stringify({ quand: '2026-11-14T08:23:00.000Z', tables: Object.fromEntries(Object.entries(tables).map(([t, r]) => [t, r.length])) }));
  return dos;
}
/** writes the SQL of a restore and runs it: { code, err } of the script, then psql's error (or '') */
async function restaurer(dos, args = []) {
  const r = await lancer('restaurer.mjs', [dos, ...args]);
  if (r.code !== 0) return { ...r, sql: '' };
  const f = join(dir, `r-${randomUUID()}.sql`);
  writeFileSync(f, r.out);
  try { psql(f); return { ...r, sql: '' }; } catch (e) { return { ...r, sql: String(e.stderr || e.message) }; }
}
const sans = (row, ...cles) => { const x = { ...row }; for (const k of cles) delete x[k]; return x; };

test('restore of a backup made BEFORE a column was added: only the backup\'s columns are written (a row put back takes the default, a row replaced keeps its value)', async () => {
  // two customers as a backup of before « sms_ok » (required, default true) and « email » existed would hold them
  const [a, b] = (await q(`insert into public.customers (first_name, phone, email, notes, sms_ok) values ('Avant', '4385550201', 'avant@exemple.ca', 'la nuit', false), ('Bientôt', '4385550202', 'b@exemple.ca', 'la nuit', false) returning id`)).map((x) => x.id);
  clients.push(a, b);
  const rows = (await q(`select to_jsonb(c) j from public.customers c where id = any($1) order by id`, [[a, b]])).map((x) => sans(x.j, 'sms_ok', 'email'));
  const dos = dossier('colonnes', { customers: rows });
  // the day after: « b » deleted for good, « a » changed
  await q(`delete from public.customers where id = $1`, [b]);
  await q(`update public.customers set notes = 'changée' where id = $1`, [a]);
  // default mode: « b » comes back, with the default of the column the backup did not know (before: not-null error, nothing restored)
  const r = await restaurer(dos, ['--tables', 'customers']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.sql, '', 'the SQL ran: ' + r.sql);
  const bb = (await q(`select sms_ok, email, notes from public.customers where id = $1`, [b]))[0];
  assert.ok(bb, '« b » is back');
  assert.equal(bb.sms_ok, true, 'a column added after the backup takes its default');
  assert.equal(bb.email, null);
  assert.equal(bb.notes, 'la nuit');
  // --remplacer: « a » goes back to the night's notes, and keeps what the backup did not know (before: email set to null)
  const r2 = await restaurer(dos, ['--tables', 'customers', '--remplacer']);
  assert.equal(r2.code, 0, r2.err);
  assert.equal(r2.sql, '', 'the SQL ran: ' + r2.sql);
  const aa = (await q(`select sms_ok, email, notes from public.customers where id = $1`, [a]))[0];
  assert.equal(aa.notes, 'la nuit', 'the backup\'s value is back');
  assert.equal(aa.email, 'avant@exemple.ca', 'a column the backup did not have is left as it is');
  assert.equal(aa.sms_ok, false, 'a required column the backup did not have is left as it is');
});

test('restore: a required column with no default that the backup did not have stops everything, names it, and changes nothing', async () => {
  const c = randomUUID();
  const ligne = (await q(`select to_jsonb(x) j from (select $1::uuid as id, 'Sans note'::text as first_name, '4385550203'::text as phone, 'fr'::text as lang, now() as created_at, now() as updated_at) x`, [c]))[0].j;
  clients.push(c);
  const note = { id: randomUUID(), customer_id: c, created_at: '2026-11-14T10:00:00Z', updated_at: '2026-11-14T10:00:00Z', deleted_at: null };   // no « body »
  const dos = dossier('requise', { customers: [ligne], customer_notes: [note] });
  const r = await restaurer(dos, ['--tables', 'customers,customer_notes']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.sql, /la colonne customer_notes\.body est obligatoire et sans valeur par défaut, mais elle n'existait pas encore dans cette sauvegarde/);
  assert.equal((await q(`select count(*)::int n from public.customers where id = $1`, [c]))[0].n, 0, 'nothing was changed: the customer of the same restore did not come in either');
});

test('restore: the numbers taken from a sequence go UP to the highest restored one (a fresh database), never down', async () => {
  // an activity row of a backup whose id is ahead of this database's sequence (what every row is in a new project)
  const seq = Number((await q(`select last_value from public.activity_id_seq`))[0].last_value);
  const id = seq + 500;
  const act = (await q(`select to_jsonb(x) j from (select $1::bigint as id, 'restau-test'::text as action, 'customer'::text as entity, now() as at) x`, [id]))[0].j;
  // jobs: the restore must not bring job_number_seq down to the highest job number (numbers given then rolled back)
  await q(`select nextval('public.job_number_seq') from generate_series(1, 3)`);
  const avantJobs = Number((await q(`select last_value from public.job_number_seq`))[0].last_value);
  const dos = dossier('sequences', { jobs: [], activity: [act] });
  try {
    const r = await restaurer(dos, ['--tables', 'jobs,activity']);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.sql, '', 'the SQL ran: ' + r.sql);
    assert.ok(Number((await q(`select last_value from public.activity_id_seq`))[0].last_value) >= id, 'activity_id_seq is past the restored row');
    const neuf = (await q(`insert into public.activity (action, entity) values ('restau-test', 'customer') returning id`))[0].id;
    assert.ok(Number(neuf) > id, 'the next row takes a new number: no duplicate key');
    assert.equal(Number((await q(`select last_value from public.job_number_seq`))[0].last_value), avantJobs, 'job_number_seq never goes down');
  } finally {
    await q(`delete from public.activity where action = 'restau-test'`);
  }
});

test('restore --retablir: the app\'s « Effacer » undone on the rows asked (deleted_at empty, updated_at new: the phones see them), nothing else written', async () => {
  const [d, e] = (await q(`insert into public.customers (first_name, phone, notes) values ('Effacé', '4385550204', 'la nuit'), ('Effacé aussi', '4385550205', 'la nuit') returning id`)).map((x) => x.id);
  clients.push(d, e);
  const rows = (await q(`select to_jsonb(c) j from public.customers c where id = any($1)`, [[d, e]])).map((x) => x.j);
  const dos = dossier('retablir', { customers: rows });
  // the day after: a note changed, then both deleted the app's way
  await q(`update public.customers set notes = 'du jour' where id = $1`, [d]);
  await q(`update public.customers set deleted_at = now() where id = any($1)`, [[d, e]]);
  const avant = (await q(`select updated_at from public.customers where id = $1`, [d]))[0].updated_at;
  // the default restore brings back nothing the app deleted (the row is still there): said in the README
  const r0 = await restaurer(dos, ['--tables', 'customers']);
  assert.equal(r0.sql, '', r0.sql);
  assert.ok((await q(`select deleted_at from public.customers where id = $1`, [d]))[0].deleted_at, 'the default mode does not undelete');
  const r = await restaurer(dos, ['--tables', 'customers', '--ids', d, '--retablir']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.sql, '', 'the SQL ran: ' + r.sql);
  assert.ok(!/session_replication_role/.test(r.out), 'the automatic steps stay on');
  const dd = (await q(`select deleted_at, notes, updated_at from public.customers where id = $1`, [d]))[0];
  assert.equal(dd.deleted_at, null, 'back in the app');
  assert.equal(dd.notes, 'du jour', 'nothing of the backup is written over the row');
  assert.ok(new Date(dd.updated_at) > new Date(avant), 'updated_at is new: every phone pulls it again');
  assert.ok((await q(`select deleted_at from public.customers where id = $1`, [e]))[0].deleted_at, 'a row not asked for stays deleted');
  // mistakes are said, nothing is written
  const m1 = await lancer('restaurer.mjs', [dos, '--retablir']);
  assert.equal(m1.code, 1); assert.match(m1.err, /--retablir demande --tables/);
  const m2 = await lancer('restaurer.mjs', [dos, '--tables', 'customers', '--ids', randomUUID()]);
  assert.equal(m2.code, 1); assert.match(m2.err, /cet id n'est dans aucun des fichiers nommés/);
  const m3 = await lancer('restaurer.mjs', [dos, '--ids', d]);
  assert.equal(m3.code, 1); assert.match(m3.err, /--ids demande --tables/);
  const m4 = await lancer('restaurer.mjs', [dos, '--tables', 'customers', '--remplacer', '--retablir']);
  assert.equal(m4.code, 1); assert.match(m4.err, /ne vont pas ensemble/);
  const deja = dossier('retablir-deja', { customers: rows.map((x) => (x.id === e ? { ...x, deleted_at: '2026-11-13T12:00:00Z' } : x)) });
  const m5 = await lancer('restaurer.mjs', [deja, '--tables', 'customers', '--ids', e, '--retablir']);
  assert.equal(m5.code, 1); assert.match(m5.err, /était déjà effacé le soir de la sauvegarde/);
  // --ids with --remplacer: only that row goes back to the night
  await q(`update public.customers set notes = 'du jour' where id = any($1)`, [[d, e]]);
  const avant6 = (await q(`select updated_at from public.customers where id = $1`, [d]))[0].updated_at;
  const r6 = await restaurer(dos, ['--tables', 'customers', '--ids', d, '--remplacer']);
  assert.equal(r6.sql, '', r6.sql);
  const d6 = (await q(`select notes, updated_at from public.customers where id = $1`, [d]))[0];
  assert.equal(d6.notes, 'la nuit');
  assert.ok(new Date(d6.updated_at) > new Date(avant6), 'a row restored by its id gets a new updated_at: the phones take the night\'s values (infra-07)');
  assert.equal((await q(`select notes from public.customers where id = $1`, [e]))[0].notes, 'du jour', 'the other row is untouched');
});

// ---------------------------------------------------------------------------------------------------------------
// After the loss of the project: the team's accounts again, with the SAME ids as their staff rows (infra-04)
// ---------------------------------------------------------------------------------------------------------------
test('accounts after a lost project: each person of staff.json gets an account with the same id (blocked when deactivated), never touched twice, and can sign in once a password is set', async () => {
  const AUTH = 'http://127.0.0.1:54331/auth/v1';
  const adm = (method, path, body) => fetch(`${AUTH}/admin/users${path}`, { method, headers: { apikey: K.service, authorization: `Bearer ${K.service}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const [a, b, c, d, e] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const mail = (x) => `ops-comptes-${x.slice(0, 8)}@exemple.ca`;
  // « e » already has an account (a person who was invited again): it must stay as it is
  assert.equal((await adm('POST', '', { id: e, email: mail(e), email_confirm: true })).status, 200);
  const comptes = [a, b, e];
  try {
    const dos = dossier('comptes', { staff: [
      { id: a, full_name: 'Alice Active', email: mail(a), active: true, deleted_at: null },
      { id: b, full_name: 'Bob Désactivé', email: mail(b), active: false, deleted_at: null },
      { id: c, full_name: 'Carl Sans Courriel', email: null, active: true, deleted_at: null },
      { id: d, full_name: 'Dan Retiré', email: mail(d), active: true, deleted_at: '2026-11-10T12:00:00Z' },
      { id: e, full_name: 'Eve Déjà Là', email: mail(e), active: true, deleted_at: null },
    ] });
    const env = { SUPABASE_URL: 'http://127.0.0.1:54331', SERVICE_ROLE_KEY: K.service };
    const essai = await lancer('restaurer-comptes.mjs', [dos, '--essai'], env);
    assert.match(essai.out, /ESSAI : rien n'a été fait/);
    assert.equal((await q(`select count(*)::int n from auth.users where id = any($1)`, [[a, b]]))[0].n, 0, 'the try makes nothing');
    const r = await lancer('restaurer-comptes.mjs', [dos], env);
    assert.equal(r.code, 1, 'a person without e-mail is a problem to fix by hand: said, and the run is red');
    assert.match(r.out, /créés \(1\) : Alice Active/);
    assert.match(r.out, /créés bloqués \(désactivés\) \(1\) : Bob Désactivé/);
    assert.match(r.out, /déjà là, pas touchés \(1\) : Eve Déjà Là/);
    assert.match(r.out, /SANS COURRIEL .* Carl Sans Courriel/);
    const u = await q(`select id::text, email, banned_until from auth.users where id = any($1) order by email`, [[a, b, c, d]]);
    assert.deepEqual(u.map((x) => x.id).sort(), [a, b].sort(), 'the same ids as the staff rows; nobody deleted, nobody without e-mail');
    assert.equal(u.find((x) => x.id === a).email, mail(a));
    assert.equal(u.find((x) => x.id === a).banned_until, null);
    assert.ok(new Date(u.find((x) => x.id === b).banned_until) > new Date('2100-01-01'), 'a deactivated person is blocked');
    // a second run touches nothing
    const r2 = await lancer('restaurer-comptes.mjs', [dos], env);
    assert.match(r2.out, /déjà là, pas touchés \(3\)/);
    // the account works: once a password is set (« Mot de passe oublié » does it in the app), the person signs in
    assert.equal((await adm('PUT', `/${a}`, { password: 'Garage-2026-ok' })).status, 200);
    const s = await fetch(`${AUTH}/token?grant_type=password`, { method: 'POST', headers: { apikey: K.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: mail(a), password: 'Garage-2026-ok' }) });
    assert.equal(s.status, 200);
    assert.equal((await s.json()).user.id, a, 'signed in under the id of the staff row');
    // without the address or the key: said, nothing done
    const m = await lancer('restaurer-comptes.mjs', [dos], { SUPABASE_URL: '', SERVICE_ROLE_KEY: '' });
    assert.equal(m.code, 1); assert.match(m.err, /il faut SUPABASE_URL/);
  } finally {
    await q(`delete from auth.users where id = any($1)`, [comptes]);
  }
});

test('the nightly backup says (a warning, never a failure) when a person of the team has no e-mail: her account could not be made again', async () => {
  const s = await faux((quoi, b) => {
    if (b.action === 'tables') return [200, { ok: true, at: 'x', tables: [{ name: 'staff', count: 3 }] }];
    if (b.action === 'rows') return [200, { ok: true, rows: [{ id: '1', full_name: 'Avec', email: 'a@exemple.ca', deleted_at: null }, { id: '2', full_name: 'Sans Courriel', email: null, deleted_at: null }, { id: '3', full_name: 'Retiré', email: null, deleted_at: '2026-11-01T00:00:00Z' }], next: null }];
    return [400, { ok: false, code: 'action', error: 'Action inconnue.' }];
  });
  const r = await lancer('sauvegarde.mjs', [join(dir, 'sans-courriel', 'donnees')], s.env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /ATTENTION : staff : Sans Courriel n'a pas de courriel/);
  assert.ok(!/Retiré/.test(r.out), 'a person removed from the team is not counted');
  await s.fermer();
});

test('the schema of the night: when the server tells its last migration, the copy keeps it and the restore says it', async () => {
  const s = await faux((quoi, b) => {
    if (b.action === 'tables') return [200, { ok: true, at: '2026-11-16T08:23:00.000Z', schema: '20261116000050', tables: [{ name: 'customers', count: 1 }] }];
    if (b.action === 'rows') return [200, { ok: true, rows: [{ id: randomUUID(), first_name: 'Schéma' }], next: null }];
    return [400, { ok: false, code: 'action', error: 'Action inconnue.' }];
  });
  const dos = join(dir, 'schema', 'donnees');
  const r = await lancer('sauvegarde.mjs', [dos], s.env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(lire(dos, '_resume.json').schema, '20261116000050');
  const sql = await lancer('restaurer.mjs', [dos]);
  assert.equal(sql.code, 0, sql.err);
  assert.match(sql.out, /-- Schéma de la base le soir de la sauvegarde : "20261116000050"/);
  await s.fermer();
});

// ---------------------------------------------------------------------------------------------------------------
// The lost project, rehearsed: a NEW database made from the migrations, a whole night restored into it (rapprochement-03)
// ---------------------------------------------------------------------------------------------------------------
test('a lost project: a whole night restored with --neuve into a NEW database made from the migrations gives back every table, the garage\'s settings and numbers, and the reconciliation reads the same books', async () => {
  const nom = `ops_repetition_${process.pid}_${Date.now()}`;
  const P = (args, input) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '54332', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-d', nom, ...args],
    { encoding: 'utf8', input, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  const avant = (await q(`select to_jsonb(s) j from public.settings s where id = 1`))[0].j;
  const neuf = new pg.Pool({ host: '127.0.0.1', port: 54332, user: 'postgres', database: nom, max: 1 });
  const nq = async (sql, p = []) => (await neuf.query(sql, p)).rows;
  await q(`create database ${nom}`);
  try {
    // the garage's own settings (what a new project's migrations do not have), and a customer of its own
    await q(`update public.settings set company = company || '{"name": "Mécanique Mobile (répétition)"}',
                     billing = billing || '{"invoice_prefix": "HIS-"}',
                     booking = jsonb_set(booking || '{"home": {"label": "Centrale (sauvegarde)"}}', '{web}', coalesce(booking->'web', '{}'::jsonb) || '{"on": false}') where id = 1`);
    clients.push((await q(`insert into public.customers (first_name, phone, notes) values ('Répétition', '4385550299', 'perte du projet') returning id`))[0].id);
    // the night, made by the nightly script against this copy's « backup » function
    const dos = join(dir, 'repetition', 'donnees');
    const r = await lancer('sauvegarde.mjs', [dos], VRAI);
    assert.equal(r.code, 0, r.out + r.err);
    const resume = lire(dos, '_resume.json');
    assert.ok('ops_recon_baseline' in resume.tables, 'the backup holds the reconciliation\'s starting point');
    const ici = (await q(`select to_jsonb(s) j from public.settings s where id = 1`))[0].j;

    // a new project: what Supabase has (roles, the auth schema), then every migration, in order
    P(['-f', join(ROOT, 'tests/stack/base.sql')]);
    P(['-c', `alter database ${nom} set search_path to "$user", public, extensions`]);
    P(['-c', 'drop schema auth cascade']);
    P([], execFileSync('pg_dump', ['-h', '127.0.0.1', '-p', '54332', '-U', 'postgres', '-s', '-n', 'auth', 'postgres'], { encoding: 'utf8', maxBuffer: 1 << 28 }));
    for (const f of readdirSync(join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql')).sort()) P(['-f', join(ROOT, 'supabase/migrations', f)]);
    // restaurer-comptes.mjs, played here: the team's accounts with the same ids (the real script talks to the project's Auth)
    for (const s of lire(dos, 'staff.json')) await nq(`insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated') on conflict do nothing`, [s.id, s.email || null]);

    const ecrit = async (args) => { const x = await lancer('restaurer.mjs', [dos, ...args]); assert.equal(x.code, 0, x.err); const f = join(dir, `rep-${randomUUID()}.sql`); writeFileSync(f, x.out); return f; };
    // the default mode in a new project would keep the migrations' settings: it stops, says --neuve, and changes nothing
    const defaut = await ecrit([]);
    assert.throws(() => P(['-f', defaut]), (e) => /c'est un projet neuf\. Refais le fichier avec --neuve/.test(String(e.stderr)));
    assert.equal((await nq(`select count(*)::int n from public.customers`))[0].n, 0, 'nothing was written');
    // --neuve: everything
    const tout = await ecrit(['--neuve']);
    P(['-f', tout]);
    for (const [t, n] of Object.entries(resume.tables)) assert.equal((await nq(`select count(*)::int n from public.${t}`))[0].n, n, `${t}: every row of the night`);
    const la = (await nq(`select to_jsonb(s) j from public.settings s where id = 1`))[0].j;
    assert.deepEqual(la, ici, 'the garage\'s settings, as they were (company, invoice prefix, booking, web.on, rights…)');
    assert.equal(la.booking.web.on, false, 'online booking stays closed as the owner left it (the migration opens it)');
    assert.deepEqual(await nq(`select name, next_value from public.counters order by name`), await q(`select name, next_value from public.counters order by name`), 'the invoice counter');
    const maxJob = (await nq(`select coalesce(max(number), 0)::bigint m from public.jobs`))[0].m;
    assert.ok(Number((await nq(`select last_value from public.job_number_seq`))[0].last_value) >= Number(maxJob), 'the next job takes a new number');
    // the reconciliation reads the same books in both (same differences, same day's sheet), and none of its checks breaks
    const recon = async (f) => { const v = (await f(`select public.recon_collect(public.local_today() - 1) v`))[0].v; return { f: v.findings.map((x) => [x.c, x.s, x.t, x.e, x.k].join('|')).sort(), sheet: v.sheet }; };
    const [a, b] = [await recon(q), await recon(nq)];
    assert.deepEqual(b.f.filter((x) => /\.error\|/.test(x)), [], 'no check of the reconciliation breaks on the restored base');
    assert.deepEqual(b.f, a.f, 'the same differences');
    assert.deepEqual(b.sheet, a.sheet, 'the same sheet of the day');
    // a second --neuve on a base that is no longer new: refused, nothing changed
    assert.throws(() => P(['-f', tout]), (e) => /cette base n'est pas neuve/.test(String(e.stderr)));
  } finally {
    await neuf.end();
    await q(`drop database if exists ${nom} with (force)`);
    await q(`update public.settings s set company = ($1::jsonb)->'company', billing = ($1::jsonb)->'billing', booking = ($1::jsonb)->'booking' where id = 1`, [avant]);
  }
});
