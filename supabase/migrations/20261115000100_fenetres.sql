-- Part 25: « Plages d’arrivée » — a 4-hour arrival window instead of the blocks (matin / après-midi / soir).
-- Everything here is INERT while settings.booking.windows_on is not true: the garage keeps running on blocks.
--   settings.booking.windows_on      the switch (changed only by windows_switch: a plain settings save never changes it)
--   settings.booking.win_before_min  60: the window starts this long before the estimated arrival
--   settings.booking.win_after_min   180: and ends this long after (so 4 hours)
--   settings.booking.win_round_min   60: the estimated arrival is rounded to this before the window is cut
--   settings.booking.win_lock_min    1080 (18:00): from then on, « flexible » jobs of tomorrow get their window
--   jobs.block = 'day'               a job of window mode (one block for the whole day)
--   jobs.win_start / win_end         the window PROMISED to the customer (minutes of the day), or null
--   jobs.win_flex                    booked « flexible »: no window until the evening before (lock_windows)
--   blocks()                         window mode: ONE block ('day', first block start, last block end, 1)
--   block_open(day, block)           window mode: today's day stays open until the end of the day (same-day bookings)
--   plan_block                       each stop may carry a window (ws / we): the truck waits when it is early, and no order is
--                                    taken that reaches a promised stop after its window. Stops en route / on site, put in
--                                    order by hand or booked « quand même » are not held to it. A booked job is never thrown
--                                    to « À placer » because of a window: it is placed late and listed in `late`.
--   book_job / web_book / move_job   window mode: block 'day', `win_start` (the window chosen; refused with `window_full`),
--                                    `win_flex`, or neither (the window is cut around the planned arrival)
--   suggest_core / suggest_blocks    window mode: one row per day with eta, win_start, win_end
--   suggest_windows                  every window still possible on one day
--   lock_windows / lock_windows_due  the flexible jobs of a day get their window from the planned arrival
--   windows_switch(op, on)           owner: switches the mode and converts today's and the coming jobs

-- ---------- the columns ----------
alter table public.jobs add column if not exists win_start int;
alter table public.jobs add column if not exists win_end int;
alter table public.jobs add column if not exists win_flex boolean not null default false;
alter table public.jobs drop constraint if exists jobs_win_ok;
alter table public.jobs add constraint jobs_win_ok check (
  (win_start is null and win_end is null) or (win_start between 0 and 1440 and win_end > win_start and win_end <= 1680));
-- the block of a job may also be 'day' (the check made with the table has the name Postgres gave it)
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.jobs'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) ~ '\mblock\M' and pg_get_constraintdef(oid) ~ '''am''' loop
    execute format('alter table public.jobs drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.jobs add constraint jobs_block_check check (block in ('am', 'pm', 'eve', 'day'));
-- win_start, win_end, win_flex are written by the server only (they are not in the columns a person may update)

-- ---------- settings helpers ----------
create or replace function public.windows_on() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (s.booking->>'windows_on')::boolean from public.settings s where s.id = 1), false)
$$;
-- the blocks written in the settings (what blocks() answered before this Part)
create or replace function public.blocks_set() returns table(key text, start_min int, end_min int, pos int) language sql stable security definer set search_path = public as $$
  select b->>'key', (b->>'start')::int, (b->>'end')::int, (row_number() over ())::int
  from jsonb_array_elements(coalesce((select s.booking->'blocks' from public.settings s where s.id = 1),
    '[{"key":"am","start":480,"end":720},{"key":"pm","start":720,"end":960},{"key":"eve","start":960,"end":1200}]'::jsonb)) b
$$;
-- the hours of a day: from the first block's start to the last block's end
create or replace function public.day_span() returns table(start_min int, end_min int) language sql stable security definer set search_path = public as $$
  select coalesce(min(x.start_min), 480)::int, coalesce(max(x.end_min), 1200)::int from public.blocks_set() x
$$;
create or replace function public.blocks() returns table(key text, start_min int, end_min int, pos int) language sql stable security definer set search_path = public as $$
  select x.key, x.start_min, x.end_min, x.pos from public.blocks_set() x where not public.windows_on()
  union all
  select 'day'::text, d.start_min, d.end_min, 1 from public.day_span() d where public.windows_on()
$$;
create or replace function public.win_len() returns int language sql stable security definer set search_path = public as $$
  select greatest(30, (public.bset('win_before_min', 60) + public.bset('win_after_min', 180))::int)
$$;
-- the window told to the customer for an estimated arrival: 15:00 → 14:00–18:00 (inside the day's hours)
create or replace function public.win_for(p_eta int) returns table(win_start int, win_end int) language sql stable security definer set search_path = public as $$
  with o as (select public.bset('win_before_min', 60)::int b, public.win_len() len, greatest(public.bset('win_round_min', 60)::int, 5) r),
       s as (select greatest(d.start_min, least((round(p_eta::numeric / o.r) * o.r)::int - o.b, greatest(d.start_min, d.end_min - o.len))) st, o.len
             from o, public.day_span() d)
  select s.st, s.st + s.len from s where p_eta is not null
$$;
-- « flexible » jobs of that day get their window now: today, or tomorrow once the lock hour (18:00) is past
create or replace function public.win_lock_due(p_day date) returns boolean language sql stable security definer set search_path = public as $$
  select p_day is not null and (p_day <= public.local_today()
    or (p_day = public.local_today() + 1 and public.now_min() >= public.bset('win_lock_min', 1080)::int))
$$;

-- ---------- the one rule for « this block may still be planned » ----------
-- window mode: today's day stays open until its end (the rest of the day is still planned and booked)
create or replace function public.block_open(p_day date, p_block text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare b record;
begin
  if p_day is null then return false; end if;
  select * into b from public.blocks() x where x.key = p_block;
  if not found then return false; end if;
  if p_day > public.local_today() then return true; end if;
  if p_day < public.local_today() then return false; end if;
  if p_block = 'day' and public.windows_on() then return public.now_min() < b.end_min; end if;
  return public.now_min() < b.start_min;
end $$;

-- ---------- a route against its windows ----------
-- walks the route like the planner's arrival times: early at a stop with a window = waiting until it opens. Answers the
-- minutes waited, or -1 when a stop is reached after its window (the first p_fixed stops, and a stop marked `late`, are
-- not held to theirs).
create or replace function public.route_walk(p_ids jsonb, p_pts jsonb, p_start int, p_hlat double precision, p_hlng double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric, p_fixed int) returns int
language plpgsql immutable set search_path = public, extensions as $$
declare plat double precision := p_hlat; plng double precision := p_hlng; clat double precision; clng double precision;
  tm int := coalesce(p_start, 0); v_wait int := 0; k int := 0; id text; v jsonb; v_ws int; v_we int;
begin
  for id in select e from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) with ordinality q(e, o) order by o loop
    k := k + 1; v := p_pts->id;
    clat := (v->>'lat')::double precision; clng := (v->>'lng')::double precision;
    tm := tm + public.drive_min(plat, plng, clat, clng, p_speed, p_detour, p_unknown);
    if k > coalesce(p_fixed, 0) then
      v_ws := (v->>'ws')::int; v_we := (v->>'we')::int;
      if v_ws is not null and tm < v_ws then v_wait := v_wait + (v_ws - tm); tm := v_ws; end if;
      if v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then return -1; end if;
    end if;
    tm := tm + ceil(p_stop)::int + coalesce((v->>'dur')::int, 0);
    if clat is not null then plat := clat; plng := clng; end if;
  end loop;
  return v_wait;
end $$;
-- a plan with one more stop puts a job late that the plan without it did not
create or replace function public.plan_late_new(p0 jsonb, p1 jsonb) returns boolean language sql immutable as $$
  select exists (select 1 from jsonb_array_elements_text(coalesce(p1->'late', '[]'::jsonb)) o where not (coalesce(p0->'late', '[]'::jsonb) ? o))
$$;
-- the extra stop fits: placed, nobody else loses a place or a window, and its truck stays inside its hours
create or replace function public.plan_fits(p0 jsonb, p1 jsonb) returns boolean language sql immutable as $$
  select coalesce((p1->'extra'->>'placed')::boolean, false)
    and not exists (select 1 from jsonb_array_elements_text(coalesce(p1->'over', '[]'::jsonb)) o where not (coalesce(p0->'over', '[]'::jsonb) ? o))
    and not public.plan_late_new(p0, p1)
    and not exists (select 1 from jsonb_array_elements(coalesce(p1->'trucks', '[]'::jsonb)) x where x->>'id' = p1->'extra'->>'truck' and (x->>'left')::int < 0)
$$;

/* ---------- the planner (Part 24 terdecies, with the windows) ----------
   plan_block(day, block, extra, exclude) → {
     trucks: [{id, machine, cap, start, hlat, hlng, from, elat, elng, used, left, wait, stops: [job ids in order]}],
     jobs:   {job_id: {truck, order, eta, travel, fixed}},
     over:   [job ids that fit nowhere],
     late:   [job ids reached after their window],
     extra:  {placed, truck, eta}
   }
   extra may carry `ws` / `we` (its window); without them an existing job keeps the window it has. */
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
  -- the windows (Part 25)
  v_wm boolean := false;          -- window mode: the one block of the day
  v_win boolean := false;         -- a stop of this plan has a window
  v_w int := 0; v_bw int := 0; v_wt int; v_try int; v_late jsonb := '[]'; v_xid text := p_extra->>'id';
  v_ws int; v_we int; v_dur int; v_start int; v_nf int;
begin
  select * into b from public.blocks() x where x.key = p_block;
  if not found then raise exception 'Bloc inconnu : %', p_block using errcode = '22023'; end if;
  v_wm := p_block = 'day' and public.windows_on();
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
      -- window mode, today: from where the truck is now (the stop it is at, else the last one it finished)
      if v_wm and p_day = v_today then
        select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into hl, hg from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.truck_id = r.id and j.day = p_day and j.block = p_block and j.deleted_at is null and j.status in ('on_site','done')
          and (p_exclude is null or j.id <> p_exclude) and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
        order by (j.status = 'on_site') desc, j.finished_at desc nulls last, j.stop_order desc nulls last limit 1;
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
           coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
           j.win_start, j.win_end, j.arrived_at, j.eta_min
    from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.day = p_day and j.block = p_block and j.deleted_at is null and j.status not in ('cancelled','no_show','done')
      and (p_exclude is null or j.id <> p_exclude)
    order by (j.status in ('en_route','on_site')) desc, j.manual_order nulls last, j.stop_order nulls last, j.created_at
  loop
    v_dur := r.duration_min;
    -- window mode, today: a job under way counts only the time it still needs
    if v_wm and p_day = v_today and r.status = 'on_site' and r.arrived_at is not null then
      v_dur := greatest(0, r.duration_min - floor(extract(epoch from (now() - r.arrived_at)) / 60)::int);
    end if;
    pts := pts || jsonb_build_object(r.id::text, jsonb_build_object('lat', r.lat, 'lng', r.lng, 'dur', v_dur)
      || case when v_wm and r.status = 'booked' and not coalesce(r.forced, false) and r.win_start is not null and r.win_end is not null
              then jsonb_build_object('ws', r.win_start, 'we', r.win_end) else '{}'::jsonb end
      || case when v_wm and p_day = v_today and r.status = 'on_site' and r.eta_min is not null then jsonb_build_object('eta0', r.eta_min) else '{}'::jsonb end);
    if v_wm and r.status = 'booked' and not coalesce(r.forced, false) and r.win_start is not null and r.win_end is not null then v_win := true; end if;
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
        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + v_dur));
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
    -- its window: said with the call (ws / we), else the one the job already has; booked « quand même »: none
    v_ws := null; v_we := null;
    if v_wm and not coalesce((p_extra->>'force')::boolean, false) then
      if p_extra ? 'ws' then
        v_ws := nullif(p_extra->>'ws', '')::int; v_we := nullif(p_extra->>'we', '')::int;
      else
        select jj.win_start, jj.win_end into v_ws, v_we from public.jobs jj where jj.id = (p_extra->>'id')::uuid and not jj.forced;
      end if;
    end if;
    pts := pts || jsonb_build_object(p_extra->>'id', jsonb_build_object('lat', clat, 'lng', clng, 'dur', coalesce((p_extra->>'dur')::int, 60))
      || case when v_ws is not null and v_we is not null then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end);
    if v_ws is not null and v_we is not null then v_win := true; end if;
    free := free || jsonb_build_array(jsonb_build_object('id', p_extra->>'id', 'truck', nullif(p_extra->>'truck', ''), 'forced', coalesce((p_extra->>'force')::boolean, false),
      -- which vehicle: said with the booking (`need`: the tire machine; `kind`: the person's choice), else as the job already is
      'kind', case when coalesce((p_extra->>'need')::boolean, false) then 'truck'
                   when p_extra ? 'kind' or p_extra ? 'need' then nullif(p_extra->>'kind', '')
                   else (select case when jj.needs_machine then 'truck' else jj.vehicle_kind end from public.jobs jj where jj.id = (p_extra->>'id')::uuid) end,
      'dist', coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, clat, clng)) from jsonb_array_elements(trucks) x),
                       public.km_between(v_hlat, v_hlng, clat, clng), 0)));
  end if;

  v_forced := (select coalesce(jsonb_agg(e->'id'), '[]'::jsonb) from jsonb_array_elements(free) e where coalesce((e->>'forced')::boolean, false));
  -- pinned jobs first, then the farthest first; the ones booked « quand même » last (they never take the room of another).
  -- Window mode: the stop being added goes after the appointments already there (it never takes a window from them), and
  -- the stops with a promised window before the flexible ones.
  for r in select e from jsonb_array_elements(free) e
           order by coalesce((e->>'forced')::boolean, false), (v_wm and v_xid is not null and e->>'id' = v_xid),
                    (e->>'truck' is not null) desc, (v_wm and (pts->(e->>'id')->>'ws') is null), (e->>'dist')::numeric desc, e->>'id' loop
    jid := r.e->>'id'; jtruck := r.e->>'truck'; pinned := jtruck is not null;
    -- the vehicle (Part 24 terdecies): 'truck' = only one with the tire machine, 'car' = only one without; nothing said: the
    -- car first (a vehicle with the machine costs 10000 more, so it is taken only when no car can take the job)
    jkind := r.e->>'kind';
    carfirst := jkind is null and exists (select 1 from jsonb_array_elements(trucks) x where not coalesce((x->>'machine')::boolean, true));
    jdur := (pts->jid->>'dur')::int;
    best_ti := null; best_cost := null; best_cand := null;
    -- the windows: 1 = every window holds; 2 = this job may arrive after its own (an appointment already booked is placed
    -- late rather than thrown to « À placer »); 3 = the windows are not looked at. The stop being added only gets 1.
    v_try := 1;
    loop
    for ti in 0 .. jsonb_array_length(trucks) - 1 loop
      t := trucks->ti;
      if (jkind = 'truck' and not coalesce((t->>'machine')::boolean, true)) or (jkind = 'car' and coalesce((t->>'machine')::boolean, true)) then continue; end if; hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision; el := (t->>'elat')::double precision; eg := (t->>'elng')::double precision;
      if pinned and t->>'id' <> jtruck then continue; end if;
      n := jsonb_array_length(t->'stops');
      durs := (t->>'durs')::int;
      base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
      basee := public.route_min_to(t->'stops', pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
      v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int; v_bw := 0;
      if v_win and v_try < 3 then v_bw := greatest(0, public.route_walk(t->'stops', pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf)); end if;
      for pos in (t->>'nfixed')::int .. n loop
        cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                  select x, case when o <= pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                  union all select to_jsonb(jid), pos + 1) q);
        rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        v_w := 0;
        if v_win and v_try < 3 then
          v_w := public.route_walk(cand, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf);
          continue when v_w < 0;
        end if;
        used := durs + jdur + rc + v_w;
        if used <= (t->>'cap')::int then
          cost := (rce - basee) + (v_w - v_bw) + 0.2 * used + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
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
        v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int; v_bw := 0;
        if v_win and v_try < 3 then v_bw := greatest(0, public.route_walk(t->'stops', pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf)); end if;
        for pos in (t->>'nfixed')::int .. n loop
          cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
                    select x, case when o <= pos then o else o + 1 end o from jsonb_array_elements(t->'stops') with ordinality s(x, o)
                    union all select to_jsonb(jid), pos + 1) q);
          rc := public.route_min(cand, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          rce := public.route_min_to(cand, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
          v_w := 0;
          if v_win and v_try < 3 then
            v_w := public.route_walk(cand, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf);
            continue when v_w < 0;
          end if;
          used := durs + jdur + rc + v_w;
          if used <= (t->>'cap')::int then
            cost := (rce - basee) + (v_w - v_bw) + 0.2 * used + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
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
        v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int; v_w := 0; v_bw := 0;
        if v_win and v_try < 3 then
          -- the better order drives less but knows nothing of the windows: taken only when they all hold
          v_w := public.route_walk(cand, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf);
          continue when v_w < 0;
          v_bw := greatest(0, public.route_walk(t->'stops', pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf));
        end if;
        used := durs + jdur + rc + v_w;
        if used <= (t->>'cap')::int then
          cost := (rce - basee) + (v_w - v_bw) + 0.2 * used + case when pinned and t->>'id' <> jtruck then 100000 else 0 end + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
          if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_cand := cand; end if;
        end if;
      end loop;
    end if;
    exit when best_ti is not null or not v_win or v_try >= 3 or jid is not distinct from v_xid or coalesce((r.e->>'forced')::boolean, false);
    if v_try = 1 and (pts->jid->>'we') is not null then
      v_try := 2; pts := jsonb_set(pts, array[jid, 'late'], 'true'::jsonb);
    else
      v_try := 3;
    end if;
    end loop;
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
    if v_win then
      -- the order that drives the least is kept only when every window still holds and it costs no more driving + waiting
      -- than the order the stops were put in (which holds them)
      v_start := (trucks->ti->>'start')::int; v_nf := (trucks->ti->>'nfixed')::int;
      v_w := public.route_walk(t || v_tail, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf);
      v_bw := public.route_walk(cand || v_tail, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf);
      if v_bw >= 0 and (v_w < 0 or public.route_min(t || v_tail, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_w
                                 > public.route_min(cand || v_tail, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_bw) then
        t := cand;
      end if;
    end if;
    trucks := jsonb_set(trucks, array[ti::text, 'stops'], t || v_tail);
    t := trucks->ti; tm := (t->>'start')::int; plat := hl; plng := hg; k := 0; v_wt := 0;
    for jid in select jsonb_array_elements_text(t->'stops') loop
      k := k + 1;
      clat := (pts->jid->>'lat')::double precision; clng := (pts->jid->>'lng')::double precision;
      leg := public.drive_min(plat, plng, clat, clng, v_speed, v_detour, v_unknown);
      tm := tm + leg;
      if v_win and k > (t->>'nfixed')::int then
        -- early at a stop with a window: the truck waits until it opens
        v_ws := (pts->jid->>'ws')::int; v_we := (pts->jid->>'we')::int;
        if v_ws is not null and tm < v_ws then v_wt := v_wt + (v_ws - tm); tm := v_ws; end if;
        if v_we is not null and tm > v_we then v_late := v_late || to_jsonb(jid); end if;
      end if;
      out_jobs := out_jobs || jsonb_build_object(jid, coalesce(out_jobs->jid, '{}'::jsonb) || jsonb_build_object('truck', t->>'id', 'order', k, 'eta', coalesce((pts->jid->>'eta0')::int, tm), 'travel', leg + ceil(v_stop)::int));
      tm := tm + ceil(v_stop)::int + (pts->jid->>'dur')::int;
      if clat is not null then plat := clat; plng := clng; end if;
    end loop;
    used := (t->>'durs')::int + public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_wt;
    trucks := jsonb_set(trucks, array[ti::text], (t - 'nfixed' - 'durs') || jsonb_build_object('used', used, 'left', (t->>'cap')::int - used, 'wait', v_wt));
  end loop;

  placed := p_extra is not null and (out_jobs ? (p_extra->>'id'));
  return jsonb_build_object('day', p_day, 'block', p_block, 'trucks', trucks, 'jobs', out_jobs, 'over', over, 'late', v_late,
    'extra', case when p_extra is null then null else jsonb_build_object('placed', placed, 'truck', out_jobs->(p_extra->>'id')->>'truck', 'eta', out_jobs->(p_extra->>'id')->>'eta') end);
end $$;

-- ---------- writing a plan (Part 18), with the one rule block_open ----------
-- Window mode, a day already started: an appointment that has a truck is never thrown to « À placer » by a plan made from
-- « now » (the truck's hours are nearly over, a job runs long…): it stays on its truck as it was.
create or replace function public.apply_plan(p_plan jsonb) returns int language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; n int := 0; c int; d date := nullif(p_plan->>'day', '')::date; bk record; p jsonb; v_moved boolean := false; v_keep boolean;
begin
  perform set_config('garage.rpc', 'on', true);
  for k, v in select * from jsonb_each(coalesce(p_plan->'jobs', '{}')) loop
    if coalesce((v->>'fixed')::boolean, false) then
      update public.jobs set stop_order = (v->>'order')::int, eta_min = (v->>'eta')::int, travel_min = (v->>'travel')::int
      where id = k::uuid and (stop_order, eta_min, travel_min) is distinct from ((v->>'order')::int, (v->>'eta')::int, (v->>'travel')::int);
    else
      update public.jobs set truck_id = (v->>'truck')::uuid, stop_order = (v->>'order')::int, eta_min = (v->>'eta')::int, travel_min = (v->>'travel')::int,
        truck_pinned = truck_pinned and truck_id = (v->>'truck')::uuid
      where id = k::uuid and (truck_id, stop_order, eta_min, travel_min) is distinct from ((v->>'truck')::uuid, (v->>'order')::int, (v->>'eta')::int, (v->>'travel')::int);
    end if;
    get diagnostics c = row_count; n := n + c;
  end loop;
  v_keep := p_plan->>'block' = 'day' and d is not null and d = public.local_today() and public.windows_on()
            and public.now_min() >= (select s.start_min from public.day_span() s);
  if not coalesce(v_keep, false) then
    update public.jobs set truck_id = null, stop_order = null, eta_min = null, travel_min = null, truck_pinned = false
    where id in (select x::uuid from jsonb_array_elements_text(coalesce(p_plan->'over', '[]')) x)
      and (truck_id is not null or stop_order is not null);
    get diagnostics c = row_count; n := n + c;
  end if;

  if n > 0 and d is not null and coalesce(current_setting('garage.chain', true), '') <> 'on' then
    perform set_config('garage.chain', 'on', true);
    for bk in select b.key, b.start_min from public.blocks() b order by b.pos loop
      -- the block just written: again only when a block before it now ends elsewhere
      continue when bk.key = p_plan->>'block' and not v_moved;
      continue when not public.block_open(d, bk.key);
      continue when not exists (select 1 from public.jobs j where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked');
      continue when not pg_try_advisory_xact_lock(hashtext('block:' || d::text || ':' || bk.key));
      p := public.plan_block(d, bk.key);
      continue when exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]')) o join public.jobs j on j.id = o::uuid where j.truck_id is not null);
      if public.apply_plan(p) > 0 then v_moved := true; end if;
    end loop;
    perform set_config('garage.chain', '', true);
    perform set_config('garage.rpc', 'on', true);
  end if;
  return n;
end $$;

create or replace function public.replan_days(p_days date[]) returns int language plpgsql security definer set search_path = public as $$
declare d date; b record; n int := 0; v_chain text := coalesce(current_setting('garage.chain', true), '');
begin
  perform set_config('garage.chain', 'on', true);
  foreach d in array p_days loop
    for b in select x.key, x.start_min from public.blocks() x order by x.pos loop
      if not public.block_open(d, b.key) then continue; end if;
      if exists (select 1 from public.jobs j where j.day = d and j.block = b.key and j.deleted_at is null and j.status = 'booked') then
        perform public.replan_block(d, b.key); n := n + 1;
      end if;
    end loop;
  end loop;
  perform set_config('garage.chain', v_chain, true);
  return n;
end $$;

/* ---------- booking ----------
   book_job(op, job, items): as before. Window mode: job.block = 'day' (or nothing) and
     job.win_start  the window chosen (its start; the server sets the end): refused with `window_full` when the stop can no
                    longer be reached inside it;
     job.win_flex   « flexible »: no window until the evening before;
     neither        the window is cut around the planned arrival (win_for). */
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
  -- the windows (Part 25)
  v_wm boolean := public.windows_on();
  v_ws int := nullif(p_job->>'win_start', '')::int; v_we int; v_flex boolean := coalesce((p_job->>'win_flex')::boolean, false);
  v_x jsonb; v_eta int; sp record;
begin
  if v_done is not null then return v_done; end if;
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi pour réserver.'); end if;
  if not (public.can('book') or (public.has_role('mechanic') and v_truck is not null and v_truck = any(public.my_truck_ids()))) then
    perform public.fail('not_allowed', 'Tu ne peux pas prendre de rendez-vous. Parle au propriétaire.');
  end if;
  if exists (select 1 from public.jobs where id = v_id) then perform public.fail('exists', 'Ce rendez-vous existe déjà.'); end if;
  if v_wm then
    if v_block is not null and v_block <> 'day' then
      perform public.fail('bad_block', 'Le garage donne maintenant une plage d’arrivée de 4 heures : choisis une plage au lieu d’un bloc.');
    end if;
    v_block := 'day';
    if v_flex then v_ws := null; end if;
  else
    v_ws := null; v_flex := false;
  end if;
  select * into b from public.blocks() x where x.key = v_block;
  if not found or v_day is null then perform public.fail('bad_block', 'Choisis la date et le bloc : matin, après-midi ou soir.'); end if;
  if not public.block_open(v_day, v_block) then
    perform public.fail('block_started', case when v_wm then 'Cette journée est finie : choisis une autre journée.' else 'Ce bloc est déjà commencé : choisis un autre bloc.' end);
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

  -- the window chosen: inside the day's hours, and not already over
  if v_ws is not null then
    select * into sp from public.day_span();
    v_we := v_ws + public.win_len();
    if v_ws < sp.start_min or v_we > greatest(sp.end_min, sp.start_min + public.win_len()) then
      perform public.fail('bad_window', 'Cette plage n’est pas dans les heures de la journée : choisis-en une autre.');
    end if;
    if v_day = public.local_today() and public.now_min() > v_we then
      perform public.fail('window_full', 'Cette plage n’est plus libre : choisis-en une autre.');
    end if;
  end if;

  perform public.lock_block(v_day, v_block);
  v_x := jsonb_build_object('id', v_id, 'lat', v_lat, 'lng', v_lng, 'dur', v_dur, 'truck', v_truck, 'need', v_need, 'kind', v_kind)
    || case when v_wm then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end;
  v_plan0 := public.plan_block(v_day, v_block);
  v_plan1 := public.plan_block(v_day, v_block, v_x);
  if jsonb_array_length(v_plan1->'trucks') = 0 then
    perform public.fail('block_closed', case when v_wm then 'Cette journée est fermée : aucun camion ne travaille.' else 'Ce bloc est fermé ce jour-là : aucun camion ne travaille.' end);
  end if;
  -- it fits when it is placed, nobody else loses a place (or a window), it is on the truck asked, and that truck stays inside
  -- its hours (a block with an appointment booked « quand même » is already past them: it takes no more)
  v_nofit := not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or public.plan_late_new(v_plan0, v_plan1)
     or (v_truck is not null and (v_plan1->'extra'->>'truck')::uuid is distinct from v_truck)
     or exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_plan1->'extra'->>'truck' and (x->>'left')::int < 0);
  if v_nofit and v_force then
    -- it does not fit: booked anyway, past the truck's hours, without taking the room of another appointment
    v_plan1 := public.plan_block(v_day, v_block, v_x || jsonb_build_object('force', true));
    v_forced := true;
  end if;
  if v_nofit and not v_forced and v_ws is not null
     and public.plan_fits(v_plan0, public.plan_block(v_day, v_block, v_x || jsonb_build_object('ws', null, 'we', null))) then
    -- the day still has room, but not inside the window chosen
    perform public.fail('window_full', 'Cette plage n’est plus libre : choisis-en une autre.');
  end if;
  if not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or (not v_forced and public.plan_late_new(v_plan0, v_plan1))
     or (not v_forced and v_truck is null and exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_plan1->'extra'->>'truck' and (x->>'left')::int < 0)) then
    perform public.fail('block_full', case when v_wm then 'Cette journée est complète : la route ne rentre plus dans le temps. Choisis une autre journée.'
      else 'Ce bloc est complet : la route ne rentre plus dans le temps. Choisis un autre bloc.' end);
  end if;
  if v_truck is not null and ((v_plan1->'extra'->>'truck')::uuid is distinct from v_truck
     or (not v_forced and exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_truck::text and (x->>'left')::int < 0))) then
    perform public.fail('truck_full', 'Ce camion n’a plus de place dans ce bloc. Laisse l’app choisir le camion, ou choisis un autre bloc.');
  end if;

  perform set_config('garage.rpc', 'on', true);
  insert into public.jobs (id, customer_id, vehicle_id, day, block, truck_id, truck_pinned, forced, duration_min, status, problem, notes,
    address, unit, postal_code, lat, lng, card_on_file, source, quote_id, created_by, needs_machine, vehicle_kind, win_start, win_end, win_flex)
  values (v_id, v_cust, nullif(p_job->>'vehicle_id', '')::uuid, v_day, v_block, (v_plan1->'extra'->>'truck')::uuid, v_truck is not null, v_forced, v_dur, 'booked',
    nullif(p_job->>'problem', ''), nullif(p_job->>'notes', ''), nullif(p_job->>'address', ''), nullif(p_job->>'unit', ''),
    nullif(p_job->>'postal_code', ''), nullif(p_job->>'lat', '')::double precision, nullif(p_job->>'lng', '')::double precision,
    coalesce((p_job->>'card_on_file')::boolean, false), coalesce(nullif(p_job->>'source', ''), 'phone'), nullif(p_job->>'quote_id', '')::uuid, auth.uid(), v_need, v_kind,
    v_ws, v_we, v_flex);
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
  -- no window chosen: it is cut around the planned arrival (a flexible job only once its day is locked). Nothing moves.
  if v_wm and v_ws is null and (not v_flex or public.win_lock_due(v_day)) then
    perform set_config('garage.rpc', 'on', true);
    select j.eta_min into v_eta from public.jobs j where j.id = v_id;
    update public.jobs set win_start = w.win_start, win_end = w.win_end from public.win_for(v_eta) w where id = v_id;
  end if;

  v_res := jsonb_build_object('ok', true, 'job_id', v_id, 'truck_id', v_plan1->'extra'->>'truck', 'forced', v_forced,
    'rows', jsonb_build_object('jobs', public.block_rows(v_day, v_block),
                               'job_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.job_items i where i.job_id = v_id)));
  if v_wm then
    v_res := v_res || (select jsonb_build_object('win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex, 'eta', j.eta_min) from public.jobs j where j.id = v_id);
  end if;
  return public.op_save(p_op, 'book_job', v_res);
end $$;

/* web_book(p): as before. Window mode: p.block = 'day' (or nothing), p.win_start = the window chosen (`window_full` when it
   is no longer free), p.win_flex, or neither (the window is cut around the planned arrival). Answers win_start / win_end. */
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
  -- the windows (Part 25)
  v_wm boolean := public.windows_on();
  v_ws int := case when p->>'win_start' ~ '^\d{1,4}$' then (p->>'win_start')::int end; v_we int;
  v_flex boolean := coalesce(p->>'win_flex', '') = 'true'; v_eta int; sp record; v_res jsonb;
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
  if v_wm then
    if v_block is not null and v_block <> 'day' then perform public.fail('bad_block', 'Choisissez une plage dans la liste.'); end if;
    v_block := 'day';
    if v_flex then v_ws := null; end if;
  else
    v_ws := null; v_flex := false;
  end if;
  select * into b from public.blocks() x where x.key = v_block;
  if not found or v_day is null then perform public.fail('bad_block', 'Choisissez une date dans la liste.'); end if;
  if not public.block_open(v_day, v_block) then
    perform public.fail('block_full', 'Ce moment n’est plus libre. Choisissez-en un autre.');
  end if;
  if v_day > public.local_today() + public.bset('horizon_days', 120)::int then perform public.fail('bad_block', 'Cette date est trop loin.'); end if;
  if v_ws is not null then
    select * into sp from public.day_span();
    v_we := v_ws + public.win_len();
    if v_ws < sp.start_min or v_we > greatest(sp.end_min, sp.start_min + public.win_len()) then perform public.fail('bad_block', 'Choisissez une plage dans la liste.'); end if;
    if v_day = public.local_today() and public.now_min() > v_we then perform public.fail('window_full', 'Cette plage n’est plus libre. Choisissez-en une autre.'); end if;
  end if;

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
    v_res := jsonb_build_object('ok', true, 'job_id', v_again, 'customer_id', v_again_cust, 'new_customer', false, 'day', v_day, 'block', v_block, 'again', true);
    if v_wm then
      v_res := v_res || (select jsonb_build_object('win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex) from public.jobs j where j.id = v_again);
    end if;
    return v_res;
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
    'need', exists (select 1 from public.services sv where sv.id = any(v_services) and sv.needs_machine), 'kind', null)
    || case when v_wm then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end);
  if jsonb_array_length(v_plan1->'trucks') = 0
     or not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or public.plan_late_new(v_plan0, v_plan1)
     or exists (select 1 from jsonb_array_elements(v_plan1->'trucks') x where x->>'id' = v_plan1->'extra'->>'truck' and (x->>'left')::int < 0) then
    if v_ws is not null then perform public.fail('window_full', 'Cette plage vient d’être prise. Choisissez-en une autre.'); end if;
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
    address, unit, postal_code, lat, lng, source, created_by, win_start, win_end, win_flex)
  values (v_id, v_cust, v_veh, v_day, v_block, (v_plan1->'extra'->>'truck')::uuid, false, false, v_dur, 'booked',
    left(nullif(trim(p->>'problem'), ''), 1000), 'Réservé en ligne par le client.', v_addr, left(nullif(trim(p->>'unit'), ''), 20),
    left(nullif(trim(p->>'postal_code'), ''), 10), v_lat, v_lng, 'web', null, v_ws, v_we, v_flex);
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
  if v_wm and v_ws is null and (not v_flex or public.win_lock_due(v_day)) then
    perform set_config('garage.rpc', 'on', true);
    select j.eta_min into v_eta from public.jobs j where j.id = v_id;
    update public.jobs set win_start = w.win_start, win_end = w.win_end from public.win_for(v_eta) w where id = v_id;
  end if;
  insert into public.activity (entity, entity_id, action, data)
  values ('job', v_id, 'web_booked', jsonb_build_object('customer_new', v_new, 'ip', left(p->>'ip', 64)));
  v_res := jsonb_build_object('ok', true, 'job_id', v_id, 'customer_id', v_cust, 'new_customer', v_new, 'day', v_day, 'block', v_block, 'again', false);
  if v_wm then
    v_res := v_res || (select jsonb_build_object('win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex) from public.jobs j where j.id = v_id);
  end if;
  return v_res;
end $$;

-- ---------- the moments offered ----------
-- Window mode: one row per day (the one block) with the estimated arrival and the window to tell the customer
-- (`eta`, `win_start`, `win_end`), and `wait_min` (what the truck would wait); `drive_min` stays the driving added.
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
  -- the whole day (Part 25, « garde-route »)
  v_maxhop numeric := public.bset('max_hop_min', 35);
  v_maxday numeric := public.bset('max_day_drive_min', 105);
  v_x jsonb := jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng);
  tk record; w0 jsonb; w1 jsonb; v_truck text; min0 int; min1 int; km0 numeric; km1 numeric; v_day int; v_hop int; v_stops int; v_far text;
  -- « plages d'arrivée »
  v_wm boolean := public.windows_on(); wait0 int; wait1 int; v_eta int; v_row jsonb;
begin
  for d in select generate_series(v_from, v_from + greatest(1, least(p_days, 60)) - 1, interval '1 day')::date loop
    for b in select * from public.blocks() loop
      if not public.block_open(d, b.key) then continue; end if;
      p0 := public.plan_block(d, b.key, null, p_exclude);
      if jsonb_array_length(p0->'trucks') = 0 then continue; end if;
      p1 := public.plan_block(d, b.key, jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', p_duration, 'need', v_need, 'kind', v_kind)
        || case when v_wm then jsonb_build_object('ws', null, 'we', null) else '{}'::jsonb end, p_exclude);
      if not coalesce((p1->'extra'->>'placed')::boolean, false) then continue; end if;
      if exists (select 1 from jsonb_array_elements_text(p1->'over') o where not ((p0->'over') ? o)) then continue; end if;
      if public.plan_late_new(p0, p1) then continue; end if;
      -- the truck it goes on must stay inside its hours (as book_job asks)
      if exists (select 1 from jsonb_array_elements(p1->'trucks') t where t->>'id' = p1->'extra'->>'truck' and (t->>'left')::int < 0) then continue; end if;
      select coalesce(sum((t->>'used')::int), 0), coalesce(sum(coalesce((t->>'wait')::int, 0)), 0) into used0, wait0 from jsonb_array_elements(p0->'trucks') t;
      select coalesce(sum((t->>'used')::int), 0), coalesce(sum(coalesce((t->>'wait')::int, 0)), 0) into used1, wait1 from jsonb_array_elements(p1->'trucks') t;
      select count(*) into near from public.jobs j left join public.customers c on c.id = j.customer_id
        where j.day = d and j.block = b.key and j.deleted_at is null and j.status not in ('cancelled','no_show')
          and (p_exclude is null or j.id <> p_exclude)
          and public.km_between(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) <= v_near;
      -- the whole day of the vehicles of the block, without and with the appointment
      v_truck := p1->'extra'->>'truck'; min0 := 0; min1 := 0; km0 := 0; km1 := 0; v_day := null; v_hop := null; v_stops := 0;
      for tk in select (e->>'id')::uuid id from jsonb_array_elements(p1->'trucks') e loop
        w0 := public.day_drive(d, tk.id, p0, null, p_exclude);
        w1 := public.day_drive(d, tk.id, p1, v_x, p_exclude);
        min0 := min0 + (w0->>'min')::int; min1 := min1 + (w1->>'min')::int;
        km0 := km0 + (w0->>'km')::numeric; km1 := km1 + (w1->>'km')::numeric;
        if tk.id::text = v_truck then
          v_day := (w1->>'min')::int; v_hop := (w1->>'hop')::int; v_stops := greatest(0, (w1->>'stops')::int - 1);
        end if;
      end loop;
      v_far := case when p_lat is null or p_lng is null or v_stops = 0 then null
                    when v_maxhop > 0 and v_hop is not null and v_hop > v_maxhop then 'hop'
                    when v_maxday > 0 and v_day > v_maxday then 'day' end;
      v_row := jsonb_build_object('day', d, 'block', b.key, 'pos', b.pos, 'drive_min', greatest(0, used1 - used0 - p_duration - (wait1 - wait0)),
        'near', near, 'truck', v_truck, 'left', (select max((t->>'left')::int) from jsonb_array_elements(p1->'trucks') t),
        'add_min', greatest(0, min1 - min0), 'add_km', greatest(0, round(km1 - km0, 1)), 'day_min', v_day, 'hop_min', v_hop, 'stops', v_stops, 'far', v_far);
      if v_wm then
        v_eta := (p1->'extra'->>'eta')::int;
        v_row := v_row || jsonb_build_object('eta', v_eta, 'wait_min', greatest(0, wait1 - wait0))
          || coalesce((select jsonb_build_object('win_start', w.win_start, 'win_end', w.win_end) from public.win_for(v_eta) w), '{}'::jsonb);
      end if;
      out := out || jsonb_build_array(v_row);
    end loop;
  end loop;
  -- the moments that are not far first, then the least driving added over the day (and the least waiting, with windows)
  return coalesce((select jsonb_agg(e order by o) from (select e, row_number() over (
      order by (e->>'far' is not null), (e->>'add_min')::int + coalesce((e->>'wait_min')::int, 0), (e->>'near')::int desc, e->>'day', (e->>'pos')::int) o
    from jsonb_array_elements(out) e) q where o <= greatest(1, p_limit)), '[]'::jsonb);
end $$;

-- every window still possible on one day: each start of the day, in steps of win_round_min, with the stop held inside it;
-- kept when it is placed without anybody losing a place or a window and the truck stays inside its hours. Best first
-- (least driving + waiting added, then the earliest).
create or replace function public.suggest_windows_core(p_lat double precision, p_lng double precision, p_duration int, p_day date,
  p_exclude uuid default null, p_need boolean default false, p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p0 jsonb; p1 jsonb; out jsonb := '[]'; used0 int; used1 int; wait0 int; wait1 int; near int; v_near numeric := public.bset('near_km', 5);
  x uuid := '00000000-0000-4000-8000-000000000000';
  v_need boolean := coalesce(p_need, false) or coalesce((select j.needs_machine from public.jobs j where j.id = p_exclude), false);
  v_kind text := coalesce(case when p_kind in ('car', 'truck') then p_kind end, (select j.vehicle_kind from public.jobs j where j.id = p_exclude));
  v_dur int := greatest(15, least(720, coalesce(p_duration, 60)));
  v_len int := public.win_len(); v_step int := greatest(public.bset('win_round_min', 60)::int, 15); v_ws int; sp record; k int := 0;
begin
  if not public.windows_on() or p_day is null or not public.block_open(p_day, 'day') then return '[]'::jsonb; end if;
  if p_day > public.local_today() + public.bset('horizon_days', 120)::int then return '[]'::jsonb; end if;
  select * into sp from public.day_span();
  p0 := public.plan_block(p_day, 'day', null, p_exclude);
  if jsonb_array_length(p0->'trucks') = 0 then return '[]'::jsonb; end if;
  select coalesce(sum((t->>'used')::int), 0), coalesce(sum(coalesce((t->>'wait')::int, 0)), 0) into used0, wait0 from jsonb_array_elements(p0->'trucks') t;
  select count(*) into near from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.day = p_day and j.block = 'day' and j.deleted_at is null and j.status not in ('cancelled','no_show')
      and (p_exclude is null or j.id <> p_exclude)
      and public.km_between(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) <= v_near;
  v_ws := sp.start_min;
  while v_ws + v_len <= sp.end_min and k < 60 loop
    k := k + 1;
    if not (p_day = public.local_today() and public.now_min() > v_ws + v_len) then
      p1 := public.plan_block(p_day, 'day', jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', v_dur, 'need', v_need, 'kind', v_kind,
        'ws', v_ws, 'we', v_ws + v_len), p_exclude);
      if public.plan_fits(p0, p1) then
        select coalesce(sum((t->>'used')::int), 0), coalesce(sum(coalesce((t->>'wait')::int, 0)), 0) into used1, wait1 from jsonb_array_elements(p1->'trucks') t;
        out := out || jsonb_build_array(jsonb_build_object('day', p_day, 'block', 'day', 'pos', k, 'drive_min', greatest(0, used1 - used0 - v_dur - (wait1 - wait0)),
          'wait_min', greatest(0, wait1 - wait0), 'near', near, 'truck', p1->'extra'->>'truck',
          'left', (select max((t->>'left')::int) from jsonb_array_elements(p1->'trucks') t),
          'eta', (p1->'extra'->>'eta')::int, 'win_start', v_ws, 'win_end', v_ws + v_len));
      end if;
    end if;
    v_ws := v_ws + v_step;
  end loop;
  return coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(out) e
    order by (e->>'drive_min')::int + (e->>'wait_min')::int, (e->>'win_start')::int) q), '[]'::jsonb);
end $$;
create or replace function public.suggest_windows(p_lat double precision, p_lng double precision, p_duration int, p_day date,
  p_exclude uuid default null, p_need boolean default false, p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then return '[]'::jsonb; end if;
  return public.suggest_windows_core(p_lat, p_lng, p_duration, p_day, p_exclude, p_need, p_kind);
end $$;
-- the same for the online booking page (function `book`): the windows of one day
create or replace function public.web_windows(p_lat double precision, p_lng double precision, p_services uuid[], p_day date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.web_on() then perform public.fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.'); end if;
  if not public.web_in_area(p_lat, p_lng) then perform public.fail('far', 'Cette adresse est en dehors de notre secteur. Appelez le garage.'); end if;
  if coalesce(cardinality(p_services), 0) = 0 then perform public.fail('no_service', 'Choisissez au moins un service.'); end if;
  return public.suggest_windows_core(p_lat, p_lng, public.web_duration(p_services), p_day, null,
    exists (select 1 from public.services sv where sv.id = any(p_services) and sv.needs_machine), null);
end $$;

/* ---------- moving a job ----------
   move_job(op, job, day, block, truck, win_start, win_flex): window mode, the new window (win_start) or « flexible »
   (win_flex true). Both null (the 5-argument call): the same day keeps what the customer was told; another day cuts a new
   window around the planned arrival (a flexible job stays flexible). win_flex false with no win_start: a window cut around
   the planned arrival. */
create or replace function public.move_job(p_op uuid, p_job uuid, p_day date, p_block text, p_truck uuid, p_win_start int, p_win_flex boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_done jsonb := public.op_done(p_op);
  j public.jobs; b record; v_lat double precision; v_lng double precision; v_plan0 jsonb; v_plan1 jsonb; v_res jsonb;
  v_wm boolean := public.windows_on(); v_ws int; v_we int; v_flex boolean := false; v_moved boolean; v_same boolean := true;
  v_x jsonb; v_eta int; sp record;
begin
  if v_done is not null then return v_done; end if;
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if not (public.can('book') or (p_truck is not null and p_truck = any(public.my_truck_ids()) and j.truck_id = any(public.my_truck_ids()))) then
    perform public.fail('not_allowed', 'Tu ne peux pas déplacer ce rendez-vous.');
  end if;
  if j.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  select * into b from public.blocks() x where x.key = p_block;
  if not found then
    perform public.fail('bad_block', case when v_wm then 'Le garage donne maintenant une plage d’arrivée de 4 heures : choisis une plage au lieu d’un bloc.' else 'Bloc inconnu.' end);
  end if;
  if not public.block_open(p_day, p_block) then
    perform public.fail('block_started', case when v_wm then 'Cette journée est finie : choisis une autre journée.' else 'Ce bloc est déjà commencé.' end);
  end if;
  v_moved := j.day <> p_day or j.block <> p_block;
  if v_wm then
    if coalesce(p_win_flex, false) then
      v_flex := true; v_ws := null;
      v_same := j.win_flex;
      if v_same then v_ws := j.win_start; v_we := j.win_end; end if;       -- already flexible: its window, if fixed, stays
    elsif p_win_start is not null then
      v_flex := false; v_ws := p_win_start; v_we := p_win_start + public.win_len();
      v_same := not j.win_flex and j.win_start is not distinct from p_win_start;
      select * into sp from public.day_span();
      if v_ws < sp.start_min or v_we > greatest(sp.end_min, sp.start_min + public.win_len()) then
        perform public.fail('bad_window', 'Cette plage n’est pas dans les heures de la journée : choisis-en une autre.');
      end if;
      if p_day = public.local_today() and public.now_min() > v_we then
        perform public.fail('window_full', 'Cette plage n’est plus libre : choisis-en une autre.');
      end if;
    elsif p_win_flex is not null then
      v_flex := false; v_ws := null; v_same := false;                      -- a window cut around the planned arrival
    elsif not v_moved then
      v_flex := j.win_flex; v_ws := j.win_start; v_we := j.win_end;        -- the same day: what the customer was told
    else
      v_flex := j.win_flex; v_ws := null;
    end if;
    if v_moved and v_flex then v_ws := null; v_we := null; end if;         -- flexible on another day: fixed again later
  end if;
  if not v_moved and v_same and p_truck is not distinct from (case when j.truck_pinned then j.truck_id end) then
    return public.op_save(p_op, 'move_job', jsonb_build_object('ok', true, 'unchanged', true, 'rows', jsonb_build_object('jobs', jsonb_build_array(to_jsonb(j)))));
  end if;
  -- the two blocks, always locked in the same order (day, then morning → evening)
  perform public.lock_two(j.day, j.block, p_day, p_block);
  select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into v_lat, v_lng from public.customers c where c.id = j.customer_id;
  v_x := jsonb_build_object('id', j.id, 'lat', v_lat, 'lng', v_lng, 'dur', j.duration_min, 'truck', p_truck,
    -- a vehicle chosen by hand: its kind becomes the job's (work for the tire machine still needs the machine)
    'need', j.needs_machine, 'kind', case when p_truck is not null then (select case when tr.tire_machine then 'truck' else 'car' end from public.trucks tr where tr.id = p_truck) else j.vehicle_kind end)
    || case when v_wm then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end;
  v_plan0 := public.plan_block(p_day, p_block, null, j.id);
  v_plan1 := public.plan_block(p_day, p_block, v_x, j.id);
  if jsonb_array_length(v_plan1->'trucks') = 0 then
    perform public.fail('block_closed', case when v_wm then 'Cette journée est fermée : aucun camion ne travaille.' else 'Ce bloc est fermé ce jour-là.' end);
  end if;
  if not coalesce((v_plan1->'extra'->>'placed')::boolean, false)
     or exists (select 1 from jsonb_array_elements_text(v_plan1->'over') o where not ((v_plan0->'over') ? o))
     or public.plan_late_new(v_plan0, v_plan1) then
    if v_ws is not null then
      v_res := public.plan_block(p_day, p_block, v_x || jsonb_build_object('ws', null, 'we', null), j.id);
      if coalesce((v_res->'extra'->>'placed')::boolean, false)
         and not exists (select 1 from jsonb_array_elements_text(v_res->'over') o where not ((v_plan0->'over') ? o))
         and not public.plan_late_new(v_plan0, v_res) then
        perform public.fail('window_full', 'Cette plage n’est plus libre : choisis-en une autre.');
      end if;
    end if;
    perform public.fail('block_full', case when v_wm then 'Cette journée est complète : la route ne rentre plus dans le temps.' else 'Ce bloc est complet : la route ne rentre plus dans le temps.' end);
  end if;
  if p_truck is not null and (v_plan1->'extra'->>'truck')::uuid is distinct from p_truck then
    perform public.fail('truck_full', 'Ce camion n’a plus de place dans ce bloc.');
  end if;
  perform set_config('garage.rpc', 'on', true);
  update public.jobs set day = p_day, block = p_block, truck_id = (v_plan1->'extra'->>'truck')::uuid, truck_pinned = p_truck is not null,
    win_start = v_ws, win_end = v_we, win_flex = v_flex,
    -- a new window is a new moment: the place chosen by hand in the route is forgotten, the customer is told again
    manual_order = case when v_ws is distinct from win_start then null else manual_order end,
    confirm_sent_at = case when day <> p_day or block <> p_block or (v_ws is not null and v_ws is distinct from win_start) then null else confirm_sent_at end
  where id = j.id;
  perform public.apply_plan(v_plan1);
  if v_moved and exists (select 1 from public.blocks() x where x.key = j.block) then perform public.apply_plan(public.plan_block(j.day, j.block)); end if;
  -- no window said: it is cut around the planned arrival (a flexible job only once its day is locked). Nothing moves.
  if v_wm and v_ws is null and (not v_flex or public.win_lock_due(p_day)) then
    perform set_config('garage.rpc', 'on', true);
    select x.eta_min into v_eta from public.jobs x where x.id = j.id;
    update public.jobs set win_start = w.win_start, win_end = w.win_end,
      confirm_sent_at = case when j.win_start is distinct from w.win_start then null else confirm_sent_at end
    from public.win_for(v_eta) w where id = j.id;
  end if;
  v_res := jsonb_build_object('ok', true, 'job_id', j.id, 'changed', v_moved,
    'rows', jsonb_build_object('jobs', public.block_rows(p_day, p_block) || case when v_moved then public.block_rows(j.day, j.block) else '[]'::jsonb end));
  return public.op_save(p_op, 'move_job', v_res);
end $$;
-- the call of before (5 arguments) is the same move, with nothing said about the window
create or replace function public.move_job(p_op uuid, p_job uuid, p_day date, p_block text, p_truck uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.move_job(p_op, p_job, p_day, p_block, p_truck, null::int, null::boolean);
end $$;

-- ---------- two small rules in functions that are otherwise unchanged (their text as the database has it) ----------
-- job_step « reopen »: the one rule block_open (window mode: a job of today is put back while the day is not over)
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.job_step(uuid, uuid, text, jsonb)'::regprocedure);
  n := replace(d, 'if j.day < public.local_today() or (j.day = public.local_today() and public.now_min() >= b.start_min) then',
                  'if not public.block_open(j.day, j.block) then');
  if n = d then raise exception 'job_step: the line to change was not found'; end if;
  execute n;
end $$;
-- walk_in: window mode, work on the spot is a job of the day's one block
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.walk_in(uuid, jsonb, jsonb)'::regprocedure);
  n := replace(d, 'if v_block is null then v_block := case when v_now < 720 then ''am'' when v_now < 960 then ''pm'' else ''eve'' end; end if;',
                  'if public.windows_on() then v_block := ''day''; elsif v_block is null then v_block := case when v_now < 720 then ''am'' when v_now < 960 then ''pm'' else ''eve'' end; end if;');
  if n = d then raise exception 'walk_in: the line to change was not found'; end if;
  execute n;
end $$;

-- ---------- « flexible » jobs get their window ----------
-- each flexible job of that day with no window yet (still booked): the day is planned again, then its window is cut around
-- its planned arrival. win_flex stays true (it says how the job was booked). Nothing else moves: the arrival is inside.
create or replace function public.lock_windows_core(p_day date) returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_ids jsonb := '[]'; n int := 0; w record;
begin
  if not public.windows_on() or p_day is null or p_day < public.local_today() then return jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb); end if;
  perform public.lock_block(p_day, 'day');
  if not exists (select 1 from public.jobs j where j.day = p_day and j.block = 'day' and j.status = 'booked' and j.deleted_at is null and j.win_flex and j.win_start is null) then
    return jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb);
  end if;
  perform public.replan_block(p_day, 'day');
  perform set_config('garage.rpc', 'on', true);
  for r in select j.id, j.eta_min from public.jobs j
           where j.day = p_day and j.block = 'day' and j.status = 'booked' and j.deleted_at is null and j.win_flex and j.win_start is null and j.eta_min is not null
           order by j.eta_min, j.id loop
    select * into w from public.win_for(r.eta_min);
    update public.jobs set win_start = w.win_start, win_end = w.win_end where id = r.id;
    insert into public.activity (entity, entity_id, action, data)
    values ('job', r.id, 'window_fixed', jsonb_build_object('day', p_day, 'win_start', w.win_start, 'win_end', w.win_end));
    v_ids := v_ids || to_jsonb(r.id); n := n + 1;
  end loop;
  return jsonb_build_object('fixed', n, 'jobs', v_ids);
end $$;
create or replace function public.lock_windows(p_op uuid, p_day date) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); v_res jsonb;
begin
  if v_done is not null then return v_done; end if;
  if not (public.is_owner() or public.has_role('office')) then
    perform public.fail('not_allowed', 'Seuls le propriétaire et le bureau fixent les plages d’arrivée.');
  end if;
  if p_day is null or p_day < public.local_today() then perform public.fail('past', 'Cette journée est passée.'); end if;
  v_res := public.lock_windows_core(p_day);
  return public.op_save(p_op, 'lock_windows', v_res || jsonb_build_object('ok', true, 'rows', jsonb_build_object('jobs', public.block_rows(p_day, 'day'))));
end $$;
-- for a scheduler: today's flexible jobs still without a window, and tomorrow's once the lock hour (18:00) is past
create or replace function public.lock_windows_due() returns jsonb language plpgsql security definer set search_path = public as $$
declare a jsonb; b jsonb := jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb);
begin
  if not public.windows_on() then return jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb); end if;
  a := public.lock_windows_core(public.local_today());
  if public.win_lock_due(public.local_today() + 1) then b := public.lock_windows_core(public.local_today() + 1); end if;
  perform set_config('garage.rpc', '', true);
  return jsonb_build_object('fixed', (a->>'fixed')::int + (b->>'fixed')::int, 'jobs', (a->'jobs') || (b->'jobs'));
end $$;

-- ---------- the switch ----------
-- settings.booking.windows_on changes only through windows_switch: a settings save from a phone that still has the old
-- value (or anything else) leaves it as it is.
create or replace function public.settings_windows_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('garage.windows', true), '') <> 'on'
     and (new.booking->'windows_on') is distinct from (old.booking->'windows_on') then
    new.booking := case when old.booking ? 'windows_on' then jsonb_set(coalesce(new.booking, '{}'::jsonb), '{windows_on}', old.booking->'windows_on')
                        else new.booking - 'windows_on' end;
  end if;
  return new;
end $$;
drop trigger if exists settings_windows_guard on public.settings;
create trigger settings_windows_guard before update of booking on public.settings for each row execute function public.settings_windows_guard();

-- windows_switch(op, on): owner only. ON: today's and the coming jobs become jobs of the day, their window = the hours of the
-- block they were booked in (that is what those customers were told). OFF: each one goes back to the block of its window's start (what the
-- customer was told; else of its planned arrival, else the first block), no window. Then the coming days are planned again; a day whose
-- new plan would throw an appointment to « À placer » stays as it was. Past days are never touched. Safe to call twice.
create or replace function public.windows_switch(p_op uuid, p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_done jsonb := public.op_done(p_op); v_today date := public.local_today(); n int := 0; d date; bk record; p jsonb;
  v_chain text := coalesce(current_setting('garage.chain', true), '');
begin
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire change la façon de donner les heures aux clients.'); end if;
  if p_on is null then perform public.fail('bad_mode', 'Choisis : les plages d’arrivée, ou les blocs.'); end if;
  perform pg_advisory_xact_lock(hashtext('windows_switch'));
  if public.windows_on() = p_on then
    return public.op_save(p_op, 'windows_switch', jsonb_build_object('ok', true, 'converted', 0, 'unchanged', true, 'on', p_on));
  end if;
  perform set_config('garage.rpc', 'on', true);
  if p_on then
    select count(*) into n from public.jobs j where j.day >= v_today and j.block <> 'day' and j.deleted_at is null;
    update public.jobs j set block = 'day', win_start = x.start_min, win_end = x.end_min, win_flex = false
      from public.blocks_set() x where x.key = j.block and j.day >= v_today and j.block <> 'day';
  else
    select count(*) into n from public.jobs j where j.day >= v_today and j.block = 'day' and j.deleted_at is null;
    update public.jobs j set
      block = coalesce(
        -- what the customer was told first (a job that came from a block goes back to that very block), then where it is planned
        (select x.key from public.blocks_set() x where j.win_start >= x.start_min and j.win_start < x.end_min order by x.pos limit 1),
        (select x.key from public.blocks_set() x where j.eta_min >= x.start_min and j.eta_min < x.end_min order by x.pos limit 1),
        (select x.key from public.blocks_set() x order by x.pos limit 1), 'am'),
      win_start = null, win_end = null, win_flex = false
    where j.day >= v_today and j.block = 'day';
  end if;
  perform set_config('garage.windows', 'on', true);
  update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{windows_on}', to_jsonb(p_on)) where id = 1;
  perform set_config('garage.windows', '', true);
  perform set_config('garage.rpc', 'on', true);
  -- the stops of each truck numbered again inside their new block, by arrival (for the blocks that are not planned again)
  update public.jobs j set stop_order = q.rn
    from (select x.id, (row_number() over (partition by x.day, x.block, x.truck_id order by x.eta_min nulls last, x.stop_order nulls last, x.created_at))::int rn
          from public.jobs x where x.day >= v_today and x.deleted_at is null and x.truck_id is not null and x.stop_order is not null
            and x.status not in ('cancelled', 'no_show')) q
    where q.id = j.id and j.stop_order is distinct from q.rn;
  -- the coming days, in block order, each block from the new end of the one before (as replan_days does)
  perform set_config('garage.chain', 'on', true);
  for d in select distinct j.day from public.jobs j where j.day >= v_today and j.status = 'booked' and j.deleted_at is null order by 1 loop
    for bk in select x.key from public.blocks() x order by x.pos loop
      continue when not public.block_open(d, bk.key);
      continue when not exists (select 1 from public.jobs j where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked');
      perform public.lock_block(d, bk.key);
      p := public.plan_block(d, bk.key);
      continue when exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid where j.truck_id is not null);
      perform public.apply_plan(p);
    end loop;
  end loop;
  perform set_config('garage.chain', v_chain, true);
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'settings', null, 'windows_switch', jsonb_build_object('on', p_on, 'converted', n));
  return public.op_save(p_op, 'windows_switch', jsonb_build_object('ok', true, 'converted', n, 'on', p_on));
end $$;

-- ---------- rights ----------
-- the app calls: suggest_windows, move_job (7 arguments), lock_windows, windows_switch. The rest is the server's own.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['windows_on', 'blocks_set', 'day_span', 'win_len', 'win_for', 'win_lock_due', 'route_walk',
      'plan_late_new', 'plan_fits', 'suggest_windows_core', 'web_windows', 'lock_windows_core', 'lock_windows_due', 'settings_windows_guard',
      'suggest_windows', 'lock_windows', 'windows_switch'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname in ('suggest_windows', 'lock_windows', 'windows_switch') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
revoke all on function public.move_job(uuid, uuid, date, text, uuid, int, boolean) from public, anon;
grant execute on function public.move_job(uuid, uuid, date, text, uuid, int, boolean) to authenticated, service_role;

-- every 10 minutes (when the database offers scheduled jobs): the flexible jobs whose day is locked get their window
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('garage-lock-windows', '*/10 * * * *', 'select public.lock_windows_due()');
  end if;
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;
