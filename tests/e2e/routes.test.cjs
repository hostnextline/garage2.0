// « Vraies routes » (Part 27) end to end: the real app in a real browser against the local server, whose TomTom and OSRM
// are the fakes of tests/stack/mocks.mjs (their times differ on purpose from the planner's straight-line estimate, so a
// test can tell which one was used). The owner measures and switches the real roads on; the office books a new address
// (measured while the picker says so; the moments say the real driving; the arrival is the real one); TomTom and OSRM
// both down (nothing invented, the booking still goes); « Ordre des arrêts » and « La voiture ferme » show the server's
// order and times; the switch off again (the estimate of before; a plain save never flips it); and the browser's own
// TomTom key (tiles, routing, addresses: every request answered by the fakes of this file; tiles refused → OpenStreetMap's).
// This file's build has the browser key `tt-browser-test` (only this one: the 39 steps of app.test.cjs build without it).
// Every request of the browser to a host that is not 127.0.0.1 and not faked fails the step (routes.helpers.cjs).
// The world: Camion Complet works 8 h–20 h every day from tomorrow (closed today), Voiture is off; the appointments booked
// beforehand are 15 days ahead or more, so the two weeks the pickers offer are empty days. Each step starts from that world
// and leaves it as it found it (a snapshot put back after every step); the database is saved before the file and put
// back exactly as it was after (harness.cjs).
// Step 6b is the bug this file found (« e2e-routes B1 »: a map closed earlier in the visit kept the map on screen blank), fixed since.
//   bash tests/stack/mac/e2e-file.sh routes            (a Mac)   ·   node --test tests/e2e/routes.test.cjs   (Linux stack)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const x = require('./routes.helpers.cjs');
const { h, PW, randomUUID, clock, duration, km, flat, until } = x;
/** « vers 12 h » as a whole time (never the start of « vers 12 h 05 ») */
const vers = (m) => new RegExp(`vers ${clock(m)}(?! ?\\d)`);

const T = { complet: '7c1a0000-0000-4000-8000-000000000001', voiture: '7c1a0000-0000-4000-8000-000000000002' };
const SVC_OIL = '5e7a0000-0000-4000-8000-000000000001';   // 45 min
const who = {};
const C = {};          // customers: { id, lat, lng, first }
const J = {};          // the world's appointments: letter → job id
let H;                 // « Départ des camions »
let W, W2;             // the two days of the world's appointments (weekdays, 15 days ahead or more)
let originalCounts;

// a failing step leaves a picture of every open page and what it asked the server (tests/out/fail-routes-*); every step
// ends with its browsers closed, the fake TomTom and OSRM back to normal, and the world put back
const step = (name, fn) => test(name, async (t) => {
  try { await fn(t); } catch (e) { await x.onFail(name); throw e; } finally { await x.endStep(); }
});
/** a step that asserts the right behaviour but waits for a fix of the app (`why` starts with « BUG … »), as plages.test.cjs:
    ROUTES_RUN_SKIPPED=1 runs it */
step.skip = (name, why, fn) => (process.env.ROUTES_RUN_SKIPPED === '1' ? step(name, fn) : test(name, { skip: why }, fn));

const customer = (first, last, phone, p) => {
  const id = h.sql(`insert into public.customers (first_name, last_name, phone, address, lat, lng, lang, sms_ok)
    values ('${first}', '${last}', '${phone}', '${first} e2e, Montréal, QC', ${p ? p.lat : 'null'}, ${p ? p.lng : 'null'}, 'fr', true) returning id`);
  C[first] = { id, first, lat: p ? p.lat : null, lng: p ? p.lng : null };
  return C[first];
};
const near = (dlat, dlng) => ({ lat: Math.round((H.lat + dlat) * 1e6) / 1e6, lng: Math.round((H.lng + dlng) * 1e6) / 1e6 });
const day = (k) => h.sql(`select (public.local_today() + ${k})::text`);
const jobRow = (id) => x.json(`select row_to_json(j) from public.jobs j where id = '${id}'`);

before(async () => {
  originalCounts = h.rowCounts();
  h.saveDb();
  h.seed();
  const n = Date.now().toString(36);
  const person = async (key, name, short, roles) => {
    const email = `${key}-rt-${n}@test.local`;
    who[key] = { email, id: await h.makePerson({ email, password: PW, name, short, roles }) };
    who[key].jwt = await x.jwtOf(email);
  };
  await person('owner', 'Hassan Jeha', 'Hassan', ['owner']);
  await person('nadia', 'Nadia Bureau', 'Nadia', ['office']);
  // nothing measured yet, the switch off, the blocks (not the arrival windows), the fake TomTom and OSRM normal
  h.sql(`delete from public.drive_times`);
  h.sql(`delete from public.drive_spend`);
  h.sql(`delete from public.rate_limits where key like 'drive%'`);
  if (x.roadsOn()) x.forceRoads(false);
  assert.equal(h.sql(`select coalesce(booking->>'windows_on', 'false') from public.settings where id = 1`), 'false', 'blocks mode');
  await x.calm();
  H = x.home();
  // the days: Camion Complet 8 h–20 h from tomorrow to 30 days ahead (closed today: no block already started), Voiture off
  h.sql(`delete from public.truck_days where truck_id in ('${T.complet}', '${T.voiture}') and day between public.local_today() and public.local_today() + 30`);
  h.sql(`insert into public.truck_days (truck_id, day, ranges)
    select '${T.complet}'::uuid, d::date, case when d::date = public.local_today() then '[]'::jsonb else '[[480,1200]]'::jsonb end
    from generate_series(public.local_today(), public.local_today() + 30, interval '1 day') d
    union all select '${T.voiture}'::uuid, d::date, '[]'::jsonb from generate_series(public.local_today(), public.local_today() + 30, interval '1 day') d`);
  // the world's appointments: two weekdays 15 days ahead or more (rush hours on a working day), 6 to 12 km from the start
  W = h.sql(`select d::date::text from generate_series(public.local_today() + 15, public.local_today() + 22, interval '1 day') d where extract(isodow from d) between 1 and 4 limit 1`);
  W2 = h.sql(`select ('${W}'::date + 1)::text`);
  const places = { Alice: near(0.06, -0.09), Benoit: near(-0.05, -0.12), Chloe: near(-0.08, -0.05), Denis: near(0.07, 0.03), Emma: near(0.04, 0.10) };
  let k = 0;
  for (const [first, p] of Object.entries(places)) customer(first, 'Monde', `514 555-07${String(++k).padStart(2, '0')}`, p);
  const book = async (c, d, block) => (await x.rpcAs(who.owner.jwt, 'book_job', { p_op: randomUUID(), p_job: { customer_id: C[c].id, day: d, block, duration_min: 45 }, p_items: [] })).job_id;
  J.A = await book('Alice', W, 'am');
  J.B = await book('Benoit', W, 'pm');
  J.C = await book('Chloe', W, 'pm');
  J.D = await book('Denis', W2, 'am');
  J.E = await book('Emma', W2, 'pm');
  for (const id of Object.values(J)) assert.equal(jobRow(id).truck_id, T.complet, 'the world is on Camion Complet');
  // the new addresses of the steps (never measured): within about 3 km of the start, so their trips are under
  // roads_rush_min (15 min) and only ever have a usual-hours time
  customer('Amelie', 'Nouvelle', '514 555-0801', near(0.02, 0.02));
  customer('Bruno', 'Panne', '514 555-0802', near(-0.015, 0.025));
  customer('Sami', 'Adresse', '514 555-0803', null);
  // this file's build: WITH the browser key (the published app will have one); every TomTom request is faked
  process.env.VITE_TOMTOM_KEY = x.BROWSER_KEY;
  try { h.buildApp(); } finally { delete process.env.VITE_TOMTOM_KEY; }
  await h.startApp();
  x.snapshot('world');
});
after(async () => {
  await h.closeAll();
  h.stopApp();
  try { await x.calm(); } catch { /* mocks down */ }
  h.restoreDb();
  const now = h.rowCounts();
  const diff = Object.keys(originalCounts).filter((k) => originalCounts[k] !== now[k]);
  assert.deepEqual(diff, [], 'the database is back exactly as it was');
});

/** every drive_times row is a trip between two places of this world, with the mock's TomTom time and km (never the estimate) */
function rowsAreTheMocks(places) {
  const rows = x.json(`select coalesce(json_agg(json_build_object('a', a::text, 'b', b::text, 'slot', slot, 'minutes', minutes, 'km', km::float8, 'source', source)), '[]') from public.drive_times`);
  const byKey = new Map(places.map((p) => [h.sql(`select public.drive_key(${p.lat}, ${p.lng})::text`), p]));
  const bad = [];
  for (const r of rows) {
    const a = byKey.get(r.a), b = byKey.get(r.b);
    if (!a || !b) { bad.push(`unknown place ${r.a} → ${r.b}`); continue; }
    if (r.source !== 'tomtom' || r.minutes !== x.ttMin(a, b, r.slot) || (r.slot === 0 && r.km !== x.kmOf(a, b))) bad.push(`${JSON.stringify(r)} ≠ ${x.ttMin(a, b, r.slot)} min ${x.kmOf(a, b)} km`);
  }
  assert.deepEqual(bad, [], 'drive_times holds the mock’s TomTom times');
  return rows;
}
const worldPlaces = () => [H, ...['Alice', 'Benoit', 'Chloe', 'Denis', 'Emma'].map((f) => C[f])];

step('1. Réglages → Réservations, « Vraies routes »: the server has TomTom’s key and says how many trips are left; « Mesurer maintenant » measures them all; the switch goes on after its question and says how many moments were planned again (the arrivals are now the mock’s times, not the estimate)', async () => {
  // before: the arrival times are the estimate of before
  assert.deepEqual([...x.walkMismatches(W, false), ...x.walkMismatches(W2, false)], [], 'switch off: the arrivals are the estimate');
  const before0 = x.etas();
  const st0 = x.roadsState();
  assert.ok(st0.left0 > 0 && st0.on === false, JSON.stringify(st0));
  await x.clearMock();
  const r = await x.openR({ kind: 'desktop' });
  const { page } = r;
  const switched = x.answersOf(page, 'roads_switch');
  const drive = x.driveAnswersOf(page);
  await h.signIn(page, who.owner.email, PW);
  await page.goto(h.APP + '#/settings/booking');
  await page.getByTestId('booking-roads').waitFor({ timeout: 15000 });
  await page.getByTestId('roads-state').waitFor({ timeout: 20000 });
  assert.equal(flat(await page.getByTestId('roads-key').innerText()), 'Sur le serveur');
  assert.equal(flat(await page.getByTestId('roads-left').innerText()), flat(`${st0.left.toLocaleString('fr-CA')} (dont ${st0.left0.toLocaleString('fr-CA')} aux heures habituelles)`), 'the trips left, as the server counts them');
  assert.equal(flat(await page.getByTestId('roads-month').innerText()), flat(`${st0.month.tx.toLocaleString('fr-CA')} sur ${st0.month.cap.toLocaleString('fr-CA')} transactions`));
  assert.equal(await page.getByTestId('roads-switch').getAttribute('aria-checked'), 'false');
  await h.shot(page, 'routes-1-before');
  // « Mesurer maintenant »: runs to its end
  await page.getByTestId('roads-measure').click();
  const msg = page.getByTestId('roads-message');
  await msg.waitFor({ timeout: 90000 });
  assert.equal(flat(await msg.innerText()).replace(/\s*Fermer$/, ''), 'Tous les trajets à venir sont mesurés.');
  await page.getByTestId('roads-left').filter({ hasText: 'Aucun : tout est mesuré' }).waitFor({ timeout: 20000 });
  const st1 = x.roadsState();
  assert.deepEqual([st1.left, st1.left0], [0, 0], JSON.stringify(st1));
  const sweeps = drive.filter((d) => d.ask?.action === 'sweep');
  assert.ok(sweeps.length >= 1 && sweeps.every((d) => d.body?.ok === true), JSON.stringify(sweeps.map((d) => d.body)));
  assert.equal(sweeps[sweeps.length - 1].body.more, false, 'the last round says nothing more');
  const rows = rowsAreTheMocks(worldPlaces());
  assert.ok(rows.some((x0) => x0.slot === 1) && rows.some((x0) => x0.slot === 2), 'the rush hours of the weekdays are measured too');
  const matrix = (await x.mockLog()).filter((l) => l.svc === 'tomtom' && l.kind === 'matrix');
  assert.ok(matrix.length >= 1 && matrix.every((l) => l.traffic === 'historical'), JSON.stringify(matrix.map((l) => [l.origins, l.destinations, l.departAt])));
  assert.deepEqual([...new Set(matrix.map((l) => String(l.departAt).slice(10)))].sort(), ['T08:00:00', 'T11:30:00', 'T17:00:00'], 'the three times of a trip');
  // nothing planned again while the switch is off
  assert.deepEqual(x.etas(), before0, 'measuring moves no arrival time while the switch is off');
  await h.shot(page, 'routes-1-measured');
  // the switch, after its question
  await page.getByTestId('roads-switch').click();
  await page.getByTestId('ask-ok').click();
  await page.getByTestId('roads-switch').and(page.locator('[aria-checked="true"]')).waitFor({ timeout: 60000 });
  await until(() => switched.length, (n) => n > 0, 20000);
  const said = switched[switched.length - 1].body;
  assert.deepEqual([said.ok, said.on], [true, true], JSON.stringify(said));
  assert.ok(said.planned > 0, `the coming blocks are planned again: ${JSON.stringify(said)}`);
  const words = said.planned === 1 ? 'Vraies routes allumées : 1 moment replanifié.' : `Vraies routes allumées : ${said.planned} moments replanifiés.`;
  await page.getByTestId('roads-message').filter({ hasText: words }).waitFor({ timeout: 20000 });
  assert.equal(x.roadsOn(), true, 'settings.booking.roads_on');
  assert.equal(h.sql(`select data->>'planned' from public.activity where action = 'roads_switch' order by id desc limit 1`), String(said.planned), 'the activity row says the same');
  await h.shot(page, 'routes-1-on');
  // the arrival times are now the mock's TomTom times (the rush hour of the morning, the usual hours of the afternoon)
  assert.deepEqual([...x.walkMismatches(W, true), ...x.walkMismatches(W2, true)], [], 'switch on: the arrivals are the measured times');
  const after1 = x.etas();
  for (const id of Object.values(J)) assert.notEqual(after1[id], before0[id], `#${jobRow(id).number}: not the estimate any more`);
  // the agenda says those times
  const shown = await x.agendaEtas(page, W, [J.A, J.B, J.C]);
  for (const id of [J.A, J.B, J.C]) assert.equal(shown[id], clock(after1[id]), `#${jobRow(id).number} on the agenda`);
  await h.shot(page, 'routes-1-agenda');
  x.nothingLeft(r);
  x.noErrors(page);
});


step('2. The office books a NEW address with the switch on: the picker says it measures it; the moments offered say the real driving (drive_times = the mock’s TomTom times, not the estimate); « Voir sur la carte » says what it adds from the server’s row; booked, its arrival in the agenda is the real one', async () => {
  await x.roadsOnByApi(who.owner.jwt);
  const P = C.Amelie;
  assert.equal(x.rowsAt(P), 0, 'a new address: nothing measured');
  await x.clearMock();
  // TomTom answers in 3 s: the measure lasts long enough to be seen
  await x.control('tomtom_ms=3000');
  const r = await x.openR({ kind: 'desktop' });
  const { page } = r;
  const sugg = x.answersOf(page, 'suggest_blocks');
  const drive = x.driveAnswersOf(page);
  await h.signIn(page, who.nadia.email, PW);
  await page.goto(h.APP + `#/book?customer=${P.id}`);
  await page.getByTestId('book-screen').waitFor({ timeout: 15000 });
  await page.getByTestId(`svc-${SVC_OIL}`).click();
  // while the address is measured, the picker says so
  const measuring = page.getByTestId('roads-measuring');
  await measuring.waitFor({ timeout: 15000 });
  assert.match(flat(await measuring.innerText()), /^Mesure des routes vers cette adresse… Les suggestions se mettent à jour toutes seules\.$/);
  await h.shot(page, 'routes-2-measuring');
  await measuring.waitFor({ state: 'detached', timeout: 30000 });
  await x.control('tomtom_ms=0');
  const warm = drive.find((d) => d.ask?.action === 'warm' && d.ask?.only === 'point' && d.ask?.point?.lat === P.lat);
  assert.ok(warm && warm.body.ok && warm.body.ready, `the address measured first: ${JSON.stringify(drive.map((d) => [d.ask, d.body]))}`);
  // the trips of the address: the mock's TomTom times, each direction its own, never the estimate
  const go = x.timeOf(H, P), back = x.timeOf(P, H);
  assert.deepEqual(go, { minutes: x.ttMin(H, P), km: x.kmOf(H, P), source: 'tomtom' });
  assert.deepEqual(back, { minutes: x.ttMin(P, H), km: x.kmOf(P, H), source: 'tomtom' });
  assert.ok(go.minutes < 15 && back.minutes < 15, 'under roads_rush_min: no rush-hour time for these trips');
  const asked = (await x.mockLog()).filter((l) => l.svc === 'tomtom' && l.kind === 'matrix' && (l.from || []).concat(l.to || []).some((p) => p[0] === P.lat && p[1] === P.lng));
  assert.ok(asked.length >= 2, `TomTom was asked for the address: ${JSON.stringify(asked.map((l) => [l.origins, l.destinations]))}`);
  // the moments offered: the server's last answer, measured (the picker asks again by itself when the measure lands)
  const answered = await until(() => {
    const last = sugg.filter((s) => s.args?.p_lat === P.lat && Array.isArray(s.body)).pop();
    return last && last.body.length && last.body.every((m) => m.unmeasured === 0) ? last : null;
  }, (v) => !!v, 30000);
  assert.ok(answered, `suggest_blocks answered measured moments: ${JSON.stringify(sugg.map((s) => s.body))}`);
  const offered = answered.body.filter((m) => !m.far).slice(0, 6);
  const rowsOn = page.getByTestId('bp-sugg');
  await until(async () => (await rowsOn.count()) === offered.length && !(await page.locator('.bp-sugg-list.is-stale').count()), (v) => v, 20000);
  await until(async () => flat(await rowsOn.first().locator('.bp-sugg-sub').innerText()), (v) => v.startsWith(x.roadWords(offered[0])), 20000);
  const est = x.straight(H, P) + x.straight(P, H);
  const sub = await rowsOn.locator('.bp-sugg-sub').allInnerTexts();
  assert.equal(sub.length, offered.length, `${sub.length} moments on screen, ${offered.length} offered by the server`);
  offered.forEach((m, i) => {
    // an empty day of the truck: what the appointment adds is the trip there and back, TomTom's times at the usual hours
    assert.equal(m.stops, 0, `${m.day} ${m.block}: an empty day (the world is 15 days ahead)`);
    assert.equal(m.add_min, go.minutes + back.minutes, `${m.day} ${m.block}: adds the measured trips (${go.minutes} + ${back.minutes} min), not the estimate (${est})`);
    assert.equal(m.add_km, Math.round((go.km + back.km) * 10) / 10);
    assert.notEqual(m.add_min, est);
    assert.ok(flat(sub[i]).startsWith(x.roadWords(m)), `row ${i + 1} says « ${x.roadWords(m)} »: ${sub[i]}`);
  });
  await rowsOn.first().scrollIntoViewIfNeeded();
  await h.shot(page, 'routes-2-moments');
  // the first moment chosen; « Voir sur la carte » says what it adds from the server's row
  const first = offered[0];
  await rowsOn.first().click();
  await page.getByTestId('bp-see-map').click();
  const sheet = page.getByTestId('route-preview');
  await sheet.waitFor({ timeout: 15000 });
  assert.equal(flat(await page.getByTestId('route-preview-extra').innerText()), `Ce rendez-vous ajoute ${duration(first.add_min)} de route (${km(first.add_km)} km).`);
  assert.equal(flat(await page.getByTestId('route-preview-day').innerText()), `Route de la journée avec ce rendez-vous : ${km(first.day_km)} km, ${duration(first.day_min)}`);
  assert.equal(first.day_min, first.add_min, 'the whole day of the truck that day: there and back');
  // the sheet's map drawn: TomTom's tiles (this build's key) and the new stop's pin
  await until(() => x.tilesShown(page), (v) => v.tomtom > 0, 20000);
  await page.getByTestId('route-preview-map').locator('.leaflet-marker-icon').first().waitFor({ timeout: 15000 });
  await h.shot(page, 'routes-2-preview');
  await sheet.getByRole('button', { name: 'Fermer' }).first().click();
  await sheet.waitFor({ state: 'detached', timeout: 10000 });
  // booked: the arrival is the real one
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  const id = await until(() => h.sql(`select id from public.jobs where customer_id = '${P.id}' and status = 'booked' and deleted_at is null`), Boolean, 20000);
  const j = jobRow(id);
  assert.deepEqual([j.day, j.block], [first.day, first.block], 'the moment chosen');
  const start = x.blockStart(j.truck_id, j.day, j.block);
  assert.equal(j.eta_min, start.tm + go.minutes, `arrival = the block's start (${clock(start.tm)}) + TomTom's ${go.minutes} min`);
  assert.equal(j.travel_min, go.minutes + x.bset('stop_min', 5));
  assert.notEqual(j.eta_min, start.tm + x.straight(H, P), 'not the estimate');
  assert.deepEqual(x.walkMismatches(j.day, true), []);
  const shown = await x.agendaEtas(page, j.day, [id]);
  assert.equal(shown[id], clock(j.eta_min), 'the agenda says the real arrival');
  await h.shot(page, 'routes-2-agenda');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('3. TomTom and OSRM both down: a new address says « pas encore mesuré » where a time or a km would be, no number is invented; « Réserver » still books (with the fixed unknown time, never the estimate)', async () => {
  await x.roadsOnByApi(who.owner.jwt);
  const Q = C.Bruno;
  await x.control('tomtom=fail&osrm=fail');
  await x.clearMock();
  const r = await x.openR({ kind: 'desktop' });
  const { page } = r;
  const sugg = x.answersOf(page, 'suggest_blocks');
  const drive = x.driveAnswersOf(page);
  await h.signIn(page, who.nadia.email, PW);
  await page.goto(h.APP + `#/book?customer=${Q.id}`);
  await page.getByTestId('book-screen').waitFor({ timeout: 15000 });
  await page.getByTestId(`svc-${SVC_OIL}`).click();
  const failed = page.getByTestId('roads-failed');
  await failed.waitFor({ timeout: 30000 });
  assert.match(flat(await failed.innerText()), /^Les routes vers cette adresse ne sont pas encore mesurées\. Tu peux réserver quand même : le temps de route sera mis à jour\./);
  const warm = drive.find((d) => d.ask?.action === 'warm' && d.ask?.only === 'point');
  assert.ok(warm && warm.body.ok === true && warm.body.ready === false && warm.body.stored === 0, JSON.stringify(warm?.body));
  assert.deepEqual([warm.body.tomtom, warm.body.osrm], ['busy', 'down'], 'TomTom down (503 = busy), OSRM down');
  assert.equal(x.rowsAt(Q), 0, 'nothing stored for the address');
  const answered = await until(() => sugg.filter((s) => s.args?.p_lat === Q.lat && Array.isArray(s.body) && s.body.length).pop(), Boolean, 30000);
  assert.ok(answered, 'moments are still offered');
  const offered = answered.body.filter((m) => !m.far).slice(0, 6);
  for (const m of offered) assert.deepEqual([m.unmeasured > 0, m.add_km, m.far], [true, null, null], `${m.day} ${m.block}: not measured, no km, never « far » by a guess: ${JSON.stringify(m)}`);
  const rowsOn = page.getByTestId('bp-sugg');
  await until(async () => (await rowsOn.count()) === offered.length, (v) => v, 20000);
  for (const s of await rowsOn.locator('.bp-sugg-sub').allInnerTexts()) assert.ok(flat(s).startsWith('Route pas encore mesurée'), s);
  const picker = flat(await page.getByTestId('block-picker').innerText());
  assert.doesNotMatch(picker, x.NUMBER_OF_ROAD, 'no minute nor km of road anywhere in the picker');
  await rowsOn.first().scrollIntoViewIfNeeded();
  await h.shot(page, 'routes-3-unmeasured');
  await rowsOn.first().click();
  await page.getByTestId('bp-see-map').click();
  const sheet = page.getByTestId('route-preview');
  await sheet.waitFor({ timeout: 15000 });
  assert.equal(flat(await page.getByTestId('route-preview-extra').innerText()), 'Route ajoutée : pas encore mesurée');
  assert.equal(flat(await page.getByTestId('route-preview-day').innerText()), 'Route de la journée : pas encore mesurée');
  assert.doesNotMatch(flat(await page.getByTestId('route-preview-facts').innerText()), x.NUMBER_OF_ROAD);
  // the sheet's map drawn: TomTom's tiles (this build's key) and the new stop's pin
  await until(() => x.tilesShown(page), (v) => v.tomtom > 0, 20000);
  await page.getByTestId('route-preview-map').locator('.leaflet-marker-icon').first().waitFor({ timeout: 15000 });
  await h.shot(page, 'routes-3-preview');
  await sheet.getByRole('button', { name: 'Fermer' }).first().click();
  await sheet.waitFor({ state: 'detached', timeout: 10000 });
  // « Réserver » still books
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  const id = await until(() => h.sql(`select id from public.jobs where customer_id = '${Q.id}' and status = 'booked' and deleted_at is null`), Boolean, 20000);
  const j = jobRow(id);
  const start = x.blockStart(j.truck_id, j.day, j.block);
  const unknown = x.bset('unknown_min', 20);
  assert.equal(j.eta_min, start.tm + unknown, `arrival = the block's start + the fixed unknown time (${unknown} min)`);
  assert.notEqual(j.eta_min, start.tm + x.straight(H, Q), 'never the estimate');
  assert.equal(x.rowsAt(Q), 0);
  // decision 2 (2026-11-21): that time counts a trip not measured, so it is never said as a time (jobs.eta_measured false)
  assert.equal(j.eta_measured, false, 'the server says a trip before it is not measured');
  const said = await ticketOf(page, j.day, id);
  assert.match(said, /heure : trajets pas encore mesurés/i, said);
  assert.doesNotMatch(said, /\bVers \d/i, 'the fixed unknown time is not said as an arrival');
  await h.shot(page, 'routes-3-agenda');
  x.nothingLeft(r);
  x.noErrors(page);
});

/** the text of a job's ticket in the agenda's day (« Vers 9 h 40 », or « Heure : trajets pas encore mesurés ») */
async function ticketOf(page, d, id) {
  await page.goto(h.APP + `#/agenda/${d}?view=day`);
  await page.getByTestId('agenda-screen').waitFor();
  const g = page.locator(`a[data-testid="job-ticket"][href="#/job/${id}"]`);
  await g.waitFor({ timeout: 20000 });
  return flat(await g.innerText());
}

step('3b. Booked while TomTom and OSRM are down: the ticket says « heure : trajets pas encore mesurés », never the fixed unknown time; once the trips are measured the arrival appears, measured (decision 2)', async () => {
  await x.roadsOnByApi(who.owner.jwt);
  const Q = C.Bruno;
  await x.control('tomtom=fail&osrm=fail');
  const d = day(2);
  const id = (await x.rpcAs(who.nadia.jwt, 'book_job', { p_op: randomUUID(), p_job: { customer_id: Q.id, day: d, block: 'am', duration_min: 45 }, p_items: [] })).job_id;
  const before = jobRow(id);
  assert.equal(x.rowsAt(Q), 0, 'nothing measured for the address');
  assert.equal(before.eta_measured, false, `the server flags the arrival as not measured: ${JSON.stringify({ eta_min: before.eta_min, eta_measured: before.eta_measured })}`);
  const r = await x.openR({ kind: 'desktop' });
  const { page } = r;
  await h.signIn(page, who.nadia.email, PW);
  const unsure = await ticketOf(page, d, id);
  assert.match(unsure, /heure : trajets pas encore mesurés/i, unsure);
  assert.doesNotMatch(unsure, /\bVers \d/i, unsure);
  await h.shot(page, 'routes-3b-unsure');
  // TomTom and OSRM back: « Mesurer maintenant » (the sweep) measures the address and plans its day again
  await x.calm();
  let s = await x.fnAs(who.owner.jwt, 'drive', { action: 'sweep' }), n = 0;
  while (s.ok && s.more && n++ < 20) s = await x.fnAs(who.owner.jwt, 'drive', { action: 'sweep' });
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.ok(x.rowsAt(Q) > 0, 'the address is measured');
  const after = await until(() => jobRow(id), (j) => j.eta_measured === true, 20000);
  assert.equal(after.eta_measured, true, `measured: ${JSON.stringify({ eta_min: after.eta_min, eta_measured: after.eta_measured })}`);
  // the phone gets the new row at its next pull (no realtime on the test server): the page opened again
  const sure = await until(async () => { await page.reload(); return ticketOf(page, d, id); }, (t) => /\bVers \d/i.test(t), 60000);
  assert.match(sure, new RegExp(`\\bVers ${clock(after.eta_min)}(?! ?\\d)`, 'i'), sure);
  assert.doesNotMatch(sure, /pas encore mesurés/i, sure);
  await h.shot(page, 'routes-3b-measured');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('4a. « Réorganiser la journée » (Part 28; it replaced « Ordre des arrêts ») with the switch on: the times shown are the server’s (the measured ones); another order is previewed by the server, and saved it gives those very times', async () => {
  await x.roadsOnByApi(who.owner.jwt);
  assert.deepEqual(x.walkMismatches(W, true), []);
  const list = x.stopsOf(T.complet, W, 'pm');
  assert.equal(list.length, 2, 'two stops in the afternoon');
  const [one, two] = list;
  const r = await x.openR({ kind: 'desktop' });
  const { page } = r;
  const previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  await h.signIn(page, who.owner.email, PW);
  await page.goto(h.APP + `#/job/${one.id}`);
  await page.getByTestId('job-order').click();
  const sheet = page.getByTestId('dayorder-sheet');
  await sheet.waitFor({ timeout: 15000 });
  // the day as it is: the server's first answer, the times it wrote
  await until(() => previews.filter((a) => a.status === 200 && a.body && a.body.basis_ok).length, (v) => v > 0, 20000);
  for (const s of list) {
    const eta = sheet.getByTestId(`dayorder-eta-${s.number}`);
    await eta.filter({ hasText: vers(s.eta_min) }).waitFor({ timeout: 10000 });
  }
  // the second first (its row's menu, « Mettre en premier »): the server's times for that order
  await sheet.getByTestId(`dayorder-main-${two.number}`).click();
  await page.getByTestId('dayorder-menu').waitFor({ timeout: 10000 });
  await page.getByTestId('dayorder-menu-first').click();
  const mine = await until(() => previews.filter((a) => a.status === 200 && a.args && (a.args.p_moved || []).includes(two.id)).pop(), Boolean, 20000);
  assert.ok(mine, 'the sheet asked the server for that order');
  const pm = (mine.args.p_lists || []).find((l) => l.truck === T.complet && l.block === 'pm');
  assert.deepEqual(pm && pm.jobs, [two.id, one.id], 'the order asked: #2 then #1');
  // the oracle: the same question asked by the test as the same person
  const oracle = await x.rpcAs(who.owner.jwt, 'day_order_preview', mine.args);
  const byId = Object.fromEntries(oracle.stops.map((s) => [s.id, s]));
  const walked = x.walk(T.complet, W, 'pm', [two, one], true);
  for (const s of [two, one]) {
    assert.equal(byId[s.id].eta, walked[s.id].eta, `#${s.number}: the server's preview is the measured walk`);
    assert.equal(byId[s.id].measured, true, `#${s.number}: measured`);
    await sheet.getByTestId(`dayorder-eta-${s.number}`).filter({ hasText: vers(byId[s.id].eta) }).waitFor({ timeout: 10000 });
  }
  await h.shot(page, 'routes-4a-order');
  // « Enregistrer » (once more, « Enregistrer quand même », when the server says someone changes)
  const save = sheet.getByTestId('dayorder-save');
  await save.click();
  await until(async () => saves.length || /quand même/.test(await save.innerText().catch(() => '')), Boolean, 20000);
  if (!saves.length) await save.click();
  await until(() => saves.length, (v) => v > 0, 20000);
  assert.equal(saves[saves.length - 1].status, 200, JSON.stringify(saves[saves.length - 1].body));
  const saved = await until(() => x.stopsOf(T.complet, W, 'pm'), (v) => v[0]?.id === two.id && v.every((s) => s.eta_min === byId[s.id].eta), 20000);
  assert.deepEqual(saved.map((s) => [s.id, s.eta_min]), [[two.id, byId[two.id].eta], [one.id, byId[one.id].eta]], 'saved: the very times previewed');
  assert.deepEqual(h.sql(`select coalesce(string_agg(coalesce(manual_order::text, 'null'), ','), '') from public.jobs where id in ('${one.id}', '${two.id}')`), 'null,null', 'no order by hand written (C1)');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('4b. « La voiture ferme » with the switch on: the truck’s route that day is the server’s (its order, the arrival, the day’s road), and the move gives that arrival', async () => {
  const car = h.sql(`insert into public.trucks (name, active, sort, color, tire_machine) values ('Voiture ferme', true, 9, '#2F6FD0', false) returning id`);
  h.sql(`insert into public.truck_week (truck_id, dow, ranges) select '${car}', d, '[[480,720]]'::jsonb from generate_series(0, 6) d`);
  const big = h.sql(`insert into public.trucks (name, active, sort, color, tire_machine) values ('Camion ouvert', true, 8, '#D3000E', true) returning id`);
  h.sql(`insert into public.truck_week (truck_id, dow, ranges) select '${big}', d, '[[480,1200]]'::jsonb from generate_series(0, 6) d`);
  const X = h.sql(`select d::date::text from generate_series(public.local_today() + 2, public.local_today() + 9, interval '1 day') d where extract(isodow from d) between 1 and 5 limit 1`);
  const dowOf = h.sql(`select extract(dow from '${X}'::date)::int`);
  h.sql(`update public.truck_days set ranges = '[]' where truck_id = '${T.complet}' and day = '${X}'`);
  const cJ = customer('Jade', 'Voiture', '514 555-0811', near(0.03, -0.04));
  const cK = customer('Karl', 'Camion', '514 555-0812', near(0.045, -0.02));
  const cL = customer('Lina', 'Camion', '514 555-0813', near(0.01, -0.06));
  const job = h.sql(`insert into public.jobs (customer_id, day, block, status, truck_id, duration_min, stop_order) values ('${cJ.id}', '${X}', 'am', 'booked', '${car}', 45, 1) returning id`);
  h.sql(`insert into public.jobs (customer_id, day, block, status, truck_id, duration_min, stop_order) values ('${cK.id}', '${X}', 'am', 'booked', '${big}', 45, 1), ('${cL.id}', '${X}', 'am', 'booked', '${big}', 45, 2)`);
  await x.roadsOnByApi(who.owner.jwt);
  assert.equal(jobRow(job).truck_id, car, 'the appointment is the car’s');
  assert.deepEqual(x.walkMismatches(X, true), [], 'that day planned with the measured times');
  const r = await x.openR({ kind: 'desktop' });
  const { page } = r;
  const previews = x.answersOf(page, 'move_preview');
  await h.signIn(page, who.owner.email, PW);
  await page.goto(h.APP + `#/hours/${car}`);
  await page.getByTestId('hours-grid').waitFor({ timeout: 15000 });
  await page.getByTestId('hours-mode').locator('button').nth(0).click();
  await page.locator('[data-testid="hours-apply"] input[type=date]').fill(X);
  // erase that morning: a drag that starts on a lit cell turns the cells off
  const a = page.locator(`[data-testid="hours-grid"] [data-d="${dowOf}"][data-u="480"]`);
  const z = page.locator(`[data-testid="hours-grid"] [data-d="${dowOf}"][data-u="690"]`);
  await a.scrollIntoViewIfNeeded();
  const ab = await a.boundingBox(), zb = await z.boundingBox();
  await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.mouse.down();
  await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.getByTestId('hours-apply-btn').click();
  const sheet = page.getByTestId('close-day-sheet');
  await sheet.waitFor({ timeout: 15000 });
  await sheet.getByTestId('close-day-server').waitFor({ timeout: 20000 });
  const mine = await x.rpcAs(who.owner.jwt, 'move_preview', { p_truck: big, p_day: X, p_block: null, p_jobs: [job] });
  assert.equal(mine.unmeasured, 0, `every trip of that day measured: ${JSON.stringify(mine)}`);
  assert.ok(previews.some((p) => p.args?.p_truck === big && (p.args?.p_jobs || []).includes(job)), 'the sheet asked the server');
  const n = mine.order.indexOf(job) + 1;
  assert.ok(n > 0, JSON.stringify(mine));
  // the server's preview is the measured walk of the truck's morning with the appointment in it
  const order = mine.order.map((id) => x.json(`select json_build_object('id', j.id, 'lat', coalesce(j.lat, c.lat), 'lng', coalesce(j.lng, c.lng), 'dur', j.duration_min)
    from public.jobs j left join public.customers c on c.id = j.customer_id where j.id = '${id}'`));
  const walked = x.walk(big, X, 'am', order, true);
  for (const id of mine.order) assert.equal(mine.eta[id], walked[id].eta, `${id}: the preview's arrival is the measured walk`);
  assert.equal(flat(await sheet.getByTestId('close-day-place').innerText()), `arrêt ${n}, vers ${clock(mine.eta[job])}`);
  assert.equal(flat(await sheet.getByTestId('close-day-facts').innerText()), `${mine.order.length} arrêts ce jour-là. Route de la journée : ${km(mine.day_km)} km, ${duration(mine.day_min)}.`);
  await h.shot(page, 'routes-4b-close-day');
  await sheet.getByTestId('close-day-move').click();
  const moved = await until(() => jobRow(job), (v) => v.truck_id === big, 20000);
  assert.deepEqual([moved.truck_id, moved.day, moved.block, moved.status], [big, X, 'am', 'booked'], 'same day, same block, the truck');
  assert.equal(moved.eta_min, mine.eta[job], 'moved: the arrival previewed');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('5. The owner turns the switch off: the arrival times go back to the estimate; a plain save of another booking setting never flips the switch (on or off)', async () => {
  const before0 = x.etas();
  await x.roadsOnByApi(who.owner.jwt);
  const on1 = x.etas();
  for (const id of Object.values(J)) assert.notEqual(on1[id], before0[id], 'switch on: the measured times');
  const r = await x.openR({ kind: 'desktop' });
  const { page } = r;
  const switched = x.answersOf(page, 'roads_switch');
  await h.signIn(page, who.owner.email, PW);
  await page.goto(h.APP + '#/settings/booking');
  const sw = page.getByTestId('roads-switch');
  await sw.and(page.locator('[aria-checked="true"]')).waitFor({ timeout: 20000 });
  const tx = page.getByTestId('booking-roads_month_tx');
  const save = async (v) => {
    await tx.fill(String(v));
    await page.getByTestId('settings-save').click();
    await until(() => h.sql(`select booking->>'roads_month_tx' from public.settings where id = 1`), (s) => s === String(v), 20000);
    assert.equal(h.sql(`select booking->>'roads_month_tx' from public.settings where id = 1`), String(v), 'the other setting is saved');
  };
  // on: a plain save keeps it on
  await save(9000);
  assert.equal(x.roadsOn(), true, 'a plain save keeps the switch on');
  // off, after its question
  await sw.click();
  await page.getByTestId('ask-ok').click();
  await sw.and(page.locator('[aria-checked="false"]')).waitFor({ timeout: 60000 });
  await until(() => switched.length, (n) => n > 0, 20000);
  const said = switched[switched.length - 1].body;
  assert.deepEqual([said.ok, said.on], [true, false], JSON.stringify(said));
  const words = said.planned === 0 ? 'Retour à l’estimation.' : said.planned === 1 ? 'Retour à l’estimation : 1 moment replanifié.' : `Retour à l’estimation : ${said.planned} moments replanifiés.`;
  await page.getByTestId('roads-message').filter({ hasText: words }).waitFor({ timeout: 20000 });
  assert.equal(x.roadsOn(), false);
  assert.deepEqual([...x.walkMismatches(W, false), ...x.walkMismatches(W2, false)], [], 'switch off: the estimate again');
  assert.deepEqual(x.etas(), before0, 'the very arrival times of before');
  await h.shot(page, 'routes-5-off');
  // off: a plain save (the same screen, its draft loaded while it was on) keeps it off
  await save(8000);
  assert.equal(x.roadsOn(), false, 'a plain save keeps the switch off');
  const shown = await x.agendaEtas(page, W, [J.A, J.B, J.C]);
  for (const id of [J.A, J.B, J.C]) assert.equal(shown[id], clock(before0[id]), 'the agenda says the estimate again');
  x.nothingLeft(r);
  x.noErrors(page);
});

/** zoom in once on the map shown (new tiles are asked) */
async function zoomIn(page) {
  const z = page.locator('.leaflet-control-zoom-in').first();
  if (await z.count()) await z.click(); else await page.locator('.leaflet-container').first().dblclick();
}
/** TomTom refuses its tiles from now on; the map shown asks new ones (zoom): the next tile that fails is checked once,
    and the map changes to OpenStreetMap's. Answers the moment the refusal began */
async function refuseTiles(page, world) {
  world.tt.state.tiles = 'refuse';
  const at = Date.now();
  await zoomIn(page);
  await until(() => x.tilesShown(page), (v) => v.osm > 0 && v.tomtom === 0, 30000);
  const shown = await x.tilesShown(page);
  assert.ok(shown.osm > 0 && shown.tomtom === 0, `OpenStreetMap’s tiles now: ${JSON.stringify(shown)}; TomTom tiles asked since the refusal: ${JSON.stringify(world.tt.log.tiles.filter((t0) => t0.at >= at).map((t0) => t0.status))}; OpenStreetMap tiles asked: ${world.osm.length}; page errors: ${JSON.stringify(page.errors)}`);
  assert.ok(world.tt.log.tiles.some((t0) => t0.at >= at && t0.status === 401), 'a refused tile was asked (and checked)');
  return at;
}
/** after the change, it stays there: more zoom, another day's map; not one more TomTom tile asked */
async function staysOnOsm(page, world, at) {
  const ttTiles = world.tt.log.tiles.length;
  const osmFirst = world.osm.find((o) => o.at >= at).at;
  await zoomIn(page);
  await page.goto(h.APP + `#/map?day=${W2}`);
  await until(() => x.tilesShown(page), (v) => v.osm > 0, 30000);
  await page.waitForTimeout(1500);
  assert.equal((await x.tilesShown(page)).tomtom, 0, 'no TomTom tile on the next map');
  assert.equal(world.tt.log.tiles.length, ttTiles, 'no TomTom tile asked after the change');
  assert.ok(world.tt.log.tiles.every((t0) => t0.at <= osmFirst || t0.status === 401), 'every TomTom tile asked after the refusal was a refused one');
}
/** the map of a day with appointments, TomTom's tiles on it */
async function mapWithTomtom(page, world, d) {
  await page.goto(h.APP + `#/map?day=${d}`);
  await until(() => x.tilesShown(page), (v) => v.tomtom > 0, 30000);
  assert.ok((await x.tilesShown(page)).tomtom > 0, 'TomTom’s tiles on the map');
}
const FAKED = ['api.tomtom.com', 'a.tile.openstreetmap.org', 'b.tile.openstreetmap.org', 'c.tile.openstreetmap.org', 'tile.openstreetmap.org', 'router.project-osrm.org', 'routing.openstreetmap.de', 'photon.komoot.io', 'vpic.nhtsa.dot.gov'];

step('6. The build WITH a browser TomTom key: every request to api.tomtom.com is answered by the fakes; the map shows TomTom’s tiles and its roads; tiles refused (401) → OpenStreetMap’s, and it stays there; an address typed is found by TomTom; nothing leaves for a host that is not faked', async () => {
  const r = await x.openR({ kind: 'desktop' });
  const { page, world } = r;
  const tt = world.tt;
  tt.doors.push({ re: /jarry/i, door: { number: '2500', street: 'Rue Jarry E', city: 'Montréal', postal: 'H1Z 4M4', lat: 45.56052, lng: -73.60048 } });
  await h.signIn(page, who.owner.email, PW);
  // the map of a day with appointments: TomTom's tiles and TomTom's roads (the first map of this visit)
  await mapWithTomtom(page, world, W);
  assert.ok(tt.log.tiles.length > 0 && tt.log.tiles.every((t0) => t0.tileSize === '256' && t0.status === 200), 'TomTom’s tiles asked (tileSize 256, the browser key)');
  assert.equal(world.osm.length, 0, 'no OpenStreetMap tile while TomTom serves');
  assert.equal((await x.tilesShown(page)).osm, 0);
  await until(() => tt.log.route.length, (v) => v > 0, 30000);
  assert.ok(tt.log.route.every((q) => q.traffic === 'true' && q.travelMode === 'car' && q.departAt === `${W}T11:30:00`), `TomTom’s roads for that day: ${JSON.stringify(tt.log.route)}`);
  assert.equal(world.osrm.length, 0, 'OSRM not needed while TomTom answers');
  await h.shot(page, 'routes-6-tomtom-tiles');
  // TomTom refuses its tiles: this map changes to OpenStreetMap's, and it stays there
  const at = await refuseTiles(page, world);
  await h.shot(page, 'routes-6-osm-tiles');
  await staysOnOsm(page, world, at);
  await h.shot(page, 'routes-6-osm-next-day');
  // an address typed: found by TomTom's geocoding (Photon's fake knows nothing)
  await page.goto(h.APP + `#/customer/${C.Sami.id}`);
  await page.getByTestId('customer-edit').click();
  const edit = page.getByTestId('customer-edit-sheet');
  await edit.waitFor({ timeout: 15000 });
  // the sheet puts the cursor in its first box once it is open: typed before that, the address box loses it (and its list)
  await page.waitForFunction(() => !!document.activeElement?.closest('[data-testid="customer-edit-sheet"]'), null, { timeout: 10000 }).catch(() => undefined);
  const input = edit.getByTestId('address-input');
  await input.click();
  await input.pressSequentially('2500 rue Jarry', { delay: 20 });
  const option = edit.getByTestId('address-suggestions').locator('li', { hasText: /Jarry/ }).first();
  await option.waitFor({ timeout: 20000 }).catch(() => {
    throw new Error(`no suggestion: TomTom asked ${JSON.stringify(tt.log.geocode)}, Photon asked ${JSON.stringify(world.photon)}, outside ${JSON.stringify(world.outside)}`);
  });
  assert.match(flat(await option.innerText()), /2500 [Rr]ue Jarry Est/, 'TomTom’s door, its side written out');
  await h.shot(page, 'routes-6-address');
  await option.click();
  await page.getByTestId('customer-save').click();
  const saved = await until(() => x.json(`select json_build_object('lat', lat, 'lng', lng, 'address', address) from public.customers where id = '${C.Sami.id}'`), (v) => v && v.lat != null, 20000);
  assert.deepEqual([saved.lat, saved.lng], [45.56052, -73.60048], `TomTom’s position: ${JSON.stringify(saved)}`);
  const g = tt.log.geocode.filter((q) => /jarry/i.test(q.q));
  assert.ok(g.length > 0 && g.every((q) => q.countrySet === 'CA' && q.language === 'fr-FR' && q.typeahead === null), JSON.stringify(tt.log.geocode));
  x.nothingLeft(r);
  // what the browser asked outside, host by host: only faked hosts
  const outsideHosts = Object.keys(world.hosts).filter((k) => !k.startsWith('127.0.0.1'));
  assert.ok(outsideHosts.every((k) => FAKED.includes(k)), JSON.stringify(world.hosts));
  x.noErrors(page);
});

// Found by this file (e2e-routes B1) and fixed in src/shared/map/MapView.tsx: the screen's cleanup drops every listener of a
// map before removing it, so a map closed earlier in the visit used to stay in the list of « maps showing TomTom's tiles »;
// when TomTom then refused, changing that dead map threw and the map on screen stayed blank.
step('6b. TomTom’s tiles refused after another map was opened and closed in the same visit: the map on screen changes to OpenStreetMap’s too (no blank map)', async () => {
  const r = await x.openR({ kind: 'desktop' });
  const { page, world } = r;
  await h.signIn(page, who.owner.email, PW);
  await mapWithTomtom(page, world, W);
  // another screen (the map goes), then the map again
  await page.goto(h.APP + `#/agenda/${W}?view=day`);
  await page.getByTestId('agenda-screen').waitFor({ timeout: 15000 });
  await mapWithTomtom(page, world, W);
  const at = await refuseTiles(page, world);
  await staysOnOsm(page, world, at);
  x.nothingLeft(r);
  x.noErrors(page);
});
