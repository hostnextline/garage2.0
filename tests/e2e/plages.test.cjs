// « Plages d'arrivée » end to end (the mode ON on live since 2026-11-15): the owner switches it on, the office books
// windows (what the screen offers is what the server answers), the planner orders the day, a flexible appointment gets
// its window, moves tell the customer only what changed, the mechanic's day, no signal, a truck that starts late, the
// way back to the blocks and on again. One garage, one truck working the days used (so a day is one route), the real
// server, GoHighLevel faked (it keeps every text). The database is saved before and put back exactly as it was after.
//   bash tests/stack/start.sh && node --test tests/e2e/plages.test.cjs
// Steps waiting for a fix are kept (step.skip, « BUG … » / « WAITS … »): PLAGES_RUN_SKIPPED=1 runs them too.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const x = require('./plages.helpers.cjs');
const { h, PW, openW, appOnPhone, until, until2, jwtOf, rpcAs, noErrors, dismissSheets, clock, between, longDay, median, jobOf, stopsOf, sentTo, textsTo,
  gridAnswered, listAnswered, offeredTimes, offeredStarts, serverWindows, pickWindow, bookStart, agendaSays, mapSays, randomUUID } = x;

// a failing step leaves a picture of every open page and what it asked the server (tests/out/fail-plages-*)
const step = (name, fn) => test(name, async (t) => {
  try { await fn(t); } catch (e) { await x.onFail(name); throw e; }
});
/** a step that asserts the right behaviour but waits for a fix: `why` starts with « BUG <id> » or « WAITS <id> » */
step.skip = (name, why, fn) => (process.env.PLAGES_RUN_SKIPPED === '1' ? step(name, fn) : test(name, { skip: why }, fn));

const T = { complet: '7c1a0000-0000-4000-8000-000000000001', voiture: '7c1a0000-0000-4000-8000-000000000002' };
const SVC = {
  oil: '5e7a0000-0000-4000-8000-000000000001',          // 45 min
  diag1h: '5e7a0000-0000-4000-8000-000000000007',       // 60 min
  promo: '5e7a0000-0000-4000-8000-000000000010',        // 120 min
  promo2: '5e7a0000-0000-4000-8000-000000000011'        // 75 min
};
const LONG = [SVC.promo, SVC.promo2, SVC.diag1h];        // 255 min: two of them never arrive in the same 4-hour window
const who = {};
const C = {};                                            // customers: { id, lat, lng, first }
const D = [];                                            // D[k] = today + k
const J = {};                                            // the appointments made by the steps
let originalCounts;

const customer = (first, last, phone, lat, lng) => {
  const id = h.sql(`insert into public.customers (first_name, last_name, phone, address, lat, lng, lang, sms_ok)
    values ('${first}', '${last}', '${phone}', '${first} e2e, Montréal, QC', ${lat}, ${lng}, 'fr', true) returning id`);
  C[first] = { id, lat, lng, first };
};

before(async () => {
  originalCounts = h.rowCounts();
  h.saveDb();
  h.seed();
  const n = Date.now().toString(36);
  const person = async (key, name, short, roles, truck = null) => {
    const email = `${key}-pl-${n}@test.local`;
    who[key] = { email, id: await h.makePerson({ email, password: PW, name, short, roles, truck }) };
  };
  await person('owner', 'Hassan Jeha', 'Hassan', ['owner']);
  await person('nadia', 'Nadia Bureau', 'Nadia', ['office']);
  await person('mira', 'Mira Bureau', 'Mira', ['office']);
  await person('saleh', 'Saleh Ismail', 'Saleh', ['mechanic'], 'Camion Complet');
  for (let k = 0; k <= 6; k++) D[k] = h.sql(`select (public.local_today() + ${k})::text`);
  // the days used: Camion Complet works 8 h to 20 h, the car does not work (whatever the day of the week: one route a day)
  for (const d of D) {
    h.sql(`delete from public.truck_days where day = '${d}' and truck_id in ('${T.complet}', '${T.voiture}')`);
    h.sql(`insert into public.truck_days (truck_id, day, ranges) values ('${T.complet}', '${d}', '[[480,1200]]'), ('${T.voiture}', '${d}', '[]')`);
  }
  // the texts go out through GoHighLevel (the fake one keeps them)
  h.sql(`insert into public.secrets (key, value) values ('ghl_token', 'pit-abcdef1234567890'), ('ghl_location', 'LOC12345678') on conflict (key) do update set value = excluded.value`);
  // tomorrow's flexible windows are fixed by « Fixer les plages de demain » in step 4, never by the evening's lock (18 h)
  h.sql(`update public.settings set booking = booking || '{"win_lock_min": 1439}'::jsonb where id = 1`);
  customer('Julie', 'Tremblay', '514 555-0241', 45.5205, -73.6489);
  customer('Amira', 'Benali', '514 555-0242', 45.5150, -73.6400);
  customer('Bruno', 'Lefebvre', '514 555-0243', 45.5100, -73.6550);
  customer('Carla', 'Gagnon', '514 555-0244', 45.5080, -73.6250);
  customer('Dina', 'Haddad', '514 555-0245', 45.5050, -73.6300);
  customer('Eric', 'Roy', '514 555-0246', 45.5250, -73.6450);
  customer('Farah', 'Nasser', '514 555-0247', 45.5180, -73.6600);
  customer('Ines', 'Moreau', '514 555-0248', 45.5120, -73.6700);
  customer('Gilles', 'Martin', '514 555-0249', 45.5060, -73.6450);
  customer('Hugo', 'Côté', '514 555-0250', 45.5160, -73.6480);
  customer('Jade', 'Pelletier', '514 555-0251', 45.5110, -73.6350);
  customer('Karl', 'Dubois', '514 555-0252', 45.5140, -73.6520);
  customer('Lina', 'Bouchard', '514 555-0253', 45.5090, -73.6420);
  // Julie booked last week, by blocks: Thursday-like afternoon (12 h – 16 h) four days from now
  who.nadia.jwt = await jwtOf(who.nadia.email);
  const b = await rpcAs(who.nadia.jwt, 'book_job', { p_op: randomUUID(), p_job: { customer_id: C.Julie.id, day: D[4], block: 'pm', duration_min: 45 },
    p_items: [{ kind: 'service', service_id: SVC.oil, description: 'Changement d’huile (5 L)', qty: 1, unit_cents: 8000 }] });
  J.julie = b.job_id;
  h.buildApp();
  await h.startApp();
  await h.clearMock();
});
after(async () => {
  await h.closeAll();
  h.stopApp();
  h.restoreDb();
  const now = h.rowCounts();
  const diff = Object.keys(originalCounts).filter((k) => originalCounts[k] !== now[k]);
  assert.deepEqual(diff, [], 'the database is back exactly as it was');
});

/** Réglages → Réservations, « Réserver par plages d’arrivée »: the switch, its question, the server's answer in words
    (« Plages d’arrivée allumées : 1 rendez-vous à venir converti. » / « Retour aux blocs : … »); answers those words */
async function flipSwitch(page, want) {
  await page.goto(h.APP + '#/settings/booking');
  const sw = page.getByTestId('windows-switch');
  await sw.waitFor({ timeout: 15000 });
  assert.equal(await sw.getAttribute('aria-checked'), String(!want));
  await sw.click();
  await page.getByTestId('ask-ok').click();
  const toast = page.getByTestId('toast-ok').filter({ hasText: want ? /Plages d’arrivée allumées/ : /Retour aux blocs/ });
  await toast.waitFor({ timeout: 30000 });
  const said = await toast.innerText();
  assert.equal(await sw.getAttribute('aria-checked'), String(want));
  assert.equal(h.sql(`select booking->>'windows_on' from public.settings where id = 1`), String(want));
  return said;
}

/** books one customer by window on the computer: the day's windows on screen are the server's, the window chosen is
    the one booked; answers how long the screen waited for that day's windows */
async function bookWindow(page, t, c, day, choose, services = [SVC.oil], duration = 45) {
  const t0 = await bookStart(page, c.first, services);
  await gridAnswered(page, day);
  const waited = Date.now() - t0;
  const times = await offeredTimes(page, day, 'grid');
  const screen = offeredStarts(times);
  const server = await serverWindows(who.nadia.jwt, c, day, duration);
  assert.deepEqual(screen.map(clock), server.map(clock), `${day}: the windows on screen are the ones suggest_windows answers`);
  const ws = choose(screen);
  await pickWindow(page, day, ws, 'grid');
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  const id = h.sql(`select id from public.jobs where customer_id = '${c.id}' and day = '${day}' and status = 'booked' and deleted_at is null order by created_at desc limit 1`);
  assert.ok(id, `${c.first} is booked on ${day}`);
  t.diagnostic(`${c.first}: the screen showed the windows of ${day} ${(waited / 1000).toFixed(1)} s after the work was chosen`);
  return { id, ws, waited, screen };
}

step('Réglages: the owner switches « Plages d’arrivée » on; Julie’s coming afternoon becomes her day with the window 12 h – 16 h, on the agenda and in the database', async (t) => {
  const was = jobOf(J.julie);
  assert.deepEqual([was.day, was.block, was.win_start], [D[4], 'pm', null], 'booked by blocks');
  const { page, ctx } = await openW({ kind: 'desktop' });
  const t0 = Date.now();
  await h.signIn(page, who.owner.email, PW);
  t.diagnostic(`signed in after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const said = await flipSwitch(page, true);
  t.diagnostic(`switched on after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  assert.match(said, /1 rendez-vous à venir converti/);
  const j = jobOf(J.julie);
  assert.deepEqual([j.day, j.block, j.win_start, j.win_end, j.win_flex], [D[4], 'day', 720, 960, false], 'her day, the window of her old block');
  assert.ok(j.eta_min >= 720 && j.eta_min <= 960, `planned inside her window: ${clock(j.eta_min)}`);
  // the settings of the windows are shown once on (before / after, the hours of the day, « Fixer les plages de demain »)
  await page.getByTestId('windows-lock').waitFor();
  // the agenda of her day: her window
  const a = await agendaSays(page, D[4], [J.julie]);
  t.diagnostic(`agenda read after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  assert.deepEqual(a[J.julie].win, [720, 960], `the agenda says 12 h – 16 h: ${a[J.julie].label}`);
  assert.equal(a[J.julie].eta, j.eta_min, 'and the arrival the server planned');
  await h.shot(page, 'plages-1-switch-on');
  noErrors(page);
  await ctx.close();
});

step('the office books Amira: the windows offered for her day are the server’s; she takes 12 h – 16 h; the agenda and the text say it', async (t) => {
  const { page, ctx } = await openW({ kind: 'desktop' });
  await h.signIn(page, who.nadia.email, PW);
  const sugg = Date.now();
  const r = await bookWindow(page, t, C.Amira, D[2], (s) => (s.includes(720) ? 720 : s[s.length - 1]));
  // how long the screen waits for the windows offered (measured, not asserted: suggest_windows was 3 to 4 times slower than live)
  const net = page.sw;
  t.diagnostic(`TIMING windows offered: the day on screen ${(r.waited / 1000).toFixed(1)} s after the work was chosen; suggest_windows on the network: ${net.length} requests, median ${(median(net) / 1000).toFixed(2)} s, slowest ${(Math.max(0, ...net) / 1000).toFixed(2)} s`);
  console.log(`# TIMING windows offered (step 2): ${(r.waited / 1000).toFixed(1)} s on screen; suggest_windows median ${(median(net) / 1000).toFixed(2)} s, slowest ${(Math.max(0, ...net) / 1000).toFixed(2)} s over ${net.length} requests (${((Date.now() - sugg) / 1000).toFixed(1)} s for the whole booking)`);
  J.amira = r.id;
  const j = jobOf(r.id);
  assert.deepEqual([j.day, j.block, j.win_start, j.win_end, j.win_flex, j.truck_id], [D[2], 'day', r.ws, r.ws + 240, false, T.complet]);
  assert.ok(j.eta_min >= j.win_start && j.eta_min <= j.win_end, `planned inside the window: ${clock(j.eta_min)}`);
  assert.equal(Number(h.sql(`select count(*) from public.job_items where job_id = '${r.id}' and service_id = '${SVC.oil}'`)), 1);
  // the job screen says the window told
  assert.match(await page.getByTestId('job-window').innerText(), new RegExp(`${clock(r.ws)}.*${clock(r.ws + 240)}`));
  // the confirmation went by itself, once, and says the window in words
  const sms = await until2(() => textsTo('Amira', /confirmé/), (l) => l.length >= 1, 20000);
  assert.equal(sms.length, 1, 'one confirmation');
  assert.ok(sms[0].includes(`${longDay(D[2])}, ${between(r.ws, r.ws + 240)}`), `the text says the day and the window: ${sms[0]}`);
  assert.doesNotMatch(sms[0], /\{|\}|le matin|l’après-midi|le soir/, 'no block word, nothing left unfilled');
  assert.equal(sentTo(r.id, 'booking').length, 1, 'kept with the job');
  const a = await agendaSays(page, D[2], [r.id]);
  assert.deepEqual(a[r.id].win, [r.ws, r.ws + 240], `on the agenda with its window: ${a[r.id].label}`);
  await h.shot(page, 'plages-2-booked');
  noErrors(page);
  await ctx.close();
});

step('a second and a third appointment the same day: the planner orders the stops; the agenda, the map and Saleh’s phone say the same order and times as the database', async (t) => {
  const { page, ctx } = await openW({ kind: 'desktop' });
  await h.signIn(page, who.nadia.email, PW);
  // Bruno: the morning; Carla: mid-day
  J.bruno = (await bookWindow(page, t, C.Bruno, D[2], (s) => s[0])).id;
  J.carla = (await bookWindow(page, t, C.Carla, D[2], (s) => (s.includes(600) ? 600 : s[1] ?? s[0]))).id;
  const stops = stopsOf(D[2]);
  assert.deepEqual(stops.map((s) => s.id).sort(), [J.amira, J.bruno, J.carla].sort(), 'three appointments that day');
  assert.ok(stops.every((s) => s.truck_id === T.complet), 'on the same truck');
  assert.deepEqual(stops.map((s) => s.stop_order), [1, 2, 3], 'numbered 1, 2, 3');
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    assert.ok(s.eta_min >= s.win_start && s.eta_min <= s.win_end, `stop ${s.stop_order} arrives inside its window: ${clock(s.eta_min)} in ${clock(s.win_start)} – ${clock(s.win_end)}`);
    if (i) assert.ok(s.eta_min > stops[i - 1].eta_min, 'each stop after the one before');
  }
  // the agenda
  const a = await agendaSays(page, D[2], stops.map((s) => s.id));
  for (const s of stops) assert.deepEqual([a[s.id].stop, a[s.id].eta, a[s.id].win], [s.stop_order, s.eta_min, [s.win_start, s.win_end]], `the agenda: ${a[s.id].label}`);
  // (opening a day may plan it again: what the screens say is compared with the database as it is now)
  const now = stopsOf(D[2]);
  assert.deepEqual(now.map((s) => [s.id, s.stop_order, s.eta_min]), stops.map((s) => [s.id, s.stop_order, s.eta_min]), 'the agenda changed nothing');
  // the map: the same order, the same numbers and times
  const m = await mapSays(page, D[2], T.complet);
  assert.deepEqual(m.map((s) => s.id), stops.map((s) => s.id), 'the map draws the stops in the same order');
  m.forEach((s, i) => {
    assert.equal(s.n, String(stops[i].stop_order), `stop number ${s.n}`);
    assert.ok(s.sub.includes(`vers ${clock(stops[i].eta_min)}`), `the map says the arrival: ${s.sub}`);
    assert.ok(s.sub.includes(clock(stops[i].win_start)) && s.sub.includes(clock(stops[i].win_end)), `and the window: ${s.sub}`);
  });
  await h.shot(page, 'plages-3-map');
  noErrors(page);
  await ctx.close();
  // Saleh's « Ma journée »: the day is not today, so its first stop is shown under « Demain » / the next working day
  const ph = await openW({ kind: 'phone' });
  await h.signIn(ph.page, who.saleh.email, PW);
  await ph.page.getByTestId('today-screen').waitFor();
  const ahead = ph.page.getByTestId('today-ahead');
  await ahead.locator(`a[href="#/job/${stops[0].id}"]`).waitFor({ timeout: 20000 });
  const words = await ahead.innerText();
  assert.ok(words.includes(`ers ${clock(stops[0].eta_min)}`), `his phone says the first stop’s arrival: ${words}`);
  noErrors(ph.page);
  await ph.ctx.close();
});

step('« Flexible »: Dina is booked for tomorrow without a window; « Fixer les plages de demain » gives her one and texts it, once', async (t) => {
  const { page, ctx } = await openW({ kind: 'desktop' });
  await h.signIn(page, who.nadia.email, PW);
  await bookStart(page, 'Dina', [SVC.oil]);
  await gridAnswered(page, D[1]);
  // the day chosen in the grid's head, then « Flexible » under the calendar
  await page.getByTestId(`pick-day-${D[1]}`).click();
  const panel = page.locator(`[data-testid="win-day-panel"][data-day="${D[1]}"]`);
  await panel.waitFor();
  await panel.getByTestId('book-flex').click();
  assert.equal(await panel.getByTestId('book-flex').getAttribute('aria-checked'), 'true');
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  J.dina = h.sql(`select id from public.jobs where customer_id = '${C.Dina.id}' and status = 'booked' and deleted_at is null`);
  let j = jobOf(J.dina);
  assert.deepEqual([j.day, j.block, j.win_flex, j.win_start, j.win_end], [D[1], 'day', true, null, null], 'flexible: no window yet');
  assert.ok(j.eta_min != null && j.truck_id === T.complet, 'placed on the route all the same');
  const booked = await until2(() => textsTo('Dina', /confirmé/), (l) => l.length >= 1, 20000);
  assert.equal(booked.length, 1);
  assert.ok(booked[0].includes('dans la journée ; nous vous confirmons la veille une plage de 4 heures'), `the confirmation says « flexible » in words: ${booked[0]}`);
  assert.match(await page.getByTestId('job-window').innerText(), /flexible|journée|veille/i, 'the job says it has no window yet');
  await ctx.close();
  // the evening before: the owner fixes tomorrow's windows
  const o = await openW({ kind: 'desktop' });
  await h.signIn(o.page, who.owner.email, PW);
  await o.page.goto(h.APP + '#/settings/booking');
  await o.page.getByTestId('windows-lock').click();
  await o.page.getByTestId('toast-ok').filter({ hasText: /plage/i }).waitFor({ timeout: 30000 });
  j = await until(() => jobOf(J.dina), (v) => v.win_start != null, 15000);
  assert.ok(j.win_start != null && j.win_end === j.win_start + 240, 'a 4-hour window');
  assert.ok(j.eta_min >= j.win_start && j.eta_min <= j.win_end, `around her planned arrival: ${clock(j.eta_min)} in ${clock(j.win_start)} – ${clock(j.win_end)}`);
  assert.equal(Number(h.sql(`select count(*) from public.activity where entity_id = '${J.dina}' and action = 'window_fixed'`)), 1, 'noted once');
  J.dinaWin = [j.win_start, j.win_end];
  const fixed = await until2(() => textsTo('Dina', /plage d’arrivée est confirmée/), (l) => l.length >= 1, 20000);
  assert.equal(fixed.length, 1, 'her window is texted');
  assert.ok(fixed[0].includes(between(j.win_start, j.win_end)), `in words: ${fixed[0]}`);
  assert.equal(sentTo(J.dina, 'window').length, 1);
  // a second tap: nothing new to fix; the app asks to tell Dina again (her window is fixed and she is « flexible »), the
  // server answers that she already has it: nobody is texted twice
  const told = o.page.waitForResponse((r) => /\/functions\/v1\/notify/.test(r.url()) && r.request().postData()?.includes(J.dina), { timeout: 20000 });
  await o.page.getByTestId('windows-lock').click();
  const again = await (await told).json();
  t.diagnostic(`second « Fixer »: notify answered ${JSON.stringify({ ok: again.ok, status: again.status })}`);
  assert.equal((await textsTo('Dina', /plage d’arrivée est confirmée/)).length, 1, 'the same window is never texted twice');
  assert.equal(sentTo(J.dina, 'window').length, 1);
  // the job screen now says her window
  await o.page.goto(h.APP + `#/job/${J.dina}`);
  await o.page.getByTestId('job-window').filter({ hasText: clock(j.win_start) }).waitFor({ timeout: 15000 });
  t.diagnostic(`Dina: flexible, then ${clock(j.win_start)} – ${clock(j.win_end)}`);
  noErrors(o.page);
  await o.ctx.close();
});

step('« Déplacer »: Carla to another window the same day, then to another day: each time she is told once, the new moment in words', async () => {
  const { page, ctx } = await openW({ kind: 'desktop' });
  await h.signIn(page, who.nadia.email, PW);
  const before = jobOf(J.carla);
  const moved = () => textsTo('Carla', /a changé/);
  assert.equal((await moved()).length, 0);
  const move = async (day, choose) => {
    await page.goto(h.APP + `#/job/${J.carla}`);
    await page.getByTestId('job-move').click({ timeout: 15000 });
    const sheet = page.getByTestId('move-sheet');
    await sheet.waitFor();
    await gridAnswered(page, day);
    const times = await offeredTimes(page, day, 'grid');
    const screen = offeredStarts(times);
    assert.deepEqual(screen.map(clock), (await serverWindows(who.nadia.jwt, C.Carla, day, 45, J.carla)).map(clock), `${day}: the windows offered to move her are the server’s`);
    const ws = choose(screen);
    await pickWindow(page, day, ws, 'grid');
    await page.getByTestId('move-ok').click();
    await sheet.waitFor({ state: 'detached', timeout: 20000 });
    return ws;
  };
  // the same day, another window
  const ws1 = await move(D[2], (s) => s.find((w) => w !== before.win_start && w >= 780) ?? s.find((w) => w !== before.win_start));
  let j = await until(() => jobOf(J.carla), (v) => v.win_start === ws1, 15000);
  assert.deepEqual([j.day, j.win_start, j.win_end], [D[2], ws1, ws1 + 240]);
  let sms = await until2(moved, (l) => l.length >= 1, 20000);
  await until2(moved, (l) => l.length > 1, 3000);
  sms = await moved();
  assert.equal(sms.length, 1, 'told once');
  assert.ok(sms[0].includes(between(ws1, ws1 + 240)), `the new window in words: ${sms[0]}`);
  // another day
  const ws2 = await move(D[3], (s) => s[0]);
  j = await until(() => jobOf(J.carla), (v) => v.day === D[3], 15000);
  assert.deepEqual([j.day, j.block, j.win_start, j.win_end], [D[3], 'day', ws2, ws2 + 240]);
  sms = await until2(moved, (l) => l.length >= 2, 20000);
  await until2(moved, (l) => l.length > 2, 3000);
  sms = await moved();
  assert.equal(sms.length, 2, 'told once more, not twice');
  assert.ok(sms[1].includes(longDay(D[3])) && sms[1].includes(between(ws2, ws2 + 240)), `the new day and window: ${sms[1]}`);
  assert.equal(sentTo(J.carla, 'moved').length, 2);
  // the day she left is planned again: the two others are stops 1 and 2
  assert.deepEqual(stopsOf(D[2]).map((s) => s.stop_order), [1, 2]);
  noErrors(page);
  await ctx.close();
});

// R84: « Déplacer » texts the customer only when move_job answers tell === true. Dina was told her window the evening
// before (step 4); the office opens « Déplacer » and takes that same window (she is no longer « flexible »): nothing
// changed for her (the server answers changed: false, tell: false), no text. Today the sheet texts on « not unchanged ».
step.skip('« Déplacer » to the window the customer was already told: nothing new for her, no text', 'WAITS R84: MoveSheet texts on !unchanged instead of tell === true', async () => {
  const { page, ctx } = await openW({ kind: 'desktop' });
  await h.signIn(page, who.nadia.email, PW);
  const [ws] = J.dinaWin;
  const moved = () => textsTo('Dina', /a changé/);
  assert.equal((await moved()).length, 0);
  await page.goto(h.APP + `#/job/${J.dina}`);
  await page.getByTestId('job-move').click({ timeout: 15000 });
  await page.getByTestId('move-sheet').waitFor();
  await gridAnswered(page, D[1]);
  await pickWindow(page, D[1], ws, 'grid');
  const answer = page.waitForResponse((r) => /\/rpc\/move_job/.test(r.url()), { timeout: 20000 });
  await page.getByTestId('move-ok').click();
  const body = await (await answer).json();
  assert.equal(body.tell, false, `the server says there is nothing to tell: ${JSON.stringify({ changed: body.changed, tell: body.tell, unchanged: body.unchanged })}`);
  const j = jobOf(J.dina);
  assert.deepEqual([j.day, j.win_start, j.win_end, j.win_flex], [D[1], ws, ws + 240, false], 'her window, now fixed');
  await until2(moved, (l) => l.length > 0, 6000);
  assert.equal((await moved()).length, 0, 'no « moved » text: she already knows her window');
  noErrors(page);
  await ctx.close();
});

step('Saleh’s day by windows: start, « Je pars », « Je suis arrivé », signature, invoice, payment, « Terminer »; the next stop; the same order and times as the database', async () => {
  // Amira and Bruno's day becomes today (the planner's order and times kept), so it is Saleh's day
  h.sql(`update public.jobs set day = public.local_today() where id in ('${J.amira}', '${J.bruno}')`);
  const day = D[0];
  const { page, ctx } = await openW({ kind: 'phone' });
  await h.signIn(page, who.saleh.email, PW);
  await page.getByTestId('today-screen').waitFor();
  const order = async () => page.locator('.today-main a[href^="#/job/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href').replace('#/job/', '')))]);
  /* the stops on screen (« Prochain arrêt », then « Ensuite ») are the database's, in its order, each with its arrival
     (a step sent may plan the rest of the day again: the screen is given the time to follow) */
  const sameAsDb = async () => {
    const said = async () => {
      const db = stopsOf(day);
      const ids = await order();
      const words = await Promise.all(db.map((s) => page.locator(`.today-main a[href="#/job/${s.id}"]`).first().innerText().catch(() => '')));
      return { db, ids, words, ok: ids.join() === db.map((s) => s.id).join() && db.every((s, i) => s.status !== 'booked' || words[i].includes(`ers ${clock(s.eta_min)}`)) };
    };
    const r = await until2(said, (v) => v.ok, 20000);
    assert.deepEqual(r.ids, r.db.map((s) => s.id), 'Ma journée lists the stops in the planner’s order');
    r.db.forEach((s, i) => { if (s.status === 'booked') assert.ok(r.words[i].includes(`ers ${clock(s.eta_min)}`), `stop ${s.stop_order} says ${clock(s.eta_min)}: ${r.words[i]}`); });
    return r.db;
  };
  let db = await sameAsDb();
  assert.equal(db[0].id === J.amira || db[0].id === J.bruno, true);
  const first = db[0].id, second = db[1].id;
  // the day starts; the next stop is the planner's first
  await page.getByTestId('shift-start').click();
  await page.getByTestId('shift-end').waitFor();
  await page.getByTestId('today-next').locator(`a[href="#/job/${first}"]`).first().click();
  await page.getByTestId('job-screen').waitFor();
  await page.getByTestId('step-leave').click();
  await until(() => jobOf(first).status, (v) => v === 'en_route', 15000);
  await page.getByTestId('text-outcome').waitFor({ timeout: 8000 }).catch(() => undefined);
  await dismissSheets(page);
  await page.getByTestId('step-arrive').click();
  await until(() => jobOf(first).status, (v) => v === 'on_site', 15000);
  await page.getByTestId('text-outcome').waitFor({ timeout: 8000 }).catch(() => undefined);
  await dismissSheets(page);
  await x.openVin(page);
  await page.getByTestId('vin-input').fill('2HGFC2F59KH512399');
  await page.getByTestId('car-check-save').click();
  await page.getByTestId('car-check').waitFor({ state: 'detached', timeout: 10000 });
  await page.getByTestId('step-waiver').click();
  await page.getByTestId('waiver-sheet').waitFor();
  await x.draw(page, 'waiver-pad');
  await page.getByTestId('waiver-save').click();
  await page.getByTestId('step-invoice').click({ timeout: 15000 });
  await page.getByTestId('invoice-finish').click({ timeout: 15000 });
  await page.getByTestId('step-pay').click({ timeout: 15000 });
  await page.getByTestId('pay-sheet').waitFor();
  await page.getByTestId('pay-cash').click();
  const due = Number(await until(() => h.sql(`select coalesce((select total_cents from public.invoices where job_id = '${first}' and status = 'issued'), 0)`), (v) => Number(v) > 0, 15000));
  assert.ok(due > 0, 'an invoice to pay');
  await page.locator('[data-testid="pay-sheet"] input.input-money').nth(1).fill(String(Math.ceil(due / 100) + 5));
  await page.getByTestId('pay-change').waitFor();
  await page.getByTestId('pay-confirm').click();
  await page.getByTestId('step-finish').click({ timeout: 15000 });
  // « Pièces utilisées » when the work takes parts (none here); then the job is done
  if (await page.getByTestId('parts-sheet').waitFor({ timeout: 4000 }).then(() => true, () => false)) await page.getByTestId('parts-confirm').click();
  await until(() => jobOf(first).status, (v) => v === 'done', 20000);
  const inv = h.sql(`select status || '|' || total_cents || '|' || paid_cents from public.invoices where job_id = '${first}' and status <> 'void'`).split('|');
  assert.equal(inv[0], 'paid');
  assert.equal(inv[1], inv[2], 'paid in full, not a cent more');
  assert.equal(h.sql(`select method from public.payments where job_id = '${first}'`), 'cash');
  assert.equal(jobOf(first).waiver_signed_at != null, true, 'signed');
  // back to « Ma journée »: the next stop is the second one, with its red button; same order and times as the database
  await page.goto(h.APP + '#/');
  await page.getByTestId('today-next').locator(`a[href="#/job/${second}"]`).first().waitFor({ timeout: 20000 });
  await page.getByTestId('today-next').getByTestId('step-leave').waitFor({ timeout: 10000 });
  db = await sameAsDb();
  assert.deepEqual(db.map((s) => s.id), [second]);
  await h.shot(page, 'plages-6-next-stop');
  noErrors(page);
  await ctx.close();
});

step('no signal: the office books a window offline (phone); when the signal is back it is booked in that window', async () => {
  const { page, ctx } = await openW({ kind: 'phone' });
  await h.signIn(page, who.nadia.email, PW);
  await appOnPhone(page);
  await bookStart(page, 'Eric', [SVC.oil]);
  await listAnswered(page, D[3]);
  const times = await offeredTimes(page, D[3], 'list');
  assert.deepEqual(offeredStarts(times).map(clock), (await serverWindows(who.nadia.jwt, C.Eric, D[3], 45)).map(clock), 'the phone offers the server’s windows');
  const t = await pickWindow(page, D[3], offeredStarts(times)[0], 'list');
  // the signal drops just before « Réserver »
  await ctx.setOffline(true);
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('sync-chip').waitFor();
  await page.waitForTimeout(2000);
  const count = () => Number(h.sql(`select count(*) from public.jobs where customer_id = '${C.Eric.id}' and deleted_at is null`));
  assert.equal(count(), 0, 'nothing reached the server while offline');
  await ctx.setOffline(false);
  assert.equal(await until(count, (n) => n === 1, 30000), 1, 'sent once the signal came back');
  J.eric = h.sql(`select id from public.jobs where customer_id = '${C.Eric.id}'`);
  const j = jobOf(J.eric);
  assert.deepEqual([j.day, j.block, j.win_start, j.win_end, j.status], [D[3], 'day', t.win[0], t.win[1], 'booked'], 'in the window chosen');
  noErrors(page);
  await ctx.close();
});

step('no signal, the window taken meanwhile by another phone: refused in words, nothing booked twice, nothing lost; the office books her another window', async (t) => {
  // Ines and Farah have long work (4 h 15): two of them never arrive in the same 4-hour window
  const p1 = await openW({ kind: 'phone' });
  await h.signIn(p1.page, who.nadia.email, PW);
  await appOnPhone(p1.page);
  await bookStart(p1.page, 'Ines', LONG);
  await listAnswered(p1.page, D[5]);
  const ws = offeredStarts(await offeredTimes(p1.page, D[5], 'list'))[0];
  await pickWindow(p1.page, D[5], ws, 'list');
  await p1.ctx.setOffline(true);
  await p1.page.getByTestId('book-confirm').click();
  await p1.page.getByTestId('sync-chip').waitFor();
  // another phone of the office, with signal, books Farah in that same window
  const p2 = await openW({ kind: 'desktop' });
  await h.signIn(p2.page, who.mira.email, PW);
  await bookStart(p2.page, 'Farah', LONG);
  await gridAnswered(p2.page, D[5]);
  await pickWindow(p2.page, D[5], ws, 'grid');
  await p2.page.getByTestId('book-confirm').click();
  await p2.page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  J.farah = h.sql(`select id from public.jobs where customer_id = '${C.Farah.id}' and status = 'booked'`);
  assert.equal(jobOf(J.farah).win_start, ws);
  await p2.ctx.close();
  // the signal comes back on the first phone: the server refuses Ines in that window, and says why
  await p1.ctx.setOffline(false);
  const banner = p1.page.getByTestId('failed-banner');
  await banner.waitFor({ timeout: 30000 });
  const said = await banner.innerText();
  t.diagnostic(`the refusal says: ${said.replace(/\s+/g, ' ')}`);
  J.refusal = { banner: said, ws };
  assert.match(said, /plage/i, `the reason is the window: ${said}`);
  assert.match(said, /choisis/i, 'and what to do');
  assert.equal(Number(h.sql(`select count(*) from public.jobs where customer_id = '${C.Ines.id}' and deleted_at is null`)), 0, 'Ines is not booked');
  assert.equal(jobOf(J.farah).win_start, ws, 'Farah keeps her window');
  // nothing lost: the refused booking stays listed on the phone, after a reload too, until the office removes it
  await p1.page.reload();
  await p1.page.getByTestId('app').waitFor();
  await p1.page.getByTestId('failed-banner').getByRole('button').click();
  const sheet = p1.page.getByTestId('sync-sheet');
  await sheet.waitFor();
  await sheet.getByText(/Réservation/).first().waitFor();
  J.refusal.sheet = await sheet.innerText();
  await dismissSheets(p1.page);
  // the office books her again: that window is no longer offered (the screen and the server agree), another one is
  await bookStart(p1.page, 'Ines', LONG);
  await listAnswered(p1.page, D[5]);
  const again = offeredStarts(await offeredTimes(p1.page, D[5], 'list'));
  assert.deepEqual(again.map(clock), (await serverWindows(who.nadia.jwt, C.Ines, D[5], 255)).map(clock), 'the phone offers the server’s windows');
  assert.ok(!again.includes(ws), `${clock(ws)} is no longer offered: ${again.map(clock).join(', ')}`);
  await pickWindow(p1.page, D[5], again[0], 'list');
  await p1.page.getByTestId('book-confirm').click();
  await p1.page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  J.ines = h.sql(`select id from public.jobs where customer_id = '${C.Ines.id}' and status = 'booked'`);
  assert.equal(jobOf(J.ines).win_start, again[0]);
  // the refused one is removed from the list by the office (« Retirer »)
  await p1.page.getByTestId('sync-chip').click();
  await p1.page.getByTestId('sync-sheet').getByRole('button', { name: 'Retirer' }).first().click();
  await p1.page.getByTestId('failed-banner').waitFor({ state: 'detached', timeout: 15000 });
  noErrors(p1.page);
  await p1.ctx.close();
});

step('the window chosen is taken by another phone while the office is still on the call: the screen says it is no longer possible, nothing is booked twice', async () => {
  // tomorrow (Dina's day): Jade and Karl have long work (4 h 15), the two never arrive in the same 4-hour window
  const day = D[1];
  const p1 = await openW({ kind: 'phone' });
  await h.signIn(p1.page, who.nadia.email, PW);
  await bookStart(p1.page, 'Jade', LONG);
  await listAnswered(p1.page, day);
  const ws = offeredStarts(await offeredTimes(p1.page, day, 'list'))[0];
  await pickWindow(p1.page, day, ws, 'list');
  assert.equal(await p1.page.getByTestId('win-gone').count(), 0);
  // Mira books Karl in that window from the computer
  const p2 = await openW({ kind: 'desktop' });
  await h.signIn(p2.page, who.mira.email, PW);
  await bookStart(p2.page, 'Karl', LONG);
  await gridAnswered(p2.page, day);
  await pickWindow(p2.page, day, ws, 'grid');
  await p2.page.getByTestId('book-confirm').click();
  await p2.page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  J.karl = h.sql(`select id from public.jobs where customer_id = '${C.Karl.id}' and status = 'booked'`);
  assert.equal(jobOf(J.karl).win_start, ws);
  await p2.ctx.close();
  // Nadia's phone hears of it (the signal blinks: the phone asks for the day's appointments again, then for its windows)
  await p1.ctx.setOffline(true);
  await p1.ctx.setOffline(false);
  const gone = p1.page.getByTestId('win-gone');
  await gone.waitFor({ timeout: 30000 });
  assert.match(await gone.innerText(), /plus possible/i, 'said in words');
  assert.ok(await p1.page.getByTestId('book-confirm').isDisabled() || !(await p1.page.getByTestId('pick-says').count()), 'the window is no longer chosen');
  const now = offeredStarts(await offeredTimes(p1.page, day, 'list'));
  assert.ok(!now.includes(ws), `${clock(ws)} is no longer offered: ${now.map(clock).join(', ')}`);
  assert.deepEqual(now.map(clock), (await serverWindows(who.nadia.jwt, C.Jade, day, 255)).map(clock), 'the phone offers the server’s windows');
  // nothing lost: Jade and her work are still on the screen; another window, and she is booked once
  await p1.page.getByTestId('customer-picked').waitFor();
  await pickWindow(p1.page, day, now[0], 'list');
  await p1.page.getByTestId('book-confirm').click();
  await p1.page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  assert.equal(Number(h.sql(`select count(*) from public.jobs where customer_id = '${C.Jade.id}' and deleted_at is null`)), 1, 'booked once');
  J.jade = h.sql(`select id from public.jobs where customer_id = '${C.Jade.id}'`);
  assert.equal(jobOf(J.jade).win_start, now[0]);
  assert.equal(jobOf(J.karl).win_start, ws, 'Karl keeps his window');
  noErrors(p1.page);
  await p1.ctx.close();
});

// e2e-plages-01: a booking kept on the phone and refused once the signal is back is listed as « Réservation : Cette
// plage n’est plus libre : choisis-en une autre. », without the customer nor the moment, with only « Réessayer » (the
// same window, refused again) and « Retirer ». With two bookings made in a basement, the office cannot tell which one
// to call back. The words of the step before (J.refusal) are checked here.
step.skip('no signal, the window taken: the refusal says whose booking it was and when, so the office knows whom to call back', 'BUG e2e-plages-01: the refused booking says neither the customer nor the moment', async () => {
  assert.ok(J.refusal, 'the step before saw the refusal');
  const words = `${J.refusal.banner}\n${J.refusal.sheet}`;
  assert.match(words, /Ines/, `the customer is named: ${words}`);
  const date = longDay(D[5]).split(' ').slice(1).join(' ');            // « 21 novembre »
  assert.ok(words.includes(date), `the day is said (${date}): ${words}`);
});

step('« Départ et heure »: Camion Complet starts at 13 h on one day; the windows offered that day follow (none before 12 h)', async (t) => {
  const day = D[6];
  // Gilles is booked late that day (16 h – 20 h); until then the windows of the day start at 8 h
  const o = await openW({ kind: 'desktop' });
  await h.signIn(o.page, who.nadia.email, PW);
  const g = await bookWindow(o.page, t, C.Gilles, day, (s) => s[s.length - 1]);
  assert.equal(g.screen[0], 480, `the day starts at 8 h – 12 h: ${g.screen.map(clock).join(', ')}`);
  J.gilles = g.id;
  await o.ctx.close();
  // the owner, from the map (« Départ et heure » on the truck of the legend): that truck leaves at 13 h that day only
  const { page, ctx } = await openW({ kind: 'desktop' });
  await h.signIn(page, who.owner.email, PW);
  await page.goto(h.APP + `#/map?day=${day}`);
  await page.getByTestId(`legend-edit-${T.complet}`).click({ timeout: 20000 });
  const sheet = page.getByTestId('truck-day-sheet');
  await sheet.waitFor();
  await sheet.getByTestId('truck-day-time').locator('select').selectOption('780');
  assert.match((await page.getByTestId('truck-day-after').innerText()).replace(/\s+/g, ' '), /^Après : 13 h à 20 h/);
  await page.getByTestId('truck-day-save').click();
  assert.equal(await until(() => h.sql(`select ranges::text from public.truck_days where truck_id = '${T.complet}' and day = '${day}' and deleted_at is null`), (v) => v === '[[780, 1200]]', 15000), '[[780, 1200]]');
  assert.equal(h.sql(`select count(*) from public.truck_week where truck_id = '${T.complet}'`) !== '0', true, 'the usual week is still there');
  await ctx.close();
  // the office books Lina that day: the windows begin at 12 h – 16 h, and the screen still says what the server says
  const b = await openW({ kind: 'desktop' });
  await h.signIn(b.page, who.nadia.email, PW);
  const t0 = await bookStart(b.page, 'Lina', [SVC.oil]);
  await gridAnswered(b.page, day);
  t.diagnostic(`TIMING windows offered (step 8): ${((Date.now() - t0) / 1000).toFixed(1)} s on screen; suggest_windows median ${(median(b.page.sw) / 1000).toFixed(2)} s, slowest ${(Math.max(0, ...b.page.sw) / 1000).toFixed(2)} s`);
  const late = offeredStarts(await offeredTimes(b.page, day, 'grid'));
  assert.deepEqual(late.map(clock), (await serverWindows(who.nadia.jwt, C.Lina, day, 45)).map(clock), 'the screen says what the server says');
  assert.ok(late.length && late[0] >= 720, `nothing before 12 h – 16 h: ${late.map(clock).join(', ')}`);
  assert.equal(await b.page.getByTestId(`pick-unit-${day}-600`).getAttribute('data-state'), 'off', '10 h is shown closed');
  await pickWindow(b.page, day, late[0], 'grid');
  await b.page.getByTestId('book-confirm').click();
  await b.page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  J.lina = h.sql(`select id from public.jobs where customer_id = '${C.Lina.id}' and status = 'booked'`);
  const j = jobOf(J.lina);
  assert.ok(j.eta_min >= 780 && j.eta_min >= j.win_start && j.eta_min <= j.win_end, `after 13 h, inside the window: ${clock(j.eta_min)}`);
  const gj = jobOf(J.gilles);
  assert.ok(gj.eta_min >= gj.win_start && gj.eta_min <= gj.win_end, 'Gilles still inside his window');
  noErrors(b.page);
  await b.ctx.close();
});

step('back to the blocks: every coming appointment goes back to a block, a block booking works again; on again: the windows come back as told; twice is safe', async () => {
  const coming = () => JSON.parse(h.sql(`select coalesce(json_agg(json_build_object('id', id, 'day', day, 'block', block, 'ws', win_start, 'we', win_end) order by id), '[]')
    from public.jobs where day >= public.local_today() and status = 'booked' and deleted_at is null`));
  const told = coming();
  assert.ok(told.length >= 6 && told.every((j) => j.block === 'day' && j.ws != null), 'every coming appointment has its window');
  const { page, ctx } = await openW({ kind: 'desktop' });
  await h.signIn(page, who.owner.email, PW);
  await flipSwitch(page, false);
  const blocks = coming();
  assert.ok(blocks.every((j) => ['am', 'pm', 'eve'].includes(j.block)), `no appointment left in « day »: ${JSON.stringify(blocks.filter((j) => j.block === 'day'))}`);
  const jj = blocks.find((j) => j.id === J.julie);
  assert.deepEqual([jj.block, jj.ws, jj.we], ['pm', null, null], 'Julie is back in her afternoon');
  // the agenda of her day shows the blocks again, Julie in the afternoon
  await page.goto(h.APP + `#/agenda/${D[4]}?view=day`);
  await page.getByTestId('block-pm').locator(`a[href="#/job/${J.julie}"]`).first().waitFor({ timeout: 20000 });
  await ctx.close();
  // a booking by blocks, as before the windows
  const b = await openW({ kind: 'desktop' });
  await h.signIn(b.page, who.nadia.email, PW);
  await b.page.goto(h.APP + '#/book');
  await b.page.getByTestId('book-screen').waitFor();
  await b.page.getByTestId('customer-search').fill('Hugo');
  await b.page.getByTestId('customer-option').first().click();
  await b.page.getByTestId(`svc-${SVC.oil}`).click();
  await b.page.locator('[data-testid="block-picker"]:not([data-mode="windows"])').waitFor({ timeout: 15000 });
  await b.page.getByTestId('bp-sugg').first().click();
  await b.page.getByTestId('book-confirm').click();
  await b.page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  J.hugo = h.sql(`select id from public.jobs where customer_id = '${C.Hugo.id}' and status = 'booked'`);
  const hj = jobOf(J.hugo);
  assert.ok(['am', 'pm', 'eve'].includes(hj.block) && hj.win_start == null, `a block: ${hj.block}`);
  const sms = await until2(() => textsTo('Hugo', /confirmé/), (l) => l.length >= 1, 20000);
  assert.match(sms[0] || '', /le matin|l’après-midi|le soir/, `his text says the block: ${sms[0]}`);
  await b.ctx.close();
  // on again: each customer's window is the one he was told; the new block booking gets its block's hours
  const o2 = await openW({ kind: 'desktop' });
  await h.signIn(o2.page, who.owner.email, PW);
  const p = o2.page;
  await flipSwitch(p, true);
  const back = coming();
  for (const was of told) {
    const now = back.find((j) => j.id === was.id);
    assert.deepEqual([now.day, now.block, now.ws, now.we], [was.day, 'day', was.ws, was.we], `the window told comes back (${was.id})`);
  }
  const hb = back.find((j) => j.id === J.hugo);
  const hours = { am: [480, 720], pm: [720, 960], eve: [960, 1200] }[hj.block];
  assert.deepEqual([hb.block, hb.ws, hb.we], ['day', ...hours], 'Hugo gets the hours of his block');
  // a second « on » (another phone, the same tap twice): nothing changes
  const jwt = await jwtOf(who.owner.email);
  const r = await rpcAs(jwt, 'windows_switch', { p_op: randomUUID(), p_on: true });
  assert.equal(r.unchanged, true, JSON.stringify(r));
  assert.equal(r.converted, 0);
  assert.deepEqual(coming(), back, 'twice is safe: not a window moved');
  noErrors(p);
  await o2.ctx.close();
});
