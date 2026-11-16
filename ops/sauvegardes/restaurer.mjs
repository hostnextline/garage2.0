// Restaurer une sauvegarde : écrit un fichier SQL à faire tourner sur la base du garage (psql, ou l'éditeur SQL
// de Supabase), table par table, sans déclencher les automatismes (heures, réorganisation, inventaire) :
//   node restaurer.mjs [dossier] [--tables customers,vehicles] [--remplacer] > restauration.sql
// Par défaut, seules les lignes qui manquent reviennent (rien de plus récent n'est écrasé).
// --remplacer : les lignes de la sauvegarde remplacent aussi celles qui existent. Rien n'est jamais effacé : ce qui
//   a été créé après la sauvegarde reste (le README dit exactement ce que ça fait et ne fait pas).
// Un fichier de la sauvegarde que ce script ne connaît pas est une ERREUR, pas un oubli silencieux : une table
// sauvegardée doit être dans ORDRE (ou nommée à part avec --tables).
// Les photos (attachments) : une instruction par photo. L'image vient de son fichier, photos/<id>.<ext>, ou de sa
// ligne quand la sauvegarde date d'avant (attachments.json gardait alors chaque photo dans « data »).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let DOSSIER = 'donnees', seulement = null, remplacer = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--remplacer') remplacer = true;
  else if (a === '--tables') seulement = String(process.argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
  else if (a.startsWith('--')) arreter(`Option inconnue : ${a}\n  node restaurer.mjs [dossier] [--tables customers,vehicles] [--remplacer] > restauration.sql`);
  else DOSSIER = a;
}
/** every table of a backup, in the order a restore loads them (the same list as TABLES of the « backup » function,
    plus the tables of the daily reconciliation) */
const ORDRE = ['settings', 'counters', 'staff', 'trucks', 'truck_week', 'truck_days', 'services', 'inventory_items', 'service_parts', 'engine_specs',
  'customers', 'customer_notes', 'vehicles', 'quotes', 'jobs', 'job_items', 'invoices', 'payments', 'expenses', 'inventory_moves',
  'shifts', 'trips', 'messages', 'public_links', 'invitations', 'activity', 'attachments',
  'coffre', 'positions', 'position_log', 'op_log', 'stripe_events', 'hermes_questions',
  'ops_backup_runs', 'ops_recon_runs', 'ops_recon_findings'];
const PAQUET = 500;
const dollar = (s) => { let tag = 'r'; while (s.includes(`$${tag}$`)) tag += 'x'; return `$${tag}$${s}$${tag}$`; };
/** the file of a picture, by its kind (the names sauvegarde.mjs writes) */
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf' };

function arreter(message) {
  process.stderr.write(`ERREUR : ${message}\nAucune restauration n'a été écrite en entier : ne te sers pas du fichier SQL.\n`);
  process.exit(1);
}
/** a picture's row with its « data » again: read from its file, unless the row still carries it (a backup of before) */
function avecPhoto(r) {
  if (r.data != null) return r;
  const f = join(DOSSIER, 'photos', `${r.id}.${EXT[r.mime] || 'bin'}`);
  if (!existsSync(f)) arreter(`il manque la photo ${f} : la sauvegarde n'est pas entière (il faut tout le dossier, avec « photos »).`);
  return { ...r, data: readFileSync(f).toString('base64') };
}
// written as it comes, never as one text: with the pictures a restore can weigh more than a text may hold
const ecrire = async (s) => { if (!process.stdout.write(s + '\n')) await new Promise((ok) => process.stdout.once('drain', ok)); };

// ---- what is in the folder, checked BEFORE a line of SQL is written
if (!existsSync(DOSSIER)) arreter(`le dossier ${DOSSIER} n'existe pas.`);
const dedans = readdirSync(DOSSIER, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
const fichiers = dedans.filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== '_resume.json').map((e) => e.name.slice(0, -5));
const autres = dedans.filter((e) => !(e.isFile() && e.name.endsWith('.json')) && !(e.isDirectory() && e.name === 'photos')).map((e) => e.name);
const resume = existsSync(join(DOSSIER, '_resume.json')) ? JSON.parse(readFileSync(join(DOSSIER, '_resume.json'), 'utf8')) : null;
const pasConnus = fichiers.filter((t) => !ORDRE.includes(t)).map((t) => `${t}.json`).concat(autres);
const fautes = [];
if (seulement) {
  if (!seulement.length) fautes.push('--tables demande au moins un nom de table (--tables customers,vehicles).');
  for (const t of seulement) {
    if (!ORDRE.includes(t)) fautes.push(`« ${t} » n'est pas une table que restaurer.mjs connaît (les tables : ${ORDRE.join(', ')}).`);
    else if (!fichiers.includes(t)) fautes.push(`${t}.json n'est pas dans ${DOSSIER} : rien à restaurer pour « ${t} ».`);
  }
  if (pasConnus.length) process.stderr.write(`À savoir : ${pasConnus.join(', ')} dans ${DOSSIER} ne ${pasConnus.length > 1 ? 'sont' : 'est'} pas dans la liste de restaurer.mjs (sans effet ici : seules les tables nommées sont restaurées).\n`);
} else {
  for (const f of pasConnus) fautes.push(`${f} est dans la sauvegarde mais restaurer.mjs ne le connaît pas : ses données ne reviendraient pas. Ajoute la table à ORDRE (à sa place : après les tables dont elle dépend), ou restaure seulement ce que tu veux avec --tables.`);
  if (resume) for (const t of Object.keys(resume.tables || {})) if (!fichiers.includes(t)) fautes.push(`_resume.json annonce la table « ${t} » (${resume.tables[t]} lignes) mais ${t}.json manque : la sauvegarde n'est pas entière.`);
  if (!fichiers.length) fautes.push(`aucune table dans ${DOSSIER} (les fichiers <table>.json).`);
}
if (fautes.length) arreter(fautes.join('\n         '));
if (!resume) process.stderr.write(`À savoir : pas de _resume.json dans ${DOSSIER} : le nombre de lignes de chaque table ne peut pas être vérifié.\n`);

const tables = ORDRE.filter((t) => fichiers.includes(t) && (!seulement || seulement.includes(t)));
await ecrire('-- Restauration de la sauvegarde du ' + (resume ? resume.quand : '?'));
await ecrire(`-- Tables : ${tables.join(', ')}`);
await ecrire(`-- ${remplacer ? 'AVEC --remplacer : les lignes de la sauvegarde remplacent celles de la base qui ont la même clé ; rien n’est effacé.' : 'Seules les lignes qui manquent reviennent ; rien n’est écrasé, rien n’est effacé.'}`);
await ecrire('begin;');
await ecrire("set local session_replication_role = replica;  -- sans les automatismes : les données reviennent telles quelles");
// the key of each table is read from the database itself (its primary key): no second list to keep in step.
// « distinct on »: a row that an old backup holds twice (a table that changed while it was read) is written once.
await ecrire(`create or replace function pg_temp.remettre(p_table text, p_rows jsonb, p_remplacer boolean) returns int language plpgsql as $f$
declare cols text; maj text; cle text; n int;
begin
  select string_agg(quote_ident(a.attname), ', ' order by k.ord) into cle
    from pg_index i cross join lateral unnest(i.indkey) with ordinality k(att, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.att
   where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  if cle is null then raise exception 'restauration : la table % n''a pas de clé primaire', p_table; end if;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg(format('%1$I = excluded.%1$I', column_name), ', ' order by ordinal_position)
    into cols, maj
    from information_schema.columns where table_schema = 'public' and table_name = p_table and is_generated = 'NEVER';
  execute format('insert into public.%I (%s) select distinct on (%s) %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%s) do '
                 || case when p_remplacer then 'update set ' || maj else 'nothing' end, p_table, cols, cle, cols, p_table, cle) using p_rows;
  get diagnostics n = row_count;
  return n;
end $f$;`);
for (const t of tables) {
  const rows = JSON.parse(readFileSync(join(DOSSIER, `${t}.json`), 'utf8'));
  if (!Array.isArray(rows)) arreter(`${t}.json n'est pas une liste de lignes.`);
  if (resume && resume.tables && t in resume.tables && rows.length !== resume.tables[t]) arreter(`${t}.json a ${rows.length} lignes, _resume.json en annonce ${resume.tables[t]} : la sauvegarde n'est pas entière.`);
  const photos = t === 'attachments';   // a picture is heavy: one statement each
  for (let i = 0; i < rows.length; i += photos ? 1 : PAQUET) {
    const lot = photos ? [avecPhoto(rows[i])] : rows.slice(i, i + PAQUET);
    await ecrire(`select '${t}' as table_, pg_temp.remettre('${t}', ${dollar(JSON.stringify(lot))}::jsonb, ${remplacer}) as lignes;`);
  }
}
// the counters never go back below a number already given (no invoice number twice)
await ecrire(`update public.counters c set next_value = greatest(c.next_value, coalesce((select max(number) + 1 from public.invoices), 1)) where c.name = 'invoice';`);
await ecrire(`select setval('public.job_number_seq', greatest((select coalesce(max(number), 0) from public.jobs), 1));`);
await ecrire(`select setval('public.quote_number_seq', greatest((select coalesce(max(number), 0) from public.quotes), 1));`);
await ecrire('commit;');
