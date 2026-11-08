-- Part 24 quinquies: buying stock, paid by the Trésorerie or by the Coffre.
--   inventory_buy(op, item, qty, total, from, vendor, note)
--       the quantity comes into the inventory (a « restock » move) and the money leaves the side chosen:
--       'treasury' → an expense (category « Pièces », taxes of Québec worked out from the total paid, the item's name and
--                    quantity as its description): it counts in the Trésorerie like any expense
--       'coffre'   → a Coffre entry of kind 'purchase': the Coffre's balance goes down (received − spent)
--       'none'     → only the stock (as before)
--       The item's cost becomes the price paid per unit. One transaction: stock and money move together, or neither.
--       Who: the inventory right, or the owner.
--   coffre.kind ('received' | 'purchase'), coffre.item_id, coffre.qty
--   coffre_report: each row says its kind and the item bought; the totals give received, spent and the balance
alter table public.coffre add column if not exists kind text not null default 'received';
alter table public.coffre add column if not exists item_id uuid references public.inventory_items(id) on delete set null;
alter table public.coffre add column if not exists item_name text;
alter table public.coffre add column if not exists qty numeric(12,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'coffre_kind_check') then
    alter table public.coffre add constraint coffre_kind_check check (kind in ('received', 'purchase'));
  end if;
end $$;

-- a quantity in plain words: 5, 4.5, 0.25 (no rounding, no trailing zeros)
create or replace function public.qty_text(p numeric) returns text language sql immutable set search_path = public as $$
  select case when p is null then '' when p = trunc(p) then trunc(p)::text else rtrim(p::text, '0') end
$$;
revoke all on function public.qty_text(numeric) from public, anon, authenticated;
grant execute on function public.qty_text(numeric) to service_role;

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
  if p_qty is null or p_qty <= 0 or p_qty > 100000 then perform public.fail('bad_qty', 'Écris une quantité plus grande que zéro.'); end if;
  if p_from <> 'none' and (p_total_cents is null or p_total_cents <= 0 or p_total_cents > 100000000) then
    perform public.fail('bad_amount', 'Écris le prix payé (le total, taxes incluses).');
  end if;
  select * into it from public.inventory_items where id = p_item and deleted_at is null;
  if not found then perform public.fail('not_found', 'Cet article n’existe plus.'); end if;
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

-- the Coffre report: received, spent (stock bought with Coffre money), and what is left
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
    'balance_cents', (select coalesce(sum(case when kind = 'purchase' then -amount_cents else amount_cents end), 0) from public.coffre where deleted_at is null));
end $$;
revoke all on function public.coffre_report(date, date) from public, anon;
grant execute on function public.coffre_report(date, date) to authenticated, service_role;
