-- Part 26 — « Refonte », the shared base: an operation runs exactly once, even when the same request arrives twice at
-- the same instant.
--
-- Until now every operation started with « v_done := op_done(p_op) » (a read) and ended with op_save (an insert).
-- Two deliveries of the same operation that overlap (two tabs of one account; a request the phone gave up on that
-- lands together with its retry) both read « not done » and both ran: two payments, two stock purchases.
--
-- op_begin CLAIMS the operation first: it writes the row of op_log before any work. A second delivery of the same
-- operation waits on the primary key until the first one commits (it then gets the stored answer) or rolls back (it
-- then runs). The operations are moved to op_begin one by one in the migrations that follow; op_done and op_save keep
-- working for the others. Nothing changes for the app: same arguments, same answers.

create or replace function public.op_begin(p_op uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if p_op is null then return null; end if;                 -- an operation sent without an id is never deduplicated (as before)
  insert into public.op_log(op, name, result) values (p_op, p_name, null) on conflict (op) do nothing;
  if found then return null; end if;                        -- claimed: the caller does the work, then calls op_save
  select result into v_result from public.op_log where op = p_op;
  -- already done: its stored answer. (A claim committed with no answer cannot happen while every operation ends with
  -- op_save; should it ever, the operation is still never run twice.)
  return coalesce(v_result, jsonb_build_object('ok', true, 'again', true));
end $$;

-- op_save writes the answer on the claimed row (op_begin), or inserts it (operations still using op_done); a row that
-- already holds an answer is left as it is, exactly as before.
create or replace function public.op_save(p_op uuid, p_name text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_op is not null then
    insert into public.op_log(op, name, result) values (p_op, p_name, p_result)
    on conflict (op) do update set result = excluded.result where public.op_log.result is null;
  end if;
  -- the server operation is over: protected fields are protected again for the rest of the transaction
  perform set_config('garage.rpc', '', true);
  return p_result;
end $$;

revoke all on function public.op_begin(uuid, text) from public, anon, authenticated;
grant execute on function public.op_begin(uuid, text) to service_role;
