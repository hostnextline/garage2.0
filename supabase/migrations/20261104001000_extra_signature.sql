-- Part 10: extra work accepted by a signature on the phone keeps that signature with the work it answers.
alter table public.job_items add column if not exists answer_attachment uuid references public.attachments(id) on delete set null;
drop function if exists public.extra_answer(uuid, uuid, boolean, text);
create or replace function public.extra_answer(p_op uuid, p_item uuid, p_accept boolean, p_via text, p_attachment uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); it public.job_items; j public.jobs;
begin
  if v_done is not null then return v_done; end if;
  select * into it from public.job_items where id = p_item and deleted_at is null for update;
  if not found then perform public.fail('not_found', 'Ce travail n’existe plus.'); end if;
  select * into j from public.jobs where id = it.job_id;
  if not public.job_actor(j) then perform public.fail('not_allowed', 'Cette job n’est pas à toi.'); end if;
  if p_via not in ('signature','verbal') then perform public.fail('via', 'Réponse inconnue.'); end if;
  if it.status not in ('proposed','approved','declined') then perform public.fail('not_extra', 'Ce n’est pas un travail proposé.'); end if;
  -- the signature must belong to this job
  if p_attachment is not null and not exists (select 1 from public.attachments a where a.id = p_attachment and a.job_id = j.id and a.kind = 'signature') then
    perform public.fail('signature', 'La signature ne correspond pas à cette job.');
  end if;
  update public.job_items set status = case when p_accept then 'approved' else 'declined' end, answered_at = now(), answered_via = p_via,
    answer_attachment = case when p_via = 'signature' then p_attachment end
  where id = it.id;
  return public.op_save(p_op, 'extra_answer', jsonb_build_object('ok', true, 'rows', public.job_payload(j.id)));
end $$;
revoke execute on function public.extra_answer(uuid, uuid, boolean, text, uuid) from public, anon;
grant execute on function public.extra_answer(uuid, uuid, boolean, text, uuid) to authenticated;
