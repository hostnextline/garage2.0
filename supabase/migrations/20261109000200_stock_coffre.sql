-- Part 24 septies: the Coffre's own stock.
--   inventory_items.pool     'garage' (the garage's stock, on the books) or 'coffre' (bought with the Coffre's money: no taxes, no
--                            expense, never in the Trésorerie); chosen when the item is made, never changed afterwards
--   inventory_buy            a Coffre item is paid by the Coffre (or not paid: « Rien »); a garage item by the Trésorerie (or « Rien »)
--   coffre_report            also says what the Coffre's stock is worth (stock_cents, at cost)
alter table public.inventory_items add column if not exists pool text not null default 'garage';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_pool_check') then
    alter table public.inventory_items add constraint inventory_items_pool_check check (pool in ('garage', 'coffre'));
  end if;
end $$;
create or replace function public.inventory_pool_fixed() returns trigger language plpgsql set search_path = public as $$
begin
  if new.pool is distinct from old.pool then perform public.fail('pool_fixed', 'Un article reste dans son stock (garage ou Coffre) : crée-en un nouveau.'); end if;
  return new;
end $$;
drop trigger if exists inventory_pool_fixed on public.inventory_items;
create trigger inventory_pool_fixed before update on public.inventory_items for each row execute function public.inventory_pool_fixed();
revoke all on function public.inventory_pool_fixed() from public, anon, authenticated;

create or replace function public.inventory_buy(p_op uuid, p_item uuid, p_qty numeric, p_total_cents int, p_from text,
  p_vendor text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb := public.op_done(p_op);
  it record; v_move uuid := gen_random_uuid(); v_expense uuid; v_coffre uuid;
  tx jsonb := (select taxes from public.settings where id = 1);
  v_tps numeric; v_tvq numeric; v_sub int; v_tps_c int; v_tvq_c int; v_desc text;
begin
  if v_done is not null then return v_done; end if;
  if not (public.is_owner() or public.can('inventory')) then perform public.fail('not_allowed', 'Tu n’as pas le droit de changer l’inventaire.'); end if;
  if p_from is null or p_from not in ('treasury', 'coffre', 'none') then perform public.fail('bad_from', 'Choisis qui paie : la Trésorerie ou le Coffre.'); end if;
  select * into it from public.inventory_items where id = p_item and deleted_at is null;
  if not found then perform public.fail('not_found', 'Cet article n’existe plus.'); end if;
  -- the Coffre's stock is paid by the Coffre (no taxes, no expense); the garage's stock by the Trésorerie
  if it.pool = 'coffre' and p_from = 'treasury' then perform public.fail('bad_from', 'Un article du Coffre se paie avec l’argent du Coffre.'); end if;
  if it.pool = 'garage' and p_from = 'coffre' then perform public.fail('bad_from', 'Un article du garage se paie par la Trésorerie. Pour l’argent du Coffre, ajoute l’article au stock du Coffre.'); end if;
  if p_qty is null or p_qty <= 0 or p_qty > 100000 then perform public.fail('bad_qty', 'Écris une quantité plus grande que zéro.'); end if;
  if p_from <> 'none' and (p_total_cents is null or p_total_cents <= 0 or p_total_cents > 100000000) then
    perform public.fail('bad_amount', case when it.pool = 'coffre' then 'Écris le prix payé.' else 'Écris le prix payé (le total, taxes incluses).' end);
  end if;
  perform set_config('garage.rpc', 'on', true);
  v_desc := format('%s × %s', public.qty_text(p_qty), it.name);

  insert into public.inventory_moves (id, item_id, delta, reason, note, created_by)
  values (v_move, it.id, p_qty, 'restock',
          nullif(concat_ws(' · ', nullif(trim(coalesce(p_vendor, '')), ''), nullif(trim(coalesce(p_note, '')), ''),
                 case p_from when 'treasury' then 'Payé par la Trésorerie' when 'coffre' then 'Payé par le Coffre' end), ''),
          auth.uid());

  if p_from = 'treasury' then
    if coalesce((tx->>'enabled')::boolean, true) then
      v_tps := coalesce((tx->>'tps')::numeric, 0.05); v_tvq := coalesce((tx->>'tvq')::numeric, 0.09975);
      v_sub := round(p_total_cents / (1 + v_tps + v_tvq));
      v_tps_c := round(v_sub * v_tps);
      v_tvq_c := p_total_cents - v_sub - v_tps_c;
    else
      v_sub := p_total_cents; v_tps_c := 0; v_tvq_c := 0;
    end if;
    insert into public.expenses (day, vendor, category, description, subtotal_cents, tps_cents, tvq_cents, total_cents, notes, created_by)
    values (public.local_today(), nullif(trim(coalesce(p_vendor, '')), ''), 'Pièces', v_desc, v_sub, v_tps_c, v_tvq_c, p_total_cents,
            nullif(trim(coalesce(p_note, '')), ''), auth.uid())
    returning id into v_expense;
  elsif p_from = 'coffre' then
    insert into public.coffre (kind, customer_id, amount_cents, value_cents, received_on, note, item_id, item_name, qty, created_by)
    values ('purchase', null, p_total_cents, 0, public.local_today(),
            nullif(concat_ws(' · ', nullif(trim(coalesce(p_vendor, '')), ''), nullif(trim(coalesce(p_note, '')), '')), ''),
            it.id, it.name, p_qty, auth.uid())
    returning id into v_coffre;
  end if;

  -- the item's cost: what one unit cost this time
  if p_from <> 'none' then
    update public.inventory_items set cost_cents = round(p_total_cents / p_qty) where id = it.id;
  end if;

  return public.op_save(p_op, 'inventory_buy', jsonb_build_object('ok', true, 'move_id', v_move, 'expense_id', v_expense, 'coffre_id', v_coffre,
    'rows', jsonb_build_object(
      'inventory_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.inventory_items x where x.id = it.id),
      'inventory_moves', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.inventory_moves x where x.id = v_move),
      'expenses', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.expenses x where x.id = v_expense))));
end $$;
revoke all on function public.inventory_buy(uuid, uuid, numeric, int, text, text, text) from public, anon;
grant execute on function public.inventory_buy(uuid, uuid, numeric, int, text, text, text) to authenticated, service_role;

create or replace function public.coffre_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not (public.is_owner() or public.can('treasury')) then perform public.fail('not_allowed', 'Tu n’as pas accès au Coffre.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind, 'day', c.received_on, 'customer_id', c.customer_id,
      'customer', case when c.kind = 'purchase' then coalesce(c.item_name, '—')
                       else coalesce(nullif(trim(concat_ws(' ', cu.first_name, cu.last_name)), ''), cu.company, '—') end,
      'item_id', c.item_id, 'qty', c.qty,
      'amount_cents', c.amount_cents, 'value_cents', c.value_cents, 'note', c.note, 'job_ids', to_jsonb(c.job_ids), 'job_numbers', to_jsonb(c.job_numbers),
      'work', case when c.kind = 'purchase' then format('%s × %s', public.qty_text(c.qty), coalesce(c.item_name, ''))
                   else (select coalesce(string_agg(distinct i.description, ', '), '') from public.job_items i
                         where i.job_id = any(c.job_ids) and i.deleted_at is null and i.status in ('planned','done','approved')) end,
      'by', (select coalesce(s.short_name, s.full_name) from public.staff s where s.id = c.created_by))
    order by c.received_on, c.created_at), '[]'::jsonb) into v_rows
  from public.coffre c left join public.customers cu on cu.id = c.customer_id
  where c.deleted_at is null and c.received_on between coalesce(p_from, '2000-01-01') and coalesce(p_to, '2999-12-31');
  return jsonb_build_object('from', p_from, 'to', p_to, 'rows', v_rows,
    'count', jsonb_array_length(v_rows),
    'amount_cents', (select coalesce(sum((x->>'amount_cents')::int), 0) from jsonb_array_elements(v_rows) x where x->>'kind' = 'received'),
    'spent_cents', (select coalesce(sum((x->>'amount_cents')::int), 0) from jsonb_array_elements(v_rows) x where x->>'kind' = 'purchase'),
    'value_cents', (select coalesce(sum((x->>'value_cents')::int), 0) from jsonb_array_elements(v_rows) x),
    -- what is in the Coffre now, since the beginning (not only the period)
    'balance_cents', (select coalesce(sum(case when kind = 'purchase' then -amount_cents else amount_cents end), 0) from public.coffre where deleted_at is null),
    -- the Coffre's own stock, at what it cost (no taxes)
    'stock_cents', (select coalesce(sum(round(greatest(qty, 0) * coalesce(cost_cents, 0))), 0)::int from public.inventory_items where pool = 'coffre' and active and deleted_at is null));
end $$;
revoke all on function public.coffre_report(date, date) from public, anon;
grant execute on function public.coffre_report(date, date) to authenticated, service_role;
