// Sauvegarde du garage — runs every night in the PRIVATE repository hostnextline/garage2.0-sauvegardes.
// GitHub gives this job a short signed ticket (OIDC): no password is stored anywhere. The garage's « backup »
// function checks the ticket and hands out every table, page by page. Each table is written to donnees/<table>.json,
// one row per line (so the history of the repository shows what changed from one night to the next).
// The pictures (table « attachments ») are heavy: attachments.json holds their rows without the picture, and each
// picture is a file of its own, donnees/photos/<id>.<ext> (GitHub refuses a file over 100 MB: one file holding every
// picture would one day stop every backup).
//
// Two moments of the night, in this order (.github/workflows/sauvegarde.yml):
//   1. node sauvegarde.mjs [dossier]         downloads everything; red when the copy is not whole
//   2. the workflow keeps the copy (git commit, git push)
//   3. node sauvegarde.mjs --fin [dossier]   tells the garage that this night is kept (backup { action: 'done' }), then
//      asks for the daily reconciliation (recon { action: 'run' }); RED when its status is « bad »: GitHub then
//      e-mails the owner. Last, the road times of the coming days (« Vraies routes »: drive { action: 'sweep' }, the same
//      ticket), asked again while the answer says « more », 10 calls at most (the rest the next night; the app of the
//      owner and the office measures too). A server that does not know « done », « recon » or « drive » yet (404,
//      « action »), or whose function is published before its migration (503 « not_ready »): a warning, never a failure.
// Step 3 comes after step 2 on purpose: whatever the reconciliation says, the night's copy is already kept.
// A night that FAILS is told to the garage too (backup { action: 'done', ok: false, tables, rows }: the tables read so
// far): by step 1 itself when the copy is not whole, by « node sauvegarde.mjs --echec [dossier] » when the push is
// refused. Best effort: the night stays red whatever the server answers.
// Run by hand (tests): FONCTION=… CLE=… TICKET_URL=… [RECON=…] [DRIVE=…] [COMMIT=…] node sauvegarde.mjs [--fin | --echec] [dossier]
import { mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, statSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FONCTION = process.env.FONCTION || 'https://wyxvizxabqgvsiiemvfw.supabase.co/functions/v1/backup';
const RECON = process.env.RECON || FONCTION.replace(/\/backup\/?$/, '/recon');
const DRIVE = process.env.DRIVE || FONCTION.replace(/\/backup\/?$/, '/drive');
/** the night's sweeps of the road times: at most this many calls (each stops by itself after ~40 s and says « more ») */
const ROUTES_MAX = 10;
const CLE = process.env.CLE || 'sb_publishable_Pzvp2qqc8Y52meAZkczSSg_trH2ZTTA';
const args = process.argv.slice(2);
const FIN = args.includes('--fin');
const ECHEC = args.includes('--echec');
const inconnue = args.find((a) => a.startsWith('--') && a !== '--fin' && a !== '--echec');
if (inconnue || (FIN && ECHEC)) { console.error(`Option inconnue : ${inconnue || '--fin avec --echec'}  (node sauvegarde.mjs [--fin | --echec] [dossier])`); process.exit(2); }
const DOSSIER = args.find((a) => !a.startsWith('--')) || 'donnees';
/** the key of a row (what the server orders the pages by): two rows with the same key are the same row read twice */
const CLE_DE = { counters: 'name', op_log: 'op' };
/** the file of a picture, by its kind (restaurer.mjs reads the same names) */
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' };
const fichier = (r) => `${r.id}.${EXT[r.mime] || 'bin'}`;
const MO = 1024 * 1024;
const GROS = Number(process.env.FICHIER_GROS_MO || 50) * MO;   // GitHub warns from 50 MB
const TROP = Number(process.env.FICHIER_MAX_MO || 95) * MO;    // and refuses the whole push at 100 MB
const ATTENTE = Number(process.env.ATTENTE_MS || 2000);         // between two tries (the tests set it shorter)
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const avis = (s) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${s}` : `ATTENTION : ${s}`);

async function ticket() {
  // inside GitHub Actions: the job's own ticket for our audience; in the tests: TICKET_URL
  const base = process.env.TICKET_URL || process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  if (!base) throw new Error('Pas de ticket GitHub : ce script tourne dans GitHub Actions (permissions: id-token: write).');
  const url = base + (base.includes('?') ? '&' : '?') + 'audience=garage2.0-backup';
  const r = await fetch(url, { headers: { authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || ''}` }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`GitHub n'a pas donné de ticket (${r.status})`);
  return (await r.json()).value;
}
// a ticket lasts a few minutes: never one older than two (a long table, many pictures)
let dernier = { t: '', pris: 0 };
async function frais() {
  if (!dernier.t || Date.now() - dernier.pris > 120000) dernier = { t: await ticket(), pris: Date.now() };
  return dernier.t;
}
/** one call of a server function. « pasEncore »: a server that does not know this function or this action yet is not
    an error (it answers { pasEncore: true }); anything else that fails is tried again, then thrown */
async function call(body, t, { url = FONCTION, pasEncore = false } = {}) {
  for (let essai = 1; ; essai++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { apikey: CLE, 'x-github-oidc': t, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      let d;
      try { d = await r.json(); } catch { d = {}; }
      // 404: no such function; « action »: a function of before; « not_ready » (503): the function is newer than the
      // database (its migration is not applied yet). None of the three is tried again.
      if (pasEncore && (r.status === 404 || d.code === 'action' || d.code === 'not_ready')) return { pasEncore: true, status: r.status };
      if (!r.ok || !d.ok) throw Object.assign(new Error(`${d.code || r.status} : ${d.error || 'refusé'}`), { final: r.status === 401 || r.status === 403 });
      return d;
    } catch (e) {
      if (e.final || essai >= 4) throw e;
      await dormir(ATTENTE * essai);   // the network hiccups: try again
    }
  }
}

/** the pictures of one page of « attachments »: each becomes a file of photos/ and leaves its row. A server of before
    sends the picture in its row; a newer one ({ light: true }) sends the row alone, and the picture is asked once. */
async function photos(rows, etat) {
  const dir = join(DOSSIER, 'photos');
  mkdirSync(dir, { recursive: true });
  for (const r of rows) {
    const f = join(dir, fichier(r));
    let data = r.data;
    if (data == null) {
      // already there, and the size the row tells (about: 3 bytes for 4 characters): never asked again
      if (existsSync(f) && (typeof r.bytes !== 'number' || Math.abs(statSync(f).size - r.bytes) <= 3)) continue;
      data = (await call({ action: 'picture', id: r.id }, await frais())).data;
    }
    const octets = Buffer.from(String(data), 'base64');
    // a « data » that is not plain base64 would not come back the same from a file: it stays in its row, as before
    if (octets.toString('base64') !== data) { r.data = data; etat.dedans++; continue; }
    delete r.data;
    if (existsSync(f) && readFileSync(f).equals(octets)) continue;
    writeFileSync(f + '.part', octets);
    renameSync(f + '.part', f);   // under its name only once it is whole
    etat.nouvelles++;
  }
}
/** every row of a table, page by page */
async function pages(name, etat) {
  const photo = name === 'attachments';
  const rows = [];
  let from = 0, limit = photo ? 20 : undefined;   // whole pictures are heavy: few a page
  for (;;) {
    const page = await call({ action: 'rows', table: name, from, ...(photo ? { light: true } : {}), ...(limit ? { limit } : {}) }, await frais());
    if (photo) {
      if (page.rows.length && !page.rows.some((r) => 'data' in r)) limit = 1000;   // rows without their picture are light
      await photos(page.rows, etat);
    }
    rows.push(...page.rows);
    if (page.next == null) break;
    from = page.next;
  }
  return rows;
}
/** a table, whole. The server reads pages by position: a row added or removed while the table is read shifts the next
    page (a row read twice, or one never read). Twice the same key, or fewer rows than counted just before: the table
    is read again with a fresh count, 3 times at most. */
async function table(name, count) {
  for (let essai = 1; ; essai++) {
    const etat = { nouvelles: 0, dedans: 0 };
    const recues = await pages(name, etat);
    const parCle = new Map();
    for (const r of recues) { const k = CLE_DE[name] || 'id'; parCle.set(k in r ? String(r[k]) : JSON.stringify(r), r); }
    const rows = [...parCle.values()];
    const doubles = recues.length - rows.length;
    if (!doubles && rows.length >= count) return { rows, etat };   // the usual night
    const attendues = count;
    const t = (await call({ action: 'tables' }, await frais())).tables.find((x) => x.name === name);
    if (t) count = t.count;
    if (essai >= 3) {
      if (rows.length < count) throw new Error(`${name} : ${rows.length} lignes reçues, ${count} attendues`);
      avis(`${name} : la table a changé pendant chacune des ${essai} lectures${doubles ? ` (${doubles} ligne${doubles > 1 ? 's' : ''} en double, gardée${doubles > 1 ? 's' : ''} une seule fois)` : ''}. Elle est gardée telle que lue la dernière fois.`);
      return { rows, etat };
    }
    console.log(`${name.padEnd(16)} a changé pendant la lecture (${rows.length} lignes${doubles ? `, ${doubles} en double` : ''}, ${attendues} attendues) : relue`);
    await dormir(ATTENTE);
  }
}
/** every file of the copy, with its size */
function tailles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) tailles(f, out); else out.push({ f, taille: statSync(f).size });
  }
  return out;
}

/** the tables read whole so far this night (what a failed night tells the garage) */
const lues = {};
async function copier() {
  const { tables, at, schema } = await call({ action: 'tables' }, await frais());
  mkdirSync(DOSSIER, { recursive: true });
  // « schema »: the last migration of the server, when the function tells it (a server of before does not): the restore
  // then says which schema the copy belongs to
  const resume = { quand: at, ...(schema != null ? { schema } : {}), tables: {} };
  for (const { name, count } of tables) {
    const { rows, etat } = await table(name, count);
    writeFileSync(join(DOSSIER, `${name}.json`), rows.length ? '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n' : '[]\n');
    resume.tables[name] = rows.length;
    lues[name] = rows.length;
    console.log(`${name.padEnd(16)} ${rows.length}`);
    if (name === 'staff') {
      // after the loss of the project, an account is made again from its staff row (restaurer-comptes.mjs): a person
      // without an e-mail could not get hers. Said every night (a warning: the backup itself is whole).
      const sans = rows.filter((r) => r && r.deleted_at == null && !r.email);
      if (sans.length) avis(`staff : ${sans.map((r) => r.full_name || r.id).join(', ')} ${sans.length > 1 ? "n'ont" : "n'a"} pas de courriel : après la perte du projet, son compte ne pourrait pas être refait (restaurer-comptes.mjs). Ajouter le courriel dans Réglages → Équipe.`);
    }
    if (name === 'attachments') {
      // read back from the disk: a row without its picture, and this backup is refused
      const dir = join(DOSSIER, 'photos');
      const sur = new Set(existsSync(dir) ? readdirSync(dir) : []);
      const manque = rows.filter((r) => r.data == null && !sur.has(fichier(r)));
      if (manque.length) throw new Error(`photos : ${manque.length} sur ${rows.length} ne sont pas dans ${dir} (la première : ${manque[0].id})`);
      resume.photos = rows.filter((r) => r.data == null).length;
      console.log(`${'photos'.padEnd(16)} ${resume.photos} (${etat.nouvelles ? `${etat.nouvelles} nouvelle${etat.nouvelles > 1 ? 's' : ''} ou changée${etat.nouvelles > 1 ? 's' : ''}` : 'aucune nouvelle'})`);
      if (etat.dedans) console.log(`${''.padEnd(16)} ${etat.dedans} restée${etat.dedans > 1 ? 's' : ''} dans attachments.json (pas du base64 simple)`);
    }
  }
  // which scripts made this copy (to compare with ops/sauvegardes of the app's repository: shasum -a 256)
  const ici = fileURLToPath(new URL('.', import.meta.url));
  resume.scripts = {};
  for (const s of ['sauvegarde.mjs', 'restaurer.mjs']) if (existsSync(join(ici, s))) resume.scripts[s] = createHash('sha256').update(readFileSync(join(ici, s))).digest('hex');
  writeFileSync(join(DOSSIER, '_resume.json'), JSON.stringify(resume, null, 2) + '\n');
  // GitHub refuses a push that holds a file over 100 MB, and with it the whole night: said here, in plain words
  const lourds = tailles(DOSSIER).filter((x) => x.taille >= GROS).sort((a, b) => b.taille - a.taille);
  for (const x of lourds.filter((x) => x.taille < TROP)) avis(`${x.f} pèse ${Math.round(x.taille / MO)} Mo : GitHub refuse un fichier de plus de 100 Mo. À alléger avant d'y arriver.`);
  const trop = lourds.filter((x) => x.taille >= TROP);
  if (trop.length) throw new Error(`${trop[0].f} pèse ${Math.round(trop[0].taille / MO)} Mo : GitHub refuserait toute la sauvegarde de cette nuit (limite de 100 Mo par fichier). Rien n'est gardé tant que ce fichier n'est pas allégé.`);
  console.log(`Sauvegarde complète (${Object.values(resume.tables).reduce((a, b) => a + b, 0)} lignes).`);
}

/** after the copy is kept: the garage is told, then the daily reconciliation runs. Returns the exit code. */
async function finir() {
  const f = join(DOSSIER, '_resume.json');
  if (!existsSync(f)) throw new Error(`Pas de sauvegarde à déclarer : ${f} n'existe pas (l'étape 1 n'a pas fini).`);
  const resume = JSON.parse(readFileSync(f, 'utf8'));
  const rows = Object.values(resume.tables).reduce((a, b) => a + b, 0);
  let commit = process.env.COMMIT || '';
  if (!commit) { try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { commit = process.env.GITHUB_SHA || ''; } }
  const lignes = [];
  const dire = (s) => { console.log(s); lignes.push(s); };
  let rouge = 0;
  // 1. this night is kept: the garage writes it down (the app and the reconciliation know the age of the last backup)
  try {
    const d = await call({ action: 'done', tables: resume.tables, rows, commit: commit || null }, await frais(), { pasEncore: true });
    if (d.pasEncore) avis('Le serveur ne connaît pas encore « backup done » : la sauvegarde est gardée, mais le garage ne le note pas. (Fonction « backup » à mettre à jour.)');
    else dire(`Sauvegarde notée au garage : ${Object.keys(resume.tables).length} tables, ${rows} lignes${commit ? `, commit ${commit.slice(0, 7)}` : ''}.`);
  } catch (e) {
    rouge = 1;
    dire(`ERREUR : la sauvegarde est gardée, mais le garage n'a pas pu la noter (${e.message}).`);
  }
  // 2. the daily reconciliation
  try {
    const d = await call({ action: 'run' }, await frais(), { url: RECON, pasEncore: true });
    if (d.pasEncore) avis('Le serveur ne connaît pas encore le rapprochement (fonction « recon ») : rien n’a été vérifié cette nuit.');
    else {
      const statut = d.status ?? d.run?.status ?? null;
      const ecarts = Array.isArray(d.findings) ? d.findings : Array.isArray(d.run?.findings) ? d.run.findings : [];
      if (statut === 'bad') {
        rouge = 1;
        dire(`RAPPROCHEMENT : des écarts à regarder (statut « bad »${ecarts.length ? `, ${ecarts.length} écart${ecarts.length > 1 ? 's' : ''}` : ''}). La sauvegarde de cette nuit est gardée. Ouvre l'app : Trésorerie, « Rapprochement ».`);
        for (const x of ecarts.slice(0, 20)) dire(`  - ${x.severity ? `[${x.severity}] ` : ''}${x.message_fr || x.message || x.check || x.key || JSON.stringify(x)}`);
      } else if (statut == null) avis('Le rapprochement a répondu sans statut : rien à dire de cette nuit.');
      else dire(`Rapprochement : ${statut === 'ok' ? 'tout balance' : `statut « ${statut} »`}.`);
    }
  } catch (e) {
    rouge = 1;
    dire(`ERREUR : le rapprochement n'a pas pu se faire (${e.message}). La sauvegarde de cette nuit est gardée.`);
  }
  // 3. the road times of the coming days (« Vraies routes »), last: what the planner counts once the real roads are on.
  //    The function measures what is missing (never what the caller says) and stops by itself (~40 s, « more »)
  try {
    let d = null, appels = 0, mesures = 0;
    // (final-critic W2) the appointments a sweep made late (their arrival now after the window or block told to the
    // customer): named in the morning's summary until a screen lists them (the job's number and day, never a name)
    const retard = new Map();
    for (;;) {
      d = await call({ action: 'sweep' }, await frais(), { url: DRIVE, pasEncore: true });
      appels++;
      if (d.pasEncore) break;
      mesures += Number(d.stored) || 0;
      for (const id of Array.isArray(d.late) ? d.late : []) if (!retard.has(String(id))) retard.set(String(id), null);
      for (const j of Array.isArray(d.late_jobs) ? d.late_jobs : []) if (j && j.id) retard.set(String(j.id), j);
      if (d.more !== true || appels >= ROUTES_MAX) break;
    }
    if (d.pasEncore) avis('Le serveur ne connaît pas encore la mesure des routes (fonction « drive ») : rien n’a été mesuré cette nuit.');
    else {
      const reste = Number(d.left) || 0, sans = Number(d.left0) || 0;
      const s = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
      dire(`Routes : ${s(mesures, 'trajet mesuré', 'trajets mesurés')} en ${s(appels, 'appel', 'appels')}. ` + (reste === 0 ? 'Il n’en reste aucun.'
        : `Il en reste ${reste} (dont ${sans} sans aucun temps) : ${d.more === true ? 'la suite la nuit prochaine.' : 'rien de plus à mesurer maintenant.'}`));
      if (d.tomtom === 'refused') avis('TomTom a refusé la clé du serveur (TOMTOM_KEY) : cette nuit, les routes ont été mesurées par OSRM seulement (sans les heures de pointe).');
      if (retard.size) {
        const noms = [...retard.values()].map((j) => (j ? `n° ${j.number ?? '?'} (${j.day}${j.block && j.block !== 'day' ? `, ${j.block}` : ''})` : null));
        const dits = noms.filter(Boolean), autres = noms.length - dits.length;
        const msg = `${s(retard.size, 'rendez-vous arrive', 'rendez-vous arrivent')} maintenant après l’heure dite au client (les vraies routes de cette nuit) : à rappeler. `
          + (dits.length ? dits.join(', ') : '') + (autres ? `${dits.length ? ', et ' : ''}${s(autres, 'autre', 'autres')}` : '') + '.';
        dire(msg);
        avis(msg);
      }
    }
  } catch (e) {
    rouge = 1;
    dire(`ERREUR : les routes n'ont pas pu être mesurées (${e.message}). La sauvegarde de cette nuit est gardée.`);
  }
  if (process.env.GITHUB_STEP_SUMMARY && lignes.length) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, lignes.join('\n\n') + '\n'); } catch { /* the summary is a comfort */ } }
  return rouge;
}

/** a night that failed: the garage writes it down too (ops_backup_runs, ok false), with the tables read whole. Never
    throws, never turns the night green: the answer only changes what is said. */
async function direEchec(tables) {
  const rows = Object.values(tables).reduce((a, b) => a + b, 0);
  try {
    const d = await call({ action: 'done', ok: false, tables, rows, commit: null }, await frais(), { pasEncore: true });
    if (d.pasEncore) avis('Le serveur ne connaît pas encore « backup done » : la nuit ratée n’est pas notée au garage.');
    else console.log(`Nuit ratée notée au garage (${Object.keys(tables).length} tables lues, ${rows} lignes).`);
  } catch (e) {
    console.log(`La nuit ratée n'a pas pu être notée au garage (${e.message}).`);
  }
}

try {
  if (FIN) process.exitCode = await finir();
  else if (ECHEC) {
    // the push was refused (the copy itself was whole): the night's summary says which tables were read
    const f = join(DOSSIER, '_resume.json');
    const resume = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { tables: {} };
    await direEchec(resume.tables || {});
  } else await copier();
} catch (e) {
  console.error(`ERREUR : ${e.message}`);
  process.exitCode = 1;
  if (!FIN && !ECHEC) await direEchec(lues);
}
