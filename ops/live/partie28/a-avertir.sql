-- READ ONLY. Part 28, the way back, step 0 (REARRANGE.md §7.3 « Le retour »): every coming booked appointment whose
-- customer does NOT have his hours yet (tell_state 'new' or 'changed'): the day he has, the one he was told, the hours
-- to tell him. Given to Hassan BEFORE anything goes back: the old app and the old notify know nothing of who is still
-- owed his hour. (Today's slips, 'drift', are left out: the « en route » text gives them the time.)
select n.n_day::text as jour, j.number as numero, trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) as client,
       c.phone as telephone, public.tell_state(j) as etat,
       case when j.told_at is null then 'jamais averti'
            else coalesce(j.told_day::text, '') || ', ' || case when j.told_start is null then 'dans la journée'
                                                                 else public.exact_hm(j.told_start) || ' à ' || public.exact_hm(j.told_end) end end as averti_de,
       case when n.n_start is null then 'dans la journée' else public.exact_hm(n.n_start) || ' à ' || public.exact_hm(n.n_end) end as heures_a_dire,
       j.told_day as jour_averti
  from public.jobs j
  left join public.customers c on c.id = j.customer_id
  cross join lateral public.tell_now(j) n
 where j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today()
   and public.tell_state(j) in ('new', 'changed')
 order by n.n_day, n.n_start nulls first, j.number;
