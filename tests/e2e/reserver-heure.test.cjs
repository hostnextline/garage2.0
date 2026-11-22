// « Réserver à l'heure choisie » (Part 30; Hassan, 2026-11-22: « hours can change, but i want to be able to decide so if i
// forcefully book someone at a specific time, i want the system to show a warning if there is no place but still let me
// book it, then show me the new map »; STATE.md 13:00, K1–K3, and the lead's correction: a time the server OFFERS books
// exactly as before — its window, no minute pinned —; only a time it does not offer, « complet », taken anyway by the
// owner or the office, is forced AT that minute after the warning) end to end: the real app in a real browser against the
// real local server, « Plages d'arrivée » on (as live), « Vraies routes » off.
// The world is deplacer.test.cjs': Camion Complet works 8 h – 20 h on the days used, Voiture does not (one truck, one
// route). Its day D holds four stops written as a planner would have left them: Alice 8 h 30 (8 h – 12 h), Benoit 10 h
// (9 h – 13 h), Chloe 11 h 30 (10 h – 14 h), Denis 15 h 30 (12 h – 16 h). A long visit (4 h 15: the promotions and a
// diagnostic) no longer fits the afternoon windows: those times are « complet ». Each step starts from that world and
// leaves it as it found it (a snapshot put back after every step); the database is saved before the file and put back
// exactly as it was after (harness.cjs). Every request of a browser to a host that is not 127.0.0.1 and not faked fails
// the step (routes.helpers.cjs fakeWorld). The server's own preview (book_preview, asked by the test as the same person)
// is the oracle of what the warning says; the database is the proof of what was done; the fake GoHighLevel's log is the
// proof of the texts.
//   bash tests/stack/mac/e2e-file.sh reserver-heure   (a Mac)   ·   node --test tests/e2e/reserver-heure.test.cjs   (Linux stack)
const { test, before, after } = require('node:test');
const d = require('./deplacer.helpers.cjs');
const p = require('./plages.helpers.cjs');
const { x, h, assert } = d;
const { PW, randomUUID, clock, duration, flat, until } = x;

const T = { complet: '7c1a0000-0000-4000-8000-000000000001', voiture: '7c1a0000-0000-4000-8000-000000000002' };
const SVC_OIL = '5e7a0000-0000-4000-8000-000000000001';   // 45 min
// 120 + 75 + 60 = 255 min: such a visit no longer fits the afternoon windows of D (« complet »)
const LONG = ['5e7a0000-0000-4000-8000-000000000010', '5e7a0000-0000-4000-8000-000000000011', '5e7a0000-0000-4000-8000-000000000007'];
const who = {};
const C = {};          // customers: first name → { id, lat, lng }
const J = {};          // the world's appointments: first name → job id
let D;                 // the day of the world
let H;                 // « Départ des camions »
let originalCounts;

const step = (name, fn) => test(name, async (t) => {
  try { await fn(t); } catch (e) { await d.onFail(name); throw e; } finally { await d.endStep(); }
});

const near = (dlat, dlng) => ({ lat: Math.round((H.lat + dlat) * 1e6) / 1e6, lng: Math.round((H.lng + dlng) * 1e6) / 1e6 });
const customer = (first, phone, pt) => {
  const id = h.sql(`insert into public.customers (first_name, last_name, phone, address, lat, lng, lang, sms_ok)
    values ('${first}', 'Monde', '${phone}', '${first} e2e, Montréal, QC', ${pt.lat}, ${pt.lng}, 'fr', true) returning id`);
  C[first] = { id, first, ...pt };
  return C[first];
};
/** a stop of the world, written as the planner leaves one, and as told (its booking text went) */
const stopOf = (first, order, eta, ws) => h.sql(`insert into public.jobs (customer_id, day, block, status, truck_id, duration_min, stop_order, eta_min, travel_min, win_start, win_end, win_flex, address, lat, lng,
    confirm_sent_at, told_day, told_start, told_end, told_at, told_how)
  values ('${C[first].id}', '${D}', 'day', 'booked', '${T.complet}', 45, ${order}, ${eta}, 10, ${ws}, ${ws + 240}, false, '${first} e2e, Montréal, QC', ${C[first].lat}, ${C[first].lng},
    now(), '${D}', ${ws}, ${ws + 240}, now(), 'install') returning id`);
const nameOf = (id) => Object.keys(J).find((k) => J[k] === id) || id;
const WORLD = ['Alice #1 510', 'Benoit #2 600', 'Chloe #3 690', 'Denis #4 930'];
/** the server's preview of that booking (asked as `jwt`, as the screen asks it): its answer, or its refusal */
async function oracle(jwt, first, at, truck = null, dur = 45) {
  const c = C[first];
  try {
    return { ok: true, a: await x.rpcAs(jwt, 'book_preview', { p_job: { id: randomUUID(), customer_id: c.id, day: D, block: 'day', duration_min: dur, truck_id: truck,
      address: `${first} e2e, Montréal, QC`, lat: c.lat, lng: c.lng, arrive_at: at, late_ok: [] }, p_items: [] }) };
  } catch (e) {
    return { ok: false, hint: e.hint, details: typeof e.details === 'string' && e.details.startsWith('{') ? JSON.parse(e.details) : e.details, message: e.message };
  }
}
/** the appointment booked for that customer on D, as the database has it (null: none) */
const bookedFor = (first) => x.json(`select coalesce((select row_to_json(j) from public.jobs j where j.customer_id = '${C[first].id}' and j.day = '${D}' and j.status = 'booked' and j.deleted_at is null order by j.created_at desc limit 1), 'null'::json)`);
/** the time calendar of the booking screen, a quarter hour of D (computer: the grid; phone: the list) */
const unitOf = (page, m, layout) => page.getByTestId(layout === 'grid' ? `pick-unit-${D}-${m}` : `pick-time-${m}`);
/** the new map's list of one truck: [n, mark, words] in its order */
const mapList = (page, truck) => page.locator(`[data-testid="booked-map-truck-${truck}"] li`).evaluateAll((ls) => ls.map((li) => ({ n: Number(li.dataset.n), mark: li.dataset.mark || '', text: li.innerText.replace(/\s+/g, ' ').trim(), id: li.dataset.testid.replace('booked-map-stop-', '') })));
/** a full time of D for a long visit (« complet » on screen: its window is not one suggest_windows answers), as near 15 h 15
    as there is one in the afternoon */
async function fullTime(first) {
  const offered = await p.serverWindows(who.nadia.jwt, C[first], D, 255);
  const cands = [915, 900, 930, 945, 885, 960, 870, 975, 990];
  const at = cands.find((m) => !offered.includes(d.winFor(m)[0]));
  assert.ok(at != null, `a full afternoon time for 4 h 15 of work on D: the windows offered are ${offered.map(clock).join(', ')}`);
  return at;
}
/** the roads drawn on the new map: the number of points of each line (a straight line has 2) */
const mapRoads = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="booked-map-map"] path.mv-line')].map((el) => (el.getAttribute('d') || '').split(/[ML]/).filter((v) => v.trim()).length));

before(async () => {
  originalCounts = h.rowCounts();
  h.saveDb();
  h.seed();
  const n = Date.now().toString(36);
  const person = async (key, name, short, roles, truck = null) => {
    const email = `${key}-rh-${n}@test.local`;
    who[key] = { email, id: await h.makePerson({ email, password: PW, name, short, roles, truck }) };
    who[key].jwt = await x.jwtOf(email);
  };
  await person('owner', 'Hassan Jeha', 'Hassan', ['owner']);
  await person('nadia', 'Nadia Bureau', 'Nadia', ['office']);
  await person('saleh', 'Saleh Mécano', 'Saleh', ['mechanic'], 'Camion Complet');
  h.sql(`delete from public.drive_times`);
  h.sql(`delete from public.drive_spend`);
  h.sql(`delete from public.rate_limits where key like 'drive%'`);
  if (x.roadsOn()) x.forceRoads(false);
  await x.calm();
  // the texts go out through GoHighLevel (the fake one keeps them): no « text by hand » sheet over the screens
  h.sql(`insert into public.secrets (key, value) values ('ghl_token', 'pit-abcdef1234567890'), ('ghl_location', 'LOC12345678') on conflict (key) do update set value = excluded.value`);
  h.sql(`delete from public.truck_days where truck_id in ('${T.complet}', '${T.voiture}') and day between public.local_today() and public.local_today() + 14`);
  h.sql(`insert into public.truck_days (truck_id, day, ranges)
    select '${T.complet}'::uuid, d::date, '[[480,1200]]'::jsonb from generate_series(public.local_today(), public.local_today() + 14, interval '1 day') d
    union all select '${T.voiture}'::uuid, d::date, '[]'::jsonb from generate_series(public.local_today(), public.local_today() + 14, interval '1 day') d`);
  const sw = await x.rpcAs(who.owner.jwt, 'windows_switch', { p_op: randomUUID(), p_on: true });
  assert.equal(sw.on, true, JSON.stringify(sw));
  H = x.home();
  D = h.sql(`select (public.local_today() + 3)::text`);
  customer('Alice', '514 555-0911', near(0.010, -0.020));
  customer('Benoit', '514 555-0912', near(-0.015, 0.010));
  customer('Chloe', '514 555-0913', near(0.020, 0.015));
  customer('Denis', '514 555-0914', near(-0.010, -0.025));
  customer('Emma', '514 555-0915', near(0.005, 0.025));
  customer('Fanny', '514 555-0916', near(-0.022, -0.004));
  customer('Gaby', '514 555-0917', near(0.012, 0.004));
  customer('Hugo', '514 555-0918', near(-0.006, 0.018));
  customer('Ines', '514 555-0919', near(0.016, -0.010));
  J.Alice = stopOf('Alice', 1, 510, 480);
  J.Benoit = stopOf('Benoit', 2, 600, 540);
  J.Chloe = stopOf('Chloe', 3, 690, 600);
  J.Denis = stopOf('Denis', 4, 930, 720);
  h.buildApp();
  await h.startApp();
  const warm = await h.open();
  await warm.ctx.close();
  d.snapshot('world');
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

step('1. The office, on a computer, books Emma at 17 h 30 (a time the server offers): exactly as before Part 30 — no preview, no question, booked with the window of 17 h 30 and NO minute pinned (the planner stays free); her booking text at once with that window; no new map', async (t) => {
  assert.deepEqual(d.orderAndTimes(d.dayOf(T.complet, D)), WORLD, 'the world');
  const AT = 1050;
  const win = d.winFor(AT);
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const previews = x.answersOf(page, 'book_preview');
  const books = x.answersOf(page, 'book_job');
  await h.signIn(page, who.nadia.email, PW);
  await page.setViewportSize({ width: 1366, height: 1100 });
  await p.bookStart(page, 'Emma', [SVC_OIL]);
  await p.gridAnswered(page, D);
  assert.equal(await unitOf(page, AT, 'grid').getAttribute('data-state'), 'open', '17 h 30 is offered');
  await unitOf(page, AT, 'grid').click();
  await h.clearMock();
  await page.getByTestId('book-confirm').click();
  assert.equal(await d.noQuestion(page, 2500), true, 'no question');
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  assert.equal(previews.length, 0, 'no preview: a time offered books as before');
  const sent = books.filter((a) => a.args?.p_job?.customer_id === C.Emma.id).pop();
  assert.equal(sent?.status, 200, JSON.stringify(sent?.body));
  assert.equal(sent.args.p_job.win_start, win[0], 'its window');
  assert.equal(sent.args.p_job.arrive_at, undefined, 'no minute sent');
  const e = bookedFor('Emma');
  t.diagnostic(`Emma: the planner put her at ${clock(e.eta_min)} in ${clock(e.win_start)} – ${clock(e.win_end)}`);
  assert.deepEqual([e.win_start, e.win_end, e.arrive_at, e.forced], [win[0], win[1], null, false], JSON.stringify(e));
  assert.ok(e.eta_min >= e.win_start && e.eta_min <= e.win_end, 'planned inside her window');
  for (const s0 of d.dayOf(T.complet, D)) assert.ok(s0.eta >= s0.ws && s0.eta <= s0.we, `${s0.first} inside the window told: ${JSON.stringify(s0)}`);
  assert.equal(await page.getByTestId('booked-map').count(), 0, 'no new map');
  const sms = await until(() => d.textsTo('Emma'), (v) => v.length > 0, 15000);
  assert.equal(sms.length, 1, 'her booking text, once, at once');
  assert.ok(sms[0].includes(`entre ${clock(win[0])} et ${clock(win[1])}`), `the window of 17 h 30 in the text: ${sms[0]}`);
  // Part 28: the booking text writes what she was told (so « Envoyer les heures aux clients » owes her nothing)
  const told = await until(() => bookedFor('Emma'), (v) => v.told_at != null, 15000);
  assert.deepEqual([told.told_day, told.told_start, told.told_end, told.told_how], [D, win[0], win[1], 'sms'], JSON.stringify(told));
  await h.shot(page, 'reserver-1-booked');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('2. The office books Fanny (4 h 15 of work) at a full time of the afternoon (« complet »): the warning names who would be late and by how much (and the truck past its hours); « Choisir une autre heure » writes nothing; again, « Réserver quand même »: booked AT that minute, pinned, the others pushed exactly as previewed; then the NEW MAP of that day: the new order, Fanny « Nouveau », the late ones marked, the roads by the streets (never a straight line); « Voir le rendez-vous »', async (t) => {
  const AT = await fullTime('Fanny');
  const pv = await oracle(who.nadia.jwt, 'Fanny', AT, null, 255);
  assert.ok(pv.ok && pv.a.exact === true, JSON.stringify(pv));
  assert.equal(pv.a.forced, true, `no room at ${clock(AT)}: ${JSON.stringify(pv.a)}`);
  const late = pv.a.stops.filter((s) => s.late);
  t.diagnostic(`the server's preview at ${clock(AT)}: ${late.map((s) => `${nameOf(s.id)} ${clock(s.eta_before)} → ${clock(s.eta_after)}, ${s.late_min} min late`).join('; ') || 'nobody late'}; past the hours: ${pv.a.over_hours} min`);
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const books = x.answersOf(page, 'book_job');
  await h.signIn(page, who.nadia.email, PW);
  await page.setViewportSize({ width: 1366, height: 1100 });
  await p.bookStart(page, 'Fanny', LONG);
  await p.gridAnswered(page, D);
  assert.equal(await unitOf(page, AT, 'grid').getAttribute('data-state'), 'no', `${clock(AT)} is full (hatched)`);
  await unitOf(page, AT, 'grid').click();
  assert.match(flat(await page.getByTestId('bp-chosen').innerText()), /Complet à cette heure/);
  const rows0 = d.dayOf(T.complet, D);
  await h.clearMock();
  await page.getByTestId('book-confirm').click();
  const q = await d.question(page);
  await h.shot(page, 'reserver-2-warning');
  t.diagnostic(`the warning: « ${q.title} » — « ${q.text} » [${q.buttons.join(' | ')}]`);
  if (late.length === 1) assert.equal(q.title, `Réserver Fanny à ${clock(AT)} met ${nameOf(late[0].id)} en retard`);
  else if (late.length > 1) assert.equal(q.title, `Réserver Fanny à ${clock(AT)} met ${late.length} clients en retard`);
  else assert.equal(q.title, `Réserver Fanny à ${clock(AT)} : le camion finit après ses heures`);
  for (const L of late) assert.ok(q.text.includes(`${nameOf(L.id)} : vers ${clock(L.eta_after)}, ${duration(L.late_min)} après sa plage (${clock(L.win_start)} à ${clock(L.win_end)}).`), q.text);
  if (pv.a.over_hours > 0) assert.ok(q.text.includes(`Le camion finirait sa journée ${duration(pv.a.over_hours)} après ses heures.`), q.text);
  assert.ok(q.buttons.includes(`Réserver quand même à ${clock(AT)}`) && q.buttons.includes('Choisir une autre heure'), q.buttons.join(' | '));
  // « Choisir une autre heure »: nothing written
  await q.no('Choisir une autre heure');
  await page.waitForTimeout(2000);
  assert.equal(books.filter((a) => a.args?.p_job?.customer_id === C.Fanny.id).length, 0, 'no booking sent');
  assert.deepEqual(d.dayOf(T.complet, D), rows0, 'the database is as it was (every stop, its time, its updated_at)');
  assert.equal(bookedFor('Fanny'), null);
  // again: « Réserver quand même »
  await page.getByTestId('book-confirm').click();
  const q2 = await d.question(page);
  assert.equal(q2.title, q.title, 'the same warning');
  await q2.yes();
  await until(() => books.filter((a) => a.args?.p_job?.customer_id === C.Fanny.id).length, (v) => v > 0, 20000);
  const sent = books.filter((a) => a.args?.p_job?.customer_id === C.Fanny.id).pop();
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const f = bookedFor('Fanny');
  assert.deepEqual([sent.args.p_job.arrive_at, [...sent.args.p_job.late_ok].sort()], [AT, [...late.map((s) => s.id), ...(pv.a.over_hours > 0 ? [f.id] : [])].sort()], 'the late ones accepted, by name');
  assert.deepEqual([f.eta_min, f.arrive_at, f.truck_pinned, f.forced], [AT, AT, true, false], JSON.stringify(f));
  assert.deepEqual([f.win_start, f.win_end], d.winFor(AT), 'its window: the one of that minute');
  const after2 = d.dayOf(T.complet, D);
  for (const s of pv.a.stops) if (s.id !== f.id && J[nameOf(s.id)]) assert.equal(after2.find((x0) => x0.id === s.id).eta, s.eta_after, `${nameOf(s.id)} exactly as previewed`);
  assert.deepEqual(after2.filter((s) => s.id !== f.id).map((s) => s.first), ['Alice', 'Benoit', 'Chloe', 'Denis'], 'the others keep their order');
  // the new map of that day, over its agenda
  await page.getByTestId('booked-map').waitFor({ timeout: 20000 });
  assert.match(page.url(), new RegExp(`#/agenda/${D}`), 'the agenda of that day behind it');
  const list = await mapList(page, T.complet);
  t.diagnostic(`the new map: ${list.map((s) => `${s.n}. ${s.text}`).join(' · ')}`);
  assert.deepEqual(list.map((s) => s.id), after2.map((s) => s.id), 'the new order, numbered');
  assert.deepEqual(list.map((s) => s.n), after2.map((_s, i) => i + 1));
  const mine = list.find((s) => s.id === f.id);
  assert.equal(mine.mark, 'new');
  assert.ok(mine.text.includes(`Nouveau ${clock(AT)}`), mine.text);
  for (const L of late) assert.equal(list.find((s) => s.id === L.id).mark, 'late', `${nameOf(L.id)} marked late`);
  const roads = await until(() => mapRoads(page), (v) => v.length > 0, 20000);
  t.diagnostic(`the roads drawn: ${JSON.stringify(roads)}`);
  assert.ok(roads.length > 0 && roads.every((n) => n > 2), `never a straight line: ${JSON.stringify(roads)}`);
  await h.shot(page, 'reserver-2-new-map');
  await page.getByTestId('toast-info').filter({ hasText: 'Réservé quand même : ' }).first().waitFor({ timeout: 10000 });
  const sms = await until(() => d.textsTo('Fanny'), (v) => v.length > 0, 15000);
  assert.equal(sms.length, 1, 'Fanny’s booking text, once');
  for (const L of late) assert.deepEqual(await d.textsTo(nameOf(L.id)), [], `no text to ${nameOf(L.id)}`);
  await page.getByTestId('booked-map-see').click();
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  assert.match(page.url(), new RegExp(`#/job/${f.id}`));
  assert.equal(await page.getByTestId('booked-map').count(), 0);
  x.nothingLeft(r);
  x.noErrors(page);
});

step('3. The owner, on a phone: 8 h for Gaby (offered) books as before — no « Pas possible à 8 h », no minute pinned; then Hugo (4 h 15) at a time marked « complet » in the list: the warning, « Réserver quand même », pinned, the new map', async (t) => {
  const r = await d.openD({ kind: 'phone' });
  const { page } = r;
  const books = x.answersOf(page, 'book_job');
  const previews = x.answersOf(page, 'book_preview');
  await h.signIn(page, who.owner.email, PW);
  await p.bookStart(page, 'Gaby', [SVC_OIL]);
  await p.listAnswered(page, D);
  const u8 = unitOf(page, 480, 'list');
  await u8.waitFor({ timeout: 10000 });
  assert.equal(await u8.getAttribute('data-state'), 'open', '8 h is offered');
  await u8.click();
  await page.getByTestId('book-confirm').click();
  assert.equal(await d.noQuestion(page, 2500), true, 'no question (the truck leaves at 8 h: the planner places her in her window)');
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  const g = bookedFor('Gaby');
  t.diagnostic(`Gaby: ${clock(g.eta_min)} in ${clock(g.win_start)} – ${clock(g.win_end)}`);
  assert.deepEqual([g.arrive_at, g.win_start, g.win_end], [null, ...d.winFor(480)], JSON.stringify(g));
  assert.equal(previews.length, 0, 'no preview');
  // Hugo, a long visit, at a full time
  const AT = await fullTime('Hugo');
  const pv = await oracle(who.owner.jwt, 'Hugo', AT, null, 255);
  assert.ok(pv.ok && pv.a.forced === true, JSON.stringify(pv));
  await p.bookStart(page, 'Hugo', LONG);
  await p.listAnswered(page, D);
  const u = unitOf(page, AT, 'list');
  await u.waitFor({ timeout: 10000 });
  assert.equal(await u.getAttribute('data-state'), 'no');
  assert.match(flat(await u.innerText()), /complet/, 'marked « complet »');
  await u.click();
  await page.getByTestId('book-confirm').click();
  const q = await d.question(page);
  await h.shot(page, 'reserver-3-phone-warning');
  t.diagnostic(`the warning: « ${q.title} » [${q.buttons.join(' | ')}]`);
  assert.ok(q.buttons.includes(`Réserver quand même à ${clock(AT)}`), q.buttons.join(' | '));
  const answers = await d.answersOnScreen(page);
  assert.ok(answers.ok, `the answers fit on the phone: ${JSON.stringify(answers)}`);
  await q.yes();
  await until(() => books.filter((a) => a.args?.p_job?.customer_id === C.Hugo.id && a.status === 200).length, (v) => v > 0, 20000);
  const hu = bookedFor('Hugo');
  assert.deepEqual([hu.eta_min, hu.arrive_at], [AT, AT], JSON.stringify(hu));
  await page.getByTestId('booked-map').waitFor({ timeout: 20000 });
  const list = await mapList(page, T.complet);
  t.diagnostic(`the new map: ${list.map((s) => `${s.n}. ${s.text}`).join(' · ')}`);
  assert.equal(list.find((s) => s.id === hu.id)?.mark, 'new');
  await h.shot(page, 'reserver-3-new-map');
  await page.getByTestId('booked-map-close').click();
  await page.getByTestId('booked-map').waitFor({ state: 'detached', timeout: 10000 });
  x.nothingLeft(r);
  x.noErrors(page);
});

step('4. A mechanic: a full time is not his to take (« pas possible », said why, nothing chosen, nothing sent)', async (t) => {
  const AT = await fullTime('Ines');
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const books = x.answersOf(page, 'book_job');
  await h.signIn(page, who.saleh.email, PW);
  await page.setViewportSize({ width: 1366, height: 1100 });
  await p.bookStart(page, 'Ines', LONG);
  await p.gridAnswered(page, D);
  assert.equal(await unitOf(page, AT, 'grid').getAttribute('data-state'), 'no');
  assert.match(await unitOf(page, AT, 'grid').getAttribute('aria-label'), /pas possible$/, 'said « pas possible » to him (not « complet, tu peux réserver quand même »)');
  // (marked aria-disabled for him: a click still says why)
  await unitOf(page, AT, 'grid').click({ force: true });
  const said = page.locator('[data-testid^="toast-"]').filter({ hasText: `Le mécano ne peut pas arriver vers ${clock(AT)}` }).first();
  await said.waitFor({ timeout: 10000 });
  t.diagnostic(`he reads: « ${flat(await said.innerText())} »`);
  assert.equal(await page.getByTestId('booked-map').count(), 0);
  assert.doesNotMatch(flat(await page.getByTestId('bp-chosen').innerText()), /Complet à cette heure/, 'nothing chosen');
  assert.equal(books.length, 0, 'no booking sent');
  assert.equal(bookedFor('Ines'), null);
  await h.shot(page, 'reserver-4-mechanic');
  x.nothingLeft(r);
  x.noErrors(page);
});
