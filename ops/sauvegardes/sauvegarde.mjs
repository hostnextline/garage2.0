// Sauvegarde du garage — runs every night in the PRIVATE repository hostnextline/garage2.0-sauvegardes.
// GitHub gives this job a short signed ticket (OIDC): no password is stored anywhere. The garage's « backup »
// function checks the ticket and hands out every table, page by page. Each table is written to donnees/<table>.json,
// one row per line (so the history of the repository shows what changed from one night to the next).
// Run by hand (tests): FONCTION=… CLE=… TICKET_URL=… node sauvegarde.mjs [dossier]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FONCTION = process.env.FONCTION || 'https://wyxvizxabqgvsiiemvfw.supabase.co/functions/v1/backup';
const CLE = process.env.CLE || 'sb_publishable_Pzvp2qqc8Y52meAZkczSSg_trH2ZTTA';
const DOSSIER = process.argv[2] || 'donnees';

async function ticket() {
  // inside GitHub Actions: the job's own ticket for our audience; in the tests: TICKET_URL
  const base = process.env.TICKET_URL || process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  if (!base) throw new Error('Pas de ticket GitHub : ce script tourne dans GitHub Actions (permissions: id-token: write).');
  const url = base + (base.includes('?') ? '&' : '?') + 'audience=garage2.0-backup';
  const r = await fetch(url, { headers: { authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || ''}` } });
  if (!r.ok) throw new Error(`GitHub n'a pas donné de ticket (${r.status})`);
  return (await r.json()).value;
}
async function call(body, t) {
  for (let essai = 1; ; essai++) {
    try {
      const r = await fetch(FONCTION, { method: 'POST', headers: { apikey: CLE, 'x-github-oidc': t, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || !d.ok) throw Object.assign(new Error(`${d.code || r.status} : ${d.error || 'refusé'}`), { final: r.status === 401 || r.status === 403 });
      return d;
    } catch (e) {
      if (e.final || essai >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * essai));   // the network hiccups: try again
    }
  }
}

const t0 = await ticket();
const { tables, at } = await call({ action: 'tables' }, t0);
mkdirSync(DOSSIER, { recursive: true });
const resume = { quand: at, tables: {} };
for (const { name, count } of tables) {
  const t = await ticket();   // a fresh ticket for each table (they last a few minutes)
  const rows = [];
  let from = 0;
  for (;;) {
    const page = await call({ action: 'rows', table: name, from }, t);
    rows.push(...page.rows);
    if (page.next == null) break;
    from = page.next;
  }
  if (rows.length < count) throw new Error(`${name} : ${rows.length} lignes reçues, ${count} attendues`);
  writeFileSync(join(DOSSIER, `${name}.json`), rows.length ? '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n' : '[]\n');
  resume.tables[name] = rows.length;
  console.log(`${name.padEnd(16)} ${rows.length}`);
}
writeFileSync(join(DOSSIER, '_resume.json'), JSON.stringify(resume, null, 2) + '\n');
console.log(`Sauvegarde complète (${Object.values(resume.tables).reduce((a, b) => a + b, 0)} lignes).`);
