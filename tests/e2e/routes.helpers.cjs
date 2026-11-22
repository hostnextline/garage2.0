// The helpers of tests/e2e/routes.test.cjs (« Vraies routes » end to end, Part 27).
// - The browser's outside world, faked with ctx.route: TomTom's browser services (tiles, routing, geocoding: the shapes of
//   BRIEF.md, the key « tt-browser-test » of this file's build), OpenStreetMap's tiles, OSRM and its copy, Photon, vPIC.
//   A catch-all route, registered FIRST (the lowest priority), records and aborts any request to a host that is not
//   127.0.0.1 and not faked: each step fails when that list is not empty. The app's service worker fetches the map tiles
//   itself (vite.config.ts « tuiles »): Playwright sees and routes a worker's requests only with
//   PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS (playwright-core 1.55 crServiceWorker.js), set below for this file's own
//   process before any browser starts.
// - The server's fake TomTom and OSRM (tests/stack/mocks.mjs): /control, /log, and their made-up road copied on purpose
//   (the test checks the numbers stored against it, as tests/api/drive.test.mjs does).
// - The planner's clock, as the arrival times are written (route_retime / route_clock of the migration
//   20261119000200_vraies_routes.sql): each leg at the minute the truck leaves for it, the rush-hour time of a working day
//   when there is one, the usual-hours time else, the fixed unknown time when not measured; switch off the estimate of
//   before. The test's oracle: what the screen and jobs.eta_min must say, computed from drive_times (and the estimate).
// - A snapshot of the database (another file than the harness's avant.sql): each step puts the world back as it found it.
// The first block is copied from tests/e2e/plages.helpers.cjs (watch, the pictures of a failing step), with this file's
// own names (fail-routes-*).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const h = require('./harness.cjs');

const PW = 'Garage-e2e-2026';
const BROWSER_KEY = 'tt-browser-test';
const MOCK = 'http://127.0.0.1:8021';
const PSQL = 'psql -h 127.0.0.1 -p 54332 -U postgres -q -v ON_ERROR_STOP=1';

/* ---------- copied from plages.helpers.cjs: what a failing step leaves ---------- */
const pages = new Set();
const watch = (page) => {
  pages.add(page); page.on('close', () => pages.delete(page));
  page.netlog = [];
  const t0 = Date.now();
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!/\/(rest|functions|auth)\/v1\//.test(u.pathname)) return;
    let rows = ''; try { const b = await r.json(); rows = Array.isArray(b) ? `rows=${b.length}` : ''; } catch { /* not json */ }
    page.netlog.push(`${Date.now() - t0}ms ${r.request().method()} ${u.pathname.replace(/^.*\/v1\//, '')}${u.search.length > 60 ? u.search.slice(0, 60) + '…' : u.search} ${r.status()} ${rows}`);
  });
  page.on('requestfailed', (r) => page.netlog.push(`${Date.now() - t0}ms FAILED ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) page.netlog.push(`${Date.now() - t0}ms console.${m.type()} ${m.text().slice(0, 200)}`); });
  return page;
};
const onFail = async (name) => {
  let i = 0;
  for (const p of pages) {
    const tag = `fail-routes-${name.slice(0, 24).replace(/\W+/g, '-')}-${i++}`;
    try { await h.shot(p, tag); } catch { /* closed */ }
    try { fs.writeFileSync(path.join(h.OUT, tag + '.txt'), (p.netlog || []).join('\n')); } catch { /* ignore */ }
  }
};
const noErrors = (page) => assert.deepEqual(page.errors, [], 'no page errors');
const until = async (get, ok, ms = 30000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await get(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 300)); } return v; };
const jwtOf = async (email) => (await (await fetch(`${h.API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: h.K.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) })).json()).access_token;
const rpcAs = async (jwt, name, args) => {
  const r = await fetch(`${h.API}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: h.K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(`${name}: ${JSON.stringify(d)}`), d);
  return d;
};
const fnAs = async (jwt, name, body) => {
  const r = await fetch(`${h.API}/functions/v1/${name}`, { method: 'POST', headers: { apikey: h.K.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};

/* ---------- the server's fake TomTom and OSRM (tests/stack/mocks.mjs) ---------- */
const control = async (qs) => (await fetch(`${MOCK}/control?${qs}`)).json();
/** TomTom and OSRM answer at once, every place has a road */
const calm = () => control('tomtom=ok&osrm=ok&tomtom_ms=0&noroad=');
const mockLog = async () => (await fetch(`${MOCK}/log`)).json();
const clearMock = () => fetch(`${MOCK}/log/clear`, { method: 'POST' });
// the mock's road (copied from tests/stack/mocks.mjs on purpose): km = straight line × 1.25; TomTom 240 s + 110 s a km,
// +120 s going north, × 1.5 at 8 h, × 1.8 at 17 h; minutes rounded up (the function: ceil), km to 0.1
const roadKm = (a, b) => Math.hypot((b.lng - a.lng) * 78, (b.lat - a.lat) * 111) * 1.25;
const ttSec = (a, b, slot = 0) => Math.round((240 + roadKm(a, b) * 110 + (b.lat > a.lat ? 120 : 0)) * [1, 1.5, 1.8][slot]);
const ttMin = (a, b, slot = 0) => Math.ceil(ttSec(a, b, slot) / 60);
const kmOf = (a, b) => Math.round(Math.round(roadKm(a, b) * 1000) / 100) / 10;

/* ---------- the database ---------- */
const json = (q) => JSON.parse(h.sql(q) || 'null');
const home = () => json(`select json_build_object('lat', lat, 'lng', lng) from public.home_point()`);
const bset = (k, d) => Number(h.sql(`select public.bset('${k}', ${d})`));
const roadsState = () => json(`select public.roads_state()`);
const roadsOn = () => h.sql(`select coalesce(booking->>'roads_on', 'false') from public.settings where id = 1`) === 'true';
/** the switch written by the server itself (what roads_switch does inside: the guard lets it through), in one transaction */
const forceRoads = (on) => execSync(PSQL, { input: `begin; select set_config('garage.roads', 'on', true);
  update public.settings set booking = jsonb_set(booking, '{roads_on}', '${on}'::jsonb) where id = 1; commit;`, encoding: 'utf8' });
/** the drive_times row of a trip (null: not measured) */
const timeOf = (a, b, slot = 0) => json(`select json_build_object('minutes', minutes, 'km', km::float8, 'source', source) from public.drive_times
  where a = public.drive_key(${a.lat}, ${a.lng}) and b = public.drive_key(${b.lat}, ${b.lng}) and slot = ${slot}`);
/** the rows that touch a place (any slot) */
const rowsAt = (p) => Number(h.sql(`select count(*) from public.drive_times where a = public.drive_key(${p.lat}, ${p.lng}) or b = public.drive_key(${p.lat}, ${p.lng})`));
/** the planner's estimate of the switch off between two points (drive_min's arithmetic of before): what must never be
    shown nor used with the switch on */
const straight = (a, b) => Number(h.sql(`select ceil(public.km_between(${a.lat}, ${a.lng}, ${b.lat}, ${b.lng}) * public.bset('detour', 1.3) / greatest(public.bset('speed_kmh', 35), 5) * 60)::int`));

/** the snapshot of this file (its own files: the harness's avant.sql stays the file-level save) */
function snapshot(tag) {
  execSync(`pg_dump -h 127.0.0.1 -p 54332 -U postgres --data-only --schema=public --exclude-table=public.local_migrations -f ${path.join(h.OUT, `routes-${tag}.sql`)}`);
  fs.writeFileSync(path.join(h.OUT, `routes-${tag}-users.txt`), h.sql('select coalesce(string_agg(id::text, \',\'), \'\') from auth.users'));
}
/** the database as the snapshot (the same way as harness.cjs restoreDb) */
function putBack(tag) {
  const tables = h.sql(`select string_agg(format('public.%I', tablename), ', ') from pg_tables where schemaname = 'public' and tablename <> 'local_migrations'`);
  const users = fs.readFileSync(path.join(h.OUT, `routes-${tag}-users.txt`), 'utf8').trim();
  execSync(PSQL, { input: `begin; set session_replication_role = replica; truncate ${tables} cascade; \\i ${path.join(h.OUT, `routes-${tag}.sql`)}\n` +
    `delete from auth.users where ${users ? `id not in (${users.split(',').map((u) => `'${u}'`).join(',')})` : 'true'}; commit;`, encoding: 'utf8' });
}

/* ---------- the planner's clock (the test's oracle) ---------- */
/** minutes of one leg leaving at minute `tm` of a day of the week (1 Monday … 7 Sunday), as drive_min counts it */
function legOf(a, b, isodow, tm, on) {
  if (!on) return { min: straight(a, b), how: 'estimate' };
  if (a.lat == null || b.lat == null) return { min: bset('unknown_min', 20), how: 'unknown' };
  const r = json(`select json_build_object('same', public.drive_key(${a.lat}, ${a.lng}) = public.drive_key(${b.lat}, ${b.lng}),
    's0', (select minutes from public.drive_times where a = public.drive_key(${a.lat}, ${a.lng}) and b = public.drive_key(${b.lat}, ${b.lng}) and slot = 0),
    'slot', public.drive_slot(${isodow}, ${tm}),
    'sx', (select minutes from public.drive_times where a = public.drive_key(${a.lat}, ${a.lng}) and b = public.drive_key(${b.lat}, ${b.lng}) and slot = public.drive_slot(${isodow}, ${tm})),
    'rush', public.roads_rush())`);
  if (r.same) return { min: 0, how: 'same' };
  if (r.s0 == null) return { min: bset('unknown_min', 20), how: 'unknown' };
  if (r.slot !== 0 && r.rush && r.sx != null) return { min: r.sx, how: `slot ${r.slot}` };
  return { min: r.s0, how: 'slot 0' };
}
/** where a truck's block starts that day (its hours) and where it leaves from (the last stop of the block before, else its
    start, else « Départ des camions »), as route_retime */
function blockStart(truck, day, block) {
  const s = json(`select json_build_object('tm', coalesce(public.ranges_first(public.truck_ranges('${truck}', '${day}'), b.start_min, b.end_min), b.start_min),
      'dow', extract(isodow from '${day}'::date)::int, 'pos', b.pos)
    from public.blocks() b where b.key = '${block}'`);
  const prev = json(`select json_build_object('lat', coalesce(j.lat, c.lat), 'lng', coalesce(j.lng, c.lng)) from public.jobs j
      left join public.customers c on c.id = j.customer_id join public.blocks() b on b.key = j.block
    where j.truck_id = '${truck}' and j.day = '${day}' and b.pos = ${s.pos} - 1 and j.deleted_at is null and j.status not in ('cancelled', 'no_show')
      and coalesce(j.lat, c.lat) is not null
    order by j.stop_order desc nulls last, j.eta_min desc nulls last limit 1`);
  const own = json(`select case when start is not null then json_build_object('lat', (start->>'lat')::float8, 'lng', (start->>'lng')::float8) end from public.trucks where id = '${truck}'`);
  return { tm: s.tm, dow: s.dow, from: prev || own || home() };
}
/** the booked stops of a truck's block, in the planner's order (route_retime's) */
function stopsOf(truck, day, block) {
  return json(`select coalesce(json_agg(x order by x.ord), '[]') from (select j.id, j.number, coalesce(j.lat, c.lat) lat, coalesce(j.lng, c.lng) lng,
      j.duration_min dur, j.stop_order, j.eta_min, j.travel_min, row_number() over (order by j.stop_order nulls last, j.eta_min nulls last, j.created_at) ord
    from public.jobs j left join public.customers c on c.id = j.customer_id
    where j.truck_id = '${truck}' and j.day = '${day}' and j.block = '${block}' and j.deleted_at is null and j.status = 'booked') x`);
}
/** the arrival of each stop of `list` (in that order) walked from the block's start: { id → { eta, leg, how } } */
function walk(truck, day, block, list, on) {
  const s = blockStart(truck, day, block);
  const stop = bset('stop_min', 5);
  let tm = s.tm, prev = s.from;
  const out = {};
  for (const j of list) {
    const leg = legOf(prev, j, s.dow, tm, on);
    tm += leg.min;
    out[j.id] = { eta: tm, leg: leg.min, how: leg.how };
    tm += stop + j.dur;
    if (j.lat != null) prev = { lat: j.lat, lng: j.lng };
  }
  return out;
}
/** every booked block of a day: the arrival times written (jobs.eta_min, travel_min) against the walk; [] when all agree */
function walkMismatches(day, on) {
  const blocks = json(`select coalesce(json_agg(distinct jsonb_build_object('truck', truck_id, 'block', block)), '[]') from public.jobs
    where day = '${day}' and deleted_at is null and status = 'booked' and truck_id is not null`);
  const stop = bset('stop_min', 5);
  const bad = [];
  for (const b of blocks) {
    const list = stopsOf(b.truck, day, b.block);
    const w = walk(b.truck, day, b.block, list, on);
    for (const j of list) {
      const e = w[j.id];
      if (j.eta_min !== e.eta || j.travel_min !== e.leg + stop) bad.push(`${day} ${b.block} #${j.number}: written ${j.eta_min} (travel ${j.travel_min}), walked ${e.eta} (leg ${e.leg}, ${e.how})`);
    }
  }
  return bad;
}
/** the arrival times of the coming booked appointments: { id → eta_min } */
const etas = () => Object.fromEntries(json(`select coalesce(json_agg(json_build_array(id, eta_min)), '[]') from public.jobs
  where day > public.local_today() and deleted_at is null and status = 'booked'`));

/* ---------- the switch through the API (the steps that start from « switch on ») ---------- */
/** « Mesurer maintenant » and the switch, as the owner, without a screen: sweep while `more`, then roads_switch ON */
async function roadsOnByApi(jwt) {
  let s = await fnAs(jwt, 'drive', { action: 'sweep' }), n = 0;
  while (s.ok && s.more && n++ < 20) s = await fnAs(jwt, 'drive', { action: 'sweep' });
  assert.deepEqual([s.ok, s.left0], [true, 0], `sweep: ${JSON.stringify(s)}`);
  const on = await rpcAs(jwt, 'roads_switch', { p_op: randomUUID(), p_on: true });
  assert.equal(on.on, true, JSON.stringify(on));
  return on;
}

/* ---------- words and numbers as the app writes them (fr) ---------- */
const pad = (n) => String(n).padStart(2, '0');
const clock = (m) => { const hh = Math.floor(m / 60), mm = m % 60; return mm ? `${hh} h ${pad(mm)}` : `${hh} h`; };
const duration = (m) => { const hh = Math.floor(m / 60), mm = m % 60; return !hh ? `${mm} min` : !mm ? `${hh} h` : `${hh} h ${pad(mm)}`; };
const km = (n) => new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 }).format(n);
/** spaces of any kind (fr-CA writes 10 000 with a no-break space) as one plain space */
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** the words of a moment's driving (domain/moment/logic.ts roadWords), capitalised as the suggestion writes them */
function roadWords(row) {
  let w;
  if ((Number(row.unmeasured) || 0) > 0) w = 'route pas encore mesurée';
  else {
    const min = row.add_min ?? row.drive_min;
    w = min <= 2 ? 'presque pas de route' : row.add_min == null || row.add_km == null ? `${duration(min)} de route` : `${duration(min)} de route (${km(row.add_km)} km)`;
  }
  return w.charAt(0).toUpperCase() + w.slice(1);
}
/** a number of minutes or km said on a screen: what must not be there while a trip is not measured */
const NUMBER_OF_ROAD = /(\d+ min|\d+ h(?: \d{2})?) de route|\d+(?:,\d+)? km\b/;

/* ---------- the browser's outside world ---------- */
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
/** a 1 × 1 picture of one colour (a tile shown as a square of that colour: TomTom's and OpenStreetMap's are told apart in the pictures) */
function solidPng(r, g, b) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, r, g, b]))), chunk('IEND', Buffer.alloc(0))]);
}
const TOMTOM_PNG = solidPng(0xf2, 0xa1, 0x3b);   // orange: TomTom's tiles
const OSM_PNG = solidPng(0x9c, 0xc3, 0xe6);      // blue: OpenStreetMap's tiles
const CORS = { 'access-control-allow-origin': '*' };
const jsonOk = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
/** a road between the points, with a bend in each leg (never the straight line between two stops) */
const bentLeg = (a, b) => [a, [(a[0] + b[0]) / 2 + 0.003, (a[1] + b[1]) / 2], b];

/** TomTom's geocoding answer for one door (the shape of its Geocoding API: BRIEF.md, src/lib/tomtom.ts TomtomResult) */
function ttDoor({ number, street, city, postal, lat, lng }) {
  return {
    type: 'Point Address', id: `CA/PAD/p0/${randomUUID().slice(0, 8)}`, score: 9.9, matchConfidence: { score: 1 },
    address: { streetNumber: number, streetName: street, municipality: city, countrySecondarySubdivision: 'Montréal', countrySubdivision: 'QC',
      countrySubdivisionName: 'Québec', countrySubdivisionCode: 'QC', postalCode: postal.slice(0, 3), extendedPostalCode: postal, countryCode: 'CA',
      country: 'Canada', countryCodeISO3: 'CAN', freeformAddress: `${number} ${street}, ${city} QC ${postal}`, localName: city },
    position: { lat, lon: lng },
    viewport: { topLeftPoint: { lat: lat + 0.001, lon: lng - 0.001 }, btmRightPoint: { lat: lat - 0.001, lon: lng + 0.001 } },
    entryPoints: [{ type: 'main', position: { lat, lon: lng } }]
  };
}

/** the outside world of one browser context. Answers { outside: [urls that tried to leave], hosts: { host → n },
    tt: { state: { tiles: 'ok' | 'refuse' }, doors: [{ re, door }], log: { tiles, route, geocode, other } }, osm, photon, osrm } */
async function fakeWorld(ctx) {
  const w = { outside: [], hosts: {}, tt: { state: { tiles: 'ok' }, doors: [], log: { tiles: [], route: [], geocode: [], other: [], badKey: [] } }, osm: [], photon: [], osrm: [] };
  ctx.on('request', (r) => { try { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) w.hosts[u.host] = (w.hosts[u.host] || 0) + 1; } catch { /* data: */ } });
  // FIRST (lowest priority): anything for a host that is not ours and not faked below is noted and never leaves
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => { w.outside.push(route.request().url()); return route.abort('blockedbyclient'); });
  // OSRM and its FOSSGIS copy
  const osrm = (route) => {
    const u = new URL(route.request().url());
    w.osrm.push(u.pathname);
    const pts = u.pathname.split('/driving/')[1].split(';').map((p) => p.split(',').map(Number));
    const legs = pts.slice(1).map((b, i) => { const a = pts[i]; return { distance: 1500, duration: 240, steps: [{ geometry: { coordinates: [a, [(a[0] + b[0]) / 2 + 0.003, (a[1] + b[1]) / 2], b] } }] }; });
    return jsonOk(route, { code: 'Ok', routes: [{ distance: 1500 * legs.length, duration: 240 * legs.length, legs }] });
  };
  await ctx.route('https://router.project-osrm.org/**', osrm);
  await ctx.route('https://routing.openstreetmap.de/**', osrm);
  // OpenStreetMap's tiles (blue)
  await ctx.route(/^https:\/\/([a-c]\.)?tile\.openstreetmap\.org\//, (route) => { w.osm.push({ at: Date.now(), url: route.request().url() }); return route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: OSM_PNG }); });
  // Photon: knows nothing (an address found is TomTom's)
  await ctx.route('https://photon.komoot.io/**', (route) => { w.photon.push(route.request().url()); return jsonOk(route, { type: 'FeatureCollection', features: [] }); });
  // the lists of car models (NHTSA), in case a screen asks
  await ctx.route('https://vpic.nhtsa.dot.gov/**', (route) => jsonOk(route, { Count: 0, Message: 'Response returned successfully', Results: [] }));
  // TomTom (the browser key of this build): tiles (orange, or 401 once refused), routing, geocoding
  await ctx.route('https://api.tomtom.com/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const at = Date.now();
    if (u.searchParams.get('key') !== BROWSER_KEY) { w.tt.log.badKey.push(req.url()); return jsonOk(route, { detailedError: { code: 'Forbidden', message: 'You are not allowed to access this endpoint' } }, 403); }
    let m;
    if ((m = /^\/map\/1\/tile\/basic\/main\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(u.pathname))) {
      const refused = w.tt.state.tiles !== 'ok';
      w.tt.log.tiles.push({ at, z: Number(m[1]), x: Number(m[2]), y: Number(m[3]), tileSize: u.searchParams.get('tileSize'), status: refused ? 401 : 200, sw: !!req.serviceWorker() });
      if (refused) return jsonOk(route, { detailedError: { code: 'Unauthorized', message: 'Developer key is invalid or the site is not allowed for it.' } }, 401);
      return route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: TOMTOM_PNG });
    }
    if ((m = /^\/routing\/1\/calculateRoute\/([^/]+)\/json$/.exec(u.pathname))) {
      const pts = decodeURIComponent(m[1]).split(':').map((p) => p.split(',').map(Number));
      w.tt.log.route.push({ at, n: pts.length, departAt: u.searchParams.get('departAt'), traffic: u.searchParams.get('traffic'), travelMode: u.searchParams.get('travelMode') });
      const legs = pts.slice(1).map((b, i) => {
        const a = pts[i];
        const metres = Math.round(roadKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * 1000), seconds = Math.round(240 + metres * 0.11);
        return { summary: { lengthInMeters: metres, travelTimeInSeconds: seconds, trafficDelayInSeconds: 0 }, points: bentLeg(a, b).map(([lat, lon]) => ({ latitude: lat, longitude: lon })) };
      });
      const sum = (k) => legs.reduce((s, l) => s + l.summary[k], 0);
      return jsonOk(route, { formatVersion: '0.0.12', routes: [{ summary: { lengthInMeters: sum('lengthInMeters'), travelTimeInSeconds: sum('travelTimeInSeconds'), trafficDelayInSeconds: 0,
        departureTime: '2026-11-24T11:30:00-05:00', arrivalTime: '2026-11-24T12:00:00-05:00' }, legs, sections: [{ startPointIndex: 0, endPointIndex: legs.length * 3 - 1, sectionType: 'TRAVEL_MODE', travelMode: 'car' }] }] });
    }
    if ((m = /^\/search\/2\/geocode\/(.+)\.json$/.exec(u.pathname))) {
      const q = decodeURIComponent(m[1]);
      w.tt.log.geocode.push({ at, q, countrySet: u.searchParams.get('countrySet'), language: u.searchParams.get('language'), typeahead: u.searchParams.get('typeahead'), limit: u.searchParams.get('limit') });
      if (u.searchParams.has('typeahead')) return jsonOk(route, { errorText: 'typeahead is not supported', detailedError: { code: 'BadRequest' } }, 400);
      const results = w.tt.doors.filter((d) => d.re.test(q)).map((d) => ttDoor(d.door));
      return jsonOk(route, { summary: { query: q.toLowerCase(), queryType: 'NON_NEAR', queryTime: 12, numResults: results.length, offset: 0, totalResults: results.length, fuzzyLevel: 1 }, results });
    }
    w.tt.log.other.push(req.url());
    return jsonOk(route, { detailedError: { code: 'NotFound' } }, 404);
  });
  return w;
}

/* ---------- a browser of a step ---------- */
const opened = new Set();
/** a page in its own context, watched (pictures of a failure), with the outside world faked */
async function openR(o) {
  const r = await h.open(o);
  watch(r.page);
  r.world = await fakeWorld(r.ctx);
  opened.add(r.ctx);
  r.ctx.on('close', () => opened.delete(r.ctx));
  return r;
}
/** nothing left for a host that is not faked, and no TomTom request with another key */
function nothingLeft(r) {
  assert.deepEqual(r.world.outside, [], 'no request left for a host that is not faked');
  assert.deepEqual(r.world.tt.log.badKey, [], 'every TomTom request carries the browser key of the build');
  assert.deepEqual(r.world.tt.log.other, [], 'no other TomTom service than tiles, routing and geocoding');
}
/** the end of every step: the browsers of the step closed, the fake TomTom and OSRM back to normal, the world put back */
async function endStep(tag = 'world') {
  for (const c of [...opened]) { try { await c.close(); } catch { /* gone */ } }
  opened.clear();
  try { await calm(); } catch { /* the mocks are down: the next step says it */ }
  putBack(tag);
}
/** every answer of an RPC the page received, in order: [{ at, args, body }] */
function answersOf(page, rpc) {
  const out = [];
  page.on('response', async (res) => {
    if (!res.url().includes(`/rest/v1/rpc/${rpc}`)) return;
    let body = null, args = null;
    try { body = await res.json(); } catch { /* not json */ }
    try { args = JSON.parse(res.request().postData() || 'null'); } catch { /* none */ }
    out.push({ at: Date.now(), status: res.status(), args, body });
  });
  return out;
}
/** every answer of the function « drive » the page received: [{ at, action, body }] */
function driveAnswersOf(page) {
  const out = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/functions/v1/drive')) return;
    let body = null, action = null;
    try { body = await res.json(); } catch { /* not json */ }
    try { action = JSON.parse(res.request().postData() || '{}'); } catch { /* none */ }
    out.push({ at: Date.now(), status: res.status(), ask: action, body });
  });
  return out;
}
/** what the agenda of a day (computer, day view: the blocks mode's lanes) says of each appointment: its arrival on its
    ticket (« Vers 12 h 33 »); null when the ticket says no time */
async function agendaEtas(page, day, ids) {
  await page.goto(h.APP + `#/agenda/${day}?view=day`);
  await page.getByTestId('agenda-screen').waitFor();
  const out = {};
  for (const id of ids) {
    const g = page.locator(`a[data-testid="job-ticket"][href="#/job/${id}"]`);
    await g.waitFor({ timeout: 20000 });
    const m = /\bVers (\d{1,2} h(?: \d{2})?)/i.exec(flat(await g.innerText()));
    out[id] = m ? m[1] : null;
  }
  return out;
}
/** the map tiles on screen: { tomtom, osm } loaded pictures */
const tilesShown = (page) => page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img.leaflet-tile')].filter((i) => i.complete && i.naturalWidth > 0);
  return { tomtom: imgs.filter((i) => i.src.startsWith('https://api.tomtom.com/map/1/tile/basic/main/')).length,
    osm: imgs.filter((i) => /^https:\/\/([a-c]\.)?tile\.openstreetmap\.org\//.test(i.src)).length, all: imgs.length };
});

module.exports = {
  PW, BROWSER_KEY, h, randomUUID, watch, onFail, noErrors, until, jwtOf, rpcAs, fnAs,
  control, calm, mockLog, clearMock, roadKm, ttMin, kmOf,
  json, home, bset, roadsState, roadsOn, forceRoads, timeOf, rowsAt, straight, snapshot, putBack,
  legOf, blockStart, stopsOf, walk, walkMismatches, etas, roadsOnByApi,
  clock, duration, km, flat, roadWords, NUMBER_OF_ROAD,
  openR, nothingLeft, endStep, answersOf, driveAnswersOf, agendaEtas, tilesShown,
  // also used by tests/e2e/deplacer.helpers.cjs (its own pictures and snapshot, the same outside world)
  fakeWorld
};
