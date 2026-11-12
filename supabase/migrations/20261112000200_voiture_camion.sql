-- Part 24 terdecies: « La voiture ou le camion » — the garage's vehicles are not all the same: only some carry the tire machine.
--   trucks.tire_machine          this vehicle mounts and balances tires (« le camion »); without it: « la voiture ».
--   services.needs_machine       this service needs the tire machine (mounting, unmounted tires, balancing): the truck only.
--   jobs.needs_machine           the job has such work (a service marked so, or a line whose words say mounting / balancing):
--                                kept by a trigger on its lines; a booked job that starts needing the machine is planned again.
--   jobs.vehicle_kind            'car' | 'truck': the kind of vehicle the job is on. Chosen when booking (the switch above the
--                                moments offered; nothing chosen: the app picks, the car first), then KEPT: a job booked for the
--                                car stays on a car, one for the truck on a truck, whatever is planned again (trigger
--                                jobs_kind_follow: the kind follows the vehicle the job is put on; trucks_kind_keep: a vehicle
--                                whose switch changes keeps its coming jobs). Only a move by hand to a vehicle of the other
--                                kind (move_job with a truck), or work that starts needing the tire machine, changes it.
--   plan_block                   a job that needs the machine (or asked « truck ») only goes on a vehicle with it; « car » only on
--                                one without; nothing said: the car first (the truck only when no car can take it).
--   book_job / web_book / suggest_core / suggest_blocks / web_suggest   say what the work needs (and the choice) to the planner;
--                                book_job refuses work for the machine on the car (`needs_truck`).
alter table public.trucks add column if not exists tire_machine boolean not null default true;
alter table public.services add column if not exists needs_machine boolean not null default false;
alter table public.jobs add column if not exists needs_machine boolean not null default false;
alter table public.jobs add column if not exists vehicle_kind text check (vehicle_kind is null or vehicle_kind in ('car', 'truck'));
grant update (vehicle_kind) on public.jobs to authenticated;

-- the services of the list that mount or balance (the owner changes it in Réglages → Services)
update public.services set needs_machine = true
 where not needs_machine and (name_fr ~* '(montage|non mont|balanc)' or coalesce(name_en, '') ~* '(mounting|unmounted|not mounted|balanc)');

/** words that say the tire machine: montage, pneus non montés, balancement */
create or replace function public.words_need_machine(p_text text) returns boolean language sql immutable as $$
  select coalesce(p_text, '') ~* '(montage|non[ -]mont|balanc|mounting|unmounted|not mounted)'
$$;
revoke all on function public.words_need_machine(text) from public, anon;
grant execute on function public.words_need_machine(text) to authenticated, service_role;
/** the lines of a booking (as sent to book_job): one of them needs the tire machine */
create or replace function public.items_need_machine(p_items jsonb) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    where coalesce(e->>'status', 'planned') not in ('declined', 'removed')
      and (public.words_need_machine(e->>'description')
        or exists (select 1 from public.services s where s.id = nullif(e->>'service_id', '')::uuid and s.needs_machine)))
$$;
revoke all on function public.items_need_machine(jsonb) from public, anon;
grant execute on function public.items_need_machine(jsonb) to authenticated, service_role;

-- the job follows its lines
create or replace function public.job_items_machine() returns trigger language plpgsql security definer set search_path = public as $$
declare v_job uuid := coalesce(new.job_id, old.job_id); v_need boolean; j record;
begin
  select exists (select 1 from public.job_items i left join public.services s on s.id = i.service_id
    where i.job_id = v_job and i.deleted_at is null and i.status not in ('declined', 'removed')
      and (public.words_need_machine(i.description) or coalesce(s.needs_machine, false))) into v_need;
  select * into j from public.jobs where id = v_job;
  if found and j.needs_machine is distinct from v_need then
    update public.jobs set needs_machine = v_need where id = v_job;
    -- booked on the car and now it needs the machine: the block is planned again (a started block is left alone)
    if v_need and j.status = 'booked' and j.deleted_at is null
       and exists (select 1 from public.trucks tr where tr.id = j.truck_id and not tr.tire_machine) then
      update public.jobs set truck_pinned = false where id = v_job;
      perform public.replan_block(j.day, j.block);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.job_items_machine() from public, anon, authenticated;
drop trigger if exists job_items_machine on public.job_items;
create trigger job_items_machine after insert or delete or update of status, description, service_id, deleted_at on public.job_items
  for each row execute function public.job_items_machine();

-- the jobs already there
update public.jobs j set needs_machine = true
 where not j.needs_machine and j.deleted_at is null and exists (select 1 from public.job_items i left join public.services s on s.id = i.service_id
   where i.job_id = j.id and i.deleted_at is null and i.status not in ('declined', 'removed')
     and (public.words_need_machine(i.description) or coalesce(s.needs_machine, false)));

create or replace function public.plan_block(p_day date, p_block text, p_extra jsonb default null, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare jkind text; carfirst boolean;
  b record;
  v_speed numeric := public.bset('speed_kmh', 35);
  v_detour numeric := public.bset('detour', 1.3);
  v_stop numeric := public.bset('stop_min', 5);
  v_unknown numeric := public.bset('unknown_min', 20);
  v_minblock numeric := public.bset('min_block_min', 45);
  v_hlat double precision; v_hlng double precision;
  v_today date := public.local_today();
  v_from int;
  trucks jsonb := '[]';
  pts jsonb := '{}';
  over jsonb := '[]';
  free jsonb := '[]';
  out_jobs jsonb := '{}';
  r record; rg jsonb; cap int; ti int; n int; pos int; cand jsonb; rc int; base int; durs int; used int; cost numeric;
  best_ti int; best_pos int; best_cost numeric; best_cand jsonb; jid text; jdur int; jtruck text; pinned boolean; placed boolean;
  t jsonb; tm int; plat double precision; plng double precision; clat double precision; clng double precision; leg int; k int;
  hl double precision; hg double precision; el double precision; eg double precision; rce int; basee int;
  v_forced jsonb := '[]'; v_tail jsonb;
  v_prev text; v_next text; v_from_kind text;
begin
  select * into b from public.blocks() x where x.key = p_block;
  if not found then raise exception 'Bloc inconnu : %', p_block using errcode = '22023'; end if;
  select h.lat, h.lng into v_hlat, v_hlng from public.home_point() h;
  v_from := case when p_day = v_today then (ceil(public.now_min() / 5.0) * 5)::int when p_day < v_today then 1440 else 0 end;

  select x.key into v_prev from public.blocks() x where x.pos = b.pos - 1;
  select x.key into v_next from public.blocks() x where x.pos = b.pos + 1;

  -- trucks working this block, each with where it leaves from and where its next block starts
  for r in select tr.id, tr.start, tr.tire_machine from public.trucks tr where tr.active and tr.deleted_at is null order by tr.sort, tr.name, tr.id loop
    rg := public.ranges_from(public.truck_ranges(r.id, p_day), v_from);
    cap := public.ranges_overlap(rg, b.start_min, b.end_min);
    if cap >= least(v_minblock, b.end_min - b.start_min) or (cap > 0 and exists (select 1 from public.jobs j where j.truck_id = r.id and j.day = p_day and j.block = p_block and j.status in ('en_route','on_site') and j.deleted_at is null)) then
      -- leaves from its last stop of the block before (done or not), else its own start, else « Départ des camions »
      hl := null; hg := null; el := null; eg := null;
      if v_prev is not null then
        select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into hl, hg from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.truck_id = r.id and j.day = p_day and j.block = v_prev and j.deleted_at is null and j.status not in ('cancelled','no_show')
          and (p_exclude is null or j.id <> p_exclude) and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
        order by j.stop_order desc nulls last, j.eta_min desc nulls last limit 1;
      end if;
      v_from_kind := case when hl is not null then 'prev' when r.start is not null then 'own' else 'home' end;
      if hl is null then hl := coalesce((r.start->>'lat')::double precision, v_hlat); hg := coalesce((r.start->>'lng')::double precision, v_hlng); end if;
      -- tries to finish close to its first stop of the next block
      if v_next is not null then
        select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into el, eg from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.truck_id = r.id and j.day = p_day and j.block = v_next and j.deleted_at is null and j.status not in ('cancelled','no_show','done')
          and (p_exclude is null or j.id <> p_exclude) and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
        order by j.stop_order nulls last, j.eta_min nulls last limit 1;
      end if;
      trucks := trucks || jsonb_build_array(jsonb_build_object('id', r.id, 'machine', r.tire_machine, 'cap', cap, 'start', coalesce(public.ranges_first(rg, b.start_min, b.end_min), b.start_min),
        'hlat', hl, 'hlng', hg, 'from', v_from_kind, 'elat', el, 'elng', eg, 'stops', '[]'::jsonb, 'nfixed', 0, 'durs', 0));
    end if;
  end loop;

  -- the jobs of the block
  for r in
    select j.id, j.truck_id, j.truck_pinned, j.forced, j.status, j.duration_min, j.stop_order, j.manual_order,
           case when j.needs_machine then 'truck' else j.vehicle_kind end kind,
           coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng
    from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.day = p_day and j.block = p_block and j.deleted_at is null and j.status not in ('cancelled','no_show','done')
      and (p_exclude is null or j.id <> p_exclude)
    order by (j.status in ('en_route','on_site')) desc, j.manual_order nulls last, j.stop_order nulls last, j.created_at
  loop
    pts := pts || jsonb_build_object(r.id::text, jsonb_build_object('lat', r.lat, 'lng', r.lng, 'dur', r.duration_min));
    -- on the way or there: stays where it is, before the others. Put in order by hand (Part 21): right after, in that
    -- order, on its truck when that truck works the block (else the planner places it like the others)
    ti := null;
    if r.status in ('en_route','on_site') or r.manual_order is not null then
      for k in 0 .. jsonb_array_length(trucks) - 1 loop if trucks->k->>'id' = r.truck_id::text then ti := k; end if; end loop;
    end if;
    if r.status in ('en_route','on_site') or ti is not null then
      if ti is not null then
        trucks := jsonb_set(trucks, array[ti::text, 'stops'], (trucks->ti->'stops') || to_jsonb(r.id::text));
        trucks := jsonb_set(trucks, array[ti::text, 'nfixed'], to_jsonb((trucks->ti->>'nfixed')::int + 1));
        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + r.duration_min));
      end if;
      out_jobs := out_jobs || jsonb_build_object(r.id::text, jsonb_build_object('truck', r.truck_id, 'fixed', true));
    else
      -- « farthest first »: from the nearest start of the trucks working the block
      free := free || jsonb_build_array(jsonb_build_object('id', r.id::text, 'truck', case when r.truck_pinned then r.truck_id::text end, 'forced', r.forced, 'kind', r.kind,
        'dist', coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, r.lat, r.lng)) from jsonb_array_elements(trucks) x),
                         public.km_between(v_hlat, v_hlng, r.lat, r.lng), 0)));
    end if;
  end loop;

  if p_extra is not null then
    clat := (p_extra->>'lat')::double precision; clng := (p_extra->>'lng')::double precision;
    pts := pts || jsonb_build_object(p_extra->>'id', jsonb_build_object('lat', clat, 'lng', clng, 'dur', coalesce((p_extra->>'dur')::int, 60)));
    free := free || jsonb_build_array(jsonb_build_object('id', p_extra->>'id', 'truck', nullif(p_extra->>'truck', ''), 'forced', coalesce((p_extra->>'force')::boolean, false),
      -- which vehicle: said with the booking (`need`: the tire machine; `kind`: the person's choice), else as the job already is
      'kind', case when coalesce((p_extra->>'need')::boolean, false) then 'truck'
                   when p_extra ? 'kind' or p_extra ? 'need' then nullif(p_extra->>'kind', '')
                   else (select case when jj.needs_machine then 'truck' else jj.vehicle_kind end from public.jobs jj where jj.id = (p_extra->>'id')::uuid) end,
      'dist', coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, clat, clng)) from jsonb_array_elements(trucks) x),
                       public.km_between(v_hlat, v_hlng, clat, clng), 0)));
  end if;

  v_forced := (select coalesce(jsonb_agg(e->'id'), '[]'::jsonb) from jsonb_array_elements(free) e where coalesce((e->>'forced')::boolean, false));
  -- pinned jobs first, then the farthest first; the ones booked « quand même » last (they never take the room of another)
  for r in select e from jsonb_array_elements(free) e order by coalesce((e->>'forced')::boolean, false), (e->>'truck' is not null) desc, (e->>'dist')::numeric desc, e->>'id' loop
    jid := r.e->>'id'; jtruck := r.e->>'truck'; pinned := jtruck is not null;
    -- the vehicle (Part 24 terdecies): 'truck' = only one with the tire machine, 'car' = only one without; nothing said: the
    -- car first (a vehicle with the machine costs 10000 more, so it is taken only when no car can take the job)
    jkind := r.e->>'kind';
    carfirst := jkind is null and exists (select 1 from jsonb_array_elements(trucks) x where not coalesce((x->>'machine')::boolean, true));
    jdur := (pts->jid->>'dur')::int;
    best_ti := null; best_cost := null; best_cand := null;
    for ti in 0 .. jsonb_array_length(trucks) - 1 loop
      t := trucks->ti;
      if (jkind = 'truck' and not coalesce((t->>'machine')::boolean, true)) or (jkind = 'car' and coalesce((t->>'machine')::boolean, true)) then continue; end if; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision;
      if pinned and t->>'id' <> jtruck then continue; end if;
      n := jsonb_array_length(t->'stops');
      durs := (t->>'durs')::int;
      base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
      basee := public.route_min_to(t->'stops', pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
      for pos in (t->>'nfixed')::int .. n loop
        cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                  select x, case when o <= pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                  union all select to_jsonb(jid), pos + 1) q);
        rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        used := durs + jdur + rc;
        if used <= (t->>'cap')::int then
          cost := (rce - basee) + 0.2 * used + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
          if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := pos; end if;
        end if;
      end loop;
    end loop;
    if best_ti is null and pinned and not coalesce((r.e->>'forced')::boolean, false) then
      -- the truck it was put on can no longer take it: try every truck before giving up
      for ti in 0 .. jsonb_array_length(trucks) - 1 loop
        t := trucks->ti;
        if (jkind = 'truck' and not coalesce((t->>'machine')::boolean, true)) or (jkind = 'car' and coalesce((t->>'machine')::boolean, true)) then continue; end if; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision;
        n := jsonb_array_length(t->'stops'); durs := (t->>'durs')::int;
        base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        basee := public.route_min_to(t->'stops', pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        for pos in (t->>'nfixed')::int .. n loop
          cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                    select x, case when o <= pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                    union all select to_jsonb(jid), pos + 1) q);
          rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
          used := durs + jdur + rc;
          if used <= (t->>'cap')::int then
            cost := (rce - basee) + 0.2 * used + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
            if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := pos; end if;
          end if;
        end loop;
      end loop;
    end if;
    if best_ti is null and not (pinned and coalesce((r.e->>'forced')::boolean, false)) then
      -- no room as the stops go: each truck again, its stops in a better order (the truck it was put on first).
      -- The order that ends near the next block only when it fits; else the shortest order inside the block.
      for ti in 0 .. jsonb_array_length(trucks) - 1 loop
        t := trucks->ti;
        if (jkind = 'truck' and not coalesce((t->>'machine')::boolean, true)) or (jkind = 'car' and coalesce((t->>'machine')::boolean, true)) then continue; end if; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision; durs := (t->>'durs')::int;
        base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        basee := public.route_min_to(t->'stops', pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        cand := public.route_improve((t->'stops') || to_jsonb(jid), (t->>'nfixed')::int, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        if durs + jdur + rc > (t->>'cap')::int and el is not null and eg is not null then
          cand := public.route_improve((t->'stops') || to_jsonb(jid), (t->>'nfixed')::int, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        end if;
        rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        used := durs + jdur + rc;
        if used <= (t->>'cap')::int then
          cost := (rce - basee) + 0.2 * used + case when pinned and t->>'id' <> jtruck then 100000 else 0 end + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
          if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_cand := cand; end if;
        end if;
      end loop;
    end if;
    if best_ti is null and coalesce((r.e->>'forced')::boolean, false) then
      -- booked « quand même » in a full block: at the end of the route of the truck where it adds the least driving, past its
      -- hours (the truck it was put on, if it works the block); the customers already booked keep their times
      for ti in 0 .. jsonb_array_length(trucks) - 1 loop
        t := trucks->ti;
        if (jkind = 'truck' and not coalesce((t->>'machine')::boolean, true)) or (jkind = 'car' and coalesce((t->>'machine')::boolean, true)) then continue; end if; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision;
        n := jsonb_array_length(t->'stops');
        base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        rc := public.route_min((t->'stops') || to_jsonb(jid), pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        cost := (rc - base) + case when pinned and t->>'id' <> jtruck then 100000 else 0 end + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
        if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := n; end if;
      end loop;
    end if;
    if best_ti is null then
      over := over || to_jsonb(jid);
    else
      t := trucks->best_ti;
      cand := coalesce(best_cand, (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                select x, case when o <= best_pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                union all select to_jsonb(jid), best_pos + 1) q));
      trucks := jsonb_set(trucks, array[best_ti::text, 'stops'], cand);
      trucks := jsonb_set(trucks, array[best_ti::text, 'durs'], to_jsonb(durs_of(cand, pts)));
    end if;
  end loop;

  -- each truck's stops in the order that drives the least (from where it is, toward its next block), then arrival times, drive of each leg, what is left.
  -- Ending near the next block never costs room in this block: when that order no longer fits in the truck's hours,
  -- the shortest order inside the block (it never drives more than the order the stops were put in, which fits).
  for ti in 0 .. jsonb_array_length(trucks) - 1 loop
    hl := (trucks->ti->>'hlat')::double precision; hg := (trucks->ti->>'hlng')::double precision;
    el := (trucks->ti->>'elat')::double precision; eg := (trucks->ti->>'elng')::double precision;
    -- the stops booked « quand même » (not on the way or there) stay at the end, in the order they were added
    v_tail := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(trucks->ti->'stops') with ordinality s(x, o)
               where o > (trucks->ti->>'nfixed')::int and v_forced @> jsonb_build_array(x));
    cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(trucks->ti->'stops') with ordinality s(x, o)
             where not (v_tail @> jsonb_build_array(x)));
    t := public.route_improve(cand, (trucks->ti->>'nfixed')::int, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
    if el is not null and eg is not null
       and (trucks->ti->>'durs')::int + public.route_min(t || v_tail, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) > (trucks->ti->>'cap')::int then
      t := public.route_improve(cand, (trucks->ti->>'nfixed')::int, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
    end if;
    trucks := jsonb_set(trucks, array[ti::text, 'stops'], t || v_tail);
    t := trucks->ti; tm := (t->>'start')::int; plat := hl; plng := hg; k := 0;
    for jid in select jsonb_array_elements_text(t->'stops') loop
      k := k + 1;
      clat := (pts->jid->>'lat')::double precision; clng := (pts->jid->>'lng')::double precision;
      leg := public.drive_min(plat, plng, clat, clng, v_speed, v_detour, v_unknown);
      tm := tm + leg;
      out_jobs := out_jobs || jsonb_build_object(jid, coalesce(out_jobs->jid, '{}'::jsonb) || jsonb_build_object('truck', t->>'id', 'order', k, 'eta', tm, 'travel', leg + ceil(v_stop)::int));
      tm := tm + ceil(v_stop)::int + (pts->jid->>'dur')::int;
      if clat is not null then plat := clat; plng := clng; end if;
    end loop;
    used := (t->>'durs')::int + public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
    trucks := jsonb_set(trucks, array[ti::text], (t - 'nfixed' - 'durs') || jsonb_build_object('used', used, 'left', (t->>'cap')::int - used));
  end loop;

  placed := p_extra is not null and (out_jobs ? (p_extra->>'id'));
  return jsonb_build_object('day', p_day, 'block', p_block, 'trucks', trucks, 'jobs', out_jobs, 'over', over,
    'extra', case when p_extra is null then null else jsonb_build_object('placed', placed, 'truck', out_jobs->(p_extra->>'id')->>'truck', 'eta', out_jobs->(p_extra->>'id')->>'eta') end);
end $$;

create or replace function public.book_job(p_op uuid, p_job jsonb, p_items jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb := public.op_done(p_op);
  v_id uuid := coalesce(nullif(p_job->>'id', '')::uuid, gen_random_uuid());
  v_day date := (p_job->>'day')::date;
  v_block text := p_job->>'block';
  v_truck uuid := nullif(p_job->>'truck_id', '')::uuid;
  v_cust uuid := nullif(p_job->>'customer_id', '')::uuid;
  v_lat double precision; v_lng double precision; v_dur int; b record;
  v_plan0 jsonb; v_plan1 jsonb; v_res jsonb; it jsonb; k int := 0;
  v_force boolean := coalesce((p_job->>'force')::boolean, false); v_forced boolean := false; v_nofit boolean;
  v_need boolean := public.items_need_machine(p_items);
  v_kind text := case when p_job->>'vehicle_kind' in ('car', 'truck') then p_job->>'vehicle_kind' end;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi pour réserver.'); end if;
  if not (public.can('book') or (public.has_role('mechanic') and v_truck is not null and v_truck = any(public.my_truck_ids()))) then
    perform public.fail('not_allowed', 'Tu ne peux pas prendre de rendez-vous. Parle au propriétaire.');
  end if;
  if exists (select 1 from public.jobs where id = v_id) then perform public.fail('exists', 'Ce rendez-vous existe déjà.'); end if;
  select * into b from public.blocks() x where x.key = v_block;
  if not found or v_day is null then perform public.fail('bad_block', 'Choisis la date et le bloc : matin, après-midi ou soir.'); end if;
  if v_day < public.local_today() or (v_day = public.local_today() and public.now_min() >= b.start_min) then
    perform public.fail('block_started', 'Ce bloc est déjà commencé : choisis un autre bloc.');
  end if;
  if v_day > public.local_today() + public.bset('horizon_days', 120)::int then perform public.fail('too_far', 'Cette date est trop loin.'); end if;
  if v_cust is null or not exists (select 1 from public.customers c where c.id = v_cust and c.deleted_at is null) then
    perform public.fail('no_customer', 'Choisis le client avant de réserver.');
  end if;
  if not public.customer_visible(v_cust) then perform public.fail('not_allowed', 'Tu n’as pas accès à ce client.'); end if;
  select coalesce(nullif(p_job->>'lat', '')::double precision, c.lat), coalesce(nullif(p_job->>'lng', '')::double precision, c.lng)
    into v_lat, v_lng from public.customers c where c.id = v_cust;
  v_dur := coalesce(nullif(p_job->>'duration_min', '')::int,
    (select sum(coalesce((e->>'duration_min')::int, 0)) from jsonb_array_elements(p_items) e where coalesce(e->>'status', 'planned') = 'planned'), 60);
  v_dur := greatest(15, least(720, coalesce(nullif(v_dur, 0), 60)));

  if v_force and not (public.is_owner() or public.has_role('office')) then
    perform public.fail('not_allowed', 'Seuls le propriétaire et le bureau peuvent réserver dans un bloc complet.');
  end if;

  -- mounting or balancing tires: only a vehicle with the tire machine
  if v_need and (v_kind = 'car' or (v_truck is not null and not exists (select 1 from public.trucks tr where tr.id = v_truck and tr.tire_machine))) then
    perform public.fail('needs_truck', 'Ce travail demande le camion (montage ou balancement des pneus) : la voiture ne peut pas le faire.');
  end if;

  perform public.lock_block(v_day, v_block);
  v_plan0 := public.plan_block(v_day, v_block);
  v_plan1 := public.plan_block(v_day, v_block, jsonb_build_object('id', v_id, 'lat', v_lat, 'lng', v_lng, 'dur', v_dur, 'truck', v_truck, 'need', v_need, 'kind', v_kind));
  if jsonb_array_length(v_plan1->'trucks') = 0 then
    perform public.fail('block_closed', 'Ce bloc est fermé ce jour-là : aucun camion ne travaille.');
  end if;
  -- it fits when it is placed, nobody else loses a place, it is on the truck asked, and that truck stays inside its
  -- hours (a block with an appointment booked « quand même » is already past them: it takes no more)
  v_nofit := not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or (v_truck is not null and (v_plan1->'extra'->>'truck')::uuid is distinct from v_truck)
     or exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_plan1->'extra'->>'truck' and (x->>'left')::int < 0);
  if v_nofit and v_force then
    -- it does not fit: booked anyway, past the truck's hours, without taking the room of another appointment
    v_plan1 := public.plan_block(v_day, v_block, jsonb_build_object('id', v_id, 'lat', v_lat, 'lng', v_lng, 'dur', v_dur, 'truck', v_truck, 'force', true, 'need', v_need, 'kind', v_kind));
    v_forced := true;
  end if;
  if not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or (not v_forced and v_truck is null and exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_plan1->'extra'->>'truck' and (x->>'left')::int < 0)) then
    perform public.fail('block_full', 'Ce bloc est complet : la route ne rentre plus dans le temps. Choisis un autre bloc.');
  end if;
  if v_truck is not null and ((v_plan1->'extra'->>'truck')::uuid is distinct from v_truck
     or (not v_forced and exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_truck::text and (x->>'left')::int < 0))) then
    perform public.fail('truck_full', 'Ce camion n’a plus de place dans ce bloc. Laisse l’app choisir le camion, ou choisis un autre bloc.');
  end if;

  perform set_config('garage.rpc', 'on', true);
  insert into public.jobs (id, customer_id, vehicle_id, day, block, truck_id, truck_pinned, forced, duration_min, status, problem, notes,
    address, unit, postal_code, lat, lng, card_on_file, source, quote_id, created_by, needs_machine, vehicle_kind)
  values (v_id, v_cust, nullif(p_job->>'vehicle_id', '')::uuid, v_day, v_block, (v_plan1->'extra'->>'truck')::uuid, v_truck is not null, v_forced, v_dur, 'booked',
    nullif(p_job->>'problem', ''), nullif(p_job->>'notes', ''), nullif(p_job->>'address', ''), nullif(p_job->>'unit', ''),
    nullif(p_job->>'postal_code', ''), nullif(p_job->>'lat', '')::double precision, nullif(p_job->>'lng', '')::double precision,
    coalesce((p_job->>'card_on_file')::boolean, false), coalesce(nullif(p_job->>'source', ''), 'phone'), nullif(p_job->>'quote_id', '')::uuid, auth.uid(), v_need, v_kind);
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    k := k + 1;
    insert into public.job_items (id, job_id, kind, service_id, item_id, description, qty, unit_cents, taxable, duration_min, status, note, sort)
    values (coalesce(nullif(it->>'id', '')::uuid, gen_random_uuid()), v_id, coalesce(nullif(it->>'kind', ''), 'service'), nullif(it->>'service_id', '')::uuid,
      nullif(it->>'item_id', '')::uuid, it->>'description', coalesce((it->>'qty')::numeric, 1), coalesce((it->>'unit_cents')::int, 0),
      coalesce((it->>'taxable')::boolean, true), nullif(it->>'duration_min', '')::int, coalesce(nullif(it->>'status', ''), 'planned'), nullif(it->>'note', ''), k);
  end loop;
  if v_cust is not null and coalesce((p_job->>'card_on_file')::boolean, false) then
    update public.customers set card_on_file = true where id = v_cust and not card_on_file;
  end if;
  if nullif(p_job->>'quote_id', '') is not null then
    update public.quotes set status = 'converted', job_id = v_id where id = (p_job->>'quote_id')::uuid;
  end if;
  perform public.apply_plan(v_plan1);

  v_res := jsonb_build_object('ok', true, 'job_id', v_id, 'truck_id', v_plan1->'extra'->>'truck', 'forced', v_forced,
    'rows', jsonb_build_object('jobs', public.block_rows(v_day, v_block),
                               'job_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.job_items i where i.job_id = v_id)));
  return public.op_save(p_op, 'book_job', v_res);
end $$;

create or replace function public.web_book(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_first text := left(nullif(trim(p->>'first_name'), ''), 80);
  v_last text := left(nullif(trim(p->>'last_name'), ''), 80);
  v_digits text := right(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), 10);
  v_email text := lower(left(nullif(trim(p->>'email'), ''), 160));
  v_lang text := case when p->>'lang' = 'en' then 'en' else 'fr' end;
  v_addr text := left(nullif(trim(p->>'address'), ''), 200);
  v_lat double precision := nullif(p->>'lat', '')::double precision;
  v_lng double precision := nullif(p->>'lng', '')::double precision;
  v_day date := nullif(p->>'day', '')::date;
  v_block text := p->>'block';
  v_hash text := left(nullif(trim(p->>'token_hash'), ''), 128);
  v_services uuid[];
  v_year int := nullif(regexp_replace(coalesce(p->'vehicle'->>'year', ''), '\D', '', 'g'), '')::int;
  v_make text := left(nullif(trim(p->'vehicle'->>'make'), ''), 60);
  v_model text := left(nullif(trim(p->'vehicle'->>'model'), ''), 60);
  v_cust uuid; v_veh uuid; v_id uuid := gen_random_uuid(); v_dur int; b record; v_plan0 jsonb; v_plan1 jsonb; k int := 0; s record;
  v_new boolean := false; v_again uuid; v_again_cust uuid;
begin
  if not public.web_on() then perform public.fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.'); end if;
  if v_first is null then perform public.fail('name', 'Écrivez votre prénom.'); end if;
  if v_digits !~ '^[2-9]\d{2}[2-9]\d{6}$' then perform public.fail('phone', 'Écrivez un numéro de téléphone à 10 chiffres.'); end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public.fail('email', 'Ce courriel ne semble pas bon.'); end if;
  if v_addr is null or not public.web_in_area(v_lat, v_lng) then perform public.fail('far', 'Choisissez votre adresse dans la liste (dans notre secteur).'); end if;
  if v_year is not null and (v_year < 1950 or v_year > extract(year from public.local_today())::int + 2) then v_year := null; end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_services
    from jsonb_array_elements_text(coalesce(p->'services', '[]'::jsonb)) x where x ~* '^[0-9a-f-]{36}$';
  if cardinality(v_services) = 0 or cardinality(v_services) > 10
     or exists (select 1 from unnest(v_services) u where not exists (select 1 from jsonb_array_elements(public.web_services()) w where (w->>'id')::uuid = u)) then
    perform public.fail('no_service', 'Choisissez au moins un service de la liste.');
  end if;
  select * into b from public.blocks() x where x.key = v_block;
  if not found or v_day is null then perform public.fail('bad_block', 'Choisissez une date dans la liste.'); end if;
  if v_day < public.local_today() or (v_day = public.local_today() and public.now_min() >= b.start_min) then
    perform public.fail('block_full', 'Ce moment n’est plus libre. Choisissez-en un autre.');
  end if;
  if v_day > public.local_today() + public.bset('horizon_days', 120)::int then perform public.fail('bad_block', 'Cette date est trop loin.'); end if;

  -- one customer at a time per phone number (the brakes and the « again » check are counted under this lock)
  perform pg_advisory_xact_lock(hashtext('web:' || v_digits));

  -- the same booking sent again (the page retried after a hiccup): the job already made, never a second one
  select j.id, j.customer_id into v_again, v_again_cust from public.jobs j join public.customers c on c.id = j.customer_id
  where c.phone_digits = v_digits and j.source = 'web' and j.status = 'booked' and j.deleted_at is null
    and j.day = v_day and j.block = v_block and lower(coalesce(j.address, '')) = lower(v_addr) and j.created_at > now() - interval '10 minutes'
    and (select coalesce(array_agg(ji.service_id order by ji.service_id), '{}'::uuid[]) from public.job_items ji
         where ji.job_id = j.id and ji.deleted_at is null and ji.service_id is not null)
        = (select array_agg(u order by u) from unnest(v_services) u)
  order by j.created_at desc limit 1;
  if v_again is not null then
    if v_hash is not null then
      insert into public.public_links (token_hash, job_id, quote_id, expires_at, created_by) values (v_hash, v_again, null, now() + interval '90 days', null)
      on conflict (token_hash) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'job_id', v_again, 'customer_id', v_again_cust, 'new_customer', false, 'day', v_day, 'block', v_block, 'again', true);
  end if;

  -- a brake on mistakes and pranks: 2 coming appointments booked online per phone number, 30 an hour in all
  if (select count(*) from public.jobs j join public.customers c on c.id = j.customer_id
      where c.phone_digits = v_digits and j.source = 'web' and j.status = 'booked' and j.deleted_at is null and j.day >= public.local_today()) >= 2 then
    perform public.fail('too_many', 'Vous avez déjà des rendez-vous à venir. Pour en ajouter, appelez le garage.');
  end if;
  perform pg_advisory_xact_lock(hashtext('web:all'));
  if (select count(*) from public.jobs j where j.source = 'web' and j.created_at > now() - interval '1 hour') >= 30 then
    perform public.fail('busy', 'Trop de réservations en même temps. Réessayez dans quelques minutes ou appelez le garage.');
  end if;

  v_dur := public.web_duration(v_services);
  perform public.lock_block(v_day, v_block);
  v_plan0 := public.plan_block(v_day, v_block);
  v_plan1 := public.plan_block(v_day, v_block, jsonb_build_object('id', v_id, 'lat', v_lat, 'lng', v_lng, 'dur', v_dur,
    'need', exists (select 1 from public.services s where s.id = any(v_services) and s.needs_machine), 'kind', null));
  if jsonb_array_length(v_plan1->'trucks') = 0
     or not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_plan1->'extra'->>'truck' and (x->>'left')::int < 0) then
    perform public.fail('block_full', 'Ce moment vient d’être pris. Choisissez-en un autre.');
  end if;

  perform set_config('garage.rpc', 'on', true);
  -- the customer: the same phone number, else a new file
  select c.id into v_cust from public.customers c where c.phone_digits = v_digits and c.deleted_at is null order by c.updated_at desc limit 1;
  if v_cust is null then
    v_new := true;
    insert into public.customers (first_name, last_name, phone, email, lang, address, unit, city, postal_code, lat, lng, notes, created_by)
    values (v_first, v_last, substr(v_digits, 1, 3) || ' ' || substr(v_digits, 4, 3) || '-' || substr(v_digits, 7), v_email, v_lang, v_addr,
      left(nullif(trim(p->>'unit'), ''), 20), left(nullif(trim(p->>'city'), ''), 80), left(nullif(trim(p->>'postal_code'), ''), 10), v_lat, v_lng,
      'Client créé par la réservation en ligne.', null)
    returning id into v_cust;
  elsif v_email is not null then
    update public.customers set email = v_email where id = v_cust and email is null;
  end if;
  -- the car
  if v_make is not null or v_model is not null then
    select v.id into v_veh from public.vehicles v where v.customer_id = v_cust and v.deleted_at is null
      and lower(coalesce(v.make, '')) = lower(coalesce(v_make, '')) and lower(coalesce(v.model, '')) = lower(coalesce(v_model, ''))
      and (v_year is null or v.year is null or v.year = v_year)
      order by v.updated_at desc limit 1;
    if v_veh is null then
      insert into public.vehicles (customer_id, year, make, model, created_by) values (v_cust, v_year, v_make, v_model, null) returning id into v_veh;
    end if;
  end if;

  insert into public.jobs (id, customer_id, vehicle_id, day, block, truck_id, truck_pinned, forced, duration_min, status, problem, notes,
    address, unit, postal_code, lat, lng, source, created_by)
  values (v_id, v_cust, v_veh, v_day, v_block, (v_plan1->'extra'->>'truck')::uuid, false, false, v_dur, 'booked',
    left(nullif(trim(p->>'problem'), ''), 1000), 'Réservé en ligne par le client.', v_addr, left(nullif(trim(p->>'unit'), ''), 20),
    left(nullif(trim(p->>'postal_code'), ''), 10), v_lat, v_lng, 'web', null);
  for s in select sv.* from public.services sv where sv.id = any(v_services) order by sv.is_promo desc, sv.sort, sv.name_fr loop
    k := k + 1;
    insert into public.job_items (job_id, kind, service_id, description, qty, unit_cents, taxable, duration_min, status, sort, created_by)
    values (v_id, 'service', s.id, case when v_lang = 'en' then coalesce(nullif(s.name_en, ''), s.name_fr) else s.name_fr end, 1,
      coalesce(s.price_cents, 0), s.taxable, s.duration_min, 'planned', k, null);
  end loop;
  -- the customer's link, in the same transaction as the booking
  if v_hash is not null then
    insert into public.public_links (token_hash, job_id, quote_id, expires_at, created_by) values (v_hash, v_id, null, now() + interval '90 days', null);
  end if;
  perform public.apply_plan(v_plan1);
  insert into public.activity (entity, entity_id, action, data)
  values ('job', v_id, 'web_booked', jsonb_build_object('customer_new', v_new, 'ip', left(p->>'ip', 64)));
  return jsonb_build_object('ok', true, 'job_id', v_id, 'customer_id', v_cust, 'new_customer', v_new, 'day', v_day, 'block', v_block, 'again', false);
end $$;

drop function if exists public.suggest_blocks(double precision, double precision, int, date, int, uuid, int);
drop function if exists public.suggest_core(double precision, double precision, int, date, int, uuid, int);

create or replace function public.suggest_core(p_lat double precision, p_lng double precision, p_duration int,
  p_from date default null, p_days int default 14, p_exclude uuid default null, p_limit int default 6,
  p_need boolean default false, p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date; b record; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
  p0 jsonb; p1 jsonb; out jsonb := '[]'; used0 int; used1 int; near int; v_near numeric := public.bset('near_km', 5);
  x uuid := '00000000-0000-4000-8000-000000000000';
  -- the vehicle: what the work needs and what the person chose; moving a job, what the job already says
  v_need boolean := coalesce(p_need, false) or coalesce((select j.needs_machine from public.jobs j where j.id = p_exclude), false);
  v_kind text := coalesce(case when p_kind in ('car', 'truck') then p_kind end, (select j.vehicle_kind from public.jobs j where j.id = p_exclude));
begin
  for d in select generate_series(v_from, v_from + greatest(1, least(p_days, 60)) - 1, interval '1 day')::date loop
    for b in select * from public.blocks() loop
      if d = public.local_today() and public.now_min() >= b.start_min then continue; end if;
      p0 := public.plan_block(d, b.key, null, p_exclude);
      if jsonb_array_length(p0->'trucks') = 0 then continue; end if;
      p1 := public.plan_block(d, b.key, jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', p_duration, 'need', v_need, 'kind', v_kind), p_exclude);
      if not coalesce((p1->'extra'->>'placed')::boolean, false) then continue; end if;
      if exists (select 1 from jsonb_array_elements_text(p1->'over') o where not ((p0->'over') ? o)) then continue; end if;
      -- the truck it goes on must stay inside its hours (as book_job asks)
      if exists (select 1 from jsonb_array_elements(p1->'trucks') t where t->>'id' = p1->'extra'->>'truck' and (t->>'left')::int < 0) then continue; end if;
      select coalesce(sum((t->>'used')::int), 0) into used0 from jsonb_array_elements(p0->'trucks') t;
      select coalesce(sum((t->>'used')::int), 0) into used1 from jsonb_array_elements(p1->'trucks') t;
      select count(*) into near from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.day = d and j.block = b.key and j.deleted_at is null and j.status not in ('cancelled','no_show')
          and (p_exclude is null or j.id <> p_exclude)
          and public.km_between(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) <= v_near;
      out := out || jsonb_build_array(jsonb_build_object('day', d, 'block', b.key, 'pos', b.pos, 'drive_min', greatest(0, used1 - used0 - p_duration),
        'near', near, 'truck', p1->'extra'->>'truck', 'left', (select max((t->>'left')::int) from jsonb_array_elements(p1->'trucks') t)));
    end loop;
  end loop;
  return coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(out) e
    order by (e->>'drive_min')::int, (e->>'near')::int desc, e->>'day', (e->>'pos')::int limit greatest(1, p_limit)) q), '[]'::jsonb);
end $$;

create or replace function public.suggest_blocks(p_lat double precision, p_lng double precision, p_duration int,
  p_from date default null, p_days int default 14, p_exclude uuid default null, p_limit int default 6,
  p_need boolean default false, p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return '[]'; end if;
  return public.suggest_core(p_lat, p_lng, p_duration, p_from, p_days, p_exclude, p_limit, p_need, p_kind);
end $$;

revoke all on function public.suggest_core(double precision, double precision, int, date, int, uuid, int, boolean, text) from public, anon, authenticated;
revoke all on function public.suggest_blocks(double precision, double precision, int, date, int, uuid, int, boolean, text) from public, anon;
grant execute on function public.suggest_blocks(double precision, double precision, int, date, int, uuid, int, boolean, text) to authenticated, service_role;
grant execute on function public.suggest_core(double precision, double precision, int, date, int, uuid, int, boolean, text) to service_role;

create or replace function public.web_suggest(p_lat double precision, p_lng double precision, p_services uuid[],
  p_from date default null, p_days int default 14, p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_horizon int := public.bset('horizon_days', 120)::int; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
begin
  if not public.web_on() then perform public.fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.'); end if;
  if not public.web_in_area(p_lat, p_lng) then perform public.fail('far', 'Cette adresse est en dehors de notre secteur. Appelez le garage.'); end if;
  if coalesce(cardinality(p_services), 0) = 0 then perform public.fail('no_service', 'Choisissez au moins un service.'); end if;
  if v_from > public.local_today() + v_horizon then return '[]'::jsonb; end if;
  -- at most 14 days per call: each day costs up to six plans
  return public.suggest_core(p_lat, p_lng, public.web_duration(p_services), v_from,
    least(greatest(1, p_days), 14, v_horizon - (v_from - public.local_today()) + 1), null, least(greatest(1, p_limit), 12),
    exists (select 1 from public.services s where s.id = any(p_services) and s.needs_machine));
end $$;

create or replace function public.move_job(p_op uuid, p_job uuid, p_day date, p_block text, p_truck uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb := public.op_done(p_op);
  j public.jobs; b record; v_lat double precision; v_lng double precision; v_plan0 jsonb; v_plan1 jsonb; v_res jsonb;
begin
  if v_done is not null then return v_done; end if;
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if not (public.can('book') or (p_truck is not null and p_truck = any(public.my_truck_ids()) and j.truck_id = any(public.my_truck_ids()))) then
    perform public.fail('not_allowed', 'Tu ne peux pas déplacer ce rendez-vous.');
  end if;
  if j.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  select * into b from public.blocks() x where x.key = p_block;
  if not found then perform public.fail('bad_block', 'Bloc inconnu.'); end if;
  if p_day < public.local_today() or (p_day = public.local_today() and public.now_min() >= b.start_min) then
    perform public.fail('block_started', 'Ce bloc est déjà commencé.');
  end if;
  if j.day = p_day and j.block = p_block and p_truck is not distinct from (case when j.truck_pinned then j.truck_id end) then
    return public.op_save(p_op, 'move_job', jsonb_build_object('ok', true, 'unchanged', true, 'rows', jsonb_build_object('jobs', jsonb_build_array(to_jsonb(j)))));
  end if;
  -- the two blocks, always locked in the same order (day, then morning → evening)
  perform public.lock_two(j.day, j.block, p_day, p_block);
  select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into v_lat, v_lng from public.customers c where c.id = j.customer_id;
  v_plan0 := public.plan_block(p_day, p_block, null, j.id);
  v_plan1 := public.plan_block(p_day, p_block, jsonb_build_object('id', j.id, 'lat', v_lat, 'lng', v_lng, 'dur', j.duration_min, 'truck', p_truck,
    -- a vehicle chosen by hand: its kind becomes the job's (work for the tire machine still needs the machine)
    'need', j.needs_machine, 'kind', case when p_truck is not null then (select case when tr.tire_machine then 'truck' else 'car' end from public.trucks tr where tr.id = p_truck) else j.vehicle_kind end), j.id);
  if jsonb_array_length(v_plan1->'trucks') = 0 then perform public.fail('block_closed', 'Ce bloc est fermé ce jour-là.'); end if;
  if not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o)) then
    perform public.fail('block_full', 'Ce bloc est complet : la route ne rentre plus dans le temps.');
  end if;
  if p_truck is not null and (v_plan1->'extra'->>'truck')::uuid is distinct from p_truck then
    perform public.fail('truck_full', 'Ce camion n’a plus de place dans ce bloc.');
  end if;
  perform set_config('garage.rpc', 'on', true);
  update public.jobs set day = p_day, block = p_block, truck_id = (v_plan1->'extra'->>'truck')::uuid, truck_pinned = p_truck is not null,
    confirm_sent_at = case when day <> p_day or block <> p_block then null else confirm_sent_at end
  where id = j.id;
  perform public.apply_plan(v_plan1);
  if j.day <> p_day or j.block <> p_block then perform public.apply_plan(public.plan_block(j.day, j.block)); end if;
  v_res := jsonb_build_object('ok', true, 'job_id', j.id, 'changed', j.day <> p_day or j.block <> p_block,
    'rows', jsonb_build_object('jobs', public.block_rows(p_day, p_block) || case when j.day <> p_day or j.block <> p_block then public.block_rows(j.day, j.block) else '[]'::jsonb end));
  return public.op_save(p_op, 'move_job', v_res);
end $$;

-- the kind of a job follows the vehicle it is put on (booked, moved by hand, online booking, on the spot)
create or replace function public.jobs_kind_follow() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.truck_id is not null then
    select case when tr.tire_machine then 'truck' else 'car' end into new.vehicle_kind from public.trucks tr where tr.id = new.truck_id;
  end if;
  return new;
end $$;
revoke all on function public.jobs_kind_follow() from public, anon, authenticated;
drop trigger if exists jobs_kind_follow on public.jobs;
create trigger jobs_kind_follow before insert or update of truck_id on public.jobs for each row execute function public.jobs_kind_follow();

-- a vehicle that gets or loses the tire machine keeps its jobs: they take its new kind
create or replace function public.trucks_kind_keep() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.jobs set vehicle_kind = case when new.tire_machine then 'truck' else 'car' end
   where truck_id = new.id and deleted_at is null and vehicle_kind is distinct from case when new.tire_machine then 'truck' else 'car' end;
  return null;
end $$;
revoke all on function public.trucks_kind_keep() from public, anon, authenticated;
drop trigger if exists trucks_kind_keep on public.trucks;
create trigger trucks_kind_keep after update of tire_machine on public.trucks for each row execute function public.trucks_kind_keep();

-- the jobs already there: the kind of the vehicle they are on
update public.jobs j set vehicle_kind = case when tr.tire_machine then 'truck' else 'car' end
  from public.trucks tr where tr.id = j.truck_id and j.vehicle_kind is null;
