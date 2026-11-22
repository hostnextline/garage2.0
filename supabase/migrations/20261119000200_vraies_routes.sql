-- Part 27 — « Vraies routes » (2026-11-19): the planner counts the driving with real road times, never a straight line.
--
-- Until now every minute of driving the planner counted (the moments offered, the order of the stops, « Garde-route », the
-- arrival windows) was drive_min: the straight line between two points × a detour number, at an average speed. This Part
-- gives drive_min a second way: the time a map service measured on the real roads (TomTom with its usual traffic; OSRM when
-- TomTom does not answer), kept in drive_times by the server function « drive ». Three times a trip on a working day,
-- because the same road is not the same at 8 h, at noon and at 17 h (garage → Brossard: 24 min at 11 h 30, 44 at 17 h):
--   slot 0 = the usual hours (also Saturday, Sunday and any hour not in a rush),
--   slot 1 = the morning rush, Monday to Friday, leaving from 6 h 30 to 9 h 29,
--   slot 2 = the evening rush, Monday to Friday, leaving from 15 h to 18 h 29.
-- (booking.roads_rush false: the usual hours only.)
--
-- ONE CLOCK. With the switch on, every decision of the planner (does it fit: used / left / over, is it late, where a new stop
-- goes, the longest hop and the day's driving of « Garde-route ») counts the same drive times as the arrival times it writes:
-- each leg at the minute the truck leaves for it (route_clock). Only the ORDER that route_improve proposes is searched with
-- the usual-hours times (a way to find a good order fast); that order is then counted on the clock before it is taken.
--
-- INERT while settings.booking.roads_on is not true: the planner answers exactly what it answered before (the same numbers,
-- the same keys, so the same plans; every test of before passes unchanged, and tests/db/vraies-routes-off.test.mjs compares
-- the answers with the definitions of before). The switch is roads_switch(op, on) only (owner; a plain settings save never
-- flips it: trigger settings_roads_guard). It refuses ON while a trip of the coming days is not measured yet (the app asks
-- the function « drive » first), then plans the coming days again with the real times; a block whose new plan would throw
-- an appointment to « À placer » stays as it was but gets its real arrival times, and the answer says who is now late.
-- OFF goes back to the estimate the same way.
--
-- ON, a trip that is not measured yet counts the garage's fixed « position inconnue » time (booking.unknown_min, 20) and
-- NEVER the straight line (Hassan's rule, 2026-11-19), and every answer says it (« unmeasured »): no km, never « far » by a
-- guess, never offered online. drive_wanted lists what is missing and the function « drive » asks for it.

-- ---------- the road times kept ----------
-- One row a trip (from a to b, the road there is not the road back) and a time of the day. source 'none': TomTom and OSRM
-- both said there is no road between the two (usually an address put at a wrong place): no minutes, no km, and it counts as
-- not measured (the planner takes the fixed time of an unknown position, never a guess); drive_wanted asks it again after
-- 7 days. A straight line is never a source.
create table if not exists public.drive_times (
  a bigint not null,                       -- from: drive_key of the point (about 100 m)
  b bigint not null,                       -- to
  slot smallint not null default 0 check (slot in (0, 1, 2)),
  minutes integer check (minutes >= 0),    -- null only for 'none'
  km numeric(7,1) check (km is null or km >= 0),
  source text not null check (source in ('tomtom', 'osrm', 'none')),
  at timestamptz not null default now(),
  primary key (a, b, slot),
  constraint drive_times_none check ((source = 'none') = (minutes is null) and (source <> 'none' or km is null))
);
alter table public.drive_times enable row level security;
revoke all on public.drive_times from public, anon, authenticated;
grant all on public.drive_times to service_role;

-- what TomTom's Matrix service charged this month (its « transactions »: the billing rule is in the function « drive »).
-- The function « drive » adds a request's cost here BEFORE sending it (drive_spend_add), so the month's ceiling
-- (booking.roads_month_tx) is never passed, even by two calls at the same time. Neither table is backed up: what was
-- measured is asked again after a restore, and the spend belongs to TomTom's own count.
create table if not exists public.drive_spend (
  month date primary key,                  -- the first day of the month (Montréal)
  tx integer not null default 0 check (tx >= 0),
  requests integer not null default 0 check (requests >= 0)
);
alter table public.drive_spend enable row level security;
revoke all on public.drive_spend from public, anon, authenticated;
grant all on public.drive_spend to service_role;
-- (final-money F3) TomTom said « no road » for that trip and OSRM found one: the OSRM time is kept with the day TomTom said so,
-- and TomTom is asked again only 7 days later (as a « none » row), never every day
alter table public.drive_times add column if not exists tt_none_at timestamptz;

-- (final-guess G1, the lead's decision 2 of 2026-11-21) is the planned arrival of this appointment counted with measured trips
-- only? null while the switch is off and for an appointment with no arrival time; true when every trip of its vehicle's day up
-- to it (from the vehicle's start, block after block, in the order driven) has a usual-hours time measured; false while one of
-- them counts the fixed unknown time. Written by the planner wherever it writes eta_min (route_mark, at the end of apply_plan
-- and of route_retime), cleared when the switch goes off. A window told to the customer is never cut from a false one, and a
-- false one is never judged « late ». The app reads it with the other columns (select=*); nobody but the server writes it
alter table public.jobs add column if not exists eta_measured boolean;

-- ---------- « Un déplacement tombe exactement où on pointe » (Hassan, 2026-11-21; STATE.md « exact move », S1 – S9) ----------
-- « when i move an appointement, i want it to move exactly where i point it to move, but the rest stays the same. keep
-- showing the timeframe of 1h before and 2 hours after ». Until now a move by hand sent only the start of a 4-hour window:
-- the planner then planned the whole day again, so the appointment landed anywhere in the 4 hours (measured: 60 min before
-- to 95 min after the minute pointed) and the other stops changed order and times.
-- S1: jobs.arrive_at = the minute of the day the person pointed (« Heure pointée »). Written by the server only (no column
-- grant: a person's columns are listed in 20261104000200_access.sql), backed up with the job (the backups take every column).
-- null on every appointment until a move with a minute is made: a job without it is planned exactly as before (S9).
alter table public.jobs add column if not exists arrive_at integer check (arrive_at between 0 and 1439);

-- a point to about 100 m (3 decimals): two doors of the same building are the same place for the road
create or replace function public.drive_key(p_lat double precision, p_lng double precision) returns bigint
language sql immutable as $$
  select case when p_lat is null or p_lng is null then null
    else (round((p_lat + 90) * 1000))::bigint * 1000000 + (round((p_lng + 180) * 1000))::bigint end
$$;
-- which of the three times of a trip: the day of the week (1 = Monday … 7 = Sunday) and the minute of the day it leaves at
create or replace function public.drive_slot(p_dow integer, p_tm integer) returns smallint
language sql immutable as $$
  select (case when p_tm is null or p_dow is null or p_dow not between 1 and 5 then 0
               when p_tm >= 390 and p_tm < 570 then 1
               when p_tm >= 900 and p_tm < 1110 then 2
               else 0 end)::smallint
$$;
-- (compared as JSON, never cast: a value that is not true or false, written by a script, reads as « off » instead of
-- stopping the whole planner; review-sql L8)
create or replace function public.roads_on() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.booking->'roads_on' = 'true'::jsonb from public.settings s where s.id = 1), false)
$$;
-- a yes / no setting said « no »: false, or written by a script as the text "false" / "0" or the number 0 (verify-on F9)
create or replace function public.roads_no(v jsonb) returns boolean language sql immutable as $$
  select case jsonb_typeof(v) when 'boolean' then v = 'false'::jsonb
                              when 'number' then (v #>> '{}')::numeric = 0
                              when 'string' then lower(btrim(v #>> '{}')) in ('false', '0')
                              else false end
$$;
-- a number setting of the measuring (booking.<key>): a number (or a text that is one) kept between lo and hi; anything else
-- (a word, nothing) is the default. Never an error: a word typed in a setting must not stop the measuring (verify-measure F1)
create or replace function public.roads_num(p_key text, p_def numeric, p_lo numeric, p_hi numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select case when jsonb_typeof(x.v) = 'number' then least(greatest((x.v #>> '{}')::numeric, p_lo), p_hi)
              when jsonb_typeof(x.v) = 'string' and btrim(x.v #>> '{}') ~ '^-?[0-9]+([.][0-9]+)?$'
                then least(greatest(btrim(x.v #>> '{}')::numeric, p_lo), p_hi)
              else p_def end
  from (select (select s.booking->p_key from public.settings s where s.id = 1) v) x
$$;
-- a coordinate sent as JSON (a point asked about, a measured row): the number when it is one and |it| <= p_lim, else null.
-- Compared as numeric first: a number no double precision can hold (1e400, 1e-400) is left out, never an error
-- (verify-measure F2, F4)
create or replace function public.drive_coord(v jsonb, p_lim numeric) returns double precision language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' and abs((v #>> '{}')::numeric) <= p_lim
                   and ((v #>> '{}')::numeric = 0 or abs((v #>> '{}')::numeric) >= 1e-300)
              then (v #>> '{}')::double precision end
$$;
-- the rush-hour times are used unless the garage said no (booking.roads_rush false, or "false", 0, "0"; anything else, or
-- nothing, is yes)
create or replace function public.roads_rush() returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce((select public.roads_no(s.booking->'roads_rush') from public.settings s where s.id = 1), false)
$$;
-- the day of the week being planned (set by the planner for the rest of its transaction; nothing set = the usual hours)
create or replace function public.drive_dow() returns integer language sql stable as $$
  select nullif(current_setting('garage.drive_dow', true), '')::integer
$$;

-- minutes to drive between two points, leaving at minute p_tm of the day (null: the usual hours).
-- Roads off: the estimate of before (straight line × detour at an average speed), unchanged.
-- Roads on: the time measured on the road for that hour (when the garage uses the rush times), else for the usual hours;
-- not measured yet (no row, or a row that says there is no road: minutes null): the fixed time of an unknown position.
-- A point with no position counts that fixed time either way, as before.
create or replace function public.drive_min(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric, p_tm integer) returns integer
language plpgsql stable security definer set search_path = public as $$
declare ka bigint; kb bigint; v_slot smallint; v integer;
begin
  if lat1 is null or lng1 is null or lat2 is null or lng2 is null then return ceil(p_unknown)::int; end if;
  if not public.roads_on() then
    return ceil(public.km_between(lat1, lng1, lat2, lng2) * p_detour / greatest(p_speed, 5) * 60)::int;
  end if;
  ka := public.drive_key(lat1, lng1); kb := public.drive_key(lat2, lng2);
  if ka = kb then return 0; end if;
  -- the usual hours first: no time there (no row, or « no road »: minutes null) = not measured, whatever a rush row says
  -- (an old rush time of a trip that has no road any more is not a time: verify-on F9)
  v := (select d.minutes from public.drive_times d where d.a = ka and d.b = kb and d.slot = 0);
  if v is null then return ceil(p_unknown)::int; end if;
  v_slot := public.drive_slot(public.drive_dow(), p_tm);
  if v_slot <> 0 and public.roads_rush() then
    return coalesce((select d.minutes from public.drive_times d where d.a = ka and d.b = kb and d.slot = v_slot), v);
  end if;
  return v;
end $$;
-- the same question without an hour (every place that asked before): the usual hours
create or replace function public.drive_min(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric) returns integer
language sql stable security definer set search_path = public as $$
  select public.drive_min(lat1, lng1, lat2, lng2, p_speed, p_detour, p_unknown, null::integer)
$$;
-- km between two points: the straight line × detour of before, or (roads on) the km of the road; null when not measured yet
create or replace function public.drive_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision,
  p_detour numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare ka bigint; kb bigint; v numeric;
begin
  if lat1 is null or lng1 is null or lat2 is null or lng2 is null then return null; end if;
  if not public.roads_on() then return public.km_between(lat1, lng1, lat2, lng2) * p_detour; end if;
  ka := public.drive_key(lat1, lng1); kb := public.drive_key(lat2, lng2);
  if ka = kb then return 0; end if;
  select d.km into v from public.drive_times d where d.a = ka and d.b = kb and d.slot = 0 and d.minutes is not null;
  return v;
end $$;
-- the usual-hours minutes MEASURED between two points (0: the same place), null when there is none (not asked yet, no road,
-- no position). Never a guess: « near », « farthest first » and « not measured » read this, whatever the switch says
create or replace function public.drive_measured(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns integer language sql stable security definer set search_path = public as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
              when public.drive_key(lat1, lng1) = public.drive_key(lat2, lng2) then 0
              else (select d.minutes from public.drive_times d
                    where d.a = public.drive_key(lat1, lng1) and d.b = public.drive_key(lat2, lng2) and d.slot = 0) end
$$;
-- is the trip known: a usual-hours time measured, or the same place
create or replace function public.drive_known(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns boolean language sql stable security definer set search_path = public as $$
  select public.drive_measured(lat1, lng1, lat2, lng2) is not null
$$;
-- « farthest first » of plan_route with the switch on: the measured minutes from the nearest start of the trucks working the
-- block (« Départ des camions » when none works it); -1 when none is measured, so a stop not measured yet comes last
create or replace function public.drive_from_starts(p_trucks jsonb, p_hlat double precision, p_hlng double precision,
  p_lat double precision, p_lng double precision) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(min(public.drive_measured(s.lat, s.lng, p_lat, p_lng)), -1)::numeric
  from (select (x->>'hlat')::double precision lat, (x->>'hlng')::double precision lng from jsonb_array_elements(coalesce(p_trucks, '[]'::jsonb)) x
        union all
        select p_hlat, p_hlng where jsonb_array_length(coalesce(p_trucks, '[]'::jsonb)) = 0) s
$$;

-- the functions that count with drive_min said « immutable » (true of the old arithmetic): they now read a table
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.provolatile = 'i'
             and p.proname = any (array['route_min', 'route_min_to', 'route_walk', 'route_walk_in', 'route_cost', 'route_improve'])
  loop
    execute format('alter function %s stable', f.sig);
  end loop;
end $$;

-- ---------- the planner's clock (roads on) ----------
-- route_clock: a truck's route walked as the arrival times are written (plan_route's last walk): the stops in that order
-- (p_add put after the first p_at ones), each leg driven at the minute the truck leaves for it (drive_min with that minute:
-- the rush-hour time on a working day), the truck waiting when it is early at a window, and moved to the next stretch of its
-- hours when the stop does not fit before a break. The stops before p_fixed (on the way, there, put in order by hand) are
-- only walked through. → [drive (each leg + the stop time), drive + the leg to the end point (the next block's first stop,
-- at the minute the last stop is done), wait (−1 when a window promised, p_windows, or the truck's hours, p_ranges, do not
-- hold)]. With the switch on, route_cost, route_walk_in and plan_route decide with it, so a decision never counts another
-- drive time than the arrival time it writes.
create or replace function public.route_clock(p_ids jsonb, p_add text, p_at integer, p_pts jsonb, p_start integer,
  p_hlat double precision, p_hlng double precision, p_elat double precision, p_elng double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric, p_fixed integer, p_ranges jsonb, p_windows boolean)
returns integer[]
language plpgsql stable set search_path = public, extensions as $$
declare plat double precision := p_hlat; plng double precision := p_hlng; clat double precision; clng double precision;
  n int := jsonb_array_length(coalesce(p_ids, '[]'::jsonb)); m int; i int; id text; v jsonb; leg int;
  v_stop int := ceil(p_stop)::int; tot int := 0; tm int := coalesce(p_start, 0); v_wait int := 0; v_ok boolean := true;
  v_ws int; v_we int; v_fit int; v_rg boolean := p_ranges is not null and jsonb_typeof(p_ranges) = 'array';
begin
  m := n + case when p_add is null then 0 else 1 end;
  for i in 1 .. m loop
    id := case when p_add is null or i <= p_at then p_ids->>(i - 1) when i = p_at + 1 then p_add else p_ids->>(i - 2) end;
    v := p_pts->id;
    clat := (v->>'lat')::double precision; clng := (v->>'lng')::double precision;
    leg := public.drive_min(plat, plng, clat, clng, p_speed, p_detour, p_unknown, tm);
    tot := tot + leg + v_stop;
    tm := tm + leg;
    if i > coalesce(p_fixed, 0) then
      v_ws := (v->>'ws')::int; v_we := (v->>'we')::int;
      -- early: the truck waits until the window opens (the walk that writes the arrival times waits the same)
      -- (exact move, verify-on F7) a day that holds a pinned stop ('pw'): a wait counts only its minutes inside the truck's hours
      if v_ws is not null and tm < v_ws then v_wait := v_wait + case when v_rg and (v->>'pw') is not null then public.ranges_overlap(p_ranges, tm, v_ws)
                                                         else v_ws - tm end; tm := v_ws; end if;
      if v_rg then
        -- a break in the hours: the stop starts in the next stretch where it fits; none: the hours do not hold (the minute stays)
        v_fit := public.ranges_fit(p_ranges, tm, v_stop + coalesce((v->>'dur')::int, 0));
        if v_fit is null then v_ok := false; else tm := v_fit; end if;
      end if;
      if coalesce(p_windows, false) and v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then v_ok := false; end if;
    elsif (v->>'pin') is not null and (v->>'ws')::int > tm then
      -- (exact move, verify-off H1) a stop of an order by hand pinned to a minute: the truck waits for that minute
      v_wait := v_wait + case when v_rg then public.ranges_overlap(p_ranges, tm, (v->>'ws')::int) else (v->>'ws')::int - tm end;
      tm := (v->>'ws')::int;
    end if;
    tm := tm + v_stop + coalesce((v->>'dur')::int, 0);
    if clat is not null then plat := clat; plng := clng; end if;
  end loop;
  return array[tot,
    tot + case when p_elat is not null and p_elng is not null then public.drive_min(plat, plng, p_elat, p_elng, p_speed, p_detour, p_unknown, tm) else 0 end,
    case when v_ok then v_wait else -1 end];
end $$;

-- ---------- the planner's walks, made again ----------

-- route_walk_in: roads on, the clocked walk (route_clock) says whether the windows and the hours hold, and the wait
create or replace function public.route_walk_in(p_ids jsonb, p_pts jsonb, p_start integer, p_hlat double precision, p_hlng double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric, p_fixed integer, p_ranges jsonb, p_windows boolean) returns integer
language plpgsql stable set search_path = public, extensions as $$
declare plat double precision := p_hlat; plng double precision := p_hlng; clat double precision; clng double precision;
  tm int := coalesce(p_start, 0); v_wait int := 0; k int := 0; id text; v jsonb; v_ws int; v_we int; v_fit int;
begin
  -- roads on (Part 27): the walk with the clock decides (route_clock); below, the walk of before, untouched
  if public.roads_on() then
    return (public.route_clock(p_ids, null, 0, p_pts, p_start, p_hlat, p_hlng, null, null, p_speed, p_detour, p_unknown, p_stop, p_fixed, p_ranges, p_windows))[3];
  end if;
  for id in select e from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) with ordinality q(e, o) order by o loop
    k := k + 1; v := p_pts->id; v_ws := null; v_we := null;
    clat := (v->>'lat')::double precision; clng := (v->>'lng')::double precision;
    tm := tm + public.drive_min(plat, plng, clat, clng, p_speed, p_detour, p_unknown);
    if k > coalesce(p_fixed, 0) then
      if coalesce(p_windows, false) then
        v_ws := (v->>'ws')::int; v_we := (v->>'we')::int;
        if v_ws is not null and tm < v_ws then v_wait := v_wait + case when (v->>'pw') is not null and p_ranges is not null and jsonb_typeof(p_ranges) = 'array'
             then public.ranges_overlap(p_ranges, tm, v_ws) else v_ws - tm end; tm := v_ws; end if;
      end if;
      if p_ranges is not null and jsonb_typeof(p_ranges) = 'array' then
        v_fit := public.ranges_fit(p_ranges, tm, ceil(p_stop)::int + coalesce((v->>'dur')::int, 0));
        if v_fit is null then return -1; end if;
        tm := v_fit;
      end if;
      if v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then return -1; end if;
    elsif coalesce(p_windows, false) and (v->>'pin') is not null and (v->>'ws')::int > tm then
      v_wait := v_wait + case when p_ranges is not null and jsonb_typeof(p_ranges) = 'array' then public.ranges_overlap(p_ranges, tm, (v->>'ws')::int)
                              else (v->>'ws')::int - tm end;
      tm := (v->>'ws')::int;
    end if;
    tm := tm + ceil(p_stop)::int + coalesce((v->>'dur')::int, 0);
    if clat is not null then plat := clat; plng := clng; end if;
  end loop;
  return v_wait;
end $$;

-- route_cost: roads on, the totals AND the walk on the clock (route_clock): the drive counted is the one of the arrival times
create or replace function public.route_cost(p_ids jsonb, p_add text, p_at integer, p_pts jsonb, p_start integer,
  p_hlat double precision, p_hlng double precision, p_elat double precision, p_elng double precision,
  p_speed numeric, p_detour numeric, p_unknown numeric, p_stop numeric, p_fixed integer, p_ranges jsonb, p_windows boolean, p_walk boolean)
returns integer[]
language plpgsql stable set search_path = public, extensions as $$
declare plat double precision := p_hlat; plng double precision := p_hlng; clat double precision; clng double precision;
  n int := jsonb_array_length(coalesce(p_ids, '[]'::jsonb)); m int; i int; id text; v jsonb; leg int;
  v_stop int := ceil(p_stop)::int; tot int := 0; tm int := coalesce(p_start, 0); v_wait int := 0; v_ok boolean := coalesce(p_walk, false);
  v_ws int; v_we int; v_fit int; v_rg boolean := p_ranges is not null and jsonb_typeof(p_ranges) = 'array';
begin
  -- roads on (Part 27): the walk with the clock decides (route_clock); below, the walk of before, untouched
  if public.roads_on() then
    return public.route_clock(p_ids, p_add, p_at, p_pts, p_start, p_hlat, p_hlng, p_elat, p_elng, p_speed, p_detour, p_unknown, p_stop, p_fixed, p_ranges, p_windows);
  end if;
  m := n + case when p_add is null then 0 else 1 end;
  for i in 1 .. m loop
    id := case when p_add is null or i <= p_at then p_ids->>(i - 1) when i = p_at + 1 then p_add else p_ids->>(i - 2) end;
    v := p_pts->id;
    clat := (v->>'lat')::double precision; clng := (v->>'lng')::double precision;
    leg := public.drive_min(plat, plng, clat, clng, p_speed, p_detour, p_unknown);
    tot := tot + leg + v_stop;
    if v_ok then
      tm := tm + leg;
      if i > coalesce(p_fixed, 0) then
        v_ws := null; v_we := null;
        if coalesce(p_windows, false) then
          v_ws := (v->>'ws')::int; v_we := (v->>'we')::int;
          if v_ws is not null and tm < v_ws then v_wait := v_wait + case when (v->>'pw') is not null and p_ranges is not null and jsonb_typeof(p_ranges) = 'array'
             then public.ranges_overlap(p_ranges, tm, v_ws) else v_ws - tm end; tm := v_ws; end if;
        end if;
        if v_rg then
          v_fit := public.ranges_fit(p_ranges, tm, v_stop + coalesce((v->>'dur')::int, 0));
          if v_fit is null then v_ok := false; v_wait := -1; else tm := v_fit; end if;
        end if;
        if v_ok and v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then v_ok := false; v_wait := -1; end if;
      elsif coalesce(p_windows, false) and (v->>'pin') is not null and (v->>'ws')::int > tm then
        v_wait := v_wait + case when v_rg then public.ranges_overlap(p_ranges, tm, (v->>'ws')::int) else (v->>'ws')::int - tm end;
        tm := (v->>'ws')::int;
      end if;
      tm := tm + v_stop + coalesce((v->>'dur')::int, 0);
    end if;
    if clat is not null then plat := clat; plng := clng; end if;
  end loop;
  return array[tot,
    tot + case when p_elat is not null and p_elng is not null then public.drive_min(plat, plng, p_elat, p_elng, p_speed, p_detour, p_unknown) else 0 end,
    case when coalesce(p_walk, false) then v_wait else 0 end];
end $$;

-- route_retime: the arrival times written again, each leg at its hour; a stop pinned to a minute waits for it
create or replace function public.route_retime(p_truck uuid, p_day date, p_block text) returns void
language plpgsql security definer set search_path = public as $$
declare b record; r record;
  v_speed numeric := public.bset('speed_kmh', 35); v_detour numeric := public.bset('detour', 1.3);
  v_stop numeric := public.bset('stop_min', 5); v_unknown numeric := public.bset('unknown_min', 20);
  v_started boolean; tm int; plat double precision; plng double precision; leg int; v_prev text; v_rg jsonb;
begin
  perform set_config('garage.drive_dow', coalesce(extract(isodow from p_day)::int::text, ''), true);
  select * into b from public.blocks() x where x.key = p_block;
  if not found or p_truck is null or p_day is null then return; end if;
  v_started := p_day = public.local_today() and public.now_min() >= b.start_min;
  -- hours with a break inside the block: a stop starts and ends inside one stretch (as plan_route)
  select jsonb_agg(jsonb_build_array(greatest((x->>0)::int, b.start_min), least((x->>1)::int, b.end_min)) order by (x->>0)::int) into v_rg
  from jsonb_array_elements(public.truck_ranges(p_truck, p_day)) x
  where least((x->>1)::int, b.end_min) > greatest((x->>0)::int, b.start_min)
  having count(*) > 1;
  if v_started then
    tm := (ceil(public.now_min() / 5.0) * 5)::int;
    select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into plat, plng from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.truck_id = p_truck and j.day = p_day and j.deleted_at is null and j.status = 'done'
      and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
    order by j.finished_at desc nulls last, j.stop_order desc nulls last limit 1;
  else
    tm := coalesce(public.ranges_first(public.truck_ranges(p_truck, p_day), b.start_min, b.end_min), b.start_min);
    select x.key into v_prev from public.blocks() x where x.pos = b.pos - 1;
    if v_prev is not null then
      select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into plat, plng from public.jobs j left join public.customers c on c.id = j.customer_id
      where j.truck_id = p_truck and j.day = p_day and j.block = v_prev and j.deleted_at is null and j.status not in ('cancelled','no_show')
        and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
      order by j.stop_order desc nulls last, j.eta_min desc nulls last limit 1;
    end if;
  end if;
  if plat is null then
    select coalesce((tr.start->>'lat')::double precision, h.lat), coalesce((tr.start->>'lng')::double precision, h.lng) into plat, plng
    from public.home_point() h left join public.trucks tr on tr.id = p_truck;
  end if;
  perform set_config('garage.rpc', 'on', true);
  for r in
    select j.id, j.status, j.duration_min, j.arrived_at, coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
           case when p_block = 'day' and public.windows_on() and not j.forced then case when j.manual_order is null then coalesce(j.arrive_at, j.win_start) else j.arrive_at end end ws
    from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.truck_id = p_truck and j.day = p_day and j.block = p_block and j.deleted_at is null and j.status in ('en_route','on_site','booked')
    order by (j.status in ('en_route','on_site')) desc, j.stop_order nulls last, j.eta_min nulls last, j.created_at
  loop
    if r.status = 'on_site' then
      -- there already: only the work that is left
      tm := tm + greatest(0, r.duration_min - coalesce(floor(extract(epoch from (now() - r.arrived_at)) / 60)::int, 0));
    else
      leg := public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown, tm);
      tm := tm + leg;
      -- early at a stop with a window: the truck waits until it opens (as the planner)
      if r.status = 'booked' and r.ws is not null and tm < r.ws then tm := r.ws; end if;
      if r.status = 'booked' and v_rg is not null then tm := coalesce(public.ranges_fit(v_rg, tm, ceil(v_stop)::int + r.duration_min), tm); end if;
      if r.status = 'booked' then
        update public.jobs set eta_min = tm, travel_min = leg + ceil(v_stop)::int
        where id = r.id and (eta_min, travel_min) is distinct from (tm, leg + ceil(v_stop)::int);
      end if;
      tm := tm + ceil(v_stop)::int + r.duration_min;
    end if;
    if r.lat is not null and r.lng is not null then plat := r.lat; plng := r.lng; end if;
  end loop;
  -- Part 27 (final-guess G1): roads on, the arrivals just written say whether they count measured trips only
  if public.roads_on() then perform public.route_mark(p_day, p_truck); end if;
end $$;

-- route_hold: route_retime's walk, each stop of p_hold waiting until its minute (the move with a minute pointed)
create or replace function public.route_hold(p_truck uuid, p_day date, p_block text, p_hold jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare b record; r record;
  v_speed numeric := public.bset('speed_kmh', 35); v_detour numeric := public.bset('detour', 1.3);
  v_stop numeric := public.bset('stop_min', 5);
  -- the lower bound of the move (exact_place, verify-on F1): every trip not measured counts 0
  v_low boolean := coalesce(current_setting('garage.exact_low', true), '') = 'on';
  v_unknown numeric := case when v_low then 0 else public.bset('unknown_min', 20) end;
  v_started boolean; tm int; plat double precision; plng double precision; leg int; v_prev text; v_rg jsonb;
begin
  perform set_config('garage.drive_dow', coalesce(extract(isodow from p_day)::int::text, ''), true);
  select * into b from public.blocks() x where x.key = p_block;
  if not found or p_truck is null or p_day is null then return; end if;
  v_started := p_day = public.local_today() and public.now_min() >= b.start_min;
  -- hours with a break inside the block: a stop starts and ends inside one stretch (as plan_route)
  select jsonb_agg(jsonb_build_array(greatest((x->>0)::int, b.start_min), least((x->>1)::int, b.end_min)) order by (x->>0)::int) into v_rg
  from jsonb_array_elements(public.truck_ranges(p_truck, p_day)) x
  where least((x->>1)::int, b.end_min) > greatest((x->>0)::int, b.start_min)
  having count(*) > 1;
  if v_started then
    tm := (ceil(public.now_min() / 5.0) * 5)::int;
    select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into plat, plng from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.truck_id = p_truck and j.day = p_day and j.deleted_at is null and j.status = 'done'
      and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
    order by j.finished_at desc nulls last, j.stop_order desc nulls last limit 1;
  else
    tm := coalesce(public.ranges_first(public.truck_ranges(p_truck, p_day), b.start_min, b.end_min), b.start_min);
    select x.key into v_prev from public.blocks() x where x.pos = b.pos - 1;
    if v_prev is not null then
      select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into plat, plng from public.jobs j left join public.customers c on c.id = j.customer_id
      where j.truck_id = p_truck and j.day = p_day and j.block = v_prev and j.deleted_at is null and j.status not in ('cancelled','no_show')
        and coalesce(j.lat, c.lat) is not null and coalesce(j.lng, c.lng) is not null
      order by j.stop_order desc nulls last, j.eta_min desc nulls last limit 1;
    end if;
  end if;
  if plat is null then
    select coalesce((tr.start->>'lat')::double precision, h.lat), coalesce((tr.start->>'lng')::double precision, h.lng) into plat, plng
    from public.home_point() h left join public.trucks tr on tr.id = p_truck;
  end if;
  perform set_config('garage.rpc', 'on', true);
  for r in
    select j.id, j.status, j.duration_min, j.arrived_at, coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
           coalesce((p_hold->>j.id::text)::int, case when p_block = 'day' and public.windows_on() and not j.forced then case when j.manual_order is null then coalesce(j.arrive_at, j.win_start) else j.arrive_at end end) ws
    from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.truck_id = p_truck and j.day = p_day and j.block = p_block and j.deleted_at is null and j.status in ('en_route','on_site','booked')
    order by (j.status in ('en_route','on_site')) desc, j.stop_order nulls last, j.eta_min nulls last, j.created_at
  loop
    if r.status = 'on_site' then
      -- there already: only the work that is left
      tm := tm + greatest(0, r.duration_min - coalesce(floor(extract(epoch from (now() - r.arrived_at)) / 60)::int, 0));
    else
      leg := coalesce((p_hold->'_legs'->>r.id::text)::int, public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown, tm));
      tm := tm + leg;
      -- early at a stop with a window: the truck waits until it opens (as the planner)
      if r.status = 'booked' and r.ws is not null and tm < r.ws then tm := r.ws; end if;
      if r.status = 'booked' and v_rg is not null then tm := coalesce(public.ranges_fit(v_rg, tm, ceil(v_stop)::int + r.duration_min), tm); end if;
      if r.status = 'booked' then
        update public.jobs set eta_min = tm, travel_min = leg + ceil(v_stop)::int
        where id = r.id and (eta_min, travel_min) is distinct from (tm, leg + ceil(v_stop)::int);
      end if;
      tm := tm + ceil(v_stop)::int + r.duration_min;
    end if;
    if r.lat is not null and r.lng is not null then plat := r.lat; plng := r.lng;
    elsif v_low then plat := null; plng := null;   -- (the lower bound) the trip after it is not known either
    end if;
  end loop;
  -- Part 27 (final-guess G1): roads on, the arrivals just written say whether they count measured trips only
  if public.roads_on() and not v_low then perform public.route_mark(p_day, p_truck); end if;
end $$;

-- plan_route_core: the planner (plan_route of before). Roads on, every decision on the clock of the arrival times it writes
-- (route_clock); « farthest first » by measured minutes; the vehicles of p_frozen keep their stops. Off: the text of before
-- (each piece done otherwise is kept as is, in « else »)
create or replace function public.plan_route_core(p_day date, p_block text, p_extra jsonb, p_exclude uuid, p_seed boolean, p_frozen jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Part 26: the stored routes as the seed (p_seed), hours with a break (a truck's 'rg'), the stops already done today
  v_seed boolean := false; v_seedfree jsonb := '{}'; fe jsonb; v_res jsonb; v_alt jsonb; v_dn int; v_fit int;
  ev int[];                        -- round 2: one walk of a route (route_cost)
  v_pastend jsonb := '[]';        -- booked « quand même » and placed past the hours (they go at the end)
  -- Part 27 (« Vraies routes »): roads on, every decision counts the same clock as the arrival times written (route_clock)
  v_on boolean := public.roads_on(); eb int[]; v_dr int := 0; v_dep int;
  -- the vehicles frozen for this plan (see plan_route, the wrapper below): their booked stops stay on them, in order
  v_frz jsonb := coalesce(p_frozen, '[]'::jsonb);
  -- « exact move » (verify-on F7): this block-day holds a stop pinned to a minute (window mode)
  v_pinday boolean := false;
begin
  -- the day being planned: the walks below take the rush hours of a working day (drive_min)
  perform set_config('garage.drive_dow', coalesce(extract(isodow from p_day)::int::text, ''), true);
  select * into b from public.blocks() x where x.key = p_block;
  if not found then raise exception 'Bloc inconnu : %', p_block using errcode = '22023'; end if;
  v_wm := p_block = 'day' and public.windows_on();
  v_seed := coalesce(p_seed, false) and v_wm;
  v_pinday := v_wm and exists (select 1 from public.jobs j where j.day = p_day and j.block = p_block and j.arrive_at is not null
                               and j.status = 'booked' and j.deleted_at is null and (p_exclude is null or j.id <> p_exclude));
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
        'hlat', hl, 'hlng', hg, 'from', v_from_kind, 'elat', el, 'elng', eg, 'stops', '[]'::jsonb, 'nfixed', 0, 'durs', 0)
        -- Part 27 (fix-sql): a vehicle frozen for this plan (it holds an appointment the real roads no longer fit)
        || case when v_frz ? r.id::text then jsonb_build_object('frozen', true) else '{}'::jsonb end
        -- hours with a break inside the block (lunch, a split shift; the whole day in window mode): its stretches of hours,
        -- walked one after the other (Part 26)
        || coalesce((select jsonb_build_object('rg', jsonb_agg(jsonb_build_array(greatest((x->>0)::int, b.start_min), least((x->>1)::int, b.end_min)) order by (x->>0)::int))
                     from jsonb_array_elements(rg) x where least((x->>1)::int, b.end_min) > greatest((x->>0)::int, b.start_min)
                     having count(*) > 1), '{}'::jsonb));
    end if;
  end loop;

  -- the jobs of the block
  for r in
    select j.id, j.truck_id, j.truck_pinned, j.forced, j.status, j.duration_min, j.stop_order, j.manual_order,
           case when j.needs_machine then 'truck' else j.vehicle_kind end kind,
           coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
           j.win_start, j.win_end, j.arrived_at, j.eta_min, j.arrive_at
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
      -- booked « quand même » too (Part 26): placed after every other stop of the plan, inside its window when it fits,
      -- else late, else at the end (it never holds another stop to anything)
      || case when v_wm and r.status = 'booked' and r.win_start is not null and r.win_end is not null
              then jsonb_build_object('ws', coalesce(r.arrive_at, r.win_start), 'we', coalesce(r.arrive_at, r.win_end))
                || case when r.arrive_at is not null then jsonb_build_object('pin', true)
                                                          -- (verify-on fuzz2) late already (accepted at a move): placed after the pins in time
                                                          || case when r.eta_min > r.arrive_at then jsonb_build_object('pinlate', true) else '{}'::jsonb end
                        else '{}'::jsonb end else '{}'::jsonb end
      || case when v_wm and p_day = v_today and r.status = 'on_site' and r.eta_min is not null then jsonb_build_object('eta0', r.eta_min) else '{}'::jsonb end
      -- « exact move » (verify-on F7): on a day that holds a pinned stop, the walks count a wait only inside the truck's hours
      || case when v_pinday then jsonb_build_object('pw', true) else '{}'::jsonb end);
    if v_wm and r.status = 'booked' and r.win_start is not null and r.win_end is not null then v_win := true; end if;
    -- Part 27 (fix-sql): a frozen vehicle keeps its booked stops, in their stored order (the ones on the way, there or in
    -- an order by hand are fixed just below, first, as on any vehicle); nothing new goes on it but « quand même »
    if r.status = 'booked' and r.manual_order is null and r.truck_id is not null and v_frz ? r.truck_id::text then
      ti := null;
      for k in 0 .. jsonb_array_length(trucks) - 1 loop if trucks->k->>'id' = r.truck_id::text then ti := k; end if; end loop;
      if ti is not null then
        trucks := jsonb_set(trucks, array[ti::text, 'stops'], (trucks->ti->'stops') || to_jsonb(r.id::text));
        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + v_dur));
        continue;
      end if;
    end if;
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
      fe := jsonb_build_object('id', r.id::text, 'truck', case when r.truck_pinned then r.truck_id::text end, 'forced', r.forced, 'kind', r.kind,
        -- roads on (Part 27): by the minutes measured from those starts (one not measured yet last), never the straight line
        'dist', case when v_on then public.drive_from_starts(trucks, v_hlat, v_hlng, r.lat, r.lng)
                     else coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, r.lat, r.lng)) from jsonb_array_elements(trucks) x),
                          public.km_between(v_hlat, v_hlng, r.lat, r.lng), 0) end);
      -- the stored routes as the seed (Part 26): a booked stop already on a truck of the plan stays there, in its order
      ti := null;
      if v_seed and r.status = 'booked' and r.truck_id is not null and not coalesce(r.forced, false) then
        for k in 0 .. jsonb_array_length(trucks) - 1 loop
          if trucks->k->>'id' = r.truck_id::text
             and not ((r.kind = 'truck' and not coalesce((trucks->k->>'machine')::boolean, true)) or (r.kind = 'car' and coalesce((trucks->k->>'machine')::boolean, true))) then ti := k; end if;
        end loop;
      end if;
      if ti is not null then
        trucks := jsonb_set(trucks, array[ti::text, 'stops'], (trucks->ti->'stops') || to_jsonb(r.id::text));
        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + v_dur));
        v_seedfree := v_seedfree || jsonb_build_object(r.id::text, fe);
      else
        free := free || jsonb_build_array(fe);
      end if;
    end if;
  end loop;

  if v_seed then
    for ti in 0 .. jsonb_array_length(trucks) - 1 loop
      t := trucks->ti;
      continue when not exists (select 1 from jsonb_array_elements_text(t->'stops') s where v_seedfree ? s);
      hl := (t->>'hlat')::double precision; hg := (t->>'hlng')::double precision;
      v_w := public.route_walk_in(t->'stops', pts, (t->>'start')::int, hl, hg, v_speed, v_detour, v_unknown, v_stop, (t->>'nfixed')::int, t->'rg', true);
      if v_w < 0 or (t->>'durs')::int + (case when v_on then (public.route_clock(t->'stops', null, 0, pts, (t->>'start')::int, hl, hg, null, null, v_speed, v_detour, v_unknown, v_stop, (t->>'nfixed')::int, t->'rg', true))[1]
                                             else public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) end) + v_w > (t->>'cap')::int then
        free := free || (select coalesce(jsonb_agg(v_seedfree->s order by o), '[]'::jsonb) from jsonb_array_elements_text(t->'stops') with ordinality q(s, o) where v_seedfree ? s);
        trucks := jsonb_set(trucks, array[ti::text, 'stops'], (select coalesce(jsonb_agg(to_jsonb(s) order by o), '[]'::jsonb) from jsonb_array_elements_text(t->'stops') with ordinality q(s, o) where not (v_seedfree ? s)));
        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb(public.durs_of(trucks->ti->'stops', pts)));
      end if;
    end loop;
  end if;

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
      || case when v_ws is not null and v_we is not null then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end
      || case when v_pinday then jsonb_build_object('pw', true) else '{}'::jsonb end);
    if v_ws is not null and v_we is not null then v_win := true; end if;
    free := free || jsonb_build_array(jsonb_build_object('id', p_extra->>'id', 'truck', nullif(p_extra->>'truck', ''), 'forced', coalesce((p_extra->>'force')::boolean, false),
      -- which vehicle: said with the booking (`need`: the tire machine; `kind`: the person's choice), else as the job already is
      'kind', case when coalesce((p_extra->>'need')::boolean, false) then 'truck'
                   when p_extra ? 'kind' or p_extra ? 'need' then nullif(p_extra->>'kind', '')
                   else (select case when jj.needs_machine then 'truck' else jj.vehicle_kind end from public.jobs jj where jj.id = (p_extra->>'id')::uuid) end,
      -- roads on (Part 27): by the minutes measured from the trucks' starts
      'dist', case when v_on then public.drive_from_starts(trucks, v_hlat, v_hlng, clat, clng)
                   else coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, clat, clng)) from jsonb_array_elements(trucks) x),
                        public.km_between(v_hlat, v_hlng, clat, clng), 0) end));
  end if;

  v_forced := (select coalesce(jsonb_agg(e->'id'), '[]'::jsonb) from jsonb_array_elements(free) e where coalesce((e->>'forced')::boolean, false));
  -- pinned jobs first, then the farthest first; the ones booked « quand même » last (they never take the room of another).
  -- Window mode: the stop being added goes after the appointments already there (it never takes a window from them), and
  -- the stops with a promised window before the flexible ones.
  for r in select e from jsonb_array_elements(free) e
           order by coalesce((e->>'forced')::boolean, false), (v_wm and v_xid is not null and e->>'id' = v_xid),
                    ((pts->(e->>'id')->>'pin') is null), ((pts->(e->>'id')->>'pinlate') is not null),
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
      continue when t ? 'frozen';   -- Part 27 (fix-sql): a frozen vehicle takes nothing new
      n := jsonb_array_length(t->'stops');
      durs := (t->>'durs')::int;
      v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int;
      -- route_min, route_min_to and route_walk_in in one walk (round 2, speed: the same answers)
      ev := public.route_cost(t->'stops', null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3, (v_win and v_try < 3) or t ? 'rg');
      base := ev[1]; basee := ev[2]; v_bw := greatest(0, ev[3]);
      for pos in (t->>'nfixed')::int .. n loop
        -- the stop tried after the first `pos` stops (the order is no longer built to be tried)
        ev := public.route_cost(t->'stops', jid, pos, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3, (v_win and v_try < 3) or t ? 'rg');
        rc := ev[1]; rce := ev[2]; v_w := ev[3];
        continue when v_w < 0;
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
        continue when t ? 'frozen';
        n := jsonb_array_length(t->'stops'); durs := (t->>'durs')::int;
        v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int;
        ev := public.route_cost(t->'stops', null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3, (v_win and v_try < 3) or t ? 'rg');
        base := ev[1]; basee := ev[2]; v_bw := greatest(0, ev[3]);
        for pos in (t->>'nfixed')::int .. n loop
          ev := public.route_cost(t->'stops', jid, pos, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3, (v_win and v_try < 3) or t ? 'rg');
          rc := ev[1]; rce := ev[2]; v_w := ev[3];
          continue when v_w < 0;
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
        continue when t ? 'frozen';
        if v_on then
          -- roads on (Part 27): route_improve finds a better order with the usual-hours times (it only puts the stops
          -- in an order); whether that order fits and what it costs are counted on the clock, as the arrival times will be
          v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int;
          ev := public.route_clock(t->'stops', null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3);
          base := ev[1]; basee := ev[2]; v_bw := greatest(0, ev[3]);
          cand := public.route_improve((t->'stops') || to_jsonb(jid), v_nf, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
          ev := public.route_clock(cand, null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3);
          if el is not null and eg is not null and (ev[3] < 0 or durs + jdur + ev[1] + ev[3] > (t->>'cap')::int) then
            cand := public.route_improve((t->'stops') || to_jsonb(jid), v_nf, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
            ev := public.route_clock(cand, null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3);
          end if;
          rc := ev[1]; rce := ev[2]; v_w := ev[3];
          continue when v_w < 0;
        else
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
          if (v_win and v_try < 3) or t ? 'rg' then
            -- the better order drives less but knows nothing of the windows: taken only when they all hold
            v_w := public.route_walk_in(cand, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3);
            continue when v_w < 0;
            v_bw := greatest(0, public.route_walk_in(t->'stops', pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3));
          end if;
        end if;
        used := durs + jdur + rc + v_w;
        if used <= (t->>'cap')::int then
          cost := (rce - basee) + (v_w - v_bw) + 0.2 * used + case when pinned and t->>'id' <> jtruck then 100000 else 0 end + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
          if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_cand := cand; end if;
        end if;
      end loop;
    end if;
    exit when best_ti is not null or not v_win or v_try >= 3 or jid is not distinct from v_xid
      -- booked « quand même »: window mode, it is tried inside its window, then late (Part 26); else straight to the end
      or (coalesce((r.e->>'forced')::boolean, false) and not (v_wm and v_try = 1 and (pts->jid->>'we') is not null));
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
        if v_on then
          -- roads on (Part 27): the driving it adds at the end of the route, on the clock
          base := (public.route_clock(t->'stops', null, 0, pts, (t->>'start')::int, hl, hg, null, null, v_speed, v_detour, v_unknown, v_stop, (t->>'nfixed')::int, t->'rg', false))[1];
          rc := (public.route_clock(t->'stops', jid, n, pts, (t->>'start')::int, hl, hg, null, null, v_speed, v_detour, v_unknown, v_stop, (t->>'nfixed')::int, t->'rg', false))[1];
        else
          base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          rc := public.route_min((t->'stops') || to_jsonb(jid), pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
        end if;
        cost := (rc - base) + case when pinned and t->>'id' <> jtruck then 100000 else 0 end + case when carfirst and coalesce((t->>'machine')::boolean, true) then 10000 else 0 end;
        if best_cost is null or cost < best_cost then best_cost := cost; best_ti := ti; best_pos := n; end if;
      end loop;
      if best_ti is not null then v_pastend := v_pastend || to_jsonb(jid); end if;
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

  -- window mode, a day already started (Part 26): an appointment that no longer fits stays on its truck (apply_plan never
  -- un-places it there), so it counts there, at the end of the route past the hours, late, instead of in « over »: the
  -- time it needs is not sold again to a same-day booking
  if v_wm and p_day = v_today and jsonb_array_length(over) > 0 then
    for jid in select o from jsonb_array_elements_text(over) o loop
      continue when jid is not distinct from v_xid;
      ti := null;
      for k in 0 .. jsonb_array_length(trucks) - 1 loop
        if trucks->k->>'id' = (select j.truck_id::text from public.jobs j where j.id::text = jid and j.status = 'booked') then ti := k; end if;
      end loop;
      continue when ti is null;
      trucks := jsonb_set(trucks, array[ti::text, 'stops'], (trucks->ti->'stops') || to_jsonb(jid));
      trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + coalesce((pts->jid->>'dur')::int, 0)));
      pts := jsonb_set(pts, array[jid, 'late'], 'true'::jsonb);
      v_forced := v_forced || to_jsonb(jid); v_pastend := v_pastend || to_jsonb(jid);
      over := over - jid;
      -- no window to be late for (flexible): late all the same, so a booking that pushes it there is seen (plan_late_new)
      if (pts->jid->>'we') is null then v_late := v_late || to_jsonb(jid); end if;
    end loop;
  end if;

  -- each truck's stops in the order that drives the least (from where it is, toward its next block), then arrival times, drive of each leg, what is left.
  -- Ending near the next block never costs room in this block: when that order no longer fits in the truck's hours,
  -- the shortest order inside the block (it never drives more than the order the stops were put in, which fits).
  for ti in 0 .. jsonb_array_length(trucks) - 1 loop
    hl := (trucks->ti->>'hlat')::double precision; hg := (trucks->ti->>'hlng')::double precision;
    el := (trucks->ti->>'elat')::double precision; eg := (trucks->ti->>'elng')::double precision;
    -- the stops booked « quand même » (not on the way or there) stay at the end, in the order they were added (window mode:
    -- only the ones placed past the hours; the others are where they fit, Part 26)
    v_tail := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(trucks->ti->'stops') with ordinality s(x, o)
               where o > (trucks->ti->>'nfixed')::int and v_forced @> jsonb_build_array(x) and (not v_wm or v_pastend @> jsonb_build_array(x)));
    cand := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(trucks->ti->'stops') with ordinality s(x, o)
             where not (v_tail @> jsonb_build_array(x)));
    if v_on then
      -- roads on (Part 27): the same choice, every total on the clock. route_improve only proposes the order that drives
      -- the least at the usual hours; it is kept when, on the clock, it fits in the truck's hours and every window holds
      -- (with windows or a break in the hours: when it costs no more driving + waiting than the order the stops were put in)
      if trucks->ti ? 'frozen' then
        -- a frozen vehicle (fix-sql, verify-on F1): its stops stay in their order (« quand même » after them)
        t := cand;
      else
        v_start := (trucks->ti->>'start')::int; v_nf := (trucks->ti->>'nfixed')::int;
        t := public.route_improve(cand, v_nf, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
        ev := public.route_clock(t || v_tail, null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, trucks->ti->'rg', v_win);
        if el is not null and eg is not null and (ev[3] < 0 or (trucks->ti->>'durs')::int + ev[1] + ev[3] > (trucks->ti->>'cap')::int) then
          t := public.route_improve(cand, v_nf, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
          ev := public.route_clock(t || v_tail, null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, trucks->ti->'rg', v_win);
        end if;
        eb := public.route_clock(cand || v_tail, null, 0, pts, v_start, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop, v_nf, trucks->ti->'rg', v_win);
        if eb[3] >= 0 and (ev[3] < 0
                           or ((v_win or trucks->ti ? 'rg') and ev[1] + ev[3] > eb[1] + eb[3])
                           or ((trucks->ti->>'durs')::int + ev[1] + ev[3] > (trucks->ti->>'cap')::int
                               and (trucks->ti->>'durs')::int + eb[1] + eb[3] <= (trucks->ti->>'cap')::int)) then
          t := cand;
        end if;
      end if;
    else
      t := public.route_improve(cand, (trucks->ti->>'nfixed')::int, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
      if el is not null and eg is not null
         and (trucks->ti->>'durs')::int + public.route_min(t || v_tail, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) > (trucks->ti->>'cap')::int then
        t := public.route_improve(cand, (trucks->ti->>'nfixed')::int, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
      end if;
      if v_win or trucks->ti ? 'rg' then
        -- the order that drives the least is kept only when every window still holds and it costs no more driving + waiting
        -- than the order the stops were put in (which holds them)
        v_start := (trucks->ti->>'start')::int; v_nf := (trucks->ti->>'nfixed')::int;
        v_w := public.route_walk_in(t || v_tail, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, trucks->ti->'rg', v_win);
        v_bw := public.route_walk_in(cand || v_tail, pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, trucks->ti->'rg', v_win);
        if v_bw >= 0 and (v_w < 0 or public.route_min(t || v_tail, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_w
                                   > public.route_min(cand || v_tail, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_bw) then
          t := cand;
        end if;
      end if;
    end if;
    trucks := jsonb_set(trucks, array[ti::text, 'stops'], t || v_tail);
    t := trucks->ti; tm := (t->>'start')::int; plat := hl; plng := hg; k := 0; v_wt := 0; v_dr := 0;
    -- window mode, today: the stops come after the ones this truck already finished (they keep 1, 2, …: Part 26)
    v_dn := case when v_wm and p_day = v_today then (select count(*)::int from public.jobs j where j.truck_id = (t->>'id')::uuid and j.day = p_day
                   and j.block = p_block and j.status = 'done' and j.deleted_at is null and (p_exclude is null or j.id <> p_exclude)) else 0 end;
    for jid in select jsonb_array_elements_text(t->'stops') loop
      k := k + 1;
      clat := (pts->jid->>'lat')::double precision; clng := (pts->jid->>'lng')::double precision;
      v_dep := tm;
      leg := public.drive_min(plat, plng, clat, clng, v_speed, v_detour, v_unknown, tm);
      tm := tm + leg; v_dr := v_dr + leg + ceil(v_stop)::int;
      if v_win and k > (t->>'nfixed')::int then
        -- early at a stop with a window: the truck waits until it opens
        v_ws := (pts->jid->>'ws')::int; v_we := (pts->jid->>'we')::int;
        -- (exact move, verify-on F7) a day that holds a pinned stop ('pw'): only the minutes of a wait inside the truck's hours
        if v_ws is not null and tm < v_ws then v_wt := v_wt + case when (pts->jid->>'pw') is not null and t ? 'rg' then public.ranges_overlap(t->'rg', tm, v_ws)
                                                       else v_ws - tm end; tm := v_ws; end if;
        if t ? 'rg' then tm := coalesce(public.ranges_fit(t->'rg', tm, ceil(v_stop)::int + (pts->jid->>'dur')::int), tm); end if;
        if v_we is not null and tm > v_we then v_late := v_late || to_jsonb(jid); end if;
      elsif t ? 'rg' and k > (t->>'nfixed')::int then
        tm := coalesce(public.ranges_fit(t->'rg', tm, ceil(v_stop)::int + (pts->jid->>'dur')::int), tm);
      elsif v_win and (pts->jid->>'pin') is not null then
        v_ws := (pts->jid->>'ws')::int; v_we := (pts->jid->>'we')::int;
        if tm < v_ws then v_wt := v_wt + case when t ? 'rg' then public.ranges_overlap(t->'rg', tm, v_ws) else v_ws - tm end; tm := v_ws; end if;
        if tm > v_we then v_late := v_late || to_jsonb(jid); end if;
      end if;
      out_jobs := out_jobs || jsonb_build_object(jid, coalesce(out_jobs->jid, '{}'::jsonb) || jsonb_build_object('truck', t->>'id', 'order', k + v_dn, 'eta', coalesce((pts->jid->>'eta0')::int, tm), 'travel', leg + ceil(v_stop)::int)
        -- roads on (Part 27): the minute the truck leaves for this stop (day_drive takes its legs at the same minutes)
        || case when v_on then jsonb_build_object('dep', v_dep) else '{}'::jsonb end);
      tm := tm + ceil(v_stop)::int + (pts->jid->>'dur')::int;
      if clat is not null then plat := clat; plng := clng; end if;
    end loop;
    -- roads on (Part 27): the driving of the walk just made (each leg at its minute), the one behind the arrival times
    used := (t->>'durs')::int + case when v_on then v_dr else public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) end + v_wt;
    trucks := jsonb_set(trucks, array[ti::text], (t - 'nfixed' - 'durs' - 'rg') || jsonb_build_object('used', used, 'left', (t->>'cap')::int - used, 'wait', v_wt));
  end loop;

  placed := p_extra is not null and (out_jobs ? (p_extra->>'id'));
  v_res := jsonb_build_object('day', p_day, 'block', p_block, 'trucks', trucks, 'jobs', out_jobs, 'over', over, 'late', v_late,
    'extra', case when p_extra is null then null else jsonb_build_object('placed', placed, 'truck', out_jobs->(p_extra->>'id')->>'truck', 'eta', out_jobs->(p_extra->>'id')->>'eta') end)
    -- made on the stored routes (plan_extra adds a stop to the same routes)
    || case when v_seed then jsonb_build_object('seeded', true) else '{}'::jsonb end;
  -- Part 26 (window mode): this plan makes late an appointment that its stored route reaches in its window: the plan seeded
  -- with the stored routes (they stay, the new stop goes where every window holds) is taken when it makes fewer late
  if p_seed is null and v_wm and public.plan_late_stored(v_res, v_xid) > 0 then
    v_alt := public.plan_route_core(p_day, p_block, p_extra, p_exclude, true, p_frozen);
    if public.plan_late_stored(v_alt, v_xid) < public.plan_late_stored(v_res, v_xid)
       and not exists (select 1 from jsonb_array_elements_text(coalesce(v_alt->'over', '[]'::jsonb)) o where not (coalesce(v_res->'over', '[]'::jsonb) ? o) and o is distinct from v_xid) then
      return v_alt;
    end if;
  end if;
  return v_res;
end $function$;

-- plan_route (fix-sql, verify-on F1, F4, F6; the lead's decision of 2026-11-20). Roads off: the planner of before, nothing frozen.
-- Roads on: a block whose plan from scratch would leave out an appointment already placed (the real roads no longer fit it
-- on its vehicle) neither throws it to « À placer » nor sells its time again: that VEHICLE is frozen (its booked stops stay
-- on it, in their order, walked on the clock; nothing new goes on it but « quand même », at the end) and the block is planned
-- around it, so the other vehicles keep their room. The frozen vehicles are found on the block's own plan (no stop tried,
-- the same appointment left out): every plan of the block (a booking, a move, the moments offered, apply_plan's chain,
-- roads_replan) freezes the same ones, and every walk holds the kept appointments (never two stops with one number).
-- book_job / move_job / web_book are unchanged: a stop that can go only on a frozen vehicle is « not placed » (block_full;
-- truck_full when that vehicle is asked). → the plan + { frozen: [vehicle ids], kept: [the appointments that did not fit] }
create or replace function public.plan_route(p_day date, p_block text, p_extra jsonb, p_exclude uuid, p_seed boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_frz jsonb := '[]'::jsonb; v_kept jsonb := '[]'::jsonb; v_new jsonb; p jsonb; i int;
begin
  if not public.roads_on() then return public.plan_route_core(p_day, p_block, p_extra, p_exclude, p_seed, null); end if;
  for i in 1 .. 10 loop
    p := public.plan_route_core(p_day, p_block, null, p_exclude, p_seed, v_frz);
    -- the vehicles of the plan holding an appointment it leaves out (a vehicle that does not work the block cannot be frozen)
    select coalesce(jsonb_agg(distinct j.truck_id::text), '[]'::jsonb) into v_new
    from jsonb_array_elements_text(coalesce(p->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid
    where j.truck_id is not null and not (v_frz ? j.truck_id::text)
      and exists (select 1 from jsonb_array_elements(p->'trucks') t where t->>'id' = j.truck_id::text);
    exit when jsonb_array_length(v_new) = 0;
    v_kept := v_kept || (select coalesce(jsonb_agg(o order by o), '[]'::jsonb)
                         from jsonb_array_elements_text(coalesce(p->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid
                         where v_new ? coalesce(j.truck_id::text, ''));
    v_frz := v_frz || v_new;
  end loop;
  if p_extra is not null then p := public.plan_route_core(p_day, p_block, p_extra, p_exclude, p_seed, v_frz); end if;
  return p || jsonb_build_object('frozen', v_frz, 'kept', v_kept);
end $$;


-- day_drive: roads on, each leg at the minute the truck leaves for it, the km of the road (null while a leg is not
-- measured: « unmeasured »), and the walk itself (at: the place of the stop tried, ids: the day in that order)
create or replace function public.day_drive(p_day date, p_truck uuid, p_plan jsonb default null, p_extra jsonb default null, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_speed numeric := public.bset('speed_kmh', 35);
  v_detour numeric := public.bset('detour', 1.3);
  v_unknown numeric := public.bset('unknown_min', 20);
  sl double precision; sg double precision; plat double precision; plng double precision;
  r record; v_min int := 0; v_km numeric := 0; n int := 0; leg int; v_hop int; was_extra boolean := false;
  -- Part 27 (roads on): each leg at the minute the truck leaves for it, the legs not measured counted, the walk given back
  v_on boolean := public.roads_on(); v_stop int := ceil(public.bset('stop_min', 5))::int; v_rg jsonb;
  v_unm int := 0; v_at int; v_ids jsonb := '[]'::jsonb; v_tm int; v_end int; v_pos int;
  v_nokm boolean := false; v_kml numeric; v_khop int;   -- fix-sql: a km not known (F7); the longest hop measured (F8)
  -- join-server (fix-sql F3, second half): today, a leg already driven at the hour of the day's plan, the next ones from
  -- where the truck is and when
  v_today boolean := false; v_now int; v_rg0 jsonb; v_live boolean := false; v_brg jsonb;
begin
  if v_on then
    -- the day walked (drive_min takes the rush hours of a working day) and where each block starts for this truck: its hours
    -- of that day from now on, as plan_route counts them
    perform set_config('garage.drive_dow', coalesce(extract(isodow from p_day)::int::text, ''), true);
    v_rg := public.ranges_from(public.truck_ranges(p_truck, p_day),
      case when p_day = public.local_today() then (ceil(public.now_min() / 5.0) * 5)::int when p_day < public.local_today() then 1440 else 0 end);
    -- today (join-server): the minute it is now, as plan_route and route_retime round it, and the truck's hours of the whole
    -- day (a leg already driven was driven inside them, not from now)
    v_today := p_day = public.local_today();
    v_now := (ceil(public.now_min() / 5.0) * 5)::int;
    v_rg0 := public.ranges_from(public.truck_ranges(p_truck, p_day), 0);
  end if;
  select coalesce((tr.start->>'lat')::double precision, h.lat), coalesce((tr.start->>'lng')::double precision, h.lng) into sl, sg
  from public.home_point() h left join public.trucks tr on tr.id = p_truck;
  plat := sl; plng := sg;
  for r in
    select q.lat, q.lng, q.extra, q.id, q.pos, q.at, q.dur, q.dep, q.bs, q.be, q.st, q.arr, q.ws from (
      -- what is written, outside the block being planned (and its stops the plan does not hold: the ones done)
      select b.pos, coalesce(j.stop_order, 9999) ord, coalesce(j.eta_min, 9999) eta, coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng, false extra,
        j.id::text id, j.eta_min at, j.duration_min dur, null::int dep, b.start_min bs, b.end_min be,
        j.status st, j.arrived_at arr,
        case when j.block = 'day' and public.windows_on() and not coalesce(j.forced, false) then case when j.manual_order is null then coalesce(j.arrive_at, j.win_start) else j.arrive_at end end ws
      from public.jobs j join public.blocks() b on b.key = j.block left join public.customers c on c.id = j.customer_id
      where j.day = p_day and j.truck_id = p_truck and j.deleted_at is null and j.status not in ('cancelled', 'no_show')
        and (p_exclude is null or j.id <> p_exclude)
        and (p_plan is null or j.block <> p_plan->>'block' or not (coalesce(p_plan->'jobs', '{}'::jsonb) ? j.id::text))
      union all
      -- the block being planned, in the order of the plan
      select b.pos, coalesce((e.value->>'order')::int, 9999), 9999,
        case when e.key = p_extra->>'id' then (p_extra->>'lat')::double precision else coalesce(j.lat, c.lat) end,
        case when e.key = p_extra->>'id' then (p_extra->>'lng')::double precision else coalesce(j.lng, c.lng) end,
        e.key = coalesce(p_extra->>'id', ''),
        e.key, (e.value->>'eta')::int, case when e.key = p_extra->>'id' then coalesce((p_extra->>'dur')::int, 60) else j.duration_min end,
        (e.value->>'dep')::int, b.start_min, b.end_min, j.status, j.arrived_at, null::int
      from jsonb_each(coalesce(p_plan->'jobs', '{}'::jsonb)) e join public.blocks() b on b.key = p_plan->>'block'
        left join public.jobs j on j.id = e.key::uuid left join public.customers c on c.id = j.customer_id
      where e.value->>'truck' = p_truck::text
    ) q order by q.pos, q.ord, q.eta
  loop
    -- roads on: the minute it leaves for this stop: said by the plan; else the end of the stop before it in the same block;
    -- else the first minute of the block for this truck (plan_route starts each block there)
    -- today (join-server, fix-sql F3 second half): a stop already reached (done, there) was driven to at the hour of the
    -- day's plan, never « now »; in a block already started the next stops leave from where the truck is and when, as
    -- route_retime writes their arrival times (a plan of today, window mode, says it itself: dep)
    v_tm := case when not v_on then null
                 when v_today and r.st in ('done', 'on_site') then
                   case when r.pos = v_pos then v_end else coalesce(public.ranges_first(v_rg0, r.bs, r.be), r.bs) end
                 when r.dep is not null then r.dep
                 when v_today and r.st in ('en_route', 'booked') and public.now_min() >= r.bs then
                   case when r.pos = v_pos and v_live then v_end else v_now end
                 when r.pos = v_pos then v_end
                 else coalesce(public.ranges_first(v_rg, r.bs, r.be), r.bs) end;
    leg := public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown, v_tm);
    v_min := v_min + leg;
    if r.lat is not null and r.lng is not null and plat is not null and plng is not null then
      if v_on then
        -- a trip measured without its km: the day's km is not known (fix-sql, verify-on F7: it counted 0)
        v_kml := public.drive_km(plat, plng, r.lat, r.lng, v_detour);
        if v_kml is null then v_nokm := true; else v_km := v_km + v_kml; end if;
      else
        v_km := v_km + public.km_between(plat, plng, r.lat, r.lng) * v_detour;
      end if;
    end if;
    -- roads on: a leg with no time measured on the road (or to a place without a position) is counted, never guessed
    if v_on and not public.drive_known(plat, plng, r.lat, r.lng) then v_unm := v_unm + 1; end if;
    -- the drive between the appointment tried and the customer before it, then the customer after it
    if n > 0 and r.lat is not null and (r.extra or was_extra) then v_hop := greatest(coalesce(v_hop, 0), leg); end if;
    -- roads on (fix-sql, verify-on F8): the longest of those drives that is a MEASURED trip
    if v_on and n > 0 and r.lat is not null and (r.extra or was_extra) and public.drive_known(plat, plng, r.lat, r.lng) then
      v_khop := greatest(coalesce(v_khop, 0), leg);
    end if;
    was_extra := r.extra and r.lat is not null;
    if r.lat is not null and r.lng is not null then plat := r.lat; plng := r.lng; end if;
    n := n + 1;
    if r.extra then v_at := n; end if;
    v_ids := v_ids || to_jsonb(case when r.extra then 'new' else r.id end);
    if v_on and v_today and r.st = 'on_site' then
      -- there now: free once the work left is done (route_retime counts no stop time after it; a plan of today does)
      v_end := (case when r.pos = v_pos and v_live then v_end else v_now end) + case when r.dep is not null then v_stop else 0 end
               + greatest(0, r.dur - coalesce(floor(extract(epoch from (now() - r.arr)) / 60)::int, 0));
      v_live := true;
    elsif v_on and v_today and r.dep is null and r.st in ('en_route', 'booked') and public.now_min() >= r.bs then
      -- on the clock from where the truck is: its arrival (a window waited for, a break in the hours: route_retime), the stop
      v_end := v_tm + leg;
      if r.st = 'booked' and r.ws is not null and v_end < r.ws then v_end := r.ws; end if;
      if r.st = 'booked' then
        v_brg := (select jsonb_agg(jsonb_build_array(greatest((x->>0)::int, r.bs), least((x->>1)::int, r.be)) order by (x->>0)::int)
                  from jsonb_array_elements(public.truck_ranges(p_truck, p_day)) x
                  where least((x->>1)::int, r.be) > greatest((x->>0)::int, r.bs) having count(*) > 1);
        if v_brg is not null then v_end := coalesce(public.ranges_fit(v_brg, v_end, v_stop + r.dur), v_end); end if;
      end if;
      v_end := v_end + v_stop + r.dur; v_live := true;
    else
      v_end := r.at + v_stop + r.dur;
    end if;
    v_pos := r.pos;
  end loop;
  if n > 0 then
    v_min := v_min + public.drive_min(plat, plng, sl, sg, v_speed, v_detour, v_unknown, case when v_on then v_end end);
    if v_on then
      -- the way back, once the last stop is done
      if plat is not null and sl is not null then
        v_kml := public.drive_km(plat, plng, sl, sg, v_detour);
        if v_kml is null then v_nokm := true; else v_km := v_km + v_kml; end if;
      end if;
      if not public.drive_known(plat, plng, sl, sg) then v_unm := v_unm + 1; end if;
    else
      if plat is not null and sl is not null then v_km := v_km + public.km_between(plat, plng, sl, sg) * v_detour; end if;
    end if;
  end if;
  -- km unknown (null) while a leg is not measured; at: the place of the stop tried in the day (1 = first); ids: the day's
  -- stops in that order (the stop tried is 'new')
  -- hop_known: the longest of the hops that is a measured trip (roads on; « far » for a fact even when another trip is not)
  return jsonb_build_object('min', v_min, 'km', case when v_unm > 0 or v_nokm then null else round(v_km, 1) end, 'stops', n, 'hop', v_hop,
    'unmeasured', v_unm, 'at', v_at, 'ids', v_ids, 'hop_known', v_khop);
end $$;

-- suggest_core: roads on, « near » by measured minutes (near_min); each moment says what is not measured (never « far » by
-- a guess), its day's km, and (window mode only) where the stop goes. A vehicle frozen by the real roads takes no new stop
-- (plan_route), the others of that block are offered (fix-sql, verify-on F6)
CREATE OR REPLACE FUNCTION public.suggest_core(p_lat double precision, p_lng double precision, p_duration integer, p_from date DEFAULT NULL::date, p_days integer DEFAULT 14, p_exclude uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 6, p_need boolean DEFAULT false, p_kind text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d date; b record; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
  p0 jsonb; p1 jsonb; out jsonb := '[]'; used0 int; used1 int; near int; v_near numeric := public.bset('near_km', 5);
  x uuid := '00000000-0000-4000-8000-000000000000';
  -- the vehicle: what the work needs and what the person chose; moving a job, what the job already says
  v_need boolean := coalesce(p_need, false) or coalesce((select j.needs_machine from public.jobs j where j.id = p_exclude), false);
  v_kind text := coalesce(case when p_kind in ('car', 'truck') then p_kind end, (select j.vehicle_kind from public.jobs j where j.id = p_exclude));
  -- the whole day (Part 25, « garde-route »)
  v_maxhop numeric := public.bset('max_hop_min', 35);
  v_maxday numeric := public.bset('max_day_drive_min', 105);
  v_x jsonb := jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', p_duration);
  tk record; w0 jsonb; w1 jsonb; v_truck text; min0 int; min1 int; km0 numeric; km1 numeric; v_day int; v_hop int; v_stops int; v_far text;
  -- « plages d'arrivée »
  v_wm boolean := public.windows_on(); wait0 int; wait1 int; v_eta int; v_row jsonb;
  -- Part 27 (roads on): « near » by measured minutes; what is not measured is said
  v_on boolean := public.roads_on(); v_nearmin numeric := public.roads_num('near_min', 10, 0, 1440); v_unm int; v_dkm numeric; v_rank int; v_route jsonb;
  v_khop int; v_unk numeric := public.bset('unknown_min', 20);
begin
  for d in select generate_series(v_from, v_from + greatest(1, least(p_days, 60)) - 1, interval '1 day')::date loop
    for b in select * from public.blocks() loop
      if not public.block_open(d, b.key) then continue; end if;
      p0 := public.plan_block(d, b.key, null, p_exclude);
      if jsonb_array_length(p0->'trucks') = 0 then continue; end if;
      -- « Peu importe »: the truck when the car-first plan does not fit (Part 26)
      p1 := public.plan_extra(d, b.key, jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', p_duration, 'need', v_need, 'kind', v_kind)
        || case when v_wm then jsonb_build_object('ws', null, 'we', null) else '{}'::jsonb end, p_exclude, p0);
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
          and case when v_on then coalesce(least(public.drive_measured(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)),
                                             public.drive_measured(coalesce(j.lat, c.lat), coalesce(j.lng, c.lng), p_lat, p_lng)) <= v_nearmin, false)
               else public.km_between(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) <= v_near end;
      -- the whole day of the vehicles of the block, without and with the appointment
      v_truck := p1->'extra'->>'truck'; min0 := 0; min1 := 0; km0 := 0; km1 := 0; v_day := null; v_hop := null; v_stops := 0;
      v_unm := 0; v_dkm := null; v_rank := null; v_route := null; v_khop := null;
      for tk in select (e->>'id')::uuid id from jsonb_array_elements(p1->'trucks') e loop
        w0 := public.day_drive(d, tk.id, p0, null, p_exclude);
        w1 := public.day_drive(d, tk.id, p1, v_x, p_exclude);
        min0 := min0 + (w0->>'min')::int; min1 := min1 + (w1->>'min')::int;
        km0 := km0 + (w0->>'km')::numeric; km1 := km1 + (w1->>'km')::numeric;
        if tk.id::text = v_truck then
          v_day := (w1->>'min')::int; v_hop := (w1->>'hop')::int; v_stops := greatest(0, (w1->>'stops')::int - 1);
          v_unm := (w1->>'unmeasured')::int; v_dkm := (w1->>'km')::numeric; v_khop := (w1->>'hop_known')::int;
          -- the place in the day only in window mode (fix-sql, the lead's F2: with blocks the booking may re-plan the other blocks)
          v_rank := case when v_wm then (w1->>'at')::int end; v_route := case when v_wm then w1->'ids' end;
        end if;
      end loop;
      v_far := case when p_lat is null or p_lng is null or v_stops = 0 then null
                    when v_maxhop > 0 and v_hop is not null and v_hop > v_maxhop then 'hop'
                    when v_maxday > 0 and v_day > v_maxday then 'day' end;
      -- roads on: a trip of that day not measured yet: « far » only for a fact (a measured hop over the limit, or the day over
      -- it with its measured trips alone: fix-sql, verify-on F8), else not known (the app says « pas encore mesuré »)
      if v_on and v_unm > 0 then
        v_far := case when p_lat is null or p_lng is null or v_stops = 0 then null
                      when v_maxhop > 0 and v_khop is not null and v_khop > v_maxhop then 'hop'
                      when v_maxday > 0 and v_day - v_unm * ceil(v_unk) > v_maxday then 'day' end;
      end if;
      v_row := jsonb_build_object('day', d, 'block', b.key, 'pos', b.pos, 'drive_min', greatest(0, used1 - used0 - p_duration - (wait1 - wait0)),
        'near', near, 'truck', v_truck, 'left', (select max((t->>'left')::int) from jsonb_array_elements(p1->'trucks') t),
        'add_min', greatest(0, min1 - min0), 'add_km', greatest(0, round(km1 - km0, 1)), 'day_min', v_day, 'hop_min', v_hop, 'stops', v_stops, 'far', v_far);
      if v_on then
        -- roads on (Part 27): km unknown while a trip is not measured; the vehicle's day km; where the stop goes in its day
        v_row := v_row || jsonb_build_object('add_km', case when v_unm > 0 or km0 is null or km1 is null then null else greatest(0, round(km1 - km0, 1)) end,
            'unmeasured', v_unm, 'day_km', v_dkm, 'rank', v_rank, 'route', v_route);
      end if;
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
      order by (e->>'far' is not null), (coalesce((e->>'unmeasured')::int, 0) > 0),
        case when coalesce((e->>'unmeasured')::int, 0) > 0 then 0 else (e->>'add_min')::int + coalesce((e->>'wait_min')::int, 0) end, (e->>'near')::int desc, e->>'day', (e->>'pos')::int) o
    from jsonb_array_elements(out) e) q where o <= greatest(1, p_limit)), '[]'::jsonb);
end $function$;

-- suggest_windows_core: the same as suggest_core for each window of the day
CREATE OR REPLACE FUNCTION public.suggest_windows_core(p_lat double precision, p_lng double precision, p_duration integer, p_day date, p_exclude uuid DEFAULT NULL::uuid, p_need boolean DEFAULT false, p_kind text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p0 jsonb; p1 jsonb; out jsonb := '[]'; used0 int; used1 int; wait0 int; wait1 int; near int; v_near numeric := public.bset('near_km', 5);
  x uuid := '00000000-0000-4000-8000-000000000000';
  v_need boolean := coalesce(p_need, false) or coalesce((select j.needs_machine from public.jobs j where j.id = p_exclude), false);
  v_kind text := coalesce(case when p_kind in ('car', 'truck') then p_kind end, (select j.vehicle_kind from public.jobs j where j.id = p_exclude));
  v_dur int := greatest(15, least(720, coalesce(p_duration, 60)));
  v_len int := public.win_len(); v_ws int; sp record; k int := 0;
  v_starts int[];
  -- « garde-route » (Part 26): what each window adds to the driving of the day, as suggest_core says it for a day
  v_maxhop numeric := public.bset('max_hop_min', 35); v_maxday numeric := public.bset('max_day_drive_min', 105);
  v_x jsonb := jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', v_dur); v_w0 jsonb := '{}'::jsonb;
  tk record; w0 jsonb; w1 jsonb; v_truck text; min0 int; min1 int; km0 numeric; km1 numeric; v_day int; v_hop int; v_stops int; v_far text;
  -- Part 27 (roads on): « near » by measured minutes; what is not measured is said
  v_on boolean := public.roads_on(); v_nearmin numeric := public.roads_num('near_min', 10, 0, 1440); v_unm int; v_dkm numeric; v_rank int; v_route jsonb;
  v_khop int; v_unk numeric := public.bset('unknown_min', 20);
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
      and case when v_on then coalesce(least(public.drive_measured(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)),
                                         public.drive_measured(coalesce(j.lat, c.lat), coalesce(j.lng, c.lng), p_lat, p_lng)) <= v_nearmin, false)
           else public.km_between(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) <= v_near end;
  -- Part 26: the windows offered are exactly the ones win_for cuts for an arrival on the day's quarter hours (the app asks
  -- for windowOf(T) of each quarter hour T), whatever « avant », the rounding and the day's first hour: one lattice
  v_starts := array(select distinct w.win_start from generate_series(sp.start_min, sp.end_min, 15) t(m) cross join lateral public.win_for(t.m) w
                    where w.win_start is not null order by 1);
  foreach v_ws in array v_starts loop
    exit when k >= 100;
    k := k + 1;
    if not (p_day = public.local_today() and public.now_min() > v_ws + v_len) then
      -- « Peu importe »: the truck when the car-first plan does not fit (Part 26)
      p1 := public.plan_extra(p_day, 'day', jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', v_dur, 'need', v_need, 'kind', v_kind,
        'ws', v_ws, 'we', v_ws + v_len), p_exclude, p0);
      if public.plan_fits(p0, p1) then
        select coalesce(sum((t->>'used')::int), 0), coalesce(sum(coalesce((t->>'wait')::int, 0)), 0) into used1, wait1 from jsonb_array_elements(p1->'trucks') t;
        -- the whole day of the vehicles, without and with the appointment (the day without it once per vehicle)
        v_truck := p1->'extra'->>'truck'; min0 := 0; min1 := 0; km0 := 0; km1 := 0; v_day := null; v_hop := null; v_stops := 0;
        v_unm := 0; v_dkm := null; v_rank := null; v_route := null; v_khop := null;
        for tk in select (e->>'id')::uuid id from jsonb_array_elements(p1->'trucks') e loop
          w0 := v_w0->(tk.id::text);
          if w0 is null then w0 := public.day_drive(p_day, tk.id, p0, null, p_exclude); v_w0 := v_w0 || jsonb_build_object(tk.id::text, w0); end if;
          w1 := public.day_drive(p_day, tk.id, p1, v_x, p_exclude);
          min0 := min0 + (w0->>'min')::int; min1 := min1 + (w1->>'min')::int;
          km0 := km0 + (w0->>'km')::numeric; km1 := km1 + (w1->>'km')::numeric;
          if tk.id::text = v_truck then
            v_day := (w1->>'min')::int; v_hop := (w1->>'hop')::int; v_stops := greatest(0, (w1->>'stops')::int - 1);
            v_unm := (w1->>'unmeasured')::int; v_dkm := (w1->>'km')::numeric; v_rank := (w1->>'at')::int; v_route := w1->'ids';
          v_khop := (w1->>'hop_known')::int;
          end if;
        end loop;
        v_far := case when p_lat is null or p_lng is null or v_stops = 0 then null
                      when v_maxhop > 0 and v_hop is not null and v_hop > v_maxhop then 'hop'
                      when v_maxday > 0 and v_day > v_maxday then 'day' end;
        -- roads on: a trip of that day not measured yet: « far » only for a fact (a measured hop over the limit, or the day over
        -- it with its measured trips alone: fix-sql, verify-on F8), else not known (the app says « pas encore mesuré »)
        if v_on and v_unm > 0 then
          v_far := case when p_lat is null or p_lng is null or v_stops = 0 then null
                        when v_maxhop > 0 and v_khop is not null and v_khop > v_maxhop then 'hop'
                        when v_maxday > 0 and v_day - v_unm * ceil(v_unk) > v_maxday then 'day' end;
        end if;
        out := out || jsonb_build_array(jsonb_build_object('day', p_day, 'block', 'day', 'pos', k, 'drive_min', greatest(0, used1 - used0 - v_dur - (wait1 - wait0)),
          'wait_min', greatest(0, wait1 - wait0), 'near', near, 'truck', p1->'extra'->>'truck',
          'left', (select max((t->>'left')::int) from jsonb_array_elements(p1->'trucks') t),
          'eta', (p1->'extra'->>'eta')::int, 'win_start', v_ws, 'win_end', v_ws + v_len,
          'add_min', greatest(0, min1 - min0), 'add_km', greatest(0, round(km1 - km0, 1)), 'day_min', v_day, 'hop_min', v_hop, 'stops', v_stops, 'far', v_far)
          -- roads on (Part 27): km unknown while a trip is not measured; the vehicle's day km; where the stop goes in its day
          || case when v_on then jsonb_build_object('add_km', case when v_unm > 0 or km0 is null or km1 is null then null else greatest(0, round(km1 - km0, 1)) end,
                 'unmeasured', v_unm, 'day_km', v_dkm, 'rank', v_rank, 'route', v_route) else '{}'::jsonb end);
      end if;
    end if;
  end loop;
  return coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(out) e
    order by (coalesce((e->>'unmeasured')::int, 0) > 0), case when coalesce((e->>'unmeasured')::int, 0) > 0 then 0 else (e->>'drive_min')::int + (e->>'wait_min')::int end,
      (e->>'win_start')::int) q), '[]'::jsonb);
end $function$;

-- web_suggest: online, a moment whose trips are not all measured is never offered (roads on; off no row says « unmeasured »)
create or replace function public.web_suggest(p_lat double precision, p_lng double precision, p_services uuid[],
  p_from date default null, p_days int default 14, p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_horizon int := public.bset('horizon_days', 120)::int; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
  v_out jsonb;
begin
  if not public.web_on() then perform public.fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.'); end if;
  if not public.web_in_area(p_lat, p_lng) then perform public.fail('far', 'Cette adresse est en dehors de notre secteur. Appelez le garage.'); end if;
  if coalesce(cardinality(p_services), 0) = 0 then perform public.fail('no_service', 'Choisissez au moins un service.'); end if;
  if v_from > public.local_today() + v_horizon then return '[]'::jsonb; end if;
  -- at most 14 days per call: each day costs up to six plans
  v_out := public.suggest_core(p_lat, p_lng, public.web_duration(p_services), v_from,
    least(greatest(1, p_days), 14, v_horizon - (v_from - public.local_today()) + 1), null, least(greatest(1, p_limit), 12),
    exists (select 1 from public.services sv where sv.id = any(p_services) and sv.needs_machine));
  return coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(v_out) with ordinality q(e, o) where e->>'far' is null
    and coalesce((e->>'unmeasured')::int, 0) = 0), '[]'::jsonb);
end $$;

-- web_windows: the same for the windows
create or replace function public.web_windows(p_lat double precision, p_lng double precision, p_services uuid[], p_day date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.web_on() then perform public.fail('web_off', 'La réservation en ligne est fermée pour le moment. Appelez le garage.'); end if;
  if not public.web_in_area(p_lat, p_lng) then perform public.fail('far', 'Cette adresse est en dehors de notre secteur. Appelez le garage.'); end if;
  if coalesce(cardinality(p_services), 0) = 0 then perform public.fail('no_service', 'Choisissez au moins un service.'); end if;
  return (select coalesce(jsonb_agg(e order by o), '[]'::jsonb)
    from jsonb_array_elements(public.suggest_windows_core(p_lat, p_lng, public.web_duration(p_services), p_day, null,
      exists (select 1 from public.services sv where sv.id = any(p_services) and sv.needs_machine), null)) with ordinality q(e, o)
    where coalesce((e->>'unmeasured')::int, 0) = 0);
end $$;

-- book_job: roads on, no window cut from a guessed arrival (it stays flexible); off: the text of before
CREATE OR REPLACE FUNCTION public.book_job(p_op uuid, p_job jsonb, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_done jsonb;
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
  v_wm boolean;
  v_ws int := nullif(p_job->>'win_start', '')::int; v_we int; v_flex boolean := coalesce((p_job->>'win_flex')::boolean, false);
  v_x jsonb; v_eta int; sp record;
  -- Part 26: a booking made in the other mode (kept on a phone); the window it was told, kept on a block job
  v_blk record; v_pws int; v_pwe int;
begin
  v_done := public.op_begin(p_op, 'book_job');
  if v_done is not null then return v_done; end if;
  -- never in the middle of the switch between blocks and windows
  perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
  v_wm := public.windows_on();
  if not public.is_staff() then perform public.fail('not_allowed', 'Connecte-toi pour réserver.'); end if;
  if not (public.can('book') or (public.has_role('mechanic') and v_truck is not null and v_truck = any(public.my_truck_ids()))) then
    perform public.fail('not_allowed', 'Tu ne peux pas prendre de rendez-vous. Parle au propriétaire.');
  end if;
  if exists (select 1 from public.jobs where id = v_id) then perform public.fail('exists', 'Ce rendez-vous existe déjà.'); end if;
  if v_wm then
    if v_block is not null and v_block <> 'day' then
      -- a block (booked while the garage gave blocks): the window of that block's hours, as the switch converts a job
      select * into v_blk from public.blocks_set() x where x.key = v_block;
      if not found then
        perform public.fail('bad_block', 'Le garage donne maintenant une plage d’arrivée : choisis une plage au lieu d’un bloc.');
      end if;
      if v_ws is null and not v_flex then v_ws := v_blk.start_min; v_we := v_blk.end_min; end if;
    end if;
    v_block := 'day';
    if v_flex then v_ws := null; v_we := null; end if;
  else
    -- a window (booked while the garage gave windows): the block of that window; the window stays on the job as what
    -- the customer was told when it is not the block's own hours
    if v_block = 'day' and v_ws is not null and not v_flex then
      v_block := coalesce(public.block_of_window(v_ws, v_ws + public.win_len()), v_block);
      if v_block <> 'day' and not exists (select 1 from public.blocks_set() x where x.key = v_block and x.start_min = v_ws and x.end_min = v_ws + public.win_len()) then
        v_pws := v_ws; v_pwe := v_ws + public.win_len();
      end if;
    end if;
    v_ws := null; v_flex := false;
  end if;
  select * into b from public.blocks() x where x.key = v_block;
  if not found or v_day is null then
    perform public.fail('bad_block', case when v_wm then 'Choisis la date et la plage d’arrivée.' else 'Choisis la date et le bloc : matin, après-midi ou soir.' end);
  end if;
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

  -- an estimate already booked (its appointment still on the agenda) is not booked again
  if nullif(p_job->>'quote_id', '') is not null then
    perform 1 from public.quotes q where q.id = (p_job->>'quote_id')::uuid for update;   -- two devices booking it at once: one after the other
    if exists (select 1 from public.quotes q join public.jobs jq on jq.id = q.job_id
               where q.id = (p_job->>'quote_id')::uuid and jq.deleted_at is null and jq.status not in ('cancelled', 'no_show')) then
      perform public.fail('quote_done', 'Ce devis est déjà réservé : ouvre son rendez-vous.');
    end if;
  end if;

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
    v_we := coalesce(v_we, v_ws + public.win_len());
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
  v_plan1 := public.plan_extra(v_day, v_block, v_x, null, v_plan0);
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
    perform public.fail('truck_full', case when v_wm then 'Ce camion n’a plus de place ce jour-là. Laisse l’app choisir le camion, ou choisis une autre journée.'
      else 'Ce camion n’a plus de place dans ce bloc. Laisse l’app choisir le camion, ou choisis un autre bloc.' end);
  end if;

  perform set_config('garage.rpc', 'on', true);
  insert into public.jobs (id, customer_id, vehicle_id, day, block, truck_id, truck_pinned, forced, duration_min, status, problem, notes,
    address, unit, postal_code, lat, lng, card_on_file, source, quote_id, created_by, needs_machine, vehicle_kind, win_start, win_end, win_flex)
  values (v_id, v_cust, nullif(p_job->>'vehicle_id', '')::uuid, v_day, v_block, (v_plan1->'extra'->>'truck')::uuid, v_truck is not null, v_forced, v_dur, 'booked',
    nullif(p_job->>'problem', ''), nullif(p_job->>'notes', ''), nullif(p_job->>'address', ''), nullif(p_job->>'unit', ''),
    nullif(p_job->>'postal_code', ''), nullif(p_job->>'lat', '')::double precision, nullif(p_job->>'lng', '')::double precision,
    coalesce((p_job->>'card_on_file')::boolean, false), coalesce(nullif(p_job->>'source', ''), 'phone'), nullif(p_job->>'quote_id', '')::uuid, auth.uid(), v_need, v_kind,
    coalesce(v_ws, v_pws), coalesce(v_we, v_pwe), v_flex);
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
  perform public.apply_plan_keep(v_plan1);
  -- no window chosen: it is cut around the planned arrival (a flexible job only once its day is locked). Nothing moves.
  if v_wm and v_ws is null and (not v_flex or public.win_lock_due(v_day)) then
    perform set_config('garage.rpc', 'on', true);
    select j.eta_min into v_eta from public.jobs j where j.id = v_id;
    if public.eta_known(v_id) then
      update public.jobs set win_start = w.win_start, win_end = w.win_end from public.win_for(v_eta) w where id = v_id;
    else
      -- Part 27 (final-guess G1): roads on, an arrival counted with the fixed unknown time (a trip not measured) is no
      -- window for the customer: the appointment stays « flexible » (the text says « dans la journée ; nous vous confirmons
      -- la veille une plage de 4 heures »), and lock_windows_core cuts its window once its trips are measured
      update public.jobs set win_flex = true where id = v_id;
    end if;
  end if;

  v_res := jsonb_build_object('ok', true, 'job_id', v_id, 'truck_id', v_plan1->'extra'->>'truck', 'forced', v_forced,
    'rows', jsonb_build_object('jobs', public.block_rows(v_day, v_block),
                               'job_items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.job_items i where i.job_id = v_id)));
  if v_wm then
    v_res := v_res || (select jsonb_build_object('win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex, 'eta', j.eta_min) from public.jobs j where j.id = v_id);
  end if;
  return public.op_save(p_op, 'book_job', v_res);
end $function$;

-- move_job (7 arguments): the same for a move to another day with no window said
create or replace function public.move_job(p_op uuid, p_job uuid, p_day date, p_block text, p_truck uuid, p_win_start integer, p_win_flex boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_done jsonb;
  j public.jobs; jn public.jobs; b record; v_lat double precision; v_lng double precision; v_plan0 jsonb; v_plan1 jsonb; v_res jsonb;
  v_wm boolean; v_ws int; v_we int; v_flex boolean := false; v_moved boolean; v_same boolean := true;
  v_x jsonb; v_eta int; sp record; v_blk record; v_wend int; v_pws int; v_pwe int; v_tell boolean; v_winch boolean; v_conv boolean := false;
begin
  v_done := public.op_begin(p_op, 'move_job');
  if v_done is not null then return v_done; end if;
  perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
  v_wm := public.windows_on();
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if not (public.can('book') or (p_truck is not null and coalesce(p_truck = any(public.my_truck_ids()), false) and coalesce(j.truck_id = any(public.my_truck_ids()), false))) then
    perform public.fail('not_allowed', 'Tu ne peux pas déplacer ce rendez-vous.');
  end if;
  if j.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  -- a move made in the other mode (kept on a phone, or an app not yet up to date): converted as the switch converts a job
  if v_wm and p_block is distinct from 'day' then
    select * into v_blk from public.blocks_set() x where x.key = p_block;
    if found then
      p_block := 'day';
      -- the same day too, unless the job's window already belongs to that block (a truck changed from the phone, the
      -- block it was shown in: the window told stays)
      if p_win_start is null and p_win_flex is null
         and (p_day is distinct from j.day or j.block <> 'day' or public.block_of_window(j.win_start, j.win_end) is distinct from v_blk.key) then
        p_win_start := v_blk.start_min; v_wend := v_blk.end_min;
      end if;
    end if;
  elsif not v_wm and p_block = 'day' then
    if p_win_start is not null then
      p_block := coalesce(public.block_of_window(p_win_start, p_win_start + public.win_len()), p_block);
      v_conv := p_block <> 'day';
      if p_block <> 'day' and not exists (select 1 from public.blocks_set() x where x.key = p_block and x.start_min = p_win_start and x.end_min = p_win_start + public.win_len()) then
        v_pws := p_win_start; v_pwe := p_win_start + public.win_len();
      end if;
    elsif p_day = j.day and exists (select 1 from public.blocks() x where x.key = j.block) then
      p_block := j.block;
    end if;
  end if;
  select * into b from public.blocks() x where x.key = p_block;
  if not found then
    perform public.fail('bad_block', case when v_wm then 'Le garage donne maintenant une plage d’arrivée : choisis une plage au lieu d’un bloc.' else 'Bloc inconnu.' end);
  end if;
  if not public.block_open(p_day, p_block) then
    perform public.fail('block_started', case when v_wm then 'Cette journée est finie : choisis une autre journée.' else 'Ce bloc est déjà commencé.' end);
  end if;
  if p_truck is not null and j.needs_machine and exists (select 1 from public.trucks tr where tr.id = p_truck and not tr.tire_machine) then
    perform public.fail('needs_truck', 'Ce travail demande le camion (montage ou balancement des pneus) : la voiture ne peut pas le faire.');
  end if;
  -- the two blocks, always locked in the same order (day, then morning → evening); then the job as it is NOW
  perform public.lock_two(j.day, j.block, p_day, p_block);
  select * into jn from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if jn.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  if (jn.day, jn.block) is distinct from (j.day, j.block) then
    perform public.fail('changed', 'Ce rendez-vous vient d’être déplacé par quelqu’un d’autre. Rouvre-le et recommence.');
  end if;
  j := jn;
  v_moved := j.day <> p_day or j.block <> p_block;
  if v_wm then
    if coalesce(p_win_flex, false) then
      v_flex := true; v_ws := null;
      v_same := j.win_flex;
      if v_same then v_ws := j.win_start; v_we := j.win_end; end if;       -- already flexible: its window, if fixed, stays
    elsif p_win_start is not null then
      v_flex := false; v_ws := p_win_start; v_we := coalesce(v_wend, p_win_start + public.win_len());
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
  elsif not v_moved and v_conv then
    v_same := (v_pws, v_pwe) is not distinct from (j.win_start, j.win_end);  -- blocks, a window inside its own block: the new window
  elsif not v_moved then
    v_pws := j.win_start; v_pwe := j.win_end;                              -- blocks, the same moment: what was told stays on the job
  end if;
  if not v_moved and v_same and p_truck is not distinct from (case when j.truck_pinned then j.truck_id end) and j.arrive_at is null then
    return public.op_save(p_op, 'move_job', jsonb_build_object('ok', true, 'unchanged', true, 'changed', false, 'tell', false,
      'rows', jsonb_build_object('jobs', jsonb_build_array(to_jsonb(j)))));
  end if;
  select coalesce(j.lat, c.lat), coalesce(j.lng, c.lng) into v_lat, v_lng from public.customers c where c.id = j.customer_id;
  v_x := jsonb_build_object('id', j.id, 'lat', v_lat, 'lng', v_lng, 'dur', j.duration_min, 'truck', p_truck,
    -- a vehicle chosen by hand: its kind becomes the job's (work for the tire machine still needs the machine)
    'need', j.needs_machine, 'kind', case when p_truck is not null then (select case when tr.tire_machine then 'truck' else 'car' end from public.trucks tr where tr.id = p_truck) else j.vehicle_kind end)
    || case when v_wm then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end;
  v_plan0 := public.plan_block(p_day, p_block, null, j.id);
  v_plan1 := public.plan_extra(p_day, p_block, v_x, j.id, v_plan0);
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
    perform public.fail('truck_full', case when v_wm then 'Ce camion n’a plus de place ce jour-là.' else 'Ce camion n’a plus de place dans ce bloc.' end);
  end if;
  perform set_config('garage.rpc', 'on', true);
  update public.jobs set day = p_day, block = p_block, truck_id = (v_plan1->'extra'->>'truck')::uuid, truck_pinned = p_truck is not null,
    win_start = case when v_wm then v_ws else v_pws end, win_end = case when v_wm then v_we else v_pwe end, win_flex = v_flex,
    -- it fits where it now is: no longer « réservé quand même »
    forced = false,
    -- (exact move, S7) no minute pointed any more: the planner chooses inside the window again
    arrive_at = null,
    -- a new window is a new moment: the place chosen by hand in the route is forgotten, the customer is told again
    manual_order = case when v_wm and v_ws is distinct from win_start then null else manual_order end,
    confirm_sent_at = case when day <> p_day or block <> p_block or (v_ws is not null and v_ws is distinct from win_start) then null else confirm_sent_at end
  where id = j.id and status = 'booked';
  if not found then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  perform public.apply_plan_keep(v_plan1);
  if v_moved and exists (select 1 from public.blocks() x where x.key = j.block) then
    if public.block_open(j.day, j.block) then
      perform public.apply_plan_keep(public.plan_block(j.day, j.block));
    elsif j.day = public.local_today() and j.truck_id is not null and j.stop_order is not null then
      -- a block already started: nobody is planned again, the stops after it move up by one
      update public.jobs set stop_order = stop_order - 1
      where truck_id = j.truck_id and day = j.day and block = j.block and deleted_at is null and id <> j.id
        and status in ('booked','en_route','on_site') and stop_order > j.stop_order
        and not exists (select 1 from public.jobs o where o.truck_id = j.truck_id and o.day = j.day and o.block = j.block and o.deleted_at is null
                        and o.id <> j.id and o.status not in ('cancelled','no_show') and o.stop_order = j.stop_order);
    end if;
  end if;
  -- no window said: it is cut around the planned arrival (a flexible job only once its day is locked). Nothing moves.
  if v_wm and v_ws is null and (not v_flex or public.win_lock_due(p_day)) then
    perform set_config('garage.rpc', 'on', true);
    select x.eta_min into v_eta from public.jobs x where x.id = j.id;
    if public.eta_known(j.id) then
      update public.jobs set win_start = w.win_start, win_end = w.win_end,
        confirm_sent_at = case when j.win_start is distinct from w.win_start then null else confirm_sent_at end
      from public.win_for(v_eta) w where id = j.id;
    else
      -- Part 27 (final-guess G1): roads on, an arrival counted with the fixed unknown time (a trip not measured) is no
      -- window for the customer: the appointment stays « flexible » (the text says « dans la journée ; nous vous confirmons
      -- la veille une plage de 4 heures »), and lock_windows_core cuts its window once its trips are measured
      update public.jobs set win_flex = true,
        confirm_sent_at = case when j.win_start is not null then null else confirm_sent_at end
      where id = j.id;
    end if;
  end if;
  -- what really changed for the customer (the day, the block, the window): told again
  select * into jn from public.jobs where id = j.id;
  v_winch := (j.win_start, j.win_end) is distinct from (jn.win_start, jn.win_end);
  -- (blocks: the window only changes on the same block when a window was chosen on a phone in the other mode)
  v_tell := v_moved or v_winch;
  if v_tell and jn.confirm_sent_at is not null then
    perform set_config('garage.rpc', 'on', true);
    update public.jobs set confirm_sent_at = null where id = j.id;
  end if;
  v_res := jsonb_build_object('ok', true, 'job_id', j.id, 'changed', v_moved, 'tell', v_tell, 'window_changed', v_winch,
    'truck_changed', j.truck_id is distinct from jn.truck_id,
    'was', jsonb_build_object('day', j.day, 'block', j.block, 'win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex, 'truck_id', j.truck_id),
    'now', jsonb_build_object('day', jn.day, 'block', jn.block, 'win_start', jn.win_start, 'win_end', jn.win_end, 'win_flex', jn.win_flex, 'truck_id', jn.truck_id),
    'rows', jsonb_build_object('jobs', public.block_rows(p_day, p_block) || case when v_moved then public.block_rows(j.day, j.block) else '[]'::jsonb end));
  return public.op_save(p_op, 'move_job', v_res);
end $function$;

-- lock_windows_core: roads on, a flexible appointment gets its window only once its arrival is measured (asked again
-- every 10 minutes by lock_windows_due); off: the text of before
create or replace function public.lock_windows_core(p_day date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_ids jsonb := '[]'; n int := 0; w record;
begin
  if not public.windows_on() or p_day is null or p_day < public.local_today() then return jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb); end if;
  -- nothing to fix (a flexible job « À placer » has no arrival to cut a window around): no lock, no re-plan
  if not exists (select 1 from public.jobs j where j.day = p_day and j.block = 'day' and j.status = 'booked' and j.deleted_at is null and j.win_flex and j.win_start is null and j.truck_id is not null
    and public.eta_known(j.id)) then
    return jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb);
  end if;
  perform public.lock_block(p_day, 'day');
  if not exists (select 1 from public.jobs j where j.day = p_day and j.block = 'day' and j.status = 'booked' and j.deleted_at is null and j.win_flex and j.win_start is null and j.truck_id is not null
    and public.eta_known(j.id)) then
    return jsonb_build_object('fixed', 0, 'jobs', '[]'::jsonb);
  end if;
  -- the arrivals as they are now (a plan that would throw an appointment to « À placer » is not written)
  perform public.replan_block_safe(p_day, 'day');
  perform set_config('garage.rpc', 'on', true);
  for r in select j.id, j.eta_min from public.jobs j
           where j.day = p_day and j.block = 'day' and j.status = 'booked' and j.deleted_at is null and j.win_flex and j.win_start is null and j.eta_min is not null
             and public.eta_known(j.id)   -- Part 27 (final-guess G1): never a window cut from a guessed arrival
           order by j.eta_min, j.id loop
    select * into w from public.win_for(r.eta_min);
    update public.jobs set win_start = w.win_start, win_end = w.win_end where id = r.id;
    insert into public.activity (entity, entity_id, action, data)
    values ('job', r.id, 'window_fixed', jsonb_build_object('day', p_day, 'win_start', w.win_start, 'win_end', w.win_end));
    v_ids := v_ids || to_jsonb(r.id); n := n + 1;
  end loop;
  return jsonb_build_object('fixed', n, 'jobs', v_ids);
end $function$;

-- plan_late_new: also a stop pinned to a minute, late already, that this plan makes later (exact move, verify-on F5)
create or replace function public.plan_late_new(p0 jsonb, p1 jsonb) returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from jsonb_array_elements_text(coalesce(p1->'late', '[]'::jsonb)) o where not (coalesce(p0->'late', '[]'::jsonb) ? o))
      or exists (select 1 from jsonb_array_elements_text(coalesce(p1->'late', '[]'::jsonb)) o
                 join public.jobs j on j.id::text = o and j.arrive_at is not null
                 where coalesce(p0->'late', '[]'::jsonb) ? o and (p1->'jobs'->o->>'eta')::int > (p0->'jobs'->o->>'eta')::int)
$$;

-- plan_inputs: roads on, the speed and the detour plan nothing (they are not used) and roads_rush does; off, as before.
-- It reads the switch as it is NOW (settings_replan compares old and new after the save), so flipping roads_on alone
-- re-plans nothing here: roads_switch plans the coming days itself
create or replace function public.plan_inputs(p_booking jsonb) returns jsonb language sql stable set search_path = public, extensions as $$
  select jsonb_build_object('lat', p_booking->'home'->'lat', 'lng', p_booking->'home'->'lng', 'speed', case when not public.roads_on() then p_booking->'speed_kmh' end,
    'detour', case when not public.roads_on() then p_booking->'detour' end, 'stop', p_booking->'stop_min', 'unknown', p_booking->'unknown_min',
    'min_block', p_booking->'min_block_min', 'blocks', p_booking->'blocks')
    || case when public.roads_on() then jsonb_build_object('rush', not public.roads_no(p_booking->'roads_rush')) else '{}'::jsonb end
$$;

-- customers_replan_on_position: the blocks it plans are locked first, in the order every planner takes them (day, then
-- morning → evening); then planned as before, in the same order as before (the plans do not change)
create or replace function public.customers_replan_on_position() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.lat is not null and (old.lat is distinct from new.lat or old.lng is distinct from new.lng) then
    -- Part 27: drive_store plans the coming days every few minutes (roads_replan locks the blocks day by day, morning →
    -- evening); this loop took them in no set order (« eve » before « pm »), so the two could wait on each other until
    -- PostgreSQL stops one (review-sql L6). Only the order of the locks changes
    for r in select q.day, q.block from (select distinct j.day, j.block from public.jobs j
             where j.customer_id = new.id and j.deleted_at is null and j.status = 'booked' and j.day >= public.local_today() and j.lat is null) q
             order by q.day, public.block_pos(q.block)
    loop
      if public.block_open(r.day, r.block) then perform public.lock_block(r.day, r.block); end if;
    end loop;
    for r in select distinct j.day, j.block from public.jobs j
             where j.customer_id = new.id and j.deleted_at is null and j.status = 'booked' and j.day >= public.local_today() and j.lat is null
    loop
      perform public.replan_block(r.day, r.block);
    end loop;
  end if;
  return null;
end $$;

-- replan_block_safe: roads on, the appointments this automatic re-plan makes late (a position found, a cancellation, a
-- duration) are written down (activity « window_late »: roads_late_note). Off: the text of before
create or replace function public.replan_block_safe(p_day date, p_block text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_plan jsonb; v_today boolean; tk record;
  -- Part 27 (fix-sql, verify-on F11): roads on, who this re-plan makes late is written down
  v_on boolean := public.roads_on(); v_before jsonb;
begin
  if not public.block_open(p_day, p_block) then return jsonb_build_object('skipped', true, 'day', p_day, 'block', p_block); end if;
  perform public.lock_block(p_day, p_block);
  if v_on then v_before := public.roads_late_ids(array[p_day]); end if;
  v_plan := public.plan_block(p_day, p_block);
  v_today := p_block = 'day' and p_day = public.local_today() and public.windows_on()
             and public.now_min() >= (select s.start_min from public.day_span() s);
  if not v_today and exists (select 1 from jsonb_array_elements_text(coalesce(v_plan->'over', '[]'::jsonb)) o
                             join public.jobs j on j.id = o::uuid where j.truck_id is not null) then
    for tk in select distinct j.truck_id from public.jobs j
              where j.day = p_day and j.block = p_block and j.deleted_at is null and j.status = 'booked' and j.truck_id is not null loop
      perform public.route_retime(tk.truck_id, p_day, p_block);
    end loop;
    v_plan := jsonb_build_object('skipped', true, 'kept', true, 'day', p_day, 'block', p_block);
  else
    perform public.apply_plan(v_plan);
  end if;
  if v_on then perform public.roads_late_note(array[p_day], v_before, 'replan'); end if;
  -- work for the tire machine left on a vehicle without it (no vehicle with the machine has room): said in the activity
  -- (`needs_truck`, once per vehicle) so the agenda can show it
  insert into public.activity (entity, entity_id, action, data)
  select 'job', j.id, 'needs_truck', jsonb_build_object('day', j.day, 'block', j.block, 'truck_id', j.truck_id)
  from public.jobs j join public.trucks tr on tr.id = j.truck_id
  where j.day = p_day and j.block = p_block and j.deleted_at is null and j.status = 'booked' and j.needs_machine and not tr.tire_machine
    and not exists (select 1 from public.activity a where a.entity = 'job' and a.entity_id = j.id and a.action = 'needs_truck'
                    and a.data->>'truck_id' = j.truck_id::text);
  return v_plan;
end $$;

-- apply_plan: roads on, the day's chain re-times a later block it cannot plan without un-placing somebody (route_retime:
-- never the arrival times counted from the old end of the block before), and writes down who it made late. Off: as before
create or replace function public.apply_plan(p_plan jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare k text; v jsonb; n int := 0; c int; d date := nullif(p_plan->>'day', '')::date; bk record; p jsonb; v_moved boolean := false; v_keep boolean;
  v_started boolean; v_was jsonb; v_now int;
  -- Part 27 (fix-sql, verify-on F4, F11): roads on, the chain re-times a block it cannot plan and says who it made late
  v_on boolean; v_before jsonb; tk record;
  -- « exact move » (verify-on F3): the stops of that day pinned to a minute, with their arrival before this plan
  v_pins jsonb;
begin
  perform set_config('garage.rpc', 'on', true);
  select jsonb_object_agg(j.id::text, j.eta_min) into v_pins from public.jobs j
  where d is not null and j.day = d and j.arrive_at is not null and j.status = 'booked' and j.deleted_at is null;
  for k, v in select * from jsonb_each(coalesce(p_plan->'jobs', '{}')) loop
    if coalesce((v->>'fixed')::boolean, false) then
      update public.jobs set stop_order = (v->>'order')::int, eta_min = (v->>'eta')::int, travel_min = (v->>'travel')::int
      where id = k::uuid and v ? 'order' and (stop_order, eta_min, travel_min) is distinct from ((v->>'order')::int, (v->>'eta')::int, (v->>'travel')::int);
    else
      update public.jobs set truck_id = (v->>'truck')::uuid, stop_order = (v->>'order')::int, eta_min = (v->>'eta')::int, travel_min = (v->>'travel')::int,
        truck_pinned = truck_pinned and truck_id = (v->>'truck')::uuid
      where id = k::uuid and status = 'booked' and (truck_id, stop_order, eta_min, travel_min) is distinct from ((v->>'truck')::uuid, (v->>'order')::int, (v->>'eta')::int, (v->>'travel')::int);
    end if;
    get diagnostics c = row_count; n := n + c;
  end loop;
  v_started := p_plan->>'block' = 'day' and d is not null and d = public.local_today() and public.windows_on()
            and public.now_min() >= (select s.start_min from public.day_span() s);
  v_keep := v_started
            -- a block already started, or of a past day: its appointments stay on their truck
            or (d is not null and not public.block_open(d, p_plan->>'block'))
            -- an operation on one appointment: the others keep their place
            or coalesce(current_setting('garage.keep', true), '') = 'on';
  if not coalesce(v_keep, false) then
    update public.jobs set truck_id = null, stop_order = null, eta_min = null, travel_min = null, truck_pinned = false
    where id in (select x::uuid from jsonb_array_elements_text(coalesce(p_plan->'over', '[]')) x)
      and status = 'booked' and (truck_id is not null or stop_order is not null);
    get diagnostics c = row_count; n := n + c;
  elsif coalesce(v_started, false) and public.block_open(d, 'day')
        and coalesce(current_setting('garage.unplace', true), '') = 'on' and coalesce(current_setting('garage.keep', true), '') <> 'on' then
    -- window mode, a day already started (round 2, plages-01): a vehicle switched off (or deleted), or one that still
    -- worked after now and whose hours of the day were changed by this very operation (Horaires, « Départ et heure »)
    -- so that it no longer works for the rest of the day: its appointments go to « À placer », as Horaires says (they
    -- stayed on the closed vehicle, numbered and timed, and nobody came). A vehicle whose day simply ended keeps the rule
    -- « never un-placed », whatever else is written on it (its start, its kind, its usual week or today's hours again
    -- after its day ended: srv-planif-r2-1); one that still works too (plan_route puts its stops back, late). En route
    -- / on site are never in « over ».
    -- Today's hours before the change: apply_hours says them (garage.hours_was, per vehicle); a day's own hours taken
    -- off by a plain table write (« Revenir à l'horaire ») are the row taken off; any other hours written in this
    -- operation: the vehicle counts as closed by them.
    v_was := coalesce(nullif(current_setting('garage.hours_was', true), '')::jsonb, '{}'::jsonb);
    v_now := public.now_min();
    update public.jobs j set truck_id = null, stop_order = null, eta_min = null, travel_min = null, truck_pinned = false
    where j.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_plan->'over', '[]')) x)
      and j.status = 'booked' and j.truck_id is not null
      and not exists (select 1 from jsonb_array_elements(coalesce(p_plan->'trucks', '[]'::jsonb)) t where t->>'id' = j.truck_id::text)
      and (exists (select 1 from public.trucks tr where tr.id = j.truck_id and (not tr.active or tr.deleted_at is not null))
           or case when v_was ? j.truck_id::text then
                 exists (select 1 from jsonb_array_elements(v_was->(j.truck_id::text)) x where (x->>1)::int > v_now)
               else
                 exists (select 1 from public.truck_days td where td.truck_id = j.truck_id and td.day = d and td.updated_at >= now()
                         and (td.deleted_at is null
                              or (td.deleted_at >= now() and exists (select 1 from jsonb_array_elements(td.ranges) x where (x->>1)::int > v_now))))
                 or exists (select 1 from public.truck_week tw where tw.truck_id = j.truck_id and tw.dow = extract(dow from d)::int and tw.updated_at >= now()
                            and not exists (select 1 from public.truck_days td where td.truck_id = j.truck_id and td.day = d and td.deleted_at is null))
               end);
    get diagnostics c = row_count; n := n + c;
  end if;
  -- window mode, today: the stops already done keep 1, 2, … on their truck, in the order they were finished (the plan
  -- numbers the others after them)
  if p_plan->>'block' = 'day' and d is not null and d = public.local_today() and public.windows_on() then
    update public.jobs j set stop_order = q.rn
    from (select x.id, (row_number() over (partition by x.truck_id order by x.finished_at nulls last, x.stop_order nulls last, x.id))::int rn
          from public.jobs x where x.day = d and x.block = 'day' and x.status = 'done' and x.truck_id is not null and x.deleted_at is null) q
    where q.id = j.id and j.stop_order is distinct from q.rn;
  end if;

  -- Part 27 (final-guess G1): roads on, the arrivals just written say whether they count measured trips only (jobs.eta_measured)
  if d is not null and public.roads_on() then perform public.route_mark(d, null); end if;
  -- « exact move » (S6 « placed late and SAID late », verify-on F3): a stop pinned to a minute that this plan puts after its
  -- minute, or later than it was, is written down, « Vraies routes » on or off (activity « window_late », why 'pin', once in
  -- this transaction); never from an arrival that counts a trip not measured (S8). Nothing pinned: nothing
  if v_pins is not null then
    insert into public.activity (actor, entity, entity_id, action, data)
    select auth.uid(), 'job', j.id, 'window_late', jsonb_build_object('day', j.day, 'block', j.block, 'eta', j.eta_min,
             'win_start', j.win_start, 'win_end', j.win_end, 'end', b.end_min, 'truck_id', j.truck_id, 'why', 'pin', 'arrive_at', j.arrive_at)
    from public.jobs j join public.blocks() b on b.key = j.block
    where v_pins ? j.id::text and j.status = 'booked' and j.deleted_at is null and j.truck_id is not null and j.arrive_at is not null
      and j.eta_min > j.arrive_at
      and ((v_pins->>j.id::text) is null or (v_pins->>j.id::text)::int <= j.arrive_at or j.eta_min > (v_pins->>j.id::text)::int)
      and (not public.roads_on() or coalesce(j.eta_measured, true))
      and not exists (select 1 from public.activity a where a.entity = 'job' and a.entity_id = j.id and a.action = 'window_late' and a.at = now());
  end if;
  if n > 0 and d is not null and coalesce(current_setting('garage.chain', true), '') <> 'on' then
    perform set_config('garage.chain', 'on', true);
    v_on := public.roads_on();
    if v_on then v_before := public.roads_late_ids(array[d]); end if;
    for bk in select b.key, b.start_min from public.blocks() b order by b.pos loop
      -- the block just written: again only when a block before it now ends elsewhere
      continue when bk.key = p_plan->>'block' and not v_moved;
      continue when not public.block_open(d, bk.key);
      continue when not exists (select 1 from public.jobs j where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked');
      continue when not pg_try_advisory_xact_lock(hashtext('block:' || d::text || ':' || bk.key));
      p := public.plan_block(d, bk.key);
      if exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]')) o join public.jobs j on j.id = o::uuid where j.truck_id is not null) then
        -- roads on (Part 27): it keeps its places, with its arrival times walked again from where the block before now ends
        if v_on then
          for tk in select distinct j.truck_id from public.jobs j
                    where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked' and j.truck_id is not null loop
            perform public.route_retime(tk.truck_id, d, bk.key);
          end loop;
        end if;
        continue;
      end if;
      if public.apply_plan(p) > 0 then v_moved := true; end if;
    end loop;
    if v_on then perform public.roads_late_note(array[d], v_before, 'chain'); end if;
    perform set_config('garage.chain', '', true);
    perform set_config('garage.rpc', 'on', true);
  end if;
  return n;
end $function$;

-- log_activity: jobs.eta_measured is the planner's, like eta_min: not an « update » of the appointment
create or replace function public.log_activity() returns trigger language plpgsql security definer set search_path = public as $$
declare d jsonb; k text; o jsonb; n jsonb; v_id uuid;
begin
  if coalesce(current_setting('garage.trial', true), '') = 'on' then return null; end if;
  n := to_jsonb(new);
  v_id := case when (n->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (n->>'id')::uuid end;
  if tg_op = 'INSERT' then
    insert into public.activity (actor, entity, entity_id, action) values (auth.uid(), tg_table_name, v_id, 'insert');
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old); d := '{}';
    for k in select key from jsonb_each(n) loop
      if k not in ('updated_at', 'created_at', 'eta_min', 'travel_min', 'stop_order', 'eta_measured', 'last_seen_at', 'prefs') and (o->k) is distinct from (n->k) then
        d := d || jsonb_build_object(k, jsonb_build_array(o->k, n->k));
      end if;
    end loop;
    if d <> '{}' then
      insert into public.activity (actor, entity, entity_id, action, data)
      values (auth.uid(), tg_table_name, v_id, case when n->>'deleted_at' is not null and o->>'deleted_at' is null then 'delete' else 'update' end, d);
    end if;
  end if;
  return null;
end $$;

-- stop_order_one: the stops put in order by hand lose the minute pointed by a move (the last action wins)
create or replace function public.stop_order_one(p_truck uuid, p_day date, p_block text, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_plan jsonb; v_direct boolean := true; v_base int;
begin
  perform public.lock_block(p_day, p_block);
  if exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.jobs j where j.id = x and j.truck_id = p_truck and j.day = p_day
             and j.block = p_block and j.deleted_at is null and j.status = 'booked')) then
    perform public.fail('changed', 'Un des rendez-vous n’est plus dans cette route (parti, fini ou déplacé). Rouvre la liste.');
  end if;
  perform set_config('garage.rpc', 'on', true);
  update public.jobs set manual_order = null
  where truck_id = p_truck and day = p_day and block = p_block and manual_order is not null and not (id = any(p_ids));
  update public.jobs j set manual_order = x.o, arrive_at = null from unnest(p_ids) with ordinality x(id, o)
  where j.id = x.id and (j.manual_order is distinct from x.o::int or j.arrive_at is not null);
  if public.block_open(p_day, p_block) then
    v_plan := public.plan_block(p_day, p_block);
    v_direct := not exists (select 1 from jsonb_array_elements(v_plan->'trucks') t where t->>'id' = p_truck::text)
      or exists (select 1 from jsonb_array_elements_text(coalesce(v_plan->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid where j.truck_id is not null);
    if not v_direct then perform public.apply_plan_keep(v_plan); end if;
  end if;
  if v_direct then
    select coalesce(max(j.stop_order), 0) into v_base from public.jobs j
    where j.truck_id = p_truck and j.day = p_day and j.block = p_block and j.deleted_at is null and j.status in ('en_route','on_site','done');
    update public.jobs j set stop_order = v_base + q.rn
    from (select x.id, (row_number() over (order by array_position(p_ids, x.id) nulls last, x.stop_order nulls last, x.eta_min nulls last, x.created_at))::int rn
          from public.jobs x where x.truck_id = p_truck and x.day = p_day and x.block = p_block and x.deleted_at is null and x.status = 'booked') q
    where q.id = j.id and j.stop_order is distinct from v_base + q.rn;
    perform public.route_retime(p_truck, p_day, p_block);
  end if;
end $$;

-- windows_switch: back to the blocks, no minute pointed is kept (a block tells no time)
CREATE OR REPLACE FUNCTION public.windows_switch(p_op uuid, p_on boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_done jsonb; v_today date := public.local_today(); n int := 0; d date; bk record; p jsonb;
  v_chain text := coalesce(current_setting('garage.chain', true), '');
  -- Part 26: whom to call (the window told is not inside the block they go back to), the days left as they were
  v_call jsonb := '[]'::jsonb; v_kept jsonb := '[]'::jsonb;
  -- round 2 (plages-02): the appointments without a window (flexible, or none yet) on the way to the blocks, and the
  -- flexible ones on the way back
  v_nowin uuid[]; v_flex uuid[]; v_back uuid[]; v_on_id bigint;
begin
  v_done := public.op_begin(p_op, 'windows_switch');
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire change la façon de donner les heures aux clients.'); end if;
  if p_on is null then perform public.fail('bad_mode', 'Choisis : les plages d’arrivée, ou les blocs.'); end if;
  perform pg_advisory_xact_lock(hashtext('windows_switch'));
  if public.windows_on() = p_on then
    return public.op_save(p_op, 'windows_switch', jsonb_build_object('ok', true, 'converted', 0, 'unchanged', true, 'on', p_on));
  end if;
  perform set_config('garage.rpc', 'on', true);
  if p_on then
    select count(*) into n from public.jobs j where j.day >= v_today and j.block <> 'day' and j.deleted_at is null and j.status = 'booked';
    -- flexible before the switch back to the blocks, and still in the block it gave them: flexible again (round 2). Only
    -- the mark of the LAST switch back to the blocks counts (written after the last switch to the windows): an older one
    -- is of a time the appointment was flexible before, and since then its window was fixed and told (lock_windows, a
    -- move with a window), then left without a mark because it is its block's very hours (srv-planif-r2-2). In the
    -- order the rows were written (the id: a switch and its marks may share one instant)
    select a.id into v_on_id from public.activity a
    where a.entity = 'settings' and a.action = 'windows_switch' and a.data->>'on' = 'true' order by a.id desc limit 1;
    select coalesce(array_agg(j.id), '{}') into v_back from public.jobs j
    where j.day >= v_today and j.block <> 'day' and j.deleted_at is null and j.status = 'booked' and j.win_start is null
      and coalesce((select a.data->>'reason' = 'flexible' and a.data->>'day' = j.day::text and a.data->>'block' = j.block
                    from public.activity a where a.entity = 'job' and a.entity_id = j.id and a.action = 'window_to_block'
                      and a.id > coalesce(v_on_id, 0)
                    order by a.id desc limit 1), false);
    -- a window still kept on the job (what the customer was told before a switch back to the blocks) is its window again
    update public.jobs j set block = 'day',
      win_start = case when j.win_start is not null and j.win_end is not null and j.win_start < x.end_min and j.win_end > x.start_min then j.win_start else x.start_min end,
      win_end = case when j.win_start is not null and j.win_end is not null and j.win_start < x.end_min and j.win_end > x.start_min then j.win_end else x.end_min end,
      win_flex = false
      from public.blocks_set() x where x.key = j.block and j.day >= v_today and j.block <> 'day';
    update public.jobs j set win_start = null, win_end = null, win_flex = true where j.id = any(v_back);
  else
    select count(*) into n from public.jobs j where j.day >= v_today and j.block = 'day' and j.deleted_at is null and j.status = 'booked';
    -- no window told yet (flexible: « la veille »; or none at all): they get a block without a word (round 2)
    select coalesce(array_agg(j.id), '{}'), coalesce(array_agg(j.id) filter (where j.win_flex), '{}') into v_nowin, v_flex from public.jobs j
    where j.day >= v_today and j.block = 'day' and j.deleted_at is null and j.status = 'booked' and j.win_start is null;
    update public.jobs j set
      block = coalesce(
        -- a window that is a block's very hours (a job that came from a block) goes back to that very block; else the block
        -- of its planned arrival when the arrival is inside the window; else the block of the window (block_of_window)
        (select x.key from public.blocks_set() x where j.win_start = x.start_min and j.win_end = x.end_min order by x.pos limit 1),
        (select x.key from public.blocks_set() x where j.eta_min >= x.start_min and j.eta_min < x.end_min
           and (j.win_start is null or (j.eta_min >= j.win_start and j.eta_min <= j.win_end)) order by x.pos limit 1),
        public.block_of_window(j.win_start, j.win_end),
        (select x.key from public.blocks_set() x where j.eta_min >= x.start_min and j.eta_min < x.end_min order by x.pos limit 1),
        (select x.key from public.blocks_set() x order by x.pos limit 1), 'am'),
      win_flex = false,
      -- (exact move, S7) back to the blocks: no minute pointed any more
      arrive_at = null
    where j.day >= v_today and j.block = 'day';
    -- what each customer was told: kept on the job when it is not the block's own hours (the switch back to the windows
    -- gives it again); the ones whose window is not inside their block are to be called
    perform set_config('garage.rpc', 'on', true);
    select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'day', j.day, 'block', j.block, 'win_start', j.win_start, 'win_end', j.win_end,
             'customer_id', j.customer_id, 'truck_id', j.truck_id, 'reason', 'window') order by j.day, j.win_start, j.id), '[]'::jsonb) into v_call
    from public.jobs j join public.blocks_set() x on x.key = j.block
    where j.day >= v_today and j.deleted_at is null and j.status = 'booked' and j.win_start is not null and j.win_end is not null
      and (j.win_start < x.start_min or j.win_end > x.end_min);
    v_call := v_call || (select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'day', j.day, 'block', j.block, 'win_start', null, 'win_end', null,
             'customer_id', j.customer_id, 'truck_id', j.truck_id, 'reason', case when j.id = any(v_flex) then 'flexible' else 'no_window' end)
             order by j.day, j.id), '[]'::jsonb) from public.jobs j where j.id = any(v_nowin));
    insert into public.activity (actor, entity, entity_id, action, data)
    select auth.uid(), 'job', (c->>'job_id')::uuid, 'window_to_block', c - 'job_id' from jsonb_array_elements(v_call) c;
    -- whom to call is to confirm again (« Aujourd'hui » lists the appointments not confirmed)
    update public.jobs j set confirm_sent_at = null
    where j.id in (select (c->>'job_id')::uuid from jsonb_array_elements(v_call) c) and j.confirm_sent_at is not null;
    update public.jobs j set win_start = null, win_end = null
      from public.blocks_set() x where x.key = j.block and j.day >= v_today and j.win_start is not null
        and (j.status <> 'booked' or (j.win_start = x.start_min and j.win_end = x.end_min));
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
      if exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid where j.truck_id is not null) then
        v_kept := v_kept || jsonb_build_object('day', d, 'block', bk.key);
        continue;
      end if;
      perform public.apply_plan(p);
    end loop;
  end loop;
  perform set_config('garage.chain', v_chain, true);
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'settings', null, 'windows_switch', jsonb_build_object('on', p_on, 'converted', n, 'to_call', jsonb_array_length(v_call), 'kept', v_kept));
  return public.op_save(p_op, 'windows_switch', jsonb_build_object('ok', true, 'converted', n, 'on', p_on, 'to_call', v_call, 'kept', v_kept));
end $function$;

-- ---------- what is missing, and keeping what was measured (the function « drive » only) ----------
-- drive_wanted(point, from, days): the trips of those days that the planner can drive and has no good time for yet.
-- Only those, because TomTom charges every trip (the free Matrix service is 2 500 a month; the review counted 6 238 trips
-- for 400 coming jobs and 56 646 for 1 500 with « every pair of a day's places, the three times »):
--   - a day's places: each truck that WORKS that day (its hours that day are not empty) gives its own start, or « Départ
--     des camions » when it has none; the day's appointments (not cancelled / no-show, with a position); the point asked
--     about (an address being booked). A truck that does not work that day brings nothing;
--   - the trips: each start to each stop and back, each stop to each other stop, the point to and from every start and
--     stop. Never one start to another: no truck drives that;
--   - the usual hours (slot 0) for every trip; the morning and evening rush (slots 1 and 2) only on a working day (Monday
--     to Friday), when the garage uses them (roads_rush), and only for a trip whose usual-hours time is already there and
--     is at least booking.roads_rush_min (15) minutes: a short hop barely changes at 8 h, and so a rush time is always
--     asked in a later call than its usual-hours time. And only for a trip between two places OF THAT DAY (a start, an
--     appointment): the point asked about that is not one of them (an address typed on the booking screen, maybe never
--     booked) gets its usual-hours trips only; once it is a booked stop its rush times come with the others (the warm
--     after the booking, the sweep). Before (the lead's « fn M3 », 2026-11-20): an address typed cost ~2.5 × its star.
-- Missing = no row; or a row older than booking.roads_keep_days (120, the same setting drive_store keeps by); or an OSRM
-- row more than a day old (asked to TomTom again: OSRM knows no traffic); or a « none » row (no road) more than 7 days old.
-- → { pairs: [[from lat, lng, to lat, lng, slot, extra, why]…] (3000 at most), total, total0, days, point_place }
--   extra: the trip touches the point asked about. why: what is wrong with the row it has — 'new' (no row), 'old' (a time
--   older than roads_keep_days), 'osrm' (an OSRM time a day old: listed only to ask TomTom, so when TomTom cannot be used
--   the function « drive » does not ask OSRM for it again), 'none' (« no road » past its 7 days, or past roads_keep_days).
--   Order: the point's usual-hours trips first (the screen waits for those), then the other usual-hours trips, then the
--   OSRM rows to ask TomTom again, then the rush times.
--   total: every trip missing; total0: the usual-hours trips with no row at all (what roads_switch waits for: an OSRM time,
--   an old time or « no road » is a time the planner can use or a fact, a rush time only makes it better);
--   days: the days with a usual-hours trip missing between places already there (their plan was made without it: drive_store
--   plans them again once it is measured).
--   point_place: the point asked about is already a place of one of those days (an appointment, a truck's start): its trips
--   are then the sweep's too (the function « drive » measures them under the common lease, never twice: join-server).
-- from: today at the earliest (a past day is never asked, nor paid); days: 1 … booking.horizon_days (14 when not said). A
-- point that is not a position (no number, out of range) is left out, never an error.
create or replace function public.drive_wanted(p_point jsonb, p_from date, p_days integer) returns jsonb
language sql stable security definer set search_path = public as $$
  with lim as (
    -- (fix-sql, verify-measure F1, F2: the numbers of the settings read safely, a day past the horizon is the horizon's last)
    select least(greatest(coalesce(p_from, public.local_today()), public.local_today()),
                 public.local_today() + greatest(public.bset('horizon_days', 120)::int, 1)) d0,
           least(greatest(coalesce(p_days, 14), 1), greatest(public.bset('horizon_days', 120)::int, 1)) n,
           public.roads_rush() rush,
           public.roads_num('roads_rush_min', 15, 0, 1440) rush_min,
           now() - public.roads_num('roads_keep_days', 120, 1, 36500) * interval '1 day' keep_from,
           -- the point, only when it is a position (drive_coord: a JSON number a double can hold, on Earth; else left out)
           case when jsonb_typeof(p_point) = 'object' and public.drive_coord(p_point->'lng', 180) is not null then public.drive_coord(p_point->'lat', 90) end plat,
           case when jsonb_typeof(p_point) = 'object' and public.drive_coord(p_point->'lat', 90) is not null then public.drive_coord(p_point->'lng', 180) end plng
  ), days as (
    select (l.d0 + g)::date d from lim l, generate_series(0, (select n - 1 from lim)) g
  ), pts as (
    -- each truck that works that day: its start (1), the day's appointments (2), the point asked about (3)
    select d.d, coalesce((tr.start->>'lat')::double precision, hp.lat) lat, coalesce((tr.start->>'lng')::double precision, hp.lng) lng, 1 kind
    from days d cross join public.trucks tr cross join public.home_point() hp
    where tr.active and tr.deleted_at is null and jsonb_array_length(coalesce(public.truck_ranges(tr.id, d.d), '[]'::jsonb)) > 0
    union all
    select j.day, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng), 2
    from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.day between (select d0 from lim) and (select d0 + n - 1 from lim) and j.deleted_at is null and j.status not in ('cancelled', 'no_show')
    union all
    select d.d, l.plat, l.plng, 3 from days d cross join lim l where l.plat is not null and l.plng is not null
  ), places as (
    -- one place a key (about 100 m) and a day, and what it is there (a start, a stop, the point: several at once)
    select p.d, public.drive_key(p.lat, p.lng) k,
           (array_agg(p.lat order by p.kind))[1] lat, (array_agg(p.lng order by p.kind))[1] lng,
           bool_or(p.kind = 1) is_start, bool_or(p.kind = 2) is_stop, bool_or(p.kind = 3) is_point
    from pts p where p.lat is not null and p.lng is not null
    group by p.d, public.drive_key(p.lat, p.lng)
  ), trips as (
    -- every trip of the day but one start to another
    select x.d, x.k a, y.k b, x.lat alat, x.lng alng, y.lat blat, y.lng blng,
           (x.is_point or y.is_point) extra,
           ((x.is_start or x.is_stop) and (y.is_start or y.is_stop)) there
    from places x join places y on y.d = x.d and y.k <> x.k
    where x.is_stop or x.is_point or y.is_stop or y.is_point
  ), want as (
    select t.*, 0::smallint slot from trips t
    union all
    -- the rush times: a working day, the garage uses them, and the usual-hours time is there and long enough
    select t.*, s.slot from trips t cross join (values (1::smallint), (2::smallint)) s(slot)
    where (select rush from lim) and extract(isodow from t.d) between 1 and 5
      and exists (select 1 from public.drive_times dt where dt.a = t.a and dt.b = t.b and dt.slot = 0 and dt.minutes >= (select rush_min from lim))
      -- (fn M3) between two places of that day: an address typed, not booked, gets no rush time
      and t.there
  ), judged as (
    -- each trip once (the first day it is driven), with what is wrong with the row it has
    select u.*,
           -- (join-server: the 7th element of a pair) an OSRM time past roads_keep_days is 'old' (OSRM may refresh it when
           -- TomTom cannot be used); a younger one a day old is 'osrm' (only TomTom can make it better)
           case when dt.a is null then 'new'
                when dt.source = 'none' and (dt.at < (select keep_from from lim) or dt.at < now() - interval '7 days') then 'none'
                when dt.at < (select keep_from from lim) then 'old'
                -- (final-money F3) TomTom said « no road » and OSRM gave the time: TomTom again only after 7 days
                when dt.source = 'osrm' and dt.at < now() - interval '1 day'
                     and (dt.tt_none_at is null or dt.tt_none_at < now() - interval '7 days') then 'osrm'
           end why
    from (select w.a, w.b, w.slot, bool_or(w.extra) extra, min(w.d) d1,
                 (array_agg(w.alat order by w.d))[1] alat, (array_agg(w.alng order by w.d))[1] alng,
                 (array_agg(w.blat order by w.d))[1] blat, (array_agg(w.blng order by w.d))[1] blng,
                 array_agg(distinct w.d) filter (where w.there) there_days
          from want w group by w.a, w.b, w.slot) u
    left join public.drive_times dt on dt.a = u.a and dt.b = u.b and dt.slot = u.slot
  ), missing as (
    select m.*, case when m.slot <> 0 then 4 when m.why = 'osrm' then 3 when m.extra then 1 else 2 end rk
    from judged m where m.why is not null
  )
  select jsonb_build_object(
    'pairs', coalesce((select jsonb_agg(jsonb_build_array(q.alat, q.alng, q.blat, q.blng, q.slot, q.extra, q.why) order by q.rk, q.extra desc, q.d1, q.a, q.b, q.slot)
                       from (select * from missing m order by m.rk, m.extra desc, m.d1, m.a, m.b, m.slot limit 3000) q), '[]'::jsonb),
    'total', (select count(*) from missing),
    'total0', (select count(*) from missing m where m.slot = 0 and m.why = 'new'),
    'days', coalesce((select jsonb_agg(distinct x.d order by x.d) from missing m cross join lateral unnest(m.there_days) x(d)
                      where m.slot = 0), '[]'::jsonb),
    'point_place', exists (select 1 from places p where p.is_point and (p.is_start or p.is_stop)))
$$;

-- drive_store(rows, days): keeps what the map service measured: rows = [[from lat, lng, to lat, lng, slot, minutes | null,
-- km | null, 'tomtom' | 'osrm' | 'none'], …]. Each row is checked on its own and a bad one is left out (a position that is
-- not a number a double can hold or not on Earth, a slot that does not exist, minutes below zero or above a day, km below
-- zero or above 99 999, no source or another one: a straight line is never a road; an OSRM time for a rush slot: OSRM knows
-- no traffic), so one bad row never loses the others. A 'none' row keeps no minutes and no km. A time is never replaced by a
-- worse one while it is younger than booking.roads_keep_days (the one setting drive_wanted asks again by; before, 120 days
-- written here made a trip asked again forever when the setting was shorter): TomTom's against OSRM's (no traffic in it).
-- « No road » never replaces a real time, whatever its age (an old one only gets the new date). A real time always replaces
-- « no road ».
-- Then, roads on, the plans are made again (roads_replan: nobody is thrown to « À placer », a block that no longer fits
-- keeps its places with its real arrival times): the days given, even when nothing was stored (the function « drive » names
-- them in its last call), PLUS every coming day with a booked appointment at one end of a trip stored by this call: an
-- appointment booked while its address was still being measured counted the fixed 20 minutes of an unknown position, and
-- would keep them (request-flows F3). Only a day where that trip can be driven, that is where its other end is a place of
-- the same day too (a start of a truck working that day, or another appointment of that day): the trips of an address
-- not booked yet (« drive » measures them while the screen waits) touch every stop of the coming days, and planning all
-- those days again would change nothing in them and keep the screen waiting. From today on, each day once, in order (the
-- blocks are locked in that order).
-- A 9th element true on an OSRM row: TomTom said « no road » for it (final-money F3: kept 7 days, see drive_wanted).
-- → { ok, stored, planned, kept: [{ day, block }], late: [job ids] } (+ replan: [days], replan_error when the re-plan failed)
create or replace function public.drive_store(p_rows jsonb, p_days date[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n integer := 0; v_a bigint[]; v_b bigint[]; v_days date[];
  v_keep timestamptz := now() - public.roads_num('roads_keep_days', 120, 1, 36500) * interval '1 day';
  v_rep jsonb := jsonb_build_object('planned', 0, 'kept', '[]'::jsonb, 'late', '[]'::jsonb);
begin
  with raw as (
    select r, o from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) with ordinality x(r, o)
  ), typed as (
    -- the shape first; nothing is cast before its JSON type is known (each test inside the one before it)
    select o, r, r->>7 source, coalesce(r->8 = 'true'::jsonb, false) ttno,
           jsonb_typeof(r) = 'array' and jsonb_typeof(r->0) = 'number' and jsonb_typeof(r->1) = 'number'
             and jsonb_typeof(r->2) = 'number' and jsonb_typeof(r->3) = 'number' and jsonb_typeof(r->4) = 'number'
             and coalesce(r->>7, '') in ('tomtom', 'osrm', 'none')
             and (r->>7 = 'none' or (jsonb_typeof(r->5) = 'number' and coalesce(jsonb_typeof(r->6), 'null') in ('number', 'null'))) ok
    from raw
  ), vals as (
    -- (a position no double can hold, 1e400 or 1e-400: that row left out, never the batch: fix-sql, verify-measure F4)
    select o, source, ttno,
           case when ok then public.drive_coord(r->0, 90) end alat, case when ok then public.drive_coord(r->1, 180) end alng,
           case when ok then public.drive_coord(r->2, 90) end blat, case when ok then public.drive_coord(r->3, 180) end blng,
           case when ok then (r->>4)::numeric end slot,
           case when ok and source <> 'none' then (r->>5)::numeric end mins,
           case when ok and source <> 'none' and jsonb_typeof(r->6) = 'number' then (r->>6)::numeric end km
    from typed
  ), good as (
    -- (final-money F4) a time of more than a day (an address put in another province): no road the planner can drive, kept
    -- as « none » (asked again after 7 days) instead of left out and paid again at every call
    select o, case when source <> 'none' and mins > 1440 then 'none' else source end source, ttno and source = 'osrm' ttno,
           case when alat between -90 and 90 and alng between -180 and 180 then public.drive_key(alat, alng) end a,
           case when blat between -90 and 90 and blng between -180 and 180 then public.drive_key(blat, blng) end b,
           case when slot in (0, 1, 2) then slot::smallint end slot,
           case when mins between 0 and 1440 then ceil(mins)::integer end minutes,
           case when km >= 0 and km <= 99999 and not mins > 1440 then km end km,
           km is not null and (km < 0 or km > 99999) and not mins > 1440 bad_km
    from vals
    where source = 'none' or mins >= 0
  ), rows as (
    -- one row a trip and a time (the batch's best: TomTom, then OSRM, then « no road »; the last one sent among equals)
    select distinct on (g.a, g.b, g.slot) g.a, g.b, g.slot, g.minutes, g.km, g.source, g.ttno
    from good g
    where g.a is not null and g.b is not null and g.a <> g.b and g.slot is not null and not g.bad_km
      and (g.source = 'none' or g.minutes is not null)
      and not (g.source = 'osrm' and g.slot <> 0)                 -- OSRM knows no traffic: the usual hours only
    order by g.a, g.b, g.slot, (g.source = 'tomtom') desc, (g.source = 'osrm') desc, g.o desc
  ), put as (
    insert into public.drive_times as t (a, b, slot, minutes, km, source, at, tt_none_at)
    select a, b, slot, case when source = 'none' then null else minutes end, case when source = 'none' then null else km end, source, now(),
           case when ttno then now() end from rows
    -- « no road » never replaces a real time, whatever its age: an old one only gets the new date (it is not asked again at
    -- once; the lead, 2026-11-19; fix-sql, verify-measure F3)
    on conflict (a, b, slot) do update set
        minutes = case when t.minutes is not null and excluded.minutes is null then t.minutes else excluded.minutes end,
        km = case when t.minutes is not null and excluded.minutes is null then t.km else excluded.km end,
        source = case when t.minutes is not null and excluded.minutes is null then t.source else excluded.source end,
        at = excluded.at,
        -- (final-money F3) the day TomTom said « no road » to an OSRM time: forgotten once TomTom gives a time
        tt_none_at = case when excluded.source = 'tomtom' then null else coalesce(excluded.tt_none_at, t.tt_none_at) end
      where not (t.at > v_keep
                 and ((t.source = 'tomtom' and excluded.source <> 'tomtom')            -- TomTom's time stays
                      or (t.minutes is not null and excluded.minutes is null)))         -- a real time stays against « no road »
    returning t.a, t.b
  )
  select count(*), array_agg(p.a), array_agg(p.b) into n, v_a, v_b from put p;
  if public.roads_on() then
    v_days := array(
      select distinct q.d from (
        select unnest(coalesce(p_days, '{}'::date[])) d
        union
        -- a booked appointment at one end of a trip stored now, and the trip's other end a place of that same day
        select bj.day
        from (select j.day, public.drive_key(coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) k
              from public.jobs j left join public.customers c on c.id = j.customer_id
              where n > 0 and j.day >= public.local_today() and j.status = 'booked' and j.deleted_at is null) bj
        join unnest(v_a, v_b) s(a, b) on bj.k in (s.a, s.b)
        where exists (select 1 from public.jobs j2 left join public.customers c2 on c2.id = j2.customer_id
                      where j2.day = bj.day and j2.deleted_at is null and j2.status not in ('cancelled', 'no_show')
                        and public.drive_key(coalesce(j2.lat, c2.lat), coalesce(j2.lng, c2.lng)) = case when s.a = bj.k then s.b else s.a end)
           or exists (select 1 from public.trucks tr cross join public.home_point() hp
                      where tr.active and tr.deleted_at is null and jsonb_array_length(coalesce(public.truck_ranges(tr.id, bj.day), '[]'::jsonb)) > 0
                        and public.drive_key(coalesce((tr.start->>'lat')::double precision, hp.lat), coalesce((tr.start->>'lng')::double precision, hp.lng))
                            = case when s.a = bj.k then s.b else s.a end)
      ) q where q.d >= public.local_today() order by q.d);
    if cardinality(v_days) > 0 then
      begin
        v_rep := public.roads_replan(v_days);
      exception when others then
        -- (final-money F5) the times just paid are kept even when the plans cannot be made again now (a lock, an error of
        -- the planner): the answer names the days (« replan ») and the function « drive » asks roads_replan for them once more
        v_rep := v_rep || jsonb_build_object('replan', to_jsonb(v_days), 'replan_error', left(sqlerrm, 200));
      end;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'stored', n) || v_rep;
end $$;

-- drive_spend_add(tx): the cost of a TomTom request, added to this month's spend BEFORE the request is sent, only when the
-- month stays within booking.roads_month_tx (10 000) → { ok: true, month, tx, cap }; else nothing is added → ok false (the
-- function « drive » then takes OSRM for the usual hours and the rush times wait for next month). 0 only reads (ok: some
-- room is left). Two calls at the same time: the one UPDATE below locks the month's row, and the second waits for the
-- first, then decides on the row as the first left it (PostgreSQL checks the WHERE again on the new row), so they never
-- both pass the ceiling (tested with two connections).
create or replace function public.drive_spend_add(p_tx integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', public.local_today())::date;
  v_cap integer := public.roads_num('roads_month_tx', 10000, 0, 2147483647)::integer; v_tx integer;
begin
  if coalesce(p_tx, 0) <= 0 then
    v_tx := coalesce((select s.tx from public.drive_spend s where s.month = v_month), 0);
    return jsonb_build_object('ok', v_tx < v_cap, 'month', v_month, 'tx', v_tx, 'cap', v_cap);
  end if;
  insert into public.drive_spend (month) values (v_month) on conflict (month) do nothing;
  update public.drive_spend s set tx = s.tx + p_tx, requests = s.requests + 1
  where s.month = v_month and s.tx + p_tx <= v_cap
  returning s.tx into v_tx;
  if found then return jsonb_build_object('ok', true, 'month', v_month, 'tx', v_tx, 'cap', v_cap); end if;
  v_tx := coalesce((select s.tx from public.drive_spend s where s.month = v_month), 0);
  return jsonb_build_object('ok', false, 'month', v_month, 'tx', v_tx, 'cap', v_cap);
end $$;

-- roads_state(): where the measuring is (the function « drive » gives it to the app: « Mesurer maintenant », the switch):
-- { on, left: every trip missing over the coming horizon_days, left0: the usual-hours trips with no time at all (the
-- switch waits for those), month: { month, tx, cap } (TomTom's spend), rows: { tomtom, osrm, none } (what is kept) }
create or replace function public.roads_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w jsonb := public.drive_wanted(null, public.local_today(), greatest(public.bset('horizon_days', 120)::int, 1));
  v_month date := date_trunc('month', public.local_today())::date;
begin
  return jsonb_build_object('on', public.roads_on(), 'left', (w->>'total')::int, 'left0', (w->>'total0')::int,
    'month', jsonb_build_object('month', v_month, 'tx', coalesce((select s.tx from public.drive_spend s where s.month = v_month), 0),
                                'cap', public.roads_num('roads_month_tx', 10000, 0, 2147483647)::integer),
    'rows', (select jsonb_build_object('tomtom', count(*) filter (where t.source = 'tomtom'), 'osrm', count(*) filter (where t.source = 'osrm'),
                                       'none', count(*) filter (where t.source = 'none')) from public.drive_times t));
end $$;

-- drive_prune(days): the trips nobody drives any more. A row measured more than p_days (30) days ago with an end that is no
-- place of the coming days (« Départ des camions », a vehicle's start, an appointment of [today, today + horizon_days] not
-- cancelled) is deleted (final-security F2: the addresses typed and never booked, the public page's, would fill the database
-- for ever). The nightly sweep calls it (the function « drive », GitHub's ticket). → how many rows were deleted
create or replace function public.drive_prune(p_days integer default 30) returns integer
language sql security definer set search_path = public as $$
  with places as (
    select public.drive_key(coalesce((tr.start->>'lat')::double precision, hp.lat), coalesce((tr.start->>'lng')::double precision, hp.lng)) k
    from public.trucks tr cross join public.home_point() hp where tr.deleted_at is null
    union
    select public.drive_key(hp.lat, hp.lng) from public.home_point() hp
    union
    select public.drive_key(coalesce(j.lat, c.lat), coalesce(j.lng, c.lng))
    from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.day between public.local_today() and public.local_today() + greatest(public.bset('horizon_days', 120)::int, 1)
      and j.deleted_at is null and j.status not in ('cancelled', 'no_show')
  ), gone as (
    delete from public.drive_times t
    where t.at < now() - greatest(coalesce(p_days, 30), 1) * interval '1 day'
      and (not exists (select 1 from places p where p.k = t.a) or not exists (select 1 from places p where p.k = t.b))
    returning 1
  )
  select count(*)::int from gone
$$;

-- web_unmeasured(lat, lng, services, from, days): how many moments web_suggest leaves out because a trip of their day is not
-- measured yet (switch on; 0 off). The function « book » asks it when web_suggest offered nothing, so the public page says it
-- cannot offer a moment for that address right now (call us), never « no moment free » (final-critic W1). Server key only
create or replace function public.web_unmeasured(p_lat double precision, p_lng double precision, p_services uuid[],
  p_from date default null, p_days int default 14) returns integer
language plpgsql stable security definer set search_path = public as $$
declare v_horizon int := public.bset('horizon_days', 120)::int; v_from date := greatest(coalesce(p_from, public.local_today()), public.local_today());
begin
  if not public.roads_on() or coalesce(cardinality(p_services), 0) = 0 or p_lat is null or p_lng is null
     or v_from > public.local_today() + v_horizon then return 0; end if;
  return (select count(*)::int from jsonb_array_elements(public.suggest_core(p_lat, p_lng, public.web_duration(p_services), v_from,
            least(greatest(1, coalesce(p_days, 14)), 14, v_horizon - (v_from - public.local_today()) + 1), null, 12,
            exists (select 1 from public.services sv where sv.id = any(p_services) and sv.needs_machine))) e
          where e->>'far' is null and coalesce((e->>'unmeasured')::int, 0) > 0);
end $$;

-- eta_walk(truck, day) (final-guess G1): each appointment of that vehicle's day (not cancelled / no-show), in the order driven
-- (block after block, its place in the block: the walk of stop_order_preview), and whether every trip from the vehicle's
-- start up to it has a usual-hours time measured (drive_known: a time, or the same place). A stop with no position is not
-- measured, nor any stop after it
create or replace function public.eta_walk(p_truck uuid, p_day date) returns table (id uuid, ok boolean)
language sql stable security definer set search_path = public as $$
  with st as (select coalesce((tr.start->>'lat')::double precision, h.lat) lat, coalesce((tr.start->>'lng')::double precision, h.lng) lng
              from public.home_point() h left join public.trucks tr on tr.id = p_truck),
  y as (select j.id, coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
               row_number() over (order by b.pos, j.stop_order nulls last, j.eta_min nulls last, j.id) n
        from public.jobs j join public.blocks() b on b.key = j.block left join public.customers c on c.id = j.customer_id
        where j.truck_id = p_truck and j.day = p_day and j.deleted_at is null and j.status not in ('cancelled', 'no_show')),
  x as (select y.*, lag(y.lat) over (order by y.n) plat, lag(y.lng) over (order by y.n) plng from y)
  select x.id, bool_and(public.drive_known(coalesce(x.plat, st.lat), coalesce(x.plng, st.lng), x.lat, x.lng)) over (order by x.n)
  from x cross join st
$$;
-- route_mark(day, truck): writes jobs.eta_measured for the appointments of that day (of that vehicle; null: every vehicle):
-- the walk above for a placed appointment with an arrival time, null for the others. Called by the planner right after it
-- writes the arrival times (apply_plan, route_retime), with the switch on only
create or replace function public.route_mark(p_day date, p_truck uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_day is null then return; end if;
  perform set_config('garage.rpc', 'on', true);
  with tk as (select distinct j.truck_id from public.jobs j
              where j.day = p_day and j.deleted_at is null and j.truck_id is not null and (p_truck is null or j.truck_id = p_truck)),
  w as (select e.id, e.ok from tk cross join lateral public.eta_walk(tk.truck_id, p_day) e),
  m as (select y.id, case when y.eta_min is null or y.truck_id is null or y.status in ('cancelled', 'no_show') then null
                          else coalesce(w.ok, false) end v
        from public.jobs y left join w on w.id = y.id
        where y.day = p_day and y.deleted_at is null and (p_truck is null or y.truck_id = p_truck))
  update public.jobs j set eta_measured = m.v from m where j.id = m.id and j.eta_measured is distinct from m.v;
end $$;
-- eta_known(job): may a window told to the customer be cut from its planned arrival? Switch off, or no arrival (not placed):
-- yes, as before. On: only when the planner wrote that arrival with measured trips only (jobs.eta_measured, written with it:
-- a time measured after the plan does not make the old arrival true until the plan is made again, which drive_store does)
create or replace function public.eta_known(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.roads_on()
         or coalesce((select j.eta_min is null or j.truck_id is null or coalesce(j.eta_measured, false) from public.jobs j where j.id = p_job), true)
$$;

-- roads_replan(days): the days given, planned again in block order. A block whose new plan would throw an appointment
-- already placed to « À placer » stays as it was (a real road longer than the old estimate never un-books anybody), but its
-- arrival times are written again with the real times (route_retime, for each truck of the block, as replan_block_safe
-- does): nobody is left with an arrival the truck cannot make. → { planned: the blocks planned again, kept: [{ day, block }],
-- late: the booked appointments that now arrive after the window (or the block) told to the customer and did not before }
-- who is late (booked, placed, arriving after the window told to the customer, else after the block): { id: true }
create or replace function public.roads_late_ids(p_days date[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(j.id::text, true), '{}'::jsonb)
  from public.jobs j join public.blocks() b on b.key = j.block
  where j.day = any(p_days) and j.status = 'booked' and j.deleted_at is null and j.truck_id is not null
    -- (exact move, S6) a stop pinned to a minute by a move is late after that minute
    and j.eta_min > coalesce(j.arrive_at, j.win_end, b.end_min)
    and coalesce(j.eta_measured, true)   -- (final-guess G1) never from an arrival that counts the unknown time
$$;
-- roads_late_note(days, before, why): the appointments of those days late now and not in `before` (roads_late_ids taken
-- before the re-plan) → [ids], each written down once in this transaction as an activity « window_late » { day, block, eta,
-- win_start, win_end, end (the block's end), truck_id, why: 'roads' | 'replan' | 'chain' } (fix-sql, verify-on F11: a window
-- made late by an automatic re-plan was said to nobody; the app can list them)
create or replace function public.roads_late_note(p_days date[], p_before jsonb, p_why text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(j.id order by j.day, j.eta_min, j.id), '[]'::jsonb) into v
  from public.jobs j join public.blocks() b on b.key = j.block
  where j.day = any(p_days) and j.status = 'booked' and j.deleted_at is null and j.truck_id is not null
    and j.eta_min > coalesce(j.arrive_at, j.win_end, b.end_min) and not (coalesce(p_before, '{}'::jsonb) ? j.id::text)
    and coalesce(j.eta_measured, true);   -- (final-guess G1) never from an arrival that counts the unknown time
  if jsonb_array_length(v) > 0 then
    insert into public.activity (actor, entity, entity_id, action, data)
    select auth.uid(), 'job', j.id, 'window_late', jsonb_build_object('day', j.day, 'block', j.block, 'eta', j.eta_min,
             'win_start', j.win_start, 'win_end', j.win_end, 'end', b.end_min, 'truck_id', j.truck_id, 'why', p_why)
           || case when j.arrive_at is not null then jsonb_build_object('arrive_at', j.arrive_at) else '{}'::jsonb end
    from public.jobs j join public.blocks() b on b.key = j.block
    where j.id in (select (x #>> '{}')::uuid from jsonb_array_elements(v) x)
      and not exists (select 1 from public.activity a where a.entity = 'job' and a.entity_id = j.id and a.action = 'window_late' and a.at = now());
  end if;
  return v;
end $$;

drop function if exists public.roads_replan(date[]);   -- (it answered a number in the first draft of this Part)
create or replace function public.roads_replan(p_days date[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date; bk record; tk record; p jsonb; n integer := 0; v_kept jsonb := '[]'::jsonb; v_before jsonb; v_late jsonb;
  v_chain text := coalesce(current_setting('garage.chain', true), ''); v_rpc text := coalesce(current_setting('garage.rpc', true), '');
begin
  if coalesce(cardinality(p_days), 0) = 0 then return jsonb_build_object('planned', 0, 'kept', '[]'::jsonb, 'late', '[]'::jsonb); end if;
  -- who is late already (after the window, or the block, told to the customer), to say only the ones this makes late
  v_before := public.roads_late_ids(p_days);
  perform set_config('garage.rpc', 'on', true);
  perform set_config('garage.chain', 'on', true);
  foreach d in array p_days loop
    for bk in select x.key from public.blocks() x order by x.pos loop
      continue when not exists (select 1 from public.jobs j where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked');
      if not public.block_open(d, bk.key) then
        -- today, a block already started (fix-sql, verify-on F3): nobody moves, but its arrival times are walked again with
        -- the times of the mode now in force (from now, from where each truck is: route_retime), never left as they were
        if d = public.local_today() then
          perform public.lock_block(d, bk.key);
          for tk in select distinct j.truck_id from public.jobs j
                    where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked' and j.truck_id is not null loop
            perform public.route_retime(tk.truck_id, d, bk.key);
          end loop;
        end if;
        continue;
      end if;
      perform public.lock_block(d, bk.key);
      p := public.plan_block(d, bk.key);
      if exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid where j.truck_id is not null) then
        -- kept: everybody stays where they are, with the arrival times of the real roads
        for tk in select distinct j.truck_id from public.jobs j
                  where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked' and j.truck_id is not null loop
          perform public.route_retime(tk.truck_id, d, bk.key);
        end loop;
        v_kept := v_kept || jsonb_build_array(jsonb_build_object('day', d, 'block', bk.key));
        continue;
      end if;
      perform public.apply_plan(p);
      if jsonb_array_length(coalesce(p->'frozen', '[]'::jsonb)) > 0 then
        -- roads on: a vehicle frozen (its appointments no longer fit on the real roads): they stay where they are, with the
        -- arrival times of the real roads (the plan walked them), the other vehicles planned around (fix-sql, verify-on F1)
        v_kept := v_kept || jsonb_build_array(jsonb_build_object('day', d, 'block', bk.key));
      else
        n := n + 1;
      end if;
    end loop;
  end loop;
  perform set_config('garage.chain', v_chain, true);
  perform set_config('garage.rpc', v_rpc, true);
  -- the newly late, each written down (activity « window_late »)
  v_late := public.roads_late_note(p_days, v_before, 'roads');
  return jsonb_build_object('planned', n, 'kept', v_kept, 'late', v_late);
end $$;

-- ---------- the switch ----------
-- settings.booking.roads_on changes only through roads_switch (as windows_on): a settings save from a phone that still has
-- the old value leaves it as it is.
-- The two TomTom ceilings (booking.roads_month_tx: the month's Matrix transactions; booking.roads_web_tx: the public booking
-- page's own share) are money: only the owner changes them. A save by anybody else keeps them as they were (a number typed,
-- taken away or added: the old value, or no key when there was none), the rest of the save goes through. The server itself
-- (no person: a script, a test copy) may change them (join-server, settings R2; the lead's decision of 2026-11-20).
create or replace function public.settings_roads_guard() returns trigger language plpgsql set search_path = public as $$
declare k text;
begin
  if coalesce(current_setting('garage.roads', true), '') <> 'on'
     and (new.booking->'roads_on') is distinct from (old.booking->'roads_on') then
    new.booking := case when old.booking ? 'roads_on' then jsonb_set(coalesce(new.booking, '{}'::jsonb), '{roads_on}', old.booking->'roads_on')
                        else new.booking - 'roads_on' end;
  end if;
  if auth.uid() is not null and not public.is_owner() then
    -- (final-money F8) roads_keep_days and roads_rush_min decide what is asked again, so what is spent: the owner's too
    foreach k in array array['roads_month_tx', 'roads_web_tx', 'roads_keep_days', 'roads_rush_min'] loop
      if (new.booking->k) is distinct from (old.booking->k) then
        new.booking := case when coalesce(old.booking ? k, false) then jsonb_set(coalesce(new.booking, '{}'::jsonb), array[k], old.booking->k)
                            else coalesce(new.booking, '{}'::jsonb) - k end;
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists settings_roads_guard on public.settings;
create trigger settings_roads_guard before update of booking on public.settings for each row execute function public.settings_roads_guard();

-- roads_switch(op, on): owner only. ON is refused while a usual-hours trip of the coming horizon_days has no time at all
-- (roads_cold, with how many: drive_wanted's total0; the app asks the function « drive » for them, then tries again). An
-- OSRM time, an old time or « no road » does not hold it back, nor a rush time missing: those only make it better, and
-- the sweep asks them later (without a TomTom key the rush times never come: the switch must still go on). Then the
-- coming days are planned again (roads_replan): the answer and the activity say the blocks kept and the appointments now
-- late (to call). It waits for the bookings under way and holds the next ones until it is done (they take the windows
-- switch's lock: review-sql L7), and never runs at the same time as windows_switch.
create or replace function public.roads_switch(p_op uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done jsonb; v_today date := public.local_today(); v_missing integer; v_rep jsonb;
begin
  v_done := public.op_begin(p_op, 'roads_switch');
  if v_done is not null then return v_done; end if;
  if not public.is_owner() then perform public.fail('not_allowed', 'Seul le propriétaire change la façon de compter la route.'); end if;
  if p_on is null then perform public.fail('bad_mode', 'Choisis : les vraies routes, ou l’estimation.'); end if;
  perform pg_advisory_xact_lock(hashtext('roads_switch'));
  perform pg_advisory_xact_lock(hashtext('windows_switch'));
  if public.roads_on() = p_on then
    return public.op_save(p_op, 'roads_switch', jsonb_build_object('ok', true, 'unchanged', true, 'on', p_on, 'planned', 0,
      'kept', '[]'::jsonb, 'late', '[]'::jsonb));
  end if;
  if p_on then
    v_missing := (public.drive_wanted(null, v_today, greatest(public.bset('horizon_days', 120)::int, 1))->>'total0')::int;
    if v_missing > 0 then
      perform public.fail('roads_cold', format('Il reste %s trajets à mesurer avant d’allumer les vraies routes. Réessaie dans un instant.', v_missing));
    end if;
  end if;
  perform set_config('garage.roads', 'on', true);
  update public.settings set booking = jsonb_set(coalesce(booking, '{}'::jsonb), '{roads_on}', to_jsonb(p_on)) where id = 1;
  perform set_config('garage.roads', '', true);
  -- (final-guess G1) off, nothing says « measured » or not (jobs.eta_measured is null while the switch is off)
  if not p_on then update public.jobs set eta_measured = null where eta_measured is not null; end if;
  v_rep := public.roads_replan(array(select distinct j.day from public.jobs j
                                     where j.day >= v_today and j.status = 'booked' and j.deleted_at is null order by 1));
  insert into public.activity (actor, entity, entity_id, action, data)
  values (auth.uid(), 'settings', null, 'roads_switch', jsonb_build_object('on', p_on) || v_rep);
  return public.op_save(p_op, 'roads_switch', jsonb_build_object('ok', true, 'on', p_on) || v_rep);
end $$;

-- ---------- what an action would do, said before it is done (the app, with the real roads) ----------
-- The phone used to guess these with a straight line or the travel times of another order (« La voiture ferme »: where
-- each moved appointment goes in the other vehicle's day; « Ordre des arrêts »: the arrival times of an order by hand).
-- With the real roads only the server can say it. These two functions do not copy the planner: they RUN the very action
-- (move_job, set_stop_order) inside a block that is always undone at the end (an error raised on purpose, caught at once:
-- PostgreSQL then takes back every row written, every lock taken and every setting changed in that block), and read the
-- result before undoing it. So the answer is the one the action would give, to the minute, switch on or off, and nothing
-- stays: no row, no op_log, no activity, no text to a customer (tests/db/vraies-routes-apercu.test.mjs). The rights are the
-- action's own: it refuses the same person with the same words.

-- move_preview(truck, day, block, jobs): those appointments moved to that vehicle, one after the other, as « La voiture
-- ferme » sends them (move_job for each, that day, that block — or each one's own block when the block is not said — with
-- its window kept: the one promised, else « flexible » as it was). A move the action refuses (the vehicle is full, tire
-- work to the car, …) is listed in « refused » and the others still go (the app asks again without it).
-- p_as_told (fix-sql, the sheets' ask): true = the move « Changer de camion » sends (move_job with 5 arguments: the window
-- kept as move_job keeps it on the same day), so the preview is the very move the tap then makes.
-- → { order: [the vehicle's stops that day, in the order it drives them], eta: { id: minute of arrival }, refused: [ids],
--     refused_why: { id: the refusal's code (block_full, truck_full, needs_truck, block_started, window_full, …) },
--     day_min: its driving that day, day_km: its km (roads on; null while a trip is not measured, and always null with
--     the switch off: never an estimate of km), unmeasured: the trips of that day not measured (roads on; null off) }
-- The locks: the windows switch's (shared, as every booking), then every block the list touches, in the order every planner
-- takes them (day, then morning → evening), before the first move: never a deadlock with roads_replan (verify-on F10)
drop function if exists public.move_preview(uuid, date, text, uuid[]);
create or replace function public.move_preview(p_truck uuid, p_day date, p_block text, p_jobs uuid[], p_as_told boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.jobs; v_id uuid; v_refused jsonb := '[]'::jsonb; v_why jsonb := '{}'::jsonb; v_out jsonb; v_done boolean := false; v_hint text;
  v_ws integer; v_flex boolean; v_dd jsonb; v_on boolean := public.roads_on(); bk record;
begin
  -- the action's rule for that vehicle (move_job checks it again for each appointment)
  if not (public.can('book') or coalesce(p_truck = any(public.my_truck_ids()), false)) then
    perform public.fail('not_allowed', 'Tu ne peux pas déplacer ce rendez-vous.');
  end if;
  if p_truck is null or p_day is null or cardinality(coalesce(p_jobs, '{}')) > 60 then
    perform public.fail('bad_list', 'La liste des arrêts n’est pas bonne.');
  end if;
  begin
    perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
    for bk in select q.d, q.b from (
                select x.day d, x.block b from public.jobs x where x.id = any(coalesce(p_jobs, '{}')) and x.deleted_at is null
                union
                select p_day, coalesce(p_block, x.block) from public.jobs x where x.id = any(coalesce(p_jobs, '{}')) and x.deleted_at is null
              ) q where q.d is not null and q.b is not null
              order by q.d, public.block_pos(q.b), q.b loop
      perform public.lock_block(bk.d, bk.b);
    end loop;
    foreach v_id in array coalesce(p_jobs, '{}') loop
      select * into j from public.jobs x where x.id = v_id;
      -- the window as the app keeps it (keepWindow): a job booked by window keeps the one promised, else stays flexible
      v_ws := case when j.block = 'day' and j.win_start is not null and j.win_end is not null then j.win_start end;
      v_flex := case when j.block = 'day' then v_ws is null and coalesce(j.win_flex, false) end;
      begin
        if coalesce(p_as_told, false) then
          perform public.move_job(null, v_id, p_day, coalesce(p_block, j.block, 'am'), p_truck);
        else
          perform public.move_job(null, v_id, p_day, coalesce(p_block, j.block, 'am'), p_truck, v_ws, v_flex);
        end if;
      exception when sqlstate 'P0001' then
        get stacked diagnostics v_hint = pg_exception_hint;
        if v_hint = 'not_allowed' then raise; end if;          -- no right: the preview is refused as the move would be
        v_refused := v_refused || to_jsonb(v_id);
        v_why := v_why || jsonb_build_object(v_id::text, coalesce(nullif(v_hint, ''), 'refused'));
      end;
    end loop;
    v_dd := public.day_drive(p_day, p_truck);
    v_out := jsonb_build_object('order', v_dd->'ids',
      'eta', coalesce((select jsonb_object_agg(x.id, jj.eta_min) from jsonb_array_elements_text(v_dd->'ids') x(id)
                       left join public.jobs jj on jj.id::text = x.id), '{}'::jsonb),
      'refused', v_refused, 'refused_why', v_why, 'day_min', v_dd->'min',
      'day_km', case when v_on then v_dd->'km' else 'null'::jsonb end,
      'unmeasured', case when v_on then v_dd->'unmeasured' else 'null'::jsonb end);
    v_done := true;
    raise exception 'move_preview: undone' using errcode = 'P0001', hint = 'preview_undone';
  exception when others then
    if not v_done then raise; end if;                          -- a real error (or a refusal of the whole) goes on
  end;
  return v_out;
end $$;

-- stop_order_preview(truck, day, block, jobs): the arrival times that order would give (set_stop_order with that list;
-- an empty list = « Laisser l'app choisir »), nothing written. → [{ id, eta, late }…] = the vehicle's booked stops of that
-- block (its whole day with the arrival windows, or for 'day' asked while the garage books by blocks) in the order they
-- would then be driven; late = arrives after the window promised, else after the block told to the customer; measured (roads
-- on; null off: fix-sql, the sheets' ask) = every trip of the vehicle's day up to that stop has a time measured on the road
-- (from its start, block after block, in the order driven): its arrival time is sure, else it counts the fixed time of a
-- trip not measured yet.
create or replace function public.stop_order_preview(p_truck uuid, p_day date, p_block text, p_jobs uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb; v_done boolean := false; v_wm boolean := public.windows_on(); v_on boolean := public.roads_on(); v_meas jsonb := '{}'::jsonb;
begin
  begin
    perform public.set_stop_order(null, p_truck, p_day, p_block, p_jobs);
    if v_on then
      -- the vehicle's day as it would be driven (as day_drive walks it), each stop sure while every trip up to it is measured
      select coalesce(jsonb_object_agg(w.id, w.ok), '{}'::jsonb) into v_meas
      from (select x.id::text id,
                   bool_and(public.drive_known(coalesce(x.plat, st.lat), coalesce(x.plng, st.lng), x.lat, x.lng)) over (order by x.n) ok
            from (select y.*, lag(y.lat) over (order by y.n) plat, lag(y.lng) over (order by y.n) plng
                  from (select j.id, coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
                               row_number() over (order by b.pos, j.stop_order nulls last, j.eta_min nulls last, j.id) n
                        from public.jobs j join public.blocks() b on b.key = j.block left join public.customers c on c.id = j.customer_id
                        where j.truck_id = p_truck and j.day = p_day and j.deleted_at is null and j.status not in ('cancelled', 'no_show')) y) x
            cross join (select coalesce((tr.start->>'lat')::double precision, h.lat) lat, coalesce((tr.start->>'lng')::double precision, h.lng) lng
                        from public.home_point() h left join public.trucks tr on tr.id = p_truck) st) w;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'eta', j.eta_min,
             'late', coalesce(j.eta_min > coalesce(j.win_end, b.end_min), false),
             'measured', case when v_on then coalesce((v_meas->>j.id::text)::boolean, false) end) order by b.pos, j.stop_order, j.eta_min), '[]'::jsonb)
      into v_out
    from public.jobs j join public.blocks() b on b.key = j.block
    where j.truck_id = p_truck and j.day = p_day and j.status = 'booked' and j.deleted_at is null
      and (v_wm or p_block = 'day' or j.block = p_block);
    v_done := true;
    raise exception 'stop_order_preview: undone' using errcode = 'P0001', hint = 'preview_undone';
  exception when others then
    if not v_done then raise; end if;
  end;
  return v_out;
end $$;

-- ---------- rights ----------
-- the app calls roads_switch, move_preview and stop_order_preview (each checks the right of the action inside); the
-- function « drive » (server key) calls drive_wanted, drive_store, drive_spend_add and roads_state. The rest is the server's own.
-- (the planner functions made again above keep the rights they had: « create or replace » does not touch them)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array['drive_key', 'drive_slot', 'drive_dow', 'roads_on', 'roads_rush', 'drive_min', 'drive_km',
      'drive_measured', 'drive_known', 'drive_from_starts', 'route_clock',
      'drive_wanted', 'drive_store', 'roads_replan', 'settings_roads_guard', 'roads_switch',
      'drive_spend_add', 'roads_state', 'move_preview', 'stop_order_preview',
      'plan_route_core', 'roads_no', 'roads_num', 'drive_coord', 'roads_late_ids', 'roads_late_note', 'eta_known', 'eta_walk', 'route_mark',
      'drive_prune', 'web_unmeasured'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
grant execute on function public.roads_switch(uuid, boolean) to authenticated;
grant execute on function public.move_preview(uuid, date, text, uuid[], boolean) to authenticated;
grant execute on function public.stop_order_preview(uuid, date, text, uuid[]) to authenticated;

-- ---------- the move with a minute pointed (S2 – S5, S8) ----------
-- move_job with 8 arguments (S2): (p_op, p_job, p_day, p_block, p_truck, p_win_start, p_win_flex, p_exact jsonb), p_exact
-- with NO default (a call with the old app's 5 or 7 names finds the old functions only: PostgREST would find a call
-- ambiguous if it had one). p_exact = { at: minute of the day, late_ok: [the ids the person accepted late after the
-- warning] }; null = the 7-argument move. With a minute, p_block / p_win_start / p_win_flex are not used: the minute decides.
-- Window mode: the appointment goes on its truck (the one picked, else its own) that day, arriving at that minute exactly;
-- its window is win_for(minute) (the garage's rule: 13 h → 12 h – 16 h, unchanged); every other stop of that truck's day keeps
-- its order and is held « not before its stored arrival »; the day is walked once with the planner's own walk (route_hold
-- = route_retime). The day it left keeps its order and its times. Every other truck is not touched.
-- Blocks mode (the way back): no time is told to the customer: the move to the block of that minute, its truck kept (the
-- one picked, else its own when it works that block), the answer says exact: false.
-- The answer (S3, the move and its preview alike): what move_job answers (ok, job_id, changed, tell, window_changed,
-- truck_changed, was, now, rows) + exact: true, at, stops: [{ id, day, truck_id, order_before, order_after, eta_before,
-- eta_after, win_start, win_end, delay_min, late, late_min, measured }] (every booked stop of the truck-days the move
-- touches, the moved one included), over_hours (minutes past the truck's hours, 0), earliest (the earliest that truck can
-- be there at or after the minute pointed: the earliest place over its day), earliest_keep (the same with nobody's time
-- changed; null when no place does that).
--   late = arrives after its window's end (a stop pinned earlier: after ITS minute), and did not before (or later than
--   before), from a measured arrival only (S8); late_min = by how much.
-- Refusals (S4), nothing written, each with its words (French here; the app has both languages, src/i18n errors):
--   arrive_late: the truck cannot be there at that minute (detail: { earliest, earliest_keep }: the earliest minutes AT OR
--     AFTER the one pointed, the second with nobody's time changed);
--   late_changed: a stop would be late, or the truck would end past its hours, and it is not in late_ok (the moved one's
--     own id accepts the hours) (detail: { late: [{ id, late_min }], over_hours });
--   pick_truck: its truck (or the one picked) does not work that day;
--   and move_job's own: not_found, not_allowed (the very rule of move_job), not_booked, changed, block_started,
--   needs_truck, bad_window (a minute outside the day).
-- « Vraies routes » on (S8): an arrival counted with a trip not measured is never refused nor said late (measured: false);
-- a place is out only when its lower bound (every trip not measured counted 0) is after the minute (verify-on F1).

-- exact_works(truck, day, block): that vehicle works that block of that day, the rule plan_route_core uses to put a vehicle
-- in its plan (its hours there, from now on for today, hold at least min_block_min, or it holds a stop under way)
create or replace function public.exact_works(p_truck uuid, p_day date, p_block text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trucks tr
    cross join (select x.key, x.start_min, x.end_min from public.blocks() x where x.key = p_block) b
    cross join lateral (select public.ranges_overlap(public.ranges_from(public.truck_ranges(tr.id, p_day),
        case when p_day = public.local_today() then (ceil(public.now_min() / 5.0) * 5)::int when p_day < public.local_today() then 1440 else 0 end),
        b.start_min, b.end_min) cap) g
    where tr.id = p_truck and tr.active and tr.deleted_at is null
      and (g.cap >= least(public.bset('min_block_min', 45), b.end_min - b.start_min)
           or (g.cap > 0 and exists (select 1 from public.jobs j where j.truck_id = tr.id and j.day = p_day and j.block = b.key
                                     and j.status in ('en_route', 'on_site') and j.deleted_at is null))))
$$;

-- exact_try(job, day, truck, minute, order, holds): the appointment put on that vehicle's day at that minute (its window cut
-- from the minute: win_for), that day's booked stops numbered in that order after the ones done or under way, and the day
-- walked with the planner's walk, each stop of `holds` not before its minute (route_hold). That truck's ORDER BY HAND stays
-- (verify-off H1, verify-on F6: the other stops are planned as today): when the place chosen is before a stop of it, the
-- moved appointment joins it there (renumbered in the order chosen; every walk waits for its minute there), else it stays
-- out of it (the planner puts it after those stops, at its minute). Written: the caller undoes it (exact_run) or keeps it
-- (exact_place)
create or replace function public.exact_try(p_job uuid, p_day date, p_truck uuid, p_at integer, p_order uuid[], p_hold jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_base int; w record; v_pos int;
begin
  perform set_config('garage.rpc', 'on', true);
  select * into w from public.win_for(p_at);
  update public.jobs set day = p_day, block = 'day', truck_id = p_truck, truck_pinned = true, win_start = w.win_start, win_end = w.win_end,
    win_flex = false, arrive_at = p_at, forced = false, manual_order = null
  where id = p_job;
  -- that truck's order by hand: the moved one joins it when a stop of it comes after the place chosen
  v_pos := array_position(p_order, p_job);
  if exists (select 1 from unnest(p_order) with ordinality x(id, o) join public.jobs y on y.id = x.id
             where x.o > v_pos and y.id <> p_job and y.manual_order is not null) then
    update public.jobs j set manual_order = q.n::int
    from (select x.id, row_number() over (order by x.o) n from unnest(p_order) with ordinality x(id, o) join public.jobs y on y.id = x.id
          where y.id = p_job or y.manual_order is not null) q
    where j.id = q.id and j.manual_order is distinct from q.n::int;
  end if;
  select coalesce(max(j.stop_order), 0) into v_base from public.jobs j
  where j.truck_id = p_truck and j.day = p_day and j.block = 'day' and j.deleted_at is null and j.status in ('en_route', 'on_site', 'done');
  update public.jobs j set stop_order = v_base + x.o::int from unnest(p_order) with ordinality x(id, o)
  where j.id = x.id and j.stop_order is distinct from v_base + x.o::int;
  perform public.route_hold(p_truck, p_day, 'day', p_hold);
end $$;

-- exact_view(truck, day, job, minute, before, hours' end): that truck's day as it now stands, judged against `before`
-- ({ id: { eta, ws, we, at } }, read before the move): { eta, sure: the moved one's arrival (sure: measured, or the switch
-- off), late: [{ id, late_min }] (the others made late), delay (minutes later, all added), moved (how many arrive at
-- another minute), drive (the day's travel), over (minutes past the truck's hours, from a sure arrival only) }
create or replace function public.exact_view(p_truck uuid, p_day date, p_job uuid, p_at integer, p_before jsonb, p_hend integer) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select x.id, x.eta_min ea, x.travel_min tr, x.stop_order oa,
           case when public.roads_on() then coalesce(x.eta_measured, false) else true end sure,
           x.eta_min + ceil(public.bset('stop_min', 5))::int + x.duration_min fin,
           (p_before->x.id::text->>'eta')::int eb, coalesce(x.arrive_at, x.win_end) lim
    from public.jobs x
    where x.truck_id = p_truck and x.day = p_day and x.block = 'day' and x.deleted_at is null and x.status = 'booked'),
  t as (select * from s where s.id <> p_job),
  l as (select f.fin, f.sure from s f order by f.fin desc nulls last limit 1)
  select jsonb_build_object(
    'eta', (select s.ea from s where s.id = p_job),
    'sure', coalesce((select s.sure from s where s.id = p_job), true),
    'late', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'late_min', t.ea - t.lim) order by t.oa) from t
                      where t.sure and t.lim is not null and t.ea > t.lim and (t.eb is null or t.eb <= t.lim or t.ea > t.eb)), '[]'::jsonb),
    'delay', coalesce((select sum(greatest(0, t.ea - t.eb)) from t where t.eb is not null), 0),
    'moved', coalesce((select count(*) from t where t.eb is distinct from t.ea), 0),
    'drive', coalesce((select sum(s.tr) from s), 0),
    'over', coalesce((select case when l.sure then greatest(0, l.fin - p_hend) else 0 end from l), 0))
$$;

-- exact_run: exact_try, then exact_view, then everything undone (an error raised on purpose and caught at once: every row
-- written in the block is taken back; the activity of the trial is not written at all, so no number is spent: garage.trial
-- is read by log_activity). → the view, with the place tried (pos) and the order
create or replace function public.exact_run(p_job uuid, p_day date, p_truck uuid, p_at integer, p_order uuid[], p_hold jsonb,
  p_before jsonb, p_hend integer, p_pos integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_done boolean := false;
begin
  begin
    perform set_config('garage.trial', 'on', true);
    perform public.exact_try(p_job, p_day, p_truck, p_at, p_order, p_hold);
    v := public.exact_view(p_truck, p_day, p_job, p_at, p_before, p_hend)
         || jsonb_build_object('pos', p_pos, 'order', to_jsonb(p_order), 'wait', p_hold->p_job::text);
    v_done := true;
    raise exception 'exact_run: undone' using errcode = 'P0001', hint = 'exact_undone';
  exception when others then
    if not v_done then raise; end if;
  end;
  return v;
end $$;

-- the minute as people read it: 13 h 05
create or replace function public.exact_hm(p_min integer) returns text language sql immutable as $$
  select case when p_min is null then '—' else format('%s h %s', p_min / 60, lpad((p_min % 60)::text, 2, '0')) end
$$;

-- exact_place(job, day, truck, minute, late_ok, check): the move with a minute, window mode (see the head of this part).
-- Every place of the truck's day after its stops under way is TRIED (exact_run: written, judged, undone), once with the
-- appointment not waiting (where it can be the earliest) and once held at the minute; kept: the places where it arrives at
-- the minute (or, « Vraies routes » on, where that is not known and its lower bound is not after it: never refused from a
-- guess, nor taken when even the bound proves it cannot), the best one: the fewest made
-- late (the truck past its hours counts as one), then the least delay added, then the least driving, then the earliest
-- place. Then written that way. check: refuse « late_changed » (the move); false: say it (the preview)
create or replace function public.exact_place(p_job uuid, p_day date, p_truck uuid, p_at integer, p_late_ok jsonb, p_check boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.jobs; jn public.jobs; v_truck uuid; sp record; w record; b record;
  v_others uuid[]; n int; p int; v_order uuid[]; v_hold jsonb; v_before jsonb; v_bold jsonb := '{}'::jsonb; v_c jsonb; v_c0 jsonb;
  v_cs jsonb := '[]'::jsonb; v_c0s jsonb := '[]'::jsonb; v_best jsonb; v_earliest int; v_keep int; v_hend int; v_bad jsonb;
  v_moved boolean; v_left boolean; v_winch boolean; v_tell boolean; v_on boolean := public.roads_on(); v_view jsonb; v_base int;
  v_oldhold jsonb; v_ok jsonb := coalesce(p_late_ok, '[]'::jsonb); v_stops jsonb; v_res jsonb; v_lo jsonb; v_next text;
begin
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if j.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  select * into sp from public.day_span();
  if p_at < sp.start_min or p_at >= sp.end_min then
    perform public.fail('bad_window', 'Cette heure n’est pas dans les heures de la journée : choisis-en une autre.');
  end if;
  if not public.block_open(p_day, 'day') then perform public.fail('block_started', 'Cette journée est finie : choisis une autre journée.'); end if;
  v_truck := coalesce(p_truck, j.truck_id);
  if v_truck is null then
    -- (verify-on F8) « À placer »: it has no truck, so the words say to pick one
    perform public.fail('pick_truck', 'Ce rendez-vous n’est sur aucun camion : choisis le camion qui ira à cette heure.');
  end if;
  if not public.exact_works(v_truck, p_day, 'day') then
    perform public.fail('pick_truck', 'Son camion ne travaille pas ce jour-là : choisis un camion qui travaille.');
  end if;
  if j.needs_machine and exists (select 1 from public.trucks tr where tr.id = v_truck and not tr.tire_machine) then
    perform public.fail('needs_truck', 'Ce travail demande le camion (montage ou balancement des pneus) : la voiture ne peut pas le faire.');
  end if;
  -- the two days, always locked in the same order (day, then morning → evening); then the job as it is NOW (move_job's rule)
  perform public.lock_two(j.day, j.block, p_day, 'day');
  select * into jn from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if jn.status <> 'booked' then perform public.fail('not_booked', 'Seul un rendez-vous pas encore commencé se déplace.'); end if;
  if (jn.day, jn.block) is distinct from (j.day, j.block) then
    perform public.fail('changed', 'Ce rendez-vous vient d’être déplacé par quelqu’un d’autre. Rouvre-le et recommence.');
  end if;
  j := jn;
  v_moved := j.day <> p_day or j.block <> 'day';
  v_left := j.truck_id is not null and (j.truck_id, j.day, j.block) is distinct from (v_truck, p_day, 'day');
  select * into w from public.win_for(p_at);
  if not v_moved and j.truck_id = v_truck and j.truck_pinned and j.arrive_at = p_at and j.eta_min = p_at
     and (j.win_start, j.win_end) is not distinct from (w.win_start, w.win_end) then
    return jsonb_build_object('ok', true, 'unchanged', true, 'changed', false, 'tell', false, 'exact', true, 'at', p_at,
      'stops', '[]'::jsonb, 'over_hours', 0, 'earliest', null, 'earliest_keep', null,
      'rows', jsonb_build_object('jobs', jsonb_build_array(to_jsonb(j))));
  end if;
  -- the truck's day as it is: its booked stops in their order (without this one), each held at its stored arrival
  v_others := array(select x.id from public.jobs x
                    where x.truck_id = v_truck and x.day = p_day and x.block = 'day' and x.deleted_at is null and x.status = 'booked' and x.id <> j.id
                    order by x.stop_order nulls last, x.eta_min nulls last, x.created_at);
  n := coalesce(cardinality(v_others), 0);
  select coalesce(jsonb_object_agg(x.id::text, x.eta_min) filter (where x.eta_min is not null), '{}'::jsonb) into v_hold
  from public.jobs x where x.id = any(v_others);
  select coalesce(jsonb_object_agg(x.id::text, jsonb_build_object('order', x.stop_order, 'eta', x.eta_min)), '{}'::jsonb) into v_before
  from public.jobs x where x.id = any(v_others) or x.id = j.id;
  if v_left then
    select coalesce(jsonb_object_agg(x.id::text, jsonb_build_object('order', x.stop_order, 'eta', x.eta_min, 'travel', x.travel_min)), '{}'::jsonb) into v_bold
    from public.jobs x where x.truck_id = j.truck_id and x.day = j.day and x.block = j.block and x.deleted_at is null and x.status = 'booked' and x.id <> j.id;
  end if;
  select * into b from public.blocks() x where x.key = 'day';
  select least(coalesce(max((x->>1)::int), b.end_min), b.end_min) into v_hend from jsonb_array_elements(public.truck_ranges(v_truck, p_day)) x;
  -- every place, tried
  for p in 0 .. n loop
    v_order := coalesce(v_others[1:p], '{}') || array[j.id] || coalesce(v_others[p + 1:n], '{}');
    v_c0 := public.exact_run(j.id, p_day, v_truck, p_at, v_order, v_hold || jsonb_build_object(j.id::text, 0), v_before, v_hend, p);
    v_c := case when (v_c0->>'eta')::int >= p_at then v_c0
                else public.exact_run(j.id, p_day, v_truck, p_at, v_order, v_hold || jsonb_build_object(j.id::text, p_at), v_before, v_hend, p) end;
    -- (verify-on F1) « Vraies routes » on, a place whose arrival counts a trip not measured and comes after the minute: its
    -- lower bound (every trip not measured counted 0, the others still held at their arrival: route_hold with
    -- garage.exact_low). Only when even that bound is after the minute is the place out: that is a fact, not a guess (S8)
    if v_on and not (v_c->>'sure')::boolean and (v_c->>'eta')::int > p_at then
      perform set_config('garage.exact_low', 'on', true);
      v_lo := public.exact_run(j.id, p_day, v_truck, p_at, v_order, v_hold || jsonb_build_object(j.id::text, p_at), v_before, v_hend, p);
      perform set_config('garage.exact_low', '', true);
      v_c := v_c || jsonb_build_object('low', (v_lo->>'eta')::int);
    end if;
    v_c0s := v_c0s || jsonb_build_array(v_c0);
    v_cs := v_cs || jsonb_build_array(v_c);
  end loop;
  -- (verify-off M1, verify-on F2) the earliest the truck can be there AT OR AFTER the minute pointed: over the places held at
  -- that minute (a minute in the truck's break, or a job that does not end before it: the first minute after the break),
  -- never a minute before the one pointed; earliest_keep: the same with nobody's time changed
  select min((c->>'eta')::int) into v_earliest from jsonb_array_elements(v_cs) c;
  select min((c->>'eta')::int) into v_keep from jsonb_array_elements(v_cs) c
  where (c->>'moved')::int = 0 and jsonb_array_length(c->'late') = 0 and (c->>'over')::int = 0;
  select c into v_best from jsonb_array_elements(v_cs) c
  where (c->>'eta')::int = p_at or (not (c->>'sure')::boolean and coalesce((c->>'low')::int, p_at) <= p_at)
  order by ((c->>'eta')::int > p_at), case when (c->>'eta')::int > p_at then (c->>'eta')::int end nulls first,
           jsonb_array_length(c->'late') + case when (c->>'over')::int > 0 then 1 else 0 end,
           (c->>'delay')::int, (c->>'drive')::int, (c->>'pos')::int
  limit 1;
  if v_best is null then
    raise exception using errcode = 'P0001', hint = 'arrive_late',
      message = format('Le camion ne peut pas être là à %s : au plus tôt %s.', public.exact_hm(p_at), public.exact_hm(v_earliest)),
      detail = jsonb_build_object('earliest', v_earliest, 'earliest_keep', v_keep)::text;
  end if;
  if p_check then
    select jsonb_agg(e) into v_bad from jsonb_array_elements(v_best->'late') e where not (v_ok ? (e->>'id'));
    if v_bad is not null or ((v_best->>'over')::int > 0 and not (v_ok ? j.id::text)) then
      raise exception using errcode = 'P0001', hint = 'late_changed',
        message = 'La journée a changé depuis la vérification : ce déplacement mettrait un autre client en retard (ou le camion après ses heures). Vérifie de nouveau.',
        detail = jsonb_build_object('late', v_best->'late', 'over_hours', (v_best->>'over')::int)::text;
    end if;
  end if;
  -- written: the place chosen, the others held at their arrival
  perform public.exact_try(j.id, p_day, v_truck, p_at, array(select (x #>> '{}')::uuid from jsonb_array_elements(v_best->'order') x),
    v_hold || jsonb_build_object(j.id::text, p_at));
  -- the day it left: same order (the hole closed), same times (each held at its arrival, each trip as it was), only the trip
  -- after the hole is new
  if v_left then
    if public.block_open(j.day, j.block) then
      select coalesce(max(x.stop_order), 0) into v_base from public.jobs x
      where x.truck_id = j.truck_id and x.day = j.day and x.block = j.block and x.deleted_at is null and x.status in ('en_route', 'on_site', 'done');
      update public.jobs x set stop_order = v_base + q.rn
      from (select y.id, (row_number() over (order by y.stop_order nulls last, y.eta_min nulls last, y.created_at))::int rn
            from public.jobs y where y.truck_id = j.truck_id and y.day = j.day and y.block = j.block and y.deleted_at is null and y.status = 'booked') q
      where q.id = x.id and x.stop_order is distinct from v_base + q.rn;
      select coalesce(jsonb_object_agg(k, (v->>'eta')::int) filter (where v->>'eta' is not null), '{}'::jsonb) into v_oldhold from jsonb_each(v_bold) e(k, v);
      -- (verify-on F4) and each trip as it was, but the one right after the hole: a stop without a position after the moved
      -- one made the walk count the next trip from another place (the last place known), so later stops got later
      select k into v_next from jsonb_each(v_bold) e(k, v) where (v->>'order')::int > j.stop_order order by (v->>'order')::int limit 1;
      select v_oldhold || jsonb_build_object('_legs', coalesce(jsonb_object_agg(k, greatest(0, (v->>'travel')::int - ceil(public.bset('stop_min', 5))::int))
               filter (where v->>'travel' is not null and k <> v_next), '{}'::jsonb)) into v_oldhold from jsonb_each(v_bold) e(k, v);
      perform public.route_hold(j.truck_id, j.day, j.block, v_oldhold);
    elsif j.day = public.local_today() and j.stop_order is not null then
      -- a day already started: nobody is walked again, the stops after it move up by one (move_job's rule)
      update public.jobs set stop_order = stop_order - 1
      where truck_id = j.truck_id and day = j.day and block = j.block and deleted_at is null and id <> j.id
        and status in ('booked','en_route','on_site') and stop_order > j.stop_order
        and not exists (select 1 from public.jobs o where o.truck_id = j.truck_id and o.day = j.day and o.block = j.block and o.deleted_at is null
                        and o.id <> j.id and o.status not in ('cancelled','no_show') and o.stop_order = j.stop_order);
    end if;
  end if;
  -- what really changed for the customer (the day, the window): told again
  select * into jn from public.jobs where id = j.id;
  v_winch := (j.win_start, j.win_end) is distinct from (jn.win_start, jn.win_end);
  v_tell := v_moved or v_winch;
  if v_tell and jn.confirm_sent_at is not null then
    perform set_config('garage.rpc', 'on', true);
    update public.jobs set confirm_sent_at = null where id = j.id;
    select * into jn from public.jobs where id = j.id;
  end if;
  v_view := public.exact_view(v_truck, p_day, j.id, p_at, v_before, v_hend);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'day', x.day, 'truck_id', x.truck_id,
           'order_before', (q.bf->>'order')::int, 'order_after', x.stop_order, 'eta_before', (q.bf->>'eta')::int, 'eta_after', x.eta_min,
           'win_start', x.win_start, 'win_end', x.win_end,
           'delay_min', greatest(0, coalesce(x.eta_min - (q.bf->>'eta')::int, 0)),
           'late', q.late, 'late_min', case when q.late then x.eta_min - q.lim else 0 end,
           'measured', case when v_on then coalesce(x.eta_measured, false) end)
           order by x.day, (x.truck_id = v_truck) desc, x.stop_order nulls last, x.id), '[]'::jsonb) into v_stops
  from public.jobs x
  cross join lateral (select coalesce(v_before->x.id::text, v_bold->x.id::text) bf, coalesce(x.arrive_at, x.win_end) lim) q0
  cross join lateral (select q0.bf, q0.lim,
      (case when v_on then coalesce(x.eta_measured, false) else true end) and q0.lim is not null and x.eta_min > q0.lim
      and (x.id = j.id or (q0.bf->>'eta') is null or (q0.bf->>'eta')::int <= q0.lim or x.eta_min > (q0.bf->>'eta')::int) late) q
  where x.deleted_at is null and x.status = 'booked'
    and (x.id = j.id or (x.truck_id = v_truck and x.day = p_day and x.block = 'day')
         or (v_left and x.truck_id = j.truck_id and x.day = j.day and x.block = j.block));
  v_res := jsonb_build_object('ok', true, 'job_id', j.id, 'changed', v_moved, 'tell', v_tell, 'window_changed', v_winch,
    'truck_changed', j.truck_id is distinct from jn.truck_id,
    'was', jsonb_build_object('day', j.day, 'block', j.block, 'win_start', j.win_start, 'win_end', j.win_end, 'win_flex', j.win_flex, 'truck_id', j.truck_id),
    'now', jsonb_build_object('day', jn.day, 'block', jn.block, 'win_start', jn.win_start, 'win_end', jn.win_end, 'win_flex', jn.win_flex, 'truck_id', jn.truck_id),
    'exact', true, 'at', p_at, 'stops', v_stops, 'over_hours', (v_view->>'over')::int, 'earliest', v_earliest, 'earliest_keep', v_keep,
    'rows', jsonb_build_object('jobs', public.block_rows(p_day, 'day') || case when v_moved then public.block_rows(j.day, j.block) else '[]'::jsonb end));
  perform set_config('garage.rpc', '', true);
  return v_res;
end $$;

-- exact_move(job, day, truck, minute, late_ok, check): the move with a minute, both modes. The right first, word for word
-- move_job's (« book », or the person's own truck named and the job on a truck of theirs)
create or replace function public.exact_move(p_job uuid, p_day date, p_truck uuid, p_at integer, p_late_ok jsonb, p_check boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.jobs; v_block text; v_truck uuid;
begin
  select * into j from public.jobs where id = p_job and deleted_at is null;
  if not found then perform public.fail('not_found', 'Ce rendez-vous n’existe plus.'); end if;
  if not (public.can('book') or (p_truck is not null and coalesce(p_truck = any(public.my_truck_ids()), false) and coalesce(j.truck_id = any(public.my_truck_ids()), false))) then
    perform public.fail('not_allowed', 'Tu ne peux pas déplacer ce rendez-vous.');
  end if;
  if p_at is null or p_at < 0 or p_at > 1439 then perform public.fail('bad_window', 'Cette heure n’est pas bonne : choisis-en une autre.'); end if;
  if public.windows_on() then return public.exact_place(p_job, p_day, p_truck, p_at, p_late_ok, p_check); end if;
  -- blocks: the block that holds that minute; its truck kept (the one picked, else its own when it works that block)
  select x.key into v_block from public.blocks() x where p_at >= x.start_min and p_at < x.end_min order by x.pos limit 1;
  if v_block is null then perform public.fail('bad_window', 'Cette heure n’est dans aucun bloc : choisis-en une autre.'); end if;
  v_truck := coalesce(p_truck, case when j.truck_id is not null and public.exact_works(j.truck_id, p_day, v_block) then j.truck_id end);
  return public.move_job(null::uuid, p_job, p_day, v_block, v_truck) || jsonb_build_object('exact', false, 'at', p_at);
end $$;

-- move_job with 8 arguments (S2): the claim first (op_begin), as every operation; p_exact null → the 7-argument move
create or replace function public.move_job(p_op uuid, p_job uuid, p_day date, p_block text, p_truck uuid, p_win_start integer, p_win_flex boolean, p_exact jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_done jsonb; v_res jsonb; v_at integer;
begin
  v_done := public.op_begin(p_op, 'move_job');
  if v_done is not null then return v_done; end if;
  if p_exact is null or jsonb_typeof(p_exact) = 'null' then
    v_res := public.move_job(null::uuid, p_job, p_day, p_block, p_truck, p_win_start, p_win_flex);
    return public.op_save(p_op, 'move_job', v_res);
  end if;
  if jsonb_typeof(p_exact) = 'object' and jsonb_typeof(p_exact->'at') = 'number'
     and (p_exact->>'at')::numeric between 0 and 1439 and (p_exact->>'at')::numeric = floor((p_exact->>'at')::numeric) then
    v_at := (p_exact->>'at')::int;
  end if;
  -- (a minute that is not a whole minute of the day stays null: exact_move refuses it « bad_window », after the right)
  -- never in the middle of the switch between blocks and windows (as every booking and move)
  perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
  v_res := public.exact_move(p_job, p_day, p_truck, v_at,
    case when jsonb_typeof(p_exact->'late_ok') = 'array' then p_exact->'late_ok' else '[]'::jsonb end, true);
  return public.op_save(p_op, 'move_job', v_res);
end $$;

-- move_preview(job, day, truck, minute) (S5): what that move would answer, nothing written (the move itself, every late
-- accepted, inside a block always undone, as the other previews: tests/db/exact-move.test.mjs), « Vraies routes » on or
-- off, windows or blocks. Its refusals are the move's (thrown, the same hint, words and detail), but « late_changed »:
-- the preview SAYS who would be late (stops[].late, over_hours) instead
create or replace function public.move_preview(p_job uuid, p_day date, p_truck uuid, p_at integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb; v_done boolean := false;
begin
  perform pg_advisory_xact_lock_shared(hashtext('windows_switch'));
  begin
    perform set_config('garage.trial', 'on', true);
    v_out := public.exact_move(p_job, p_day, p_truck, p_at, null, false);
    v_done := true;
    raise exception 'move_preview: undone' using errcode = 'P0001', hint = 'preview_undone';
  exception when others then
    if not v_done then raise; end if;
  end;
  return v_out;
end $$;

-- rights: the app calls move_job (8 arguments) and move_preview (this form); each checks the right of the move inside.
-- The rest is the server's own
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any (array['exact_works', 'exact_try', 'exact_view', 'exact_run', 'exact_hm',
             'exact_place', 'exact_move', 'route_hold'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
revoke all on function public.move_job(uuid, uuid, date, text, uuid, integer, boolean, jsonb) from public, anon;
grant execute on function public.move_job(uuid, uuid, date, text, uuid, integer, boolean, jsonb) to authenticated, service_role;
revoke all on function public.move_preview(uuid, date, uuid, integer) from public, anon;
grant execute on function public.move_preview(uuid, date, uuid, integer) to authenticated, service_role;
