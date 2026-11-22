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
