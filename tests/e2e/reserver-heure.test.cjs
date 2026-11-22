// « Réserver à l'heure choisie » (Part 30; Hassan, 2026-11-22: « hours can change, but i want to be able to decide so if i
// forcefully book someone at a specific time, i want the system to show a warning if there is no place but still let me
// book it, then show me the new map »; STATE.md 13:00, K1–K3) end to end: the real app in a real browser against the
// real local server, « Plages d'arrivée » on (as live), « Vraies routes » off.
// The world is deplacer.test.cjs': Camion Complet works 8 h – 20 h on the days used, Voiture does not (one truck, one
// route). Its day D holds four stops written as a planner would have left them: Alice 8 h 30 (8 h – 12 h), Benoit 10 h
// (9 h – 13 h), Chloe 11 h 30 (10 h – 14 h), Denis 15 h 30 (12 h – 16 h: half an hour left in his window, so a stop put
// just before him makes him late). Each step starts from that world and leaves it as it found it (a snapshot put back
// after every step); the database is saved before the file and put back exactly as it was after (harness.cjs).
// Every request of a browser to a host that is not 127.0.0.1 and not faked fails the step (routes.helpers.cjs fakeWorld).
// The server's own preview (book_preview, asked by the test as the same person) is the oracle of what the screen says;
// the database (jobs.eta_min, arrive_at, the windows, the stop order) is the proof of what was done; the fake
// GoHighLevel's log is the proof of the texts.
//   bash tests/stack/mac/e2e-file.sh reserver-heure   (a Mac)   ·   node --test tests/e2e/reserver-heure.test.cjs   (Linux stack)
const { test, before, after } = require('node:test');
const d = require('./deplacer.helpers.cjs');
const p = require('./plages.helpers.cjs');
const { x, h, assert } = d;
const { PW, randomUUID, clock, duration, flat, until } = x;

const T = { complet: '7c1a0000-0000-4000-8000-000000000001', voiture: '7c1a0000-0000-4000-8000-000000000002' };
const SVC_OIL = '5e7a0000-0000-4000-8000-000000000001';   // 45 min
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
async function oracle(jwt, first, at, truck = null) {
  const c = C[first];
  try {
    return { ok: true, a: await x.rpcAs(jwt, 'book_preview', { p_job: { id: randomUUID(), customer_id: c.id, day: D, block: 'day', duration_min: 45, truck_id: truck,
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

step('1. The office, on a computer, books Emma at 17 h 30 (room there): no question, booked AT 17 h 30 (pinned, the window of 17 h 30), the four others keep their order and their hours; her booking text at once with that window; no new map', async (t) => {
  assert.deepEqual(d.orderAndTimes(d.dayOf(T.complet, D)), WORLD, 'the world');
  const AT = 1050;
  const win = d.winFor(AT);
  const pv = await oracle(who.nadia.jwt, 'Emma', AT);
  assert.ok(pv.ok && pv.a.exact === true, JSON.stringify(pv));
  assert.equal(pv.a.forced, false);
  for (const s of pv.a.stops.filter((s0) => J[nameOf(s0.id)])) assert.equal(s.delay_min, 0, `${nameOf(s.id)} keeps its hour: ${JSON.stringify(s)}`);
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const previews = x.answersOf(page, 'book_preview');
  const books = x.answersOf(page, 'book_job');
  await h.signIn(page, who.nadia.email, PW);
  await page.setViewportSize({ width: 1366, height: 1100 });
  await p.bookStart(page, 'Emma', [SVC_OIL]);
  await p.gridAnswered(page, D);
  t.diagnostic(`17 h 30 on the grid: ${await unitOf(page, AT, 'grid').getAttribute('data-state')}`);
  await unitOf(page, AT, 'grid').click();
  await h.clearMock();
  await page.getByTestId('book-confirm').click();
  assert.equal(await d.noQuestion(page, 2500), true, 'no question: there is room');
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  assert.ok(previews.some((a) => a.args?.p_job?.arrive_at === AT), `the screen asked the server's preview at 17 h 30: ${JSON.stringify(previews.map((a) => a.args?.p_job?.arrive_at))}`);
  const sent = books.filter((a) => a.args?.p_job?.customer_id === C.Emma.id).pop();
  assert.equal(sent?.status, 200, JSON.stringify(sent?.body));
  assert.deepEqual([sent.args.p_job.arrive_at, sent.args.p_job.late_ok], [AT, []], 'booked at the minute, nobody accepted late');
  const e = bookedFor('Emma');
  assert.deepEqual([e.eta_min, e.arrive_at, e.win_start, e.win_end, e.truck_id, e.truck_pinned, e.forced], [AT, AT, win[0], win[1], T.complet, true, false], JSON.stringify(e));
  assert.deepEqual(d.orderAndTimes(d.dayOf(T.complet, D)), [...WORLD, `Emma #5 ${AT}`], 'the others keep their order and their hours');
  assert.equal(await page.getByTestId('booked-map').count(), 0, 'nobody else changed: no new map');
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

step('2. The office books Fanny at 15 h 15 (no room: Denis would be late): the warning names Denis and by how much; « Choisir une autre heure » writes nothing; again, « Réserver quand même à 15 h 15 »: booked AT 15 h 15, Denis pushed exactly as previewed; then the NEW MAP of that day: the new order, Fanny « Nouveau », Denis late, the roads by the streets (never a straight line); « Voir le rendez-vous »', async (t) => {
  const AT = 915;
  const pv = await oracle(who.nadia.jwt, 'Fanny', AT);
  assert.ok(pv.ok && pv.a.exact === true, JSON.stringify(pv));
  const late = pv.a.stops.filter((s) => s.late);
  assert.deepEqual(late.map((s) => nameOf(s.id)), ['Denis'], `the server: Denis, only, would be late: ${JSON.stringify(pv.a.stops)}`);
  const L = late[0];
  t.diagnostic(`the server's preview: Denis ${clock(L.eta_before)} → ${clock(L.eta_after)}, ${L.late_min} min after his window (${clock(L.win_start)} – ${clock(L.win_end)})`);
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const books = x.answersOf(page, 'book_job');
  await h.signIn(page, who.nadia.email, PW);
  await page.setViewportSize({ width: 1366, height: 1100 });
  await p.bookStart(page, 'Fanny', [SVC_OIL]);
  await p.gridAnswered(page, D);
  await unitOf(page, AT, 'grid').click();
  const rows0 = d.dayOf(T.complet, D);
  await h.clearMock();
  await page.getByTestId('book-confirm').click();
  const q = await d.question(page);
  await h.shot(page, 'reserver-2-warning');
  t.diagnostic(`the warning: « ${q.title} » — « ${q.text} » [${q.buttons.join(' | ')}]`);
  assert.equal(q.title, `Réserver Fanny à ${clock(AT)} met Denis en retard`);
  assert.ok(q.text.includes(`Denis : vers ${clock(L.eta_after)}, ${duration(L.late_min)} après sa plage (${clock(L.win_start)} à ${clock(L.win_end)}).`), q.text);
  assert.ok(q.buttons.includes(`Réserver quand même à ${clock(AT)}`) && q.buttons.includes('Choisir une autre heure'), q.buttons.join(' | '));
  // « Choisir une autre heure »: nothing written
  await q.no('Choisir une autre heure');
  await page.waitForTimeout(2000);
  assert.equal(books.filter((a) => a.args?.p_job?.customer_id === C.Fanny.id).length, 0, 'no booking sent');
  assert.deepEqual(d.dayOf(T.complet, D), rows0, 'the database is as it was (every stop, its time, its updated_at)');
  assert.equal(bookedFor('Fanny'), null);
  // again: « Réserver quand même à 15 h 15 »
  await page.getByTestId('book-confirm').click();
  const q2 = await d.question(page);
  assert.equal(q2.title, q.title, 'the same warning');
  await q2.yes();
  await until(() => books.filter((a) => a.args?.p_job?.customer_id === C.Fanny.id).length, (v) => v > 0, 20000);
  const sent = books.filter((a) => a.args?.p_job?.customer_id === C.Fanny.id).pop();
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual([sent.args.p_job.arrive_at, sent.args.p_job.late_ok], [AT, [J.Denis]], 'Denis accepted late, by name');
  const f = bookedFor('Fanny');
  assert.deepEqual([f.eta_min, f.arrive_at, f.truck_pinned, f.forced], [AT, AT, true, false], JSON.stringify(f));
  const after2 = d.dayOf(T.complet, D);
  const dn = after2.find((s) => s.id === J.Denis);
  assert.equal(dn.eta, L.eta_after, 'Denis arrives when the warning said');
  assert.equal(dn.eta - dn.we, L.late_min, `Denis is late by what was said (${L.late_min} min)`);
  assert.deepEqual(after2.map((s) => s.first), ['Alice', 'Benoit', 'Chloe', 'Fanny', 'Denis'], 'Fanny at her minute; the others in their order');
  assert.deepEqual(d.orderAndTimes(after2).slice(0, 3), WORLD.slice(0, 3), 'Alice, Benoit, Chloe keep their hours');
  // the new map of that day, over its agenda
  await page.getByTestId('booked-map').waitFor({ timeout: 20000 });
  assert.match(page.url(), new RegExp(`#/agenda/${D}`), 'the agenda of that day behind it');
  const list = await mapList(page, T.complet);
  t.diagnostic(`the new map: ${list.map((s) => `${s.n}. ${s.text}`).join(' · ')}`);
  assert.deepEqual(list.map((s) => [s.n, nameOf(s.id) === s.id ? 'Fanny' : nameOf(s.id), s.mark]),
    [[1, 'Alice', ''], [2, 'Benoit', ''], [3, 'Chloe', ''], [4, 'Fanny', 'new'], [5, 'Denis', 'late']]);
  assert.ok(list[3].text.includes(`Nouveau ${clock(AT)}`), list[3].text);
  assert.ok(list[4].text.includes(`en retard de ${duration(L.late_min)}`), list[4].text);
  // the roads: nothing until a real one comes, then by the streets (the fake OSRM's road bends: more than 2 points)
  const roads = await until(() => mapRoads(page), (v) => v.length > 0, 20000);
  t.diagnostic(`the roads drawn: ${JSON.stringify(roads)}`);
  assert.ok(roads.length > 0 && roads.every((n) => n > 2), `never a straight line: ${JSON.stringify(roads)}`);
  await h.shot(page, 'reserver-2-new-map');
  // the message names Denis (his new window leaves with the day's button); Fanny's text at once; nothing to Denis
  await page.getByTestId('toast-info').filter({ hasText: `Réservé quand même : ` }).filter({ hasText: 'Denis aura une nouvelle plage' }).first().waitFor({ timeout: 10000 });
  const sms = await until(() => d.textsTo('Fanny'), (v) => v.length > 0, 15000);
  assert.equal(sms.length, 1, 'Fanny’s booking text, once');
  assert.deepEqual(await d.textsTo('Denis'), [], 'no text to Denis');
  // « Voir le rendez-vous »
  await page.getByTestId('booked-map-see').click();
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  assert.match(page.url(), new RegExp(`#/job/${f.id}`));
  assert.equal(await page.getByTestId('booked-map').count(), 0);
  x.nothingLeft(r);
  x.noErrors(page);
});

step('3. The owner, on a phone, takes 8 h for Gaby from the list (the truck leaves the garage at 8 h): « Pas possible à 8 h … au plus tôt … », « Mettre à … »: booked at that minute, the ones pushed later said on the new map', async (t) => {
  const AT = 480;
  const pv = await oracle(who.owner.jwt, 'Gaby', AT);
  assert.deepEqual([pv.ok, pv.hint], [false, 'arrive_late'], JSON.stringify(pv));
  const E = pv.details.earliest;
  assert.ok(E > AT, JSON.stringify(pv.details));
  const pe = await oracle(who.owner.jwt, 'Gaby', E);
  assert.ok(pe.ok, JSON.stringify(pe));
  t.diagnostic(`the server: arrive_late, earliest ${clock(E)}; at ${clock(E)}: ${pe.a.stops.filter((s) => s.delay_min > 0).map((s) => `${nameOf(s.id)} +${s.delay_min}`).join(', ') || 'nobody moves'}${pe.a.forced ? ' (forced)' : ''}`);
  const r = await d.openD({ kind: 'phone' });
  const { page } = r;
  const books = x.answersOf(page, 'book_job');
  await h.signIn(page, who.owner.email, PW);
  await p.bookStart(page, 'Gaby', [SVC_OIL]);
  await p.listAnswered(page, D);
  const u = unitOf(page, AT, 'list');
  await u.waitFor({ timeout: 10000 });
  t.diagnostic(`8 h on the phone's list: ${await u.getAttribute('data-state')} « ${flat(await u.innerText())} »`);
  await u.click();
  await page.getByTestId('book-confirm').click();
  const q = await d.question(page);
  await h.shot(page, 'reserver-3-earliest');
  t.diagnostic(`the question: « ${q.title} » — « ${q.text} » [${q.buttons.join(' | ')}]`);
  assert.equal(q.title, `Pas possible à ${clock(AT)}`);
  assert.ok(q.text.includes(`Le camion ne peut pas être chez Gaby à ${clock(AT)} : au plus tôt ${clock(E)}.`), q.text);
  assert.ok(q.buttons.includes(`Mettre à ${clock(E)}`), q.buttons.join(' | '));
  const answers = await d.answersOnScreen(page);
  assert.ok(answers.ok, `the answers fit on the phone: ${JSON.stringify(answers)}`);
  await q.yes();
  // at that minute somebody late would be a new warning (said, never in silence)
  if (pe.a.forced) { const q2 = await d.question(page); t.diagnostic(`then: « ${q2.title} »`); await q2.yes(); }
  await until(() => books.filter((a) => a.args?.p_job?.customer_id === C.Gaby.id && a.status === 200).length, (v) => v > 0, 20000);
  const g = bookedFor('Gaby');
  assert.deepEqual([g.eta_min, g.arrive_at], [E, E], JSON.stringify(g));
  for (const s of pe.a.stops) assert.equal(d.dayOf(T.complet, D).find((x0) => x0.id === s.id)?.eta ?? g.eta_min, s.eta_after, `${nameOf(s.id)} as previewed`);
  const moved = pe.a.stops.some((s) => J[nameOf(s.id)] && s.delay_min > 0);
  if (moved) {
    await page.getByTestId('booked-map').waitFor({ timeout: 20000 });
    const list = await mapList(page, T.complet);
    t.diagnostic(`the new map: ${list.map((s) => `${s.n}. ${s.text}`).join(' · ')}`);
    assert.equal(list[0].mark, 'new', 'Gaby first, « Nouveau »');
    assert.ok(list.some((s) => s.mark === 'pushed' || s.mark === 'late'), 'the ones pushed are marked');
    await h.shot(page, 'reserver-3-new-map');
    await page.getByTestId('booked-map-close').click();
    await page.getByTestId('booked-map').waitFor({ state: 'detached', timeout: 10000 });
  } else {
    await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  }
  x.nothingLeft(r);
  x.noErrors(page);
});

step('4. A mechanic books Hugo at 15 h 15 on his truck (no room): the same warning says only the owner and the office may book anyway; his only answer is another time; nothing written', async (t) => {
  const AT = 915;
  const pv = await oracle(who.saleh.jwt, 'Hugo', AT, T.complet);
  assert.ok(pv.ok, JSON.stringify(pv));
  assert.deepEqual([pv.a.forced, pv.a.may_force], [true, false], 'the server says it is a forcing he may not do');
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const books = x.answersOf(page, 'book_job');
  await h.signIn(page, who.saleh.email, PW);
  await page.setViewportSize({ width: 1366, height: 1100 });
  await p.bookStart(page, 'Hugo', [SVC_OIL]);
  await p.gridAnswered(page, D);
  await unitOf(page, AT, 'grid').click();
  const rows0 = d.dayOf(T.complet, D);
  await page.getByTestId('book-confirm').click();
  const q = await d.question(page);
  await h.shot(page, 'reserver-4-mechanic');
  t.diagnostic(`the warning: « ${q.title} » — « ${q.text} » [${q.buttons.join(' | ')}]`);
  assert.match(q.title, /met Denis en retard/);
  assert.ok(q.text.includes('Seuls le propriétaire et le bureau peuvent réserver quand même. Choisis une autre heure.'), q.text);
  assert.ok(!q.buttons.some((b) => /quand même/.test(b)), `no « quand même » for him: ${q.buttons.join(' | ')}`);
  await q.yes();
  await page.waitForTimeout(2000);
  assert.equal(books.filter((a) => a.args?.p_job?.customer_id === C.Hugo.id).length, 0, 'no booking sent');
  assert.deepEqual(d.dayOf(T.complet, D), rows0, 'nothing written');
  assert.equal(bookedFor('Hugo'), null);
  assert.equal(await page.getByTestId('book-screen').count(), 1, 'the booking screen stays, to pick another time');
  x.nothingLeft(r);
  x.noErrors(page);
});
