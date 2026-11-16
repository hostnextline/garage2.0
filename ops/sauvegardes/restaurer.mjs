// Restaurer une sauvegarde : écrit un fichier SQL à faire tourner sur la base du garage (psql, ou l'éditeur SQL
// de Supabase). Le README dit exactement ce que chaque façon fait et ne fait pas.
//   node restaurer.mjs [dossier] [--tables customers,vehicles] [--ids <id>,<id>] [--remplacer | --retablir] > restauration.sql
// Par défaut, seules les lignes qui manquent dans la base reviennent (rien de plus récent n'est écrasé, rien n'est effacé),
//   sans déclencher les automatismes (heures, réorganisation, inventaire).
// --remplacer : les lignes de la sauvegarde remplacent aussi celles qui existent (même clé). Rien n'est jamais effacé : ce
//   qui a été créé après la sauvegarde reste.
// --retablir : défait l'« Effacer » de l'app (deleted_at remis à vide) sur les lignes qui étaient là le soir de la
//   sauvegarde, automatismes ALLUMÉS (updated_at neuf : les téléphones les revoient). Aucune autre valeur n'est écrite.
// --ids : seulement ces lignes-là (avec --tables) ; un id qui n'est dans aucun des fichiers nommés est une erreur.
// Une sauvegarde faite AVANT qu'une colonne soit ajoutée se restaure : seules les colonnes présentes dans la sauvegarde
// sont écrites (une ligne remise prend la valeur par défaut des autres ; une ligne remplacée garde la sienne).
// Un fichier de la sauvegarde que ce script ne connaît pas est une ERREUR, pas un oubli silencieux : une table
// sauvegardée doit être dans ORDRE (ou nommée à part avec --tables).
// Les photos (attachments) : une instruction par photo. L'image vient de son fichier, photos/<id>.<ext>, ou de sa
// ligne quand la sauvegarde date d'avant (attachments.json gardait alors chaque photo dans « data »).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const USAGE = 'node restaurer.mjs [dossier] [--tables customers,vehicles] [--ids <id>,<id>] [--remplacer | --retablir] > restauration.sql';
let DOSSIER = 'donnees', seulement = null, remplacer = false, retablir = false, ids = null;
const liste = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--remplacer') remplacer = true;
  else if (a === '--retablir') retablir = true;
  else if (a === '--tables') seulement = liste(process.argv[++i]);
  else if (a === '--ids') ids = liste(process.argv[++i]);
  else if (a.startsWith('--')) arreter(`Option inconnue : ${a}\n  ${USAGE}`);
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
if (remplacer && retablir) arreter('--remplacer et --retablir ne vont pas ensemble : choisis l\'un ou l\'autre (le README dit ce que fait chacun).');
if (ids && !seulement) arreter('--ids demande --tables : nomme la ou les tables de ces lignes (--tables customers --ids <id>).');
if (ids && !ids.length) arreter('--ids demande au moins un id (--ids <id>,<id>).');
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
  if (retablir) fautes.push('--retablir demande --tables : nomme les tables où défaire un « Effacer » (--tables customers [--ids <id>]).');
  for (const f of pasConnus) fautes.push(`${f} est dans la sauvegarde mais restaurer.mjs ne le connaît pas : ses données ne reviendraient pas. Ajoute la table à ORDRE (à sa place : après les tables dont elle dépend), ou restaure seulement ce que tu veux avec --tables.`);
  if (resume) for (const t of Object.keys(resume.tables || {})) if (!fichiers.includes(t)) fautes.push(`_resume.json annonce la table « ${t} » (${resume.tables[t]} lignes) mais ${t}.json manque : la sauvegarde n'est pas entière.`);
  if (!fichiers.length) fautes.push(`aucune table dans ${DOSSIER} (les fichiers <table>.json).`);
}
if (fautes.length) arreter(fautes.join('\n         '));
if (!resume) process.stderr.write(`À savoir : pas de _resume.json dans ${DOSSIER} : le nombre de lignes de chaque table ne peut pas être vérifié.\n`);

const tables = ORDRE.filter((t) => fichiers.includes(t) && (!seulement || seulement.includes(t)));
/** the rows of a table as the backup holds them (checked against the summary), then the ones asked for (--ids) */
const lignesDe = {};
const trouves = new Set();
for (const t of tables) {
  const rows = JSON.parse(readFileSync(join(DOSSIER, `${t}.json`), 'utf8'));
  if (!Array.isArray(rows)) arreter(`${t}.json n'est pas une liste de lignes.`);
  if (resume && resume.tables && t in resume.tables && rows.length !== resume.tables[t]) arreter(`${t}.json a ${rows.length} lignes, _resume.json en annonce ${resume.tables[t]} : la sauvegarde n'est pas entière.`);
  lignesDe[t] = ids ? rows.filter((r) => r && ids.includes(String(r.id))) : rows;
  for (const r of lignesDe[t]) trouves.add(String(r.id));
}
if (ids) {
  const absents = ids.filter((x) => !trouves.has(x));
  if (absents.length) arreter(`${absents.length > 1 ? 'ces ids ne sont' : 'cet id n\'est'} dans aucun des fichiers nommés (${tables.map((t) => `${t}.json`).join(', ')}) : ${absents.join(', ')}.`);
}
if (retablir) {
  const fautes2 = [];
  for (const t of tables) {
    const rows = lignesDe[t];
    if (rows.length && !rows.every((r) => 'deleted_at' in r)) { fautes2.push(`« ${t} » n'a pas d'« Effacer » de l'app (pas de colonne deleted_at) : --retablir ne s'y applique pas.`); continue; }
    const dejaEfface = rows.filter((r) => r.deleted_at != null).map((r) => r.id);
    if (ids && dejaEfface.length) fautes2.push(`dans ${t}.json, ${dejaEfface.join(', ')} ${dejaEfface.length > 1 ? 'étaient déjà effacés' : 'était déjà effacé'} le soir de la sauvegarde : rien à rétablir de cette nuit-là (prends une sauvegarde plus ancienne).`);
    lignesDe[t] = rows.filter((r) => r.deleted_at == null);
  }
  if (fautes2.length) arreter(fautes2.join('\n         '));
}

await ecrire('-- Restauration de la sauvegarde du ' + (resume ? resume.quand : '?'));
await ecrire(`-- Tables : ${tables.join(', ')}${ids ? ` — seulement les lignes ${ids.join(', ')}` : ''}`);

if (retablir) {
  // undo the app's « Effacer »: deleted_at back to empty, triggers ON (touch() stamps updated_at: every phone pulls the
  // row again; log_activity notes it). Only rows that were alive that night and are deleted now are changed.
  await ecrire('-- AVEC --retablir : les lignes effacées dans l\'app depuis cette nuit-là reviennent (deleted_at vide) ; aucune autre valeur n\'est écrite, rien n\'est effacé.');
  await ecrire('begin;');
  for (const t of tables) {
    const lst = lignesDe[t].map((r) => String(r.id));
    for (let i = 0; i < lst.length || i === 0; i += PAQUET) {
      const lot = lst.slice(i, i + PAQUET);
      await ecrire(`with r as (update public.${t} set deleted_at = null where id::text in (select jsonb_array_elements_text(${dollar(JSON.stringify(lot))}::jsonb)) and deleted_at is not null returning 1) select '${t}' as table_, count(*) as retablies from r;`);
      if (!lst.length) break;
    }
  }
  await ecrire('commit;');
  process.exit(0);
}

await ecrire(`-- ${remplacer ? 'AVEC --remplacer : les lignes de la sauvegarde remplacent celles de la base qui ont la même clé ; rien n’est effacé.' : 'Seules les lignes qui manquent reviennent ; rien n’est écrasé, rien n’est effacé.'}`);
await ecrire('begin;');
await ecrire("set local session_replication_role = replica;  -- sans les automatismes : les données reviennent telles quelles");
// the key of each table is read from the database itself (its primary key): no second list to keep in step.
// The columns written are those of the BACKUP that the table still has: a column added after that night is not named,
// so a row put back takes its default and a row replaced keeps its own value. A column added since that is required and
// has no default cannot be guessed: the whole restore stops, naming it (nothing is changed).
// Default mode: « on conflict do nothing » on ANY unique key (a row deleted then made again under a new id is skipped,
// not an abort). « distinct on »: a row that an old backup holds twice (a table that changed while it was read) is written once.
await ecrire(`create or replace function pg_temp.remettre(p_table text, p_rows jsonb, p_remplacer boolean) returns int language plpgsql as $f$
declare cols text; maj text; cle text; sans_cle text; requises text; n int;
begin
  select string_agg(quote_ident(a.attname), ', ' order by k.ord),
         string_agg(a.attname, ', ' order by k.ord) filter (where not exists (select 1 from jsonb_array_elements(p_rows) r where r ? a.attname))
    into cle, sans_cle
    from pg_index i cross join lateral unnest(i.indkey) with ordinality k(att, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.att
   where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  if cle is null then raise exception 'restauration : la table % n''a pas de clé primaire', p_table; end if;
  if sans_cle is not null then raise exception 'restauration : dans la sauvegarde, des lignes de % n''ont pas leur clé (%)', p_table, sans_cle; end if;
  select string_agg(format('%s.%s', p_table, c.column_name), ', ' order by c.ordinal_position) into requises
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table and c.is_generated = 'NEVER' and c.is_identity = 'NO'
     and c.is_nullable = 'NO' and c.column_default is null
     and not exists (select 1 from jsonb_array_elements(p_rows) r where r ? c.column_name);
  if requises is not null then
    raise exception 'restauration : la colonne % est obligatoire et sans valeur par défaut, mais elle n''existait pas encore dans cette sauvegarde : choisis sa valeur à la main (rien n''a été changé)', requises;
  end if;
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ' order by c.ordinal_position)
    into cols, maj
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = p_table and c.is_generated = 'NEVER'
     and exists (select 1 from jsonb_array_elements(p_rows) r where r ? c.column_name);
  execute format('insert into public.%I (%s) select distinct on (%s) %s from jsonb_populate_recordset(null::public.%I, $1) on conflict ', p_table, cols, cle, cols, p_table)
          || case when p_remplacer then format('(%s) do update set %s', cle, maj) else 'do nothing' end using p_rows;
  get diagnostics n = row_count;
  if n < jsonb_array_length(p_rows) then
    raise notice '% : % ligne(s) sur % écrite(s) (%)', p_table, n, jsonb_array_length(p_rows),
      case when p_remplacer then 'les autres en double dans la sauvegarde' else 'les autres sont déjà dans la base' end;
  end if;
  return n;
end $f$;`);
for (const t of tables) {
  const rows = lignesDe[t];
  const photos = t === 'attachments';   // a picture is heavy: one statement each
  for (let i = 0; i < rows.length; i += photos ? 1 : PAQUET) {
    const lot = photos ? [avecPhoto(rows[i])] : rows.slice(i, i + PAQUET);
    await ecrire(`select '${t}' as table_, pg_temp.remettre('${t}', ${dollar(JSON.stringify(lot))}::jsonb, ${remplacer}) as lignes;`);
  }
}
// a few rows asked by their id (--ids): their updated_at is made new, so every phone pulls them again (a phone keeps a
// row only when the server's copy is newer than its own). Not for a whole table: until the app pulls by (updated_at, id),
// a thousand rows stamped within two seconds would make the phones read the same page forever.
if (ids && ids.length <= PAQUET) {
  for (const t of tables) {
    if (!lignesDe[t].length || !lignesDe[t].every((r) => 'updated_at' in r)) continue;
    await ecrire(`update public.${t} set updated_at = clock_timestamp() where id::text in (select jsonb_array_elements_text(${dollar(JSON.stringify(lignesDe[t].map((r) => String(r.id))))}::jsonb));  -- les téléphones les revoient`);
  }
}
// numbers never go back below one already given (no invoice, job or quote number twice), and never DOWN either.
// Every sequence a restored table takes its numbers from is found in the database (the bigserial ids of activity and
// position_log, job_number_seq, quote_number_seq…): raised to the highest number restored, never lowered, untouched
// when the table is empty.
await ecrire(`update public.counters c set next_value = greatest(c.next_value, coalesce((select max(number) + 1 from public.invoices), 1)) where c.name = 'invoice';`);
await ecrire(`do $s$
declare r record; v_max bigint; v_last bigint;
begin
  for r in
    select distinct c.relname as t, a.attname as col, s.oid::regclass as seq
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      join pg_class s on s.relkind = 'S' and (
             s.oid = pg_get_serial_sequence(format('public.%I', c.relname), a.attname)::regclass
          or s.oid in (select d.refobjid from pg_attrdef ad join pg_depend d on d.classid = 'pg_attrdef'::regclass and d.objid = ad.oid
                        where ad.adrelid = c.oid and ad.adnum = a.attnum and d.refclassid = 'pg_class'::regclass))
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any(${dollar(`{${tables.join(',')}}`)}::text[])
  loop
    execute format('select max(%I)::bigint from public.%I', r.col, r.t) into v_max;
    execute format('select last_value from %s', r.seq) into v_last;
    if v_max is not null and v_max > v_last then perform setval(r.seq, v_max, true); end if;
  end loop;
end $s$;`);
await ecrire('commit;');
