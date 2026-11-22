# Builds supabase/migrations/20261119000200_vraies_routes.sql (run: python3 ops/generateurs/vraies-routes/build.py): the new objects (written here) and
# the planner functions that walk a route with a clock, taken from their latest definition BEFORE this migration and changed
# by exact replacements (each must apply exactly the number of times said, else this stops and writes nothing).
# Where a whole piece of a function is done otherwise with the switch on, the generator keeps the old piece itself inside
# « else » (re-indented by two spaces): `branch()` builds « if v_on then <new> else <old> end if; » from the old text, so the
# switch off runs the very text of before (tests/db/vraies-routes-off.test.mjs checks the answers too).
import re, glob, os

# the repository's own migrations, found from where this file sits (ops/generateurs/vraies-routes/)
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'supabase', 'migrations'))
OUT = ROOT + '/20261119000200_vraies_routes.sql'
# BUILD_OUT=<file>: write there instead (to load the new text in a rolled-back transaction before the other agents see it);
# the definitions are still read from the migrations, Part 27 left out
WRITE = os.environ.get('BUILD_OUT') or OUT


def latest(name):
    """the latest definition of public.<name> (the same reading as tools/fn.py), Part 27 itself left out: the file is
    written only at the end, so a run that stops never leaves the other agents without the migration"""
    out = None
    for f in sorted(glob.glob(ROOT + '/*.sql')):
        if f == OUT:
            continue
        s = open(f).read()
        for m in re.finditer(r'(?im)^create or replace function public\.' + re.escape(name) + r'\s*\(', s):
            tail = s[m.start():]
            q = re.search(r'\bas\s+(\$[a-z_]*\$)', tail, re.I)
            end = tail.index(q.group(1), q.end())
            out = (f, tail[:tail.index(';', end) + 1], m.start() + tail.index(';', end) + 1)
    assert out, name
    bad = later_patches(name, out[0], out[2])
    assert not bad, (name, 'changed later without its text: copying this definition would lose it', bad)
    return out[:2]


def later_patches(name, f, end):
    """review-sql L10: a migration can also change a function without writing its text (pg_get_functiondef + replace +
    execute, or « alter function », also inside a loop over names). A copy of the last text written would then silently
    lose that change: the generator stops instead. Looked for after the definition copied (Part 27 left out)."""
    found = []
    for g in sorted(glob.glob(ROOT + '/*.sql')):
        if g == OUT or g < f:
            continue
        s = open(g).read().lower()
        if g == f:
            s = s[end:]
        n = re.escape(name.lower())
        if re.search(r'alter\s+function\s+public\.' + n + r'\s*\(', s):
            found.append((os.path.basename(g), 'alter function'))
        if re.search(r"pg_get_functiondef\s*\(\s*'public\." + n + r'\s*\(', s):
            found.append((os.path.basename(g), 'pg_get_functiondef'))
        for m in re.finditer(r'(?s)\bdo\s+(\$[a-z_]*\$)(.*?)\1', s):
            body = m.group(2)
            if ('alter function' in body or 'pg_get_functiondef' in body) and ("'" + name.lower() + "'") in body:
                found.append((os.path.basename(g), 'a loop that alters it'))
    return found


def patched(name, pairs):
    f, t = latest(name)
    for old, new, n in pairs:
        assert t.count(old) == n, (name, old[:80], t.count(old))
        t = t.replace(old, new)
    return t


def indent(s, n=2):
    return ''.join((' ' * n + l) if l.strip() else l for l in s.splitlines(True))


def piece(text, first, last):
    """the old text from the line that starts with `first` to the end of the line that holds `last` (each once)"""
    assert text.count(first) == 1 and text.count(last) == 1, (first[:60], last[:60])
    i = text.index(first)
    j = text.index(last, i) + len(last)
    return text[i:j]


def branch(old, on, pad, why):
    """« if v_on then <on> else <old, two spaces further in> end if; » at the indentation `pad`"""
    p = ' ' * pad
    return (p + 'if v_on then\n' + ''.join(p + '  -- ' + l + '\n' for l in why) + indent(on, pad + 2)
            + p + 'else\n' + indent(old, 2) + p + 'end if;\n')


HEAD = r'''-- Part 27 — « Vraies routes » (2026-11-19): the planner counts the driving with real road times, never a straight line.
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
      if v_ws is not null and tm < v_ws then v_wait := v_wait + (v_ws - tm); tm := v_ws; end if;
      if v_rg then
        -- a break in the hours: the stop starts in the next stretch where it fits; none: the hours do not hold (the minute stays)
        v_fit := public.ranges_fit(p_ranges, tm, v_stop + coalesce((v->>'dur')::int, 0));
        if v_fit is null then v_ok := false; else tm := v_fit; end if;
      end if;
      if coalesce(p_windows, false) and v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then v_ok := false; end if;
    end if;
    tm := tm + v_stop + coalesce((v->>'dur')::int, 0);
    if clat is not null then plat := clat; plng := clng; end if;
  end loop;
  return array[tot,
    tot + case when p_elat is not null and p_elng is not null then public.drive_min(plat, plng, p_elat, p_elng, p_speed, p_detour, p_unknown, tm) else 0 end,
    case when v_ok then v_wait else -1 end];
end $$;

-- ---------- the planner's walks, made again ----------
'''

TAIL = r'''
@@MEASURE@@
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

@@PREVIEWS@@
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
'''

HERE = os.path.dirname(os.path.abspath(__file__))
# drive_wanted, drive_store, drive_spend_add, roads_state (measure.sql) and move_preview, stop_order_preview (previews.sql):
# new functions, written in their own files beside this one (plain SQL, easier to read than inside a Python string)
for mark, frag in (('@@MEASURE@@', 'measure.sql'), ('@@PREVIEWS@@', 'previews.sql')):
    assert TAIL.count(mark) == 1, mark
    TAIL = TAIL.replace(mark, open(os.path.join(HERE, frag)).read().rstrip('\n') + '\n')
# « exact move » (STATE.md 2026-11-21, S1 – S9): exact.sql. Its first part (the column jobs.arrive_at) goes right after the
# column of Part 27 (the functions below read it, some of them in plain SQL, checked when they are made); the rest (the move
# with a minute pointed, its preview and their rights) at the very end, after the rights of Part 27 (whose loop closes
# every move_preview: the new form is opened after it)
EXACT_CUT = '-- @@ the generator puts what is above right after the columns of Part 27, what is below at the end of the migration @@\n'
EXACT = open(os.path.join(HERE, 'exact.sql')).read()
assert EXACT.count(EXACT_CUT) == 1, 'exact.sql: the cut'
EXACT_HEAD, EXACT_REST = EXACT.split(EXACT_CUT)
COL27 = 'alter table public.jobs add column if not exists eta_measured boolean;\n'
assert HEAD.count(COL27) == 1
HEAD = HEAD.replace(COL27, COL27 + '\n' + EXACT_HEAD.rstrip('\n') + '\n')
# « exact move » (verify-on F7): route_clock, the walk on the clock: on a day that holds a pinned stop ('pw'), a wait counts only
# inside the truck's hours (a lunch break inside that wait is not work time); every other day as before
RC_WAIT = "      if v_ws is not null and tm < v_ws then v_wait := v_wait + (v_ws - tm); tm := v_ws; end if;\n"
assert HEAD.count(RC_WAIT) == 1
RC_FIXED = ("      if coalesce(p_windows, false) and v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then v_ok := false; end if;\n"
            "    end if;\n")
assert HEAD.count(RC_FIXED) == 1
HEAD = HEAD.replace(RC_FIXED, RC_FIXED[:-len("    end if;\n")]
                    + "    elsif (v->>'pin') is not null and (v->>'ws')::int > tm then\n"
                    + "      -- (exact move, verify-off H1) a stop of an order by hand pinned to a minute: the truck waits for that minute\n"
                    + "      v_wait := v_wait + case when v_rg then public.ranges_overlap(p_ranges, tm, (v->>'ws')::int) else (v->>'ws')::int - tm end;\n"
                    + "      tm := (v->>'ws')::int;\n"
                    + "    end if;\n")
HEAD = HEAD.replace(RC_WAIT, "      -- (exact move, verify-on F7) a day that holds a pinned stop ('pw'): a wait counts only its minutes inside the truck's hours\n"
                    "      if v_ws is not null and tm < v_ws then v_wait := v_wait + case when v_rg and (v->>'pw') is not null then public.ranges_overlap(p_ranges, tm, v_ws)\n"
                    "                                                         else v_ws - tm end; tm := v_ws; end if;\n")
TAIL = TAIL.rstrip('\n') + '\n\n' + EXACT_REST.strip('\n') + '\n'

parts = [HEAD]
SET_DOW = "perform set_config('garage.drive_dow', coalesce(extract(isodow from p_day)::int::text, ''), true);"
CLOCK_FIRST = '''  -- roads on (Part 27): the walk with the clock decides (route_clock); below, the walk of before, untouched
  if public.roads_on() then
    return {call};
  end if;
'''

# ---- route_walk_in, route_cost: with the switch on, the walk with the clock; off, the very text of before
# « exact move » (verify-on F7): on a day that holds a stop pinned to a minute (pts 'pw', set on every stop of such a day only),
# a wait counts only its minutes inside the truck's hours (ranges_overlap): a lunch break inside a wait is not work time (the
# pin makes such waits long: a clean move then « did not fit » at the next plan); every other day as before
PINW_OFF = ("if v_ws is not null and tm < v_ws then v_wait := v_wait + (v_ws - tm); tm := v_ws; end if;",
            "if v_ws is not null and tm < v_ws then v_wait := v_wait + case when (v->>'pw') is not null and p_ranges is not null and jsonb_typeof(p_ranges) = 'array'\n"
            "             then public.ranges_overlap(p_ranges, tm, v_ws) else v_ws - tm end; tm := v_ws; end if;")
parts.append("-- route_walk_in: roads on, the clocked walk (route_clock) says whether the windows and the hours hold, and the wait\n" + patched('route_walk_in', [
    ('language plpgsql immutable set search_path', 'language plpgsql stable set search_path', 1),
    ("begin\n  for id in select e from jsonb_array_elements_text",
     "begin\n" + CLOCK_FIRST.format(call="(public.route_clock(p_ids, null, 0, p_pts, p_start, p_hlat, p_hlng, null, null, p_speed, p_detour, p_unknown, p_stop, p_fixed, p_ranges, p_windows))[3]")
     + "  for id in select e from jsonb_array_elements_text", 1),
    # « exact move » (verify-on F7): on a day that holds a pinned stop (pts 'pw'), a wait counts only its minutes inside the
    # truck's hours: a lunch break inside that wait is not work time (it made a clean move « not fit » at the next plan)
    PINW_OFF + (1,),
    # (verify-off H1) a stop of an order by hand pinned to a minute: the truck waits for that minute (windows looked at)
    ("      if v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then return -1; end if;\n    end if;\n",
     "      if v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then return -1; end if;\n"
     "    elsif coalesce(p_windows, false) and (v->>'pin') is not null and (v->>'ws')::int > tm then\n"
     "      v_wait := v_wait + case when p_ranges is not null and jsonb_typeof(p_ranges) = 'array' then public.ranges_overlap(p_ranges, tm, (v->>'ws')::int)\n"
     "                              else (v->>'ws')::int - tm end;\n"
     "      tm := (v->>'ws')::int;\n"
     "    end if;\n", 1),
]))
parts.append("\n-- route_cost: roads on, the totals AND the walk on the clock (route_clock): the drive counted is the one of the arrival times\n" + patched('route_cost', [
    ('language plpgsql immutable set search_path', 'language plpgsql stable set search_path', 1),
    ("begin\n  m := n + case when p_add is null then 0 else 1 end;",
     "begin\n" + CLOCK_FIRST.format(call="public.route_clock(p_ids, p_add, p_at, p_pts, p_start, p_hlat, p_hlng, p_elat, p_elng, p_speed, p_detour, p_unknown, p_stop, p_fixed, p_ranges, p_windows)")
     + "  m := n + case when p_add is null then 0 else 1 end;", 1),
    PINW_OFF + (1,),   # « exact move » (verify-on F7), as route_walk_in
    # (verify-off H1) as route_walk_in: a stop of an order by hand pinned to a minute is waited for
    ("        if v_ok and v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then v_ok := false; v_wait := -1; end if;\n      end if;\n",
     "        if v_ok and v_we is not null and tm > v_we and not coalesce((v->>'late')::boolean, false) then v_ok := false; v_wait := -1; end if;\n"
     "      elsif coalesce(p_windows, false) and (v->>'pin') is not null and (v->>'ws')::int > tm then\n"
     "        v_wait := v_wait + case when v_rg then public.ranges_overlap(p_ranges, tm, (v->>'ws')::int) else (v->>'ws')::int - tm end;\n"
     "        tm := (v->>'ws')::int;\n"
     "      end if;\n", 1),
]))

# ---- route_retime: the arrival times written again, each leg at its hour (already a walk: only the hour is added)
RT_WS = "case when p_block = 'day' and public.windows_on() and not j.forced and j.manual_order is null then j.win_start end ws"
# (verify-off H1, verify-on F6) a stop pinned to a minute inside an order by hand (the move kept that order and put the stop in
# it) waits for its minute too; a stop of an order by hand without a minute: no wait, as before
RT_WS_PIN = "case when p_block = 'day' and public.windows_on() and not j.forced then case when j.manual_order is null then coalesce(j.arrive_at, j.win_start) else j.arrive_at end end ws"
RT = patched('route_retime', [
    ("begin\n  select * into b from public.blocks() x where x.key = p_block;",
     "begin\n  " + SET_DOW + "\n  select * into b from public.blocks() x where x.key = p_block;", 1),
    ('leg := public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown);',
     'leg := public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown, tm);', 1),
    # final-guess G1: roads on, each appointment of that vehicle's day says whether its arrival counts measured trips only
    ("  end loop;\nend $$;", "  end loop;\n  -- Part 27 (final-guess G1): roads on, the arrivals just written say whether they count measured trips only\n"
     "  if public.roads_on() then perform public.route_mark(p_day, p_truck); end if;\nend $$;", 1),
    # « exact move » (S6): a stop pinned to a minute by a move (jobs.arrive_at, window mode) waits for that minute, not for the
    # start of its window. arrive_at null (every appointment until such a move): the text of before
    (RT_WS, RT_WS_PIN, 1),
])
parts.append("\n-- route_retime: the arrival times written again, each leg at its hour; a stop pinned to a minute waits for it\n" + RT)
# « exact move » (S2): route_hold(truck, day, block, holds) = route_retime's very walk (made from its text above), each stop of
# `holds` ({ id: minute }) waiting until that minute instead of its window (the move holds the others « not before their
# stored arrival » and the moved one at the minute pointed). Called by the move only
RH = RT
for old, new in (("create or replace function public.route_retime(p_truck uuid, p_day date, p_block text) returns void",
                  "create or replace function public.route_hold(p_truck uuid, p_day date, p_block text, p_hold jsonb) returns void"),
                 (RT_WS_PIN, "coalesce((p_hold->>j.id::text)::int, " + RT_WS_PIN[:-3] + ") ws"),
                 # verify-on F1: the move's lower bound (exact_place sets garage.exact_low for one trial): a trip not measured
                 # counts 0 minutes, the trip after a stop without a position too; the trial is undone, its « measured » unread
                 ("v_stop numeric := public.bset('stop_min', 5); v_unknown numeric := public.bset('unknown_min', 20);\n",
                  "v_stop numeric := public.bset('stop_min', 5);\n"
                  "  -- the lower bound of the move (exact_place, verify-on F1): every trip not measured counts 0\n"
                  "  v_low boolean := coalesce(current_setting('garage.exact_low', true), '') = 'on';\n"
                  "  v_unknown numeric := case when v_low then 0 else public.bset('unknown_min', 20) end;\n"),
                 ("    if r.lat is not null and r.lng is not null then plat := r.lat; plng := r.lng; end if;\n",
                  "    if r.lat is not null and r.lng is not null then plat := r.lat; plng := r.lng;\n"
                  "    elsif v_low then plat := null; plng := null;   -- (the lower bound) the trip after it is not known either\n"
                  "    end if;\n"),
                 ("  if public.roads_on() then perform public.route_mark(p_day, p_truck); end if;\n",
                  "  if public.roads_on() and not v_low then perform public.route_mark(p_day, p_truck); end if;\n"),
                 # verify-on F4: the day an appointment left keeps each trip as it was (p_hold->'_legs': { id: minutes }), but
                 # the one after the hole; every other caller gives no '_legs': the walk of before
                 ("      leg := public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown, tm);\n",
                  "      leg := coalesce((p_hold->'_legs'->>r.id::text)::int, public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown, tm));\n")):
    assert RH.count(old) == 1, old[:60]
    RH = RH.replace(old, new)
parts.append("\n-- route_hold: route_retime's walk, each stop of p_hold waiting until its minute (the move with a minute pointed)\n" + RH)

# ---- plan_route
_, PR = latest('plan_route')
RC = "public.route_clock({ids}, null, 0, pts, {start}, hl, hg, {end}, v_speed, v_detour, v_unknown, v_stop, {nf}, {rg}, {win})"
ROUND3_OLD = piece(PR, "        base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);\n        basee := public.route_min_to(",
                   "          v_bw := greatest(0, public.route_walk_in(t->'stops', pts, v_start, hl, hg, v_speed, v_detour, v_unknown, v_stop, v_nf, t->'rg', v_win and v_try < 3));\n        end if;\n")
ROUND3_ON = '''v_start := (t->>'start')::int; v_nf := (t->>'nfixed')::int;
ev := {cur};
base := ev[1]; basee := ev[2]; v_bw := greatest(0, ev[3]);
cand := public.route_improve((t->'stops') || to_jsonb(jid), v_nf, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
ev := {cand};
if el is not null and eg is not null and (ev[3] < 0 or durs + jdur + ev[1] + ev[3] > (t->>'cap')::int) then
  cand := public.route_improve((t->'stops') || to_jsonb(jid), v_nf, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
  ev := {cand};
end if;
rc := ev[1]; rce := ev[2]; v_w := ev[3];
continue when v_w < 0;
'''.format(cur=RC.format(ids="t->'stops'", start='v_start', end='el, eg', nf='v_nf', rg="t->'rg'", win='v_win and v_try < 3'),
           cand=RC.format(ids='cand', start='v_start', end='el, eg', nf='v_nf', rg="t->'rg'", win='v_win and v_try < 3'))
FORCED_OLD = ("        base := public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);\n"
              "        rc := public.route_min((t->'stops') || to_jsonb(jid), pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);\n")
FORCED_ON = '''base := ({cur})[1];
rc := (public.route_clock(t->'stops', jid, n, pts, (t->>'start')::int, hl, hg, null, null, v_speed, v_detour, v_unknown, v_stop, (t->>'nfixed')::int, t->'rg', false))[1];
'''.format(cur=RC.format(ids="t->'stops'", start="(t->>'start')::int", end='null, null', nf="(t->>'nfixed')::int", rg="t->'rg'", win='false'))
FINAL_OLD = piece(PR, "    t := public.route_improve(cand, (trucks->ti->>'nfixed')::int, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);\n",
                  "        t := cand;\n      end if;\n    end if;\n")
FINAL_ON = '''if trucks->ti ? 'frozen' then
  -- a frozen vehicle (fix-sql, verify-on F1): its stops stay in their order (« quand même » after them)
  t := cand;
else
  v_start := (trucks->ti->>'start')::int; v_nf := (trucks->ti->>'nfixed')::int;
  t := public.route_improve(cand, v_nf, pts, hl, hg, el, eg, v_speed, v_detour, v_unknown, v_stop);
  ev := {best};
  if el is not null and eg is not null and (ev[3] < 0 or (trucks->ti->>'durs')::int + ev[1] + ev[3] > (trucks->ti->>'cap')::int) then
    t := public.route_improve(cand, v_nf, pts, hl, hg, v_speed, v_detour, v_unknown, v_stop);
    ev := {best};
  end if;
  eb := {put};
  if eb[3] >= 0 and (ev[3] < 0
                     or ((v_win or trucks->ti ? 'rg') and ev[1] + ev[3] > eb[1] + eb[3])
                     or ((trucks->ti->>'durs')::int + ev[1] + ev[3] > (trucks->ti->>'cap')::int
                         and (trucks->ti->>'durs')::int + eb[1] + eb[3] <= (trucks->ti->>'cap')::int)) then
    t := cand;
  end if;
end if;
'''.format(best=RC.format(ids='t || v_tail', start='v_start', end='el, eg', nf='v_nf', rg="trucks->ti->'rg'", win='v_win'),
           put=RC.format(ids='cand || v_tail', start='v_start', end='el, eg', nf='v_nf', rg="trucks->ti->'rg'", win='v_win'))
DIST_R = ("'dist', coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, r.lat, r.lng)) from jsonb_array_elements(trucks) x),\n"
          "                         public.km_between(v_hlat, v_hlng, r.lat, r.lng), 0));")
DIST_X = ("'dist', coalesce((select min(public.km_between((x->>'hlat')::double precision, (x->>'hlng')::double precision, clat, clng)) from jsonb_array_elements(trucks) x),\n"
          "                       public.km_between(v_hlat, v_hlng, clat, clng), 0)));")
SEED_OLD = "(t->>'durs')::int + public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_w > (t->>'cap')::int then"
pr = patched('plan_route', [
    # the clock and the day it plans
    ("  v_pastend jsonb := '[]';        -- booked « quand même » and placed past the hours (they go at the end)\n",
     "  v_pastend jsonb := '[]';        -- booked « quand même » and placed past the hours (they go at the end)\n"
     "  -- Part 27 (« Vraies routes »): roads on, every decision counts the same clock as the arrival times written (route_clock)\n"
     "  v_on boolean := public.roads_on(); eb int[]; v_dr int := 0; v_dep int;\n"
     "  -- the vehicles frozen for this plan (see plan_route, the wrapper below): their booked stops stay on them, in order\n"
     "  v_frz jsonb := coalesce(p_frozen, '[]'::jsonb);\n"
     "  -- « exact move » (verify-on F7): this block-day holds a stop pinned to a minute (window mode)\n"
     "  v_pinday boolean := false;\n", 1),
    ("  v_seed := coalesce(p_seed, false) and v_wm;\n",
     "  v_seed := coalesce(p_seed, false) and v_wm;\n"
     "  v_pinday := v_wm and exists (select 1 from public.jobs j where j.day = p_day and j.block = p_block and j.arrive_at is not null\n"
     "                               and j.status = 'booked' and j.deleted_at is null and (p_exclude is null or j.id <> p_exclude));\n", 1),
    ("      || case when v_wm and p_day = v_today and r.status = 'on_site' and r.eta_min is not null then jsonb_build_object('eta0', r.eta_min) else '{}'::jsonb end);\n",
     "      || case when v_wm and p_day = v_today and r.status = 'on_site' and r.eta_min is not null then jsonb_build_object('eta0', r.eta_min) else '{}'::jsonb end\n"
     "      -- « exact move » (verify-on F7): on a day that holds a pinned stop, the walks count a wait only inside the truck's hours\n"
     "      || case when v_pinday then jsonb_build_object('pw', true) else '{}'::jsonb end);\n", 1),
    ("      || case when v_ws is not null and v_we is not null then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end);\n",
     "      || case when v_ws is not null and v_we is not null then jsonb_build_object('ws', v_ws, 'we', v_we) else '{}'::jsonb end\n"
     "      || case when v_pinday then jsonb_build_object('pw', true) else '{}'::jsonb end);\n", 1),
    # « exact move » (verify-on fuzz2): the stops pinned to a minute are placed first (before the other stops tied to a truck),
    # those still at their minute before those the person accepted late at a move (a later plan never makes the pin kept late
    # in place of the one accepted late), so that the others fit around them as the move left them; nothing pinned: the
    # order of before
    ("           order by coalesce((e->>'forced')::boolean, false), (v_wm and v_xid is not null and e->>'id' = v_xid),\n",
     "           order by coalesce((e->>'forced')::boolean, false), (v_wm and v_xid is not null and e->>'id' = v_xid),\n"
     "                    ((pts->(e->>'id')->>'pin') is null), ((pts->(e->>'id')->>'pinlate') is not null),\n", 1),
    ("\nbegin\n  select * into b from public.blocks() x where x.key = p_block;",
     "\nbegin\n  -- the day being planned: the walks below take the rush hours of a working day (drive_min)\n  " + SET_DOW
     + "\n  select * into b from public.blocks() x where x.key = p_block;", 1),
    # « farthest first »: roads on, by the minutes measured from the trucks' starts
    (DIST_R, "-- roads on (Part 27): by the minutes measured from those starts (one not measured yet last), never the straight line\n"
             "        'dist', case when v_on then public.drive_from_starts(trucks, v_hlat, v_hlng, r.lat, r.lng)\n"
             "                     else " + DIST_R[len("'dist', "):-2].replace('\n                         ', '\n                          ') + " end);", 1),
    (DIST_X, "-- roads on (Part 27): by the minutes measured from the trucks' starts\n"
             "      'dist', case when v_on then public.drive_from_starts(trucks, v_hlat, v_hlng, clat, clng)\n"
             "                   else " + DIST_X[len("'dist', "):-3].replace('\n                       ', '\n                        ') + " end));", 1),
    # the stored routes as the seed (window mode): the room on the clock
    # (in parentheses: PL/pgSQL reads an IF condition up to its first THEN)
    (SEED_OLD, "(t->>'durs')::int + (case when v_on then (" + RC.format(ids="t->'stops'", start="(t->>'start')::int", end='null, null', nf="(t->>'nfixed')::int", rg="t->'rg'", win='true')
               + ")[1]\n                                             else public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) end) + v_w > (t->>'cap')::int then", 1),
    # round 3 (a better order), « quand même » at the end, the last order of each truck
    (ROUND3_OLD, branch(ROUND3_OLD, ROUND3_ON, 8, ['roads on (Part 27): route_improve finds a better order with the usual-hours times (it only puts the stops',
                                                   'in an order); whether that order fits and what it costs are counted on the clock, as the arrival times will be']), 1),
    (FORCED_OLD, branch(FORCED_OLD, FORCED_ON, 8, ['roads on (Part 27): the driving it adds at the end of the route, on the clock']), 1),
    (FINAL_OLD, branch(FINAL_OLD, FINAL_ON, 4, ['roads on (Part 27): the same choice, every total on the clock. route_improve only proposes the order that drives',
                                                'the least at the usual hours; it is kept when, on the clock, it fits in the truck\'s hours and every window holds',
                                                '(with windows or a break in the hours: when it costs no more driving + waiting than the order the stops were put in)']), 1),
    # the last walk: each leg at its hour; what it drives is the room counted (roads on)
    ("    t := trucks->ti; tm := (t->>'start')::int; plat := hl; plng := hg; k := 0; v_wt := 0;\n",
     "    t := trucks->ti; tm := (t->>'start')::int; plat := hl; plng := hg; k := 0; v_wt := 0; v_dr := 0;\n", 1),
    ('      leg := public.drive_min(plat, plng, clat, clng, v_speed, v_detour, v_unknown);\n      tm := tm + leg;',
     '      v_dep := tm;\n      leg := public.drive_min(plat, plng, clat, clng, v_speed, v_detour, v_unknown, tm);\n      tm := tm + leg; v_dr := v_dr + leg + ceil(v_stop)::int;', 1),
    ("'travel', leg + ceil(v_stop)::int));",
     "'travel', leg + ceil(v_stop)::int)\n"
     "        -- roads on (Part 27): the minute the truck leaves for this stop (day_drive takes its legs at the same minutes)\n"
     "        || case when v_on then jsonb_build_object('dep', v_dep) else '{}'::jsonb end);", 1),
    ("    used := (t->>'durs')::int + public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) + v_wt;",
     "    -- roads on (Part 27): the driving of the walk just made (each leg at its minute), the one behind the arrival times\n"
     "    used := (t->>'durs')::int + case when v_on then v_dr else public.route_min(t->'stops', pts, hl, hg, v_speed, v_detour, v_unknown, v_stop) end + v_wt;", 1),
    # fix-sql (verify-on F1, F4, F6): the planner itself under a new name, with the vehicles frozen for this plan; plan_route
    # (below) is the wrapper that finds them. Nothing frozen (always with the switch off): the text of before
    ("create or replace function public.plan_route(p_day date, p_block text, p_extra jsonb, p_exclude uuid, p_seed boolean)\n",
     "create or replace function public.plan_route_core(p_day date, p_block text, p_extra jsonb, p_exclude uuid, p_seed boolean, p_frozen jsonb)\n", 1),
    ("    v_alt := public.plan_route(p_day, p_block, p_extra, p_exclude, true);",
     "    v_alt := public.plan_route_core(p_day, p_block, p_extra, p_exclude, true, p_frozen);", 1),
    ("'stops', '[]'::jsonb, 'nfixed', 0, 'durs', 0)\n",
     "'stops', '[]'::jsonb, 'nfixed', 0, 'durs', 0)\n"
     "        -- Part 27 (fix-sql): a vehicle frozen for this plan (it holds an appointment the real roads no longer fit)\n"
     "        || case when v_frz ? r.id::text then jsonb_build_object('frozen', true) else '{}'::jsonb end\n", 1),
    ("    -- on the way or there: stays where it is, before the others.",
     "    -- Part 27 (fix-sql): a frozen vehicle keeps its booked stops, in their stored order (the ones on the way, there or in\n"
     "    -- an order by hand are fixed just below, first, as on any vehicle); nothing new goes on it but « quand même »\n"
     "    if r.status = 'booked' and r.manual_order is null and r.truck_id is not null and v_frz ? r.truck_id::text then\n"
     "      ti := null;\n"
     "      for k in 0 .. jsonb_array_length(trucks) - 1 loop if trucks->k->>'id' = r.truck_id::text then ti := k; end if; end loop;\n"
     "      if ti is not null then\n"
     "        trucks := jsonb_set(trucks, array[ti::text, 'stops'], (trucks->ti->'stops') || to_jsonb(r.id::text));\n"
     "        trucks := jsonb_set(trucks, array[ti::text, 'durs'], to_jsonb((trucks->ti->>'durs')::int + v_dur));\n"
     "        continue;\n"
     "      end if;\n"
     "    end if;\n"
     "    -- on the way or there: stays where it is, before the others.", 1),
    # « exact move » (S6): a booked stop pinned to a minute (jobs.arrive_at, window mode) is walked with the window [minute,
    # minute]: every plan holds it there (a booking, a move or a moment offered that would push it later does not fit; an
    # automatic re-plan places it late and lists it late rather than out). The other stops are planned as before
    ("           j.win_start, j.win_end, j.arrived_at, j.eta_min\n    from public.jobs j",
     "           j.win_start, j.win_end, j.arrived_at, j.eta_min, j.arrive_at\n    from public.jobs j", 1),
    ("then jsonb_build_object('ws', r.win_start, 'we', r.win_end) else '{}'::jsonb end",
     "then jsonb_build_object('ws', coalesce(r.arrive_at, r.win_start), 'we', coalesce(r.arrive_at, r.win_end))\n"
     "                || case when r.arrive_at is not null then jsonb_build_object('pin', true)\n"
     "                                                          -- (verify-on fuzz2) late already (accepted at a move): placed after the pins in time\n"
     "                                                          || case when r.eta_min > r.arrive_at then jsonb_build_object('pinlate', true) else '{}'::jsonb end\n"
     "                        else '{}'::jsonb end else '{}'::jsonb end", 1),
    # « exact move » (verify-off H1): in the last walk, a stop of an order by hand pinned to a minute waits for that minute and
    # is late after it (it is never « tried »: a booking or a longer stop before it that makes it later is seen by plan_late_new)
    ("      elsif t ? 'rg' and k > (t->>'nfixed')::int then\n        tm := coalesce(public.ranges_fit(t->'rg', tm, ceil(v_stop)::int + (pts->jid->>'dur')::int), tm);\n      end if;\n",
     "      elsif t ? 'rg' and k > (t->>'nfixed')::int then\n        tm := coalesce(public.ranges_fit(t->'rg', tm, ceil(v_stop)::int + (pts->jid->>'dur')::int), tm);\n"
     "      elsif v_win and (pts->jid->>'pin') is not null then\n"
     "        v_ws := (pts->jid->>'ws')::int; v_we := (pts->jid->>'we')::int;\n"
     "        if tm < v_ws then v_wt := v_wt + case when t ? 'rg' then public.ranges_overlap(t->'rg', tm, v_ws) else v_ws - tm end; tm := v_ws; end if;\n"
     "        if tm > v_we then v_late := v_late || to_jsonb(jid); end if;\n"
     "      end if;\n", 1),
    # « exact move » (verify-on F7): the last walk counts a wait only inside the truck's hours on a day that holds a pinned stop
    ("        if v_ws is not null and tm < v_ws then v_wt := v_wt + (v_ws - tm); tm := v_ws; end if;\n",
     "        -- (exact move, verify-on F7) a day that holds a pinned stop ('pw'): only the minutes of a wait inside the truck's hours\n"
     "        if v_ws is not null and tm < v_ws then v_wt := v_wt + case when (pts->jid->>'pw') is not null and t ? 'rg' then public.ranges_overlap(t->'rg', tm, v_ws)\n"
     "                                                       else v_ws - tm end; tm := v_ws; end if;\n", 1),
    ("      if pinned and t->>'id' <> jtruck then continue; end if;\n",
     "      if pinned and t->>'id' <> jtruck then continue; end if;\n"
     "      continue when t ? 'frozen';   -- Part 27 (fix-sql): a frozen vehicle takes nothing new\n", 1),
    ("        n := jsonb_array_length(t->'stops'); durs := (t->>'durs')::int;\n",
     "        continue when t ? 'frozen';\n"
     "        n := jsonb_array_length(t->'stops'); durs := (t->>'durs')::int;\n", 1),
    ("eg := (t->>'elng')::double precision; durs := (t->>'durs')::int;\n",
     "eg := (t->>'elng')::double precision; durs := (t->>'durs')::int;\n"
     "        continue when t ? 'frozen';\n", 1),
])
parts.append("\n-- plan_route_core: the planner (plan_route of before). Roads on, every decision on the clock of the arrival times it writes\n"
             "-- (route_clock); « farthest first » by measured minutes; the vehicles of p_frozen keep their stops. Off: the text of before\n"
             "-- (each piece done otherwise is kept as is, in « else »)\n" + pr)
parts.append(r'''
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
''')

# ---- day_drive: each leg at its hour; the legs not measured said; the place of the stop tried and the day's order
parts.append("\n-- day_drive: roads on, each leg at the minute the truck leaves for it, the km of the road (null while a leg is not\n"
             "-- measured: « unmeasured »), and the walk itself (at: the place of the stop tried, ids: the day in that order)\n" + patched('day_drive', [
    ("  r record; v_min int := 0; v_km numeric := 0; n int := 0; leg int; v_hop int; was_extra boolean := false;\nbegin\n",
     "  r record; v_min int := 0; v_km numeric := 0; n int := 0; leg int; v_hop int; was_extra boolean := false;\n"
     "  -- Part 27 (roads on): each leg at the minute the truck leaves for it, the legs not measured counted, the walk given back\n"
     "  v_on boolean := public.roads_on(); v_stop int := ceil(public.bset('stop_min', 5))::int; v_rg jsonb;\n"
     "  v_unm int := 0; v_at int; v_ids jsonb := '[]'::jsonb; v_tm int; v_end int; v_pos int;\n"
     "  v_nokm boolean := false; v_kml numeric; v_khop int;   -- fix-sql: a km not known (F7); the longest hop measured (F8)\n"
     "  -- join-server (fix-sql F3, second half): today, a leg already driven at the hour of the day's plan, the next ones from\n"
     "  -- where the truck is and when\n"
     "  v_today boolean := false; v_now int; v_rg0 jsonb; v_live boolean := false; v_brg jsonb;\n"
     "begin\n"
     "  if v_on then\n"
     "    -- the day walked (drive_min takes the rush hours of a working day) and where each block starts for this truck: its hours\n"
     "    -- of that day from now on, as plan_route counts them\n"
     "    " + SET_DOW + "\n"
     "    v_rg := public.ranges_from(public.truck_ranges(p_truck, p_day),\n"
     "      case when p_day = public.local_today() then (ceil(public.now_min() / 5.0) * 5)::int when p_day < public.local_today() then 1440 else 0 end);\n"
     "    -- today (join-server): the minute it is now, as plan_route and route_retime round it, and the truck's hours of the whole\n"
     "    -- day (a leg already driven was driven inside them, not from now)\n"
     "    v_today := p_day = public.local_today();\n"
     "    v_now := (ceil(public.now_min() / 5.0) * 5)::int;\n"
     "    v_rg0 := public.ranges_from(public.truck_ranges(p_truck, p_day), 0);\n"
     "  end if;\n", 1),
    ("    select q.lat, q.lng, q.extra from (", "    select q.lat, q.lng, q.extra, q.id, q.pos, q.at, q.dur, q.dep, q.bs, q.be, q.st, q.arr, q.ws from (", 1),
    ("coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng, false extra\n",
     "coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng, false extra,\n"
     "        j.id::text id, j.eta_min at, j.duration_min dur, null::int dep, b.start_min bs, b.end_min be,\n"
     "        j.status st, j.arrived_at arr,\n"
     "        case when j.block = 'day' and public.windows_on() and not coalesce(j.forced, false) and j.manual_order is null then j.win_start end ws\n", 1),
    ("        e.key = coalesce(p_extra->>'id', '')\n",
     "        e.key = coalesce(p_extra->>'id', ''),\n"
     "        e.key, (e.value->>'eta')::int, case when e.key = p_extra->>'id' then coalesce((p_extra->>'dur')::int, 60) else j.duration_min end,\n"
     "        (e.value->>'dep')::int, b.start_min, b.end_min, j.status, j.arrived_at, null::int\n", 1),
    ("    leg := public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown);\n",
     "    -- roads on: the minute it leaves for this stop: said by the plan; else the end of the stop before it in the same block;\n"
     "    -- else the first minute of the block for this truck (plan_route starts each block there)\n"
     "    -- today (join-server, fix-sql F3 second half): a stop already reached (done, there) was driven to at the hour of the\n"
     "    -- day's plan, never « now »; in a block already started the next stops leave from where the truck is and when, as\n"
     "    -- route_retime writes their arrival times (a plan of today, window mode, says it itself: dep)\n"
     "    v_tm := case when not v_on then null\n"
     "                 when v_today and r.st in ('done', 'on_site') then\n"
     "                   case when r.pos = v_pos then v_end else coalesce(public.ranges_first(v_rg0, r.bs, r.be), r.bs) end\n"
     "                 when r.dep is not null then r.dep\n"
     "                 when v_today and r.st in ('en_route', 'booked') and public.now_min() >= r.bs then\n"
     "                   case when r.pos = v_pos and v_live then v_end else v_now end\n"
     "                 when r.pos = v_pos then v_end\n"
     "                 else coalesce(public.ranges_first(v_rg, r.bs, r.be), r.bs) end;\n"
     "    leg := public.drive_min(plat, plng, r.lat, r.lng, v_speed, v_detour, v_unknown, v_tm);\n", 1),
    ("      v_km := v_km + public.km_between(plat, plng, r.lat, r.lng) * v_detour;\n    end if;\n",
     "      if v_on then\n"
     "        -- a trip measured without its km: the day's km is not known (fix-sql, verify-on F7: it counted 0)\n"
     "        v_kml := public.drive_km(plat, plng, r.lat, r.lng, v_detour);\n"
     "        if v_kml is null then v_nokm := true; else v_km := v_km + v_kml; end if;\n"
     "      else\n"
     "        v_km := v_km + public.km_between(plat, plng, r.lat, r.lng) * v_detour;\n"
     "      end if;\n"
     "    end if;\n"
     "    -- roads on: a leg with no time measured on the road (or to a place without a position) is counted, never guessed\n"
     "    if v_on and not public.drive_known(plat, plng, r.lat, r.lng) then v_unm := v_unm + 1; end if;\n", 1),
    ("    n := n + 1;\n  end loop;",
     "    n := n + 1;\n"
     "    if r.extra then v_at := n; end if;\n"
     "    v_ids := v_ids || to_jsonb(case when r.extra then 'new' else r.id end);\n"
     "    if v_on and v_today and r.st = 'on_site' then\n"
     "      -- there now: free once the work left is done (route_retime counts no stop time after it; a plan of today does)\n"
     "      v_end := (case when r.pos = v_pos and v_live then v_end else v_now end) + case when r.dep is not null then v_stop else 0 end\n"
     "               + greatest(0, r.dur - coalesce(floor(extract(epoch from (now() - r.arr)) / 60)::int, 0));\n"
     "      v_live := true;\n"
     "    elsif v_on and v_today and r.dep is null and r.st in ('en_route', 'booked') and public.now_min() >= r.bs then\n"
     "      -- on the clock from where the truck is: its arrival (a window waited for, a break in the hours: route_retime), the stop\n"
     "      v_end := v_tm + leg;\n"
     "      if r.st = 'booked' and r.ws is not null and v_end < r.ws then v_end := r.ws; end if;\n"
     "      if r.st = 'booked' then\n"
     "        v_brg := (select jsonb_agg(jsonb_build_array(greatest((x->>0)::int, r.bs), least((x->>1)::int, r.be)) order by (x->>0)::int)\n"
     "                  from jsonb_array_elements(public.truck_ranges(p_truck, p_day)) x\n"
     "                  where least((x->>1)::int, r.be) > greatest((x->>0)::int, r.bs) having count(*) > 1);\n"
     "        if v_brg is not null then v_end := coalesce(public.ranges_fit(v_brg, v_end, v_stop + r.dur), v_end); end if;\n"
     "      end if;\n"
     "      v_end := v_end + v_stop + r.dur; v_live := true;\n"
     "    else\n"
     "      v_end := r.at + v_stop + r.dur;\n"
     "    end if;\n"
     "    v_pos := r.pos;\n"
     "  end loop;", 1),
    ("    v_min := v_min + public.drive_min(plat, plng, sl, sg, v_speed, v_detour, v_unknown);\n"
     "    if plat is not null and sl is not null then v_km := v_km + public.km_between(plat, plng, sl, sg) * v_detour; end if;\n",
     "    v_min := v_min + public.drive_min(plat, plng, sl, sg, v_speed, v_detour, v_unknown, case when v_on then v_end end);\n"
     "    if v_on then\n"
     "      -- the way back, once the last stop is done\n"
     "      if plat is not null and sl is not null then\n"
     "        v_kml := public.drive_km(plat, plng, sl, sg, v_detour);\n"
     "        if v_kml is null then v_nokm := true; else v_km := v_km + v_kml; end if;\n"
     "      end if;\n"
     "      if not public.drive_known(plat, plng, sl, sg) then v_unm := v_unm + 1; end if;\n"
     "    else\n"
     "      if plat is not null and sl is not null then v_km := v_km + public.km_between(plat, plng, sl, sg) * v_detour; end if;\n"
     "    end if;\n", 1),
    ("  return jsonb_build_object('min', v_min, 'km', round(v_km, 1), 'stops', n, 'hop', v_hop);",
     "  -- km unknown (null) while a leg is not measured; at: the place of the stop tried in the day (1 = first); ids: the day's\n"
     "  -- stops in that order (the stop tried is 'new')\n"
     "  -- hop_known: the longest of the hops that is a measured trip (roads on; « far » for a fact even when another trip is not)\n"
     "  return jsonb_build_object('min', v_min, 'km', case when v_unm > 0 or v_nokm then null else round(v_km, 1) end, 'stops', n, 'hop', v_hop,\n"
     "    'unmeasured', v_unm, 'at', v_at, 'ids', v_ids, 'hop_known', v_khop);", 1),
    # « exact move » (S6): today, a stop pinned to a minute is waited for until that minute (route_retime's walk)
    # (verify-off H1) inside an order by hand too (a stop of an order by hand without a minute: no wait, as before)
    ("and j.manual_order is null then j.win_start end ws\n",
     "then case when j.manual_order is null then coalesce(j.arrive_at, j.win_start) else j.arrive_at end end ws\n", 1),
    ("    if n > 0 and r.lat is not null and (r.extra or was_extra) then v_hop := greatest(coalesce(v_hop, 0), leg); end if;\n",
     "    if n > 0 and r.lat is not null and (r.extra or was_extra) then v_hop := greatest(coalesce(v_hop, 0), leg); end if;\n"
     "    -- roads on (fix-sql, verify-on F8): the longest of those drives that is a MEASURED trip\n"
     "    if v_on and n > 0 and r.lat is not null and (r.extra or was_extra) and public.drive_known(plat, plng, r.lat, r.lng) then\n"
     "      v_khop := greatest(coalesce(v_khop, 0), leg);\n"
     "    end if;\n", 1),
]))

# ---- the moments offered: what was not measured is said (roads on only: off, the very same keys)
KEPT = ("exists (select 1 from jsonb_array_elements_text(coalesce(p0->'over', '[]'::jsonb)) o join public.jobs j on j.id = o::uuid "
        "where j.truck_id is not null)")
NEAR_ON = ("case when v_on then coalesce(least(public.drive_measured(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)),\n"
           "{p}                                   public.drive_measured(coalesce(j.lat, c.lat), coalesce(j.lng, c.lng), p_lat, p_lng)) <= v_nearmin, false)\n"
           "{p}     else public.km_between(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) <= v_near end;")
NEAR_OLD = "public.km_between(p_lat, p_lng, coalesce(j.lat, c.lat), coalesce(j.lng, c.lng)) <= v_near;"
TAKE = ("          v_unm := (w1->>'unmeasured')::int; v_dkm := (w1->>'km')::numeric; v_rank := (w1->>'at')::int; v_route := w1->'ids';\n"
        "          v_khop := (w1->>'hop_known')::int;\n")
# suggest_core: the place in the day only in window mode (fix-sql, the lead's F2: with blocks a booking runs apply_plan's
# chain, which may re-plan the other blocks of the day: verify-on F2 found 39 of 91 moments wrong; window mode 0 of 188)
TAKE_B = ("          v_unm := (w1->>'unmeasured')::int; v_dkm := (w1->>'km')::numeric; v_khop := (w1->>'hop_known')::int;\n"
          "          -- the place in the day only in window mode (fix-sql, the lead's F2: with blocks the booking may re-plan the other blocks)\n"
          "          v_rank := case when v_wm then (w1->>'at')::int end; v_route := case when v_wm then w1->'ids' end;\n")
FAR_FACT = ("{p}-- roads on: a trip of that day not measured yet: « far » only for a fact (a measured hop over the limit, or the day over\n"
            "{p}-- it with its measured trips alone: fix-sql, verify-on F8), else not known (the app says « pas encore mesuré »)\n"
            "{p}if v_on and v_unm > 0 then\n"
            "{p}  v_far := case when p_lat is null or p_lng is null or v_stops = 0 then null\n"
            "{p}                when v_maxhop > 0 and v_khop is not null and v_khop > v_maxhop then 'hop'\n"
            "{p}                when v_maxday > 0 and v_day - v_unm * ceil(v_unk) > v_maxday then 'day' end;\n"
            "{p}end if;\n")
UNM = "coalesce((e->>'unmeasured')::int, 0)"
UNM_LAST = "(" + UNM + " > 0)"
DECL = ("  -- Part 27 (roads on): « near » by measured minutes; what is not measured is said\n"
        "  v_on boolean := public.roads_on(); v_nearmin numeric := public.roads_num('near_min', 10, 0, 1440); v_unm int; v_dkm numeric; v_rank int; v_route jsonb;\n"
        "  v_khop int; v_unk numeric := public.bset('unknown_min', 20);\n")
NEWKEYS = ("jsonb_build_object('add_km', case when v_unm > 0 or km0 is null or km1 is null then null else greatest(0, round(km1 - km0, 1)) end,\n"
           "{p}  'unmeasured', v_unm, 'day_km', v_dkm, 'rank', v_rank, 'route', v_route)")
parts.append("\n-- suggest_core: roads on, « near » by measured minutes (near_min); each moment says what is not measured (never « far » by\n"
             "-- a guess), its day's km, and (window mode only) where the stop goes. A vehicle frozen by the real roads takes no new stop\n"
             "-- (plan_route), the others of that block are offered (fix-sql, verify-on F6)\n" + patched('suggest_core', [
    ("  v_wm boolean := public.windows_on(); wait0 int; wait1 int; v_eta int; v_row jsonb;\nbegin",
     "  v_wm boolean := public.windows_on(); wait0 int; wait1 int; v_eta int; v_row jsonb;\n" + DECL + "begin", 1),
    ("  v_x jsonb := jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng);",
     "  v_x jsonb := jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', p_duration);", 1),
    (NEAR_OLD, NEAR_ON.format(p='          '), 1),
    ("v_day := null; v_hop := null; v_stops := 0;\n", "v_day := null; v_hop := null; v_stops := 0;\n      v_unm := 0; v_dkm := null; v_rank := null; v_route := null; v_khop := null;\n", 1),
    ("          v_day := (w1->>'min')::int; v_hop := (w1->>'hop')::int; v_stops := greatest(0, (w1->>'stops')::int - 1);\n",
     "          v_day := (w1->>'min')::int; v_hop := (w1->>'hop')::int; v_stops := greatest(0, (w1->>'stops')::int - 1);\n" + TAKE_B, 1),
    ("when v_maxday > 0 and v_day > v_maxday then 'day' end;\n",
     "when v_maxday > 0 and v_day > v_maxday then 'day' end;\n" + FAR_FACT.format(p='      '), 1),
    ("'stops', v_stops, 'far', v_far);\n      if v_wm then",
     "'stops', v_stops, 'far', v_far);\n"
     "      if v_on then\n"
     "        -- roads on (Part 27): km unknown while a trip is not measured; the vehicle's day km; where the stop goes in its day\n"
     "        v_row := v_row || " + NEWKEYS.format(p='          ') + ";\n"
     "      end if;\n"
     "      if v_wm then", 1),
    # final-guess G2: a moment with a trip not measured is never ranked by its guessed minutes (the unknown time): after
    # the measured ones, among themselves by day and block. Off no row has « unmeasured »: the order of before
    ("      order by (e->>'far' is not null), (e->>'add_min')::int + coalesce((e->>'wait_min')::int, 0), (e->>'near')::int desc, e->>'day', (e->>'pos')::int) o\n",
     "      order by (e->>'far' is not null), " + UNM_LAST + ",\n"
     "        case when " + UNM + " > 0 then 0 else (e->>'add_min')::int + coalesce((e->>'wait_min')::int, 0) end, (e->>'near')::int desc, e->>'day', (e->>'pos')::int) o\n", 1),
]))
parts.append("\n-- suggest_windows_core: the same as suggest_core for each window of the day\n" + patched('suggest_windows_core', [
    ("  tk record; w0 jsonb; w1 jsonb; v_truck text; min0 int; min1 int; km0 numeric; km1 numeric; v_day int; v_hop int; v_stops int; v_far text;\nbegin",
     "  tk record; w0 jsonb; w1 jsonb; v_truck text; min0 int; min1 int; km0 numeric; km1 numeric; v_day int; v_hop int; v_stops int; v_far text;\n" + DECL + "begin", 1),
    ("  v_x jsonb := jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng);", "  v_x jsonb := jsonb_build_object('id', x, 'lat', p_lat, 'lng', p_lng, 'dur', v_dur);", 1),
    (NEAR_OLD, NEAR_ON.format(p='      '), 1),
    ("v_day := null; v_hop := null; v_stops := 0;\n", "v_day := null; v_hop := null; v_stops := 0;\n        v_unm := 0; v_dkm := null; v_rank := null; v_route := null; v_khop := null;\n", 1),
    ("            v_day := (w1->>'min')::int; v_hop := (w1->>'hop')::int; v_stops := greatest(0, (w1->>'stops')::int - 1);\n",
     "            v_day := (w1->>'min')::int; v_hop := (w1->>'hop')::int; v_stops := greatest(0, (w1->>'stops')::int - 1);\n  " + TAKE, 1),
    ("when v_maxday > 0 and v_day > v_maxday then 'day' end;\n",
     "when v_maxday > 0 and v_day > v_maxday then 'day' end;\n" + FAR_FACT.format(p='        '), 1),
    ("'stops', v_stops, 'far', v_far));",
     "'stops', v_stops, 'far', v_far)\n"
     "          -- roads on (Part 27): km unknown while a trip is not measured; the vehicle's day km; where the stop goes in its day\n"
     "          || case when v_on then " + NEWKEYS.format(p='               ') + " else '{}'::jsonb end);", 1),
    # final-guess G2: the windows of a day whose trips are not all measured are never ranked by guessed minutes: after the
    # measured ones, by the hour. Off: the order of before
    ("    order by (e->>'drive_min')::int + (e->>'wait_min')::int, (e->>'win_start')::int) q), '[]'::jsonb);",
     "    order by " + UNM_LAST + ", case when " + UNM + " > 0 then 0 else (e->>'drive_min')::int + (e->>'wait_min')::int end,\n"
     "      (e->>'win_start')::int) q), '[]'::jsonb);", 1),
]))
parts.append("\n-- web_suggest: online, a moment whose trips are not all measured is never offered (roads on; off no row says « unmeasured »)\n" + patched('web_suggest', [
    ("where e->>'far' is null), '[]'::jsonb);",
     "where e->>'far' is null\n    and coalesce((e->>'unmeasured')::int, 0) = 0), '[]'::jsonb);", 1),
]))
parts.append("\n-- web_windows: the same for the windows\n" + patched('web_windows', [
    ("  return public.suggest_windows_core(p_lat, p_lng, public.web_duration(p_services), p_day, null,\n"
     "    exists (select 1 from public.services sv where sv.id = any(p_services) and sv.needs_machine), null);",
     "  return (select coalesce(jsonb_agg(e order by o), '[]'::jsonb)\n"
     "    from jsonb_array_elements(public.suggest_windows_core(p_lat, p_lng, public.web_duration(p_services), p_day, null,\n"
     "      exists (select 1 from public.services sv where sv.id = any(p_services) and sv.needs_machine), null)) with ordinality q(e, o)\n"
     "    where coalesce((e->>'unmeasured')::int, 0) = 0);", 1),
]))

# ---- final-guess G1: a window told to the customer is never cut from an arrival that counts the unknown time
FLEX_WHY = ("{p}-- Part 27 (final-guess G1): roads on, an arrival counted with the fixed unknown time (a trip not measured) is no\n"
            "{p}-- window for the customer: the appointment stays « flexible » (the text says « dans la journée ; nous vous confirmons\n"
            "{p}-- la veille une plage de 4 heures »), and lock_windows_core cuts its window once its trips are measured\n")
parts.append("\n-- book_job: roads on, no window cut from a guessed arrival (it stays flexible); off: the text of before\n" + patched('book_job', [
    ("    update public.jobs set win_start = w.win_start, win_end = w.win_end from public.win_for(v_eta) w where id = v_id;\n  end if;\n",
     "    if public.eta_known(v_id) then\n"
     "      update public.jobs set win_start = w.win_start, win_end = w.win_end from public.win_for(v_eta) w where id = v_id;\n"
     "    else\n" + FLEX_WHY.format(p='      ') +
     "      update public.jobs set win_flex = true where id = v_id;\n"
     "    end if;\n  end if;\n", 1),
]))
parts.append("\n-- move_job (7 arguments): the same for a move to another day with no window said\n" + patched('move_job', [
    ("    update public.jobs set win_start = w.win_start, win_end = w.win_end,\n"
     "      confirm_sent_at = case when j.win_start is distinct from w.win_start then null else confirm_sent_at end\n"
     "    from public.win_for(v_eta) w where id = j.id;\n  end if;\n",
     "    if public.eta_known(j.id) then\n"
     "      update public.jobs set win_start = w.win_start, win_end = w.win_end,\n"
     "        confirm_sent_at = case when j.win_start is distinct from w.win_start then null else confirm_sent_at end\n"
     "      from public.win_for(v_eta) w where id = j.id;\n"
     "    else\n" + FLEX_WHY.format(p='      ') +
     "      update public.jobs set win_flex = true,\n"
     "        confirm_sent_at = case when j.win_start is not null then null else confirm_sent_at end\n"
     "      where id = j.id;\n"
     "    end if;\n  end if;\n", 1),
    # « exact move » (S7): a move without a minute (the 5 or 7 arguments: « Laisser l'app choisir », a window chosen, the old
    # app) gives the appointment back to the planner inside its window. A job without arrive_at: the text of before
    ("    forced = false,\n",
     "    forced = false,\n    -- (exact move, S7) no minute pointed any more: the planner chooses inside the window again\n    arrive_at = null,\n", 1),
    ("  if not v_moved and v_same and p_truck is not distinct from (case when j.truck_pinned then j.truck_id end) then\n",
     "  if not v_moved and v_same and p_truck is not distinct from (case when j.truck_pinned then j.truck_id end) and j.arrive_at is null then\n", 1),
]))
LOCK_OLD = "j.status = 'booked' and j.deleted_at is null and j.win_flex and j.win_start is null and j.truck_id is not null) then\n"
parts.append("\n-- lock_windows_core: roads on, a flexible appointment gets its window only once its arrival is measured (asked again\n"
             "-- every 10 minutes by lock_windows_due); off: the text of before\n" + patched('lock_windows_core', [
    (LOCK_OLD, LOCK_OLD.replace(") then\n", "\n    and public.eta_known(j.id)) then\n"), 2),
    ("j.win_flex and j.win_start is null and j.eta_min is not null\n",
     "j.win_flex and j.win_start is null and j.eta_min is not null\n"
     "             and public.eta_known(j.id)   -- Part 27 (final-guess G1): never a window cut from a guessed arrival\n", 1),
]))

# ---- « exact move » (verify-on F5): plan_late_new (« a plan with one more stop makes somebody late »: book_job, move_job,
# set_job_duration, the moments offered, plan_fits) also sees a stop pinned to a minute that was already late (accepted late at
# a move) and that this plan makes LATER: before, only a NEW late id counted, so such a pin could be pushed past the window told
# to its customer in silence. Nothing pinned: the answer of before (the extra part reads only pinned rows)
parts.append("\n-- plan_late_new: also a stop pinned to a minute, late already, that this plan makes later (exact move, verify-on F5)\n" + patched('plan_late_new', [
    ("returns boolean language sql immutable as $$", "returns boolean language sql stable set search_path = public as $$", 1),
    ("where not (coalesce(p0->'late', '[]'::jsonb) ? o))\n$$;",
     "where not (coalesce(p0->'late', '[]'::jsonb) ? o))\n"
     "      or exists (select 1 from jsonb_array_elements_text(coalesce(p1->'late', '[]'::jsonb)) o\n"
     "                 join public.jobs j on j.id::text = o and j.arrive_at is not null\n"
     "                 where coalesce(p0->'late', '[]'::jsonb) ? o and (p1->'jobs'->o->>'eta')::int > (p0->'jobs'->o->>'eta')::int)\n$$;", 1),
]))
# ---- plan_inputs: what re-plans the coming days when the settings change (trigger settings_replan)
parts.append("\n-- plan_inputs: roads on, the speed and the detour plan nothing (they are not used) and roads_rush does; off, as before.\n"
             "-- It reads the switch as it is NOW (settings_replan compares old and new after the save), so flipping roads_on alone\n"
             "-- re-plans nothing here: roads_switch plans the coming days itself\n" + patched('plan_inputs', [
    ("language sql immutable set search_path", "language sql stable set search_path", 1),
    ("'speed', p_booking->'speed_kmh',\n    'detour', p_booking->'detour',",
     "'speed', case when not public.roads_on() then p_booking->'speed_kmh' end,\n    'detour', case when not public.roads_on() then p_booking->'detour' end,", 1),
    ("'blocks', p_booking->'blocks')\n$$;",
     "'blocks', p_booking->'blocks')\n"
     "    || case when public.roads_on() then jsonb_build_object('rush', not public.roads_no(p_booking->'roads_rush')) else '{}'::jsonb end\n$$;", 1),
]))
# ---- customers_replan_on_position (a position found re-plans the customer's blocks): the blocks locked in order first
POS_SEL = ("select distinct j.day, j.block from public.jobs j\n"
           "             where j.customer_id = new.id and j.deleted_at is null and j.status = 'booked' and j.day >= public.local_today() and j.lat is null\n")
parts.append("\n-- customers_replan_on_position: the blocks it plans are locked first, in the order every planner takes them (day, then\n"
             "-- morning → evening); then planned as before, in the same order as before (the plans do not change)\n" + patched('customers_replan_on_position', [
    ("    for r in " + POS_SEL,
     "    -- Part 27: drive_store plans the coming days every few minutes (roads_replan locks the blocks day by day, morning →\n"
     "    -- evening); this loop took them in no set order (« eve » before « pm »), so the two could wait on each other until\n"
     "    -- PostgreSQL stops one (review-sql L6). Only the order of the locks changes\n"
     "    for r in select q.day, q.block from (" + POS_SEL.replace('select distinct', 'select distinct').rstrip('\n') + ") q\n"
     "             order by q.day, public.block_pos(q.block)\n"
     "    loop\n"
     "      if public.block_open(r.day, r.block) then perform public.lock_block(r.day, r.block); end if;\n"
     "    end loop;\n"
     "    for r in " + POS_SEL, 1),
]))
# ---- fix-sql (verify-on F11): an automatic re-plan says who it made late (activity « window_late », roads on only)
parts.append("\n-- replan_block_safe: roads on, the appointments this automatic re-plan makes late (a position found, a cancellation, a\n"
             "-- duration) are written down (activity « window_late »: roads_late_note). Off: the text of before\n" + patched('replan_block_safe', [
    ("declare v_plan jsonb; v_today boolean; tk record;\nbegin\n",
     "declare v_plan jsonb; v_today boolean; tk record;\n"
     "  -- Part 27 (fix-sql, verify-on F11): roads on, who this re-plan makes late is written down\n"
     "  v_on boolean := public.roads_on(); v_before jsonb;\nbegin\n", 1),
    ("  perform public.lock_block(p_day, p_block);\n  v_plan := public.plan_block(p_day, p_block);\n",
     "  perform public.lock_block(p_day, p_block);\n"
     "  if v_on then v_before := public.roads_late_ids(array[p_day]); end if;\n"
     "  v_plan := public.plan_block(p_day, p_block);\n", 1),
    ("  -- work for the tire machine left on a vehicle without it",
     "  if v_on then perform public.roads_late_note(array[p_day], v_before, 'replan'); end if;\n"
     "  -- work for the tire machine left on a vehicle without it", 1),
]))
# ---- fix-sql (verify-on F4, F11): apply_plan's chain, roads on: a later block it cannot plan is re-timed, the late are said
parts.append("\n-- apply_plan: roads on, the day's chain re-times a later block it cannot plan without un-placing somebody (route_retime:\n"
             "-- never the arrival times counted from the old end of the block before), and writes down who it made late. Off: as before\n" + patched('apply_plan', [
    ("declare k text; v jsonb; n int := 0; c int; d date := nullif(p_plan->>'day', '')::date; bk record; p jsonb; v_moved boolean := false; v_keep boolean;\n"
     "  v_started boolean; v_was jsonb; v_now int;\nbegin\n",
     "declare k text; v jsonb; n int := 0; c int; d date := nullif(p_plan->>'day', '')::date; bk record; p jsonb; v_moved boolean := false; v_keep boolean;\n"
     "  v_started boolean; v_was jsonb; v_now int;\n"
     "  -- Part 27 (fix-sql, verify-on F4, F11): roads on, the chain re-times a block it cannot plan and says who it made late\n"
     "  v_on boolean; v_before jsonb; tk record;\n"
     "  -- « exact move » (verify-on F3): the stops of that day pinned to a minute, with their arrival before this plan\n"
     "  v_pins jsonb;\nbegin\n", 1),
    ("begin\n  perform set_config('garage.rpc', 'on', true);\n  for k, v in select * from jsonb_each(coalesce(p_plan->'jobs', '{}')) loop\n",
     "begin\n  perform set_config('garage.rpc', 'on', true);\n"
     "  select jsonb_object_agg(j.id::text, j.eta_min) into v_pins from public.jobs j\n"
     "  where d is not null and j.day = d and j.arrive_at is not null and j.status = 'booked' and j.deleted_at is null;\n"
     "  for k, v in select * from jsonb_each(coalesce(p_plan->'jobs', '{}')) loop\n", 1),
    ("    perform set_config('garage.chain', 'on', true);\n    for bk in select b.key, b.start_min from public.blocks() b order by b.pos loop\n",
     "    perform set_config('garage.chain', 'on', true);\n"
     "    v_on := public.roads_on();\n"
     "    if v_on then v_before := public.roads_late_ids(array[d]); end if;\n"
     "    for bk in select b.key, b.start_min from public.blocks() b order by b.pos loop\n", 1),
    ("      continue when exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]')) o join public.jobs j on j.id = o::uuid where j.truck_id is not null);\n",
     "      if exists (select 1 from jsonb_array_elements_text(coalesce(p->'over', '[]')) o join public.jobs j on j.id = o::uuid where j.truck_id is not null) then\n"
     "        -- roads on (Part 27): it keeps its places, with its arrival times walked again from where the block before now ends\n"
     "        if v_on then\n"
     "          for tk in select distinct j.truck_id from public.jobs j\n"
     "                    where j.day = d and j.block = bk.key and j.deleted_at is null and j.status = 'booked' and j.truck_id is not null loop\n"
     "            perform public.route_retime(tk.truck_id, d, bk.key);\n"
     "          end loop;\n"
     "        end if;\n"
     "        continue;\n"
     "      end if;\n", 1),
    ("    perform set_config('garage.chain', '', true);\n",
     "    if v_on then perform public.roads_late_note(array[d], v_before, 'chain'); end if;\n"
     "    perform set_config('garage.chain', '', true);\n", 1),
    # final-guess G1: roads on, the arrivals just written say whether they count measured trips only (before the chain: its
    # « late » reads them)
    ("  if n > 0 and d is not null and coalesce(current_setting('garage.chain', true), '') <> 'on' then\n",
     "  -- Part 27 (final-guess G1): roads on, the arrivals just written say whether they count measured trips only (jobs.eta_measured)\n"
     "  if d is not null and public.roads_on() then perform public.route_mark(d, null); end if;\n"
     "  -- « exact move » (S6 « placed late and SAID late », verify-on F3): a stop pinned to a minute that this plan puts after its\n"
     "  -- minute, or later than it was, is written down, « Vraies routes » on or off (activity « window_late », why 'pin', once in\n"
     "  -- this transaction); never from an arrival that counts a trip not measured (S8). Nothing pinned: nothing\n"
     "  if v_pins is not null then\n"
     "    insert into public.activity (actor, entity, entity_id, action, data)\n"
     "    select auth.uid(), 'job', j.id, 'window_late', jsonb_build_object('day', j.day, 'block', j.block, 'eta', j.eta_min,\n"
     "             'win_start', j.win_start, 'win_end', j.win_end, 'end', b.end_min, 'truck_id', j.truck_id, 'why', 'pin', 'arrive_at', j.arrive_at)\n"
     "    from public.jobs j join public.blocks() b on b.key = j.block\n"
     "    where v_pins ? j.id::text and j.status = 'booked' and j.deleted_at is null and j.truck_id is not null and j.arrive_at is not null\n"
     "      and j.eta_min > j.arrive_at\n"
     "      and ((v_pins->>j.id::text) is null or (v_pins->>j.id::text)::int <= j.arrive_at or j.eta_min > (v_pins->>j.id::text)::int)\n"
     "      and (not public.roads_on() or coalesce(j.eta_measured, true))\n"
     "      and not exists (select 1 from public.activity a where a.entity = 'job' and a.entity_id = j.id and a.action = 'window_late' and a.at = now());\n"
     "  end if;\n"
     "  if n > 0 and d is not null and coalesce(current_setting('garage.chain', true), '') <> 'on' then\n", 1),
]))
# ---- final-guess G1: the activity of a job does not list the flag (as eta_min: the planner's own number, written often)
parts.append("\n-- log_activity: jobs.eta_measured is the planner's, like eta_min: not an « update » of the appointment\n" + patched('log_activity', [
    ("'eta_min', 'travel_min', 'stop_order',", "'eta_min', 'travel_min', 'stop_order', 'eta_measured',", 1),
    # « exact move »: the places tried by the move and its preview are undone; their activity is not written at all
    # (garage.trial, set inside those blocks only), so they spend no number of activity's sequence
    ("begin\n  n := to_jsonb(new);", "begin\n  if coalesce(current_setting('garage.trial', true), '') = 'on' then return null; end if;\n  n := to_jsonb(new);", 1),
]))
# ---- « exact move » (S7): an order by hand clears the minute of the stops it lists; the windows off clear every one
parts.append("\n-- stop_order_one: the stops put in order by hand lose the minute pointed by a move (the last action wins)\n" + patched('stop_order_one', [
    ("update public.jobs j set manual_order = x.o from unnest(p_ids) with ordinality x(id, o) where j.id = x.id and j.manual_order is distinct from x.o::int;",
     "update public.jobs j set manual_order = x.o, arrive_at = null from unnest(p_ids) with ordinality x(id, o)\n"
     "  where j.id = x.id and (j.manual_order is distinct from x.o::int or j.arrive_at is not null);", 1),
]))
parts.append("\n-- windows_switch: back to the blocks, no minute pointed is kept (a block tells no time)\n" + patched('windows_switch', [
    ("      win_flex = false\n    where j.day >= v_today and j.block = 'day';",
     "      win_flex = false,\n      -- (exact move, S7) back to the blocks: no minute pointed any more\n      arrive_at = null\n    where j.day >= v_today and j.block = 'day';", 1),
]))
parts.append(TAIL)

text = '\n'.join(parts)
open(WRITE, 'w').write(text)
print('written', WRITE, text.count('\n'), 'lines')
