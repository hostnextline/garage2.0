// Restaurer une sauvegarde : écrit un fichier SQL à faire tourner sur la base du garage (psql, ou l'éditeur SQL
// de Supabase), table par table, sans déclencher les automatismes (heures, réorganisation, inventaire) :
//   node restaurer.mjs [dossier] [--tables customers,vehicles] [--remplacer] > restauration.sql
// Par défaut, seules les lignes qui manquent reviennent (rien de plus récent n'est écrasé).
// --remplacer : les lignes de la sauvegarde remplacent aussi celles qui existent (retour en arrière complet).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let DOSSIER = 'donnees', seulement = null, remplacer = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--remplacer') remplacer = true;
  else if (a === '--tables') seulement = String(process.argv[++i] || '').split(',').filter(Boolean);
  else DOSSIER = a;
}
const ORDRE = ['settings', 'counters', 'staff', 'trucks', 'truck_week', 'truck_days', 'services', 'inventory_items', 'service_parts', 'engine_specs',
  'customers', 'customer_notes', 'vehicles', 'quotes', 'jobs', 'job_items', 'invoices', 'payments', 'expenses', 'inventory_moves',
  'shifts', 'trips', 'messages', 'public_links', 'invitations', 'activity', 'attachments',
  'coffre', 'positions', 'position_log', 'op_log', 'stripe_events', 'hermes_questions'];
const CLE = { counters: 'name', op_log: 'op' };
const PAQUET = 500;
const dollar = (s) => { let tag = 'r'; while (s.includes(`$${tag}$`)) tag += 'x'; return `$${tag}$${s}$${tag}$`; };

const out = [];
out.push('-- Restauration de la sauvegarde du ' + (existsSync(join(DOSSIER, '_resume.json')) ? JSON.parse(readFileSync(join(DOSSIER, '_resume.json'), 'utf8')).quand : '?'));
out.push('begin;', "set local session_replication_role = replica;  -- sans les automatismes : les données reviennent telles quelles");
out.push(`create or replace function pg_temp.remettre(p_table text, p_cle text, p_rows jsonb, p_remplacer boolean) returns int language plpgsql as $f$
declare cols text; maj text; n int;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg(format('%1$I = excluded.%1$I', column_name), ', ' order by ordinal_position)
    into cols, maj
    from information_schema.columns where table_schema = 'public' and table_name = p_table and is_generated = 'NEVER';
  execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%I) do '
                 || case when p_remplacer then 'update set ' || maj else 'nothing' end, p_table, cols, cols, p_table, p_cle) using p_rows;
  get diagnostics n = row_count;
  return n;
end $f$;`);
for (const t of ORDRE) {
  if (seulement && !seulement.includes(t)) continue;
  const f = join(DOSSIER, `${t}.json`);
  if (!existsSync(f)) continue;
  const rows = JSON.parse(readFileSync(f, 'utf8'));
  for (let i = 0; i < rows.length; i += PAQUET) {
    out.push(`select '${t}' as table_, pg_temp.remettre('${t}', '${CLE[t] || 'id'}', ${dollar(JSON.stringify(rows.slice(i, i + PAQUET)))}::jsonb, ${remplacer}) as lignes;`);
  }
}
// the counters never go back below a number already given (no invoice number twice)
out.push(`update public.counters c set next_value = greatest(c.next_value, coalesce((select max(number) + 1 from public.invoices), 1)) where c.name = 'invoice';`);
out.push(`select setval('public.job_number_seq', greatest((select coalesce(max(number), 0) from public.jobs), 1));`);
out.push(`select setval('public.quote_number_seq', greatest((select coalesce(max(number), 0) from public.quotes), 1));`);
out.push('commit;');
process.stdout.write(out.join('\n') + '\n');
