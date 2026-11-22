// « Déplacer à l'heure choisie » (the exact move: Hassan, 2026-11-21, « when i move an appointement, i want it to move
// exactly where i point it to move, but the rest stays the same »; STATE.md 2026-11-21 20:00 S1–S9 / A1–A6 and 20:25: S6
// corrected, A7) end to end: the real app in a real browser against the real local server, « Plages d'arrivée » on (as
// live), « Vraies routes » off unless a step says on.
// The world: Camion Complet works 8 h – 20 h on the days used, Voiture does not (one truck, one route). Its day D holds
// four stops written as a planner would have left them (stop order and arrival times stored): Alice 8 h 30 (8 h – 12 h),
// Benoit 10 h (9 h – 13 h), Chloe 11 h 30 (10 h – 14 h, the third, the one moved), Denis 15 h 30 (12 h – 16 h: half an
// hour left in his window, so a stop put just before him makes him late). The planner itself never leaves such a gap
// (it waits for each window to open), which is why the stops are written and not booked: without it no single move
// could make a customer late. Each step starts from that world and leaves it as it found it (a snapshot put back after
// every step); the database is saved before the file and put back exactly as it was after (harness.cjs).
// Every request of a browser to a host that is not 127.0.0.1 and not faked fails the step (routes.helpers.cjs fakeWorld).
// The server's own preview (move_preview, asked by the test as the same person) is the oracle of what the screen says;
// the database (jobs.eta_min, arrive_at, the windows, the stop order) is the proof of what was done.
//   bash tests/stack/mac/e2e-file.sh deplacer         (a Mac)   ·   node --test tests/e2e/deplacer.test.cjs   (Linux stack)
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
/** a stop of the world, written as the planner leaves one (order, arrival, the window told) and as told: its booking
    text went (Part 28: told_* = what told_install() writes for a booking already texted), so the day's line counts only
    the clients a step leaves owed their new hour */
const stopOf = (first, order, eta, ws) => h.sql(`insert into public.jobs (customer_id, day, block, status, truck_id, duration_min, stop_order, eta_min, travel_min, win_start, win_end, win_flex, address, lat, lng,
    confirm_sent_at, told_day, told_start, told_end, told_at, told_how)
  values ('${C[first].id}', '${D}', 'day', 'booked', '${T.complet}', 45, ${order}, ${eta}, 10, ${ws}, ${ws + 240}, false, '${first} e2e, Montréal, QC', ${C[first].lat}, ${C[first].lng},
    now(), '${D}', ${ws}, ${ws + 240}, now(), 'install') returning id`);
/** the clients owed their hour on D, as the office's list says it (tell_list as Nadia): first names */
const dueOn = async (day) => (await x.rpcAs(who.nadia.jwt, 'tell_list', { p_day: day })).filter((r) => r.state !== 'drift').map((r) => nameOf(r.id)).sort();
const jobRow = (id) => x.json(`select row_to_json(j) from public.jobs j where id = '${id}'`);
const nameOf = (id) => Object.keys(J).find((k) => J[k] === id) || id;
/** the server's preview of a move to that minute (asked as the office, as the screen asks it): its answer, or its refusal */
async function preview(job, at, truck = null) {
  try { return { ok: true, a: await x.rpcAs(who.nadia.jwt, 'move_preview', { p_job: job, p_day: D, p_truck: truck, p_at: at }) }; } catch (e) {
    return { ok: false, hint: e.hint, details: typeof e.details === 'string' && e.details.startsWith('{') ? JSON.parse(e.details) : e.details, message: e.message };
  }
}
/** the exact move through the API (what step 1 does through the screen), as the office */
const moveExactByApi = (job, at, lateOk = []) => x.rpcAs(who.nadia.jwt, 'move_job', { p_op: randomUUID(), p_job: job, p_day: D, p_block: 'day', p_truck: null,
  p_win_start: d.winFor(at)[0], p_win_flex: false, p_exact: { at, late_ok: lateOk } });
/** what the screen sent to move_job last, and what the server answered */
const lastMove = (answers) => answers.filter((a) => a.args && a.args.p_job).pop();
/** « Texter … ? » (Hassan, 2026-11-22: « the system should ask me first »): after a move whose window told changed, the app
    asks before the « moved » text and sends nothing before the answer. `changed` true: the question, and for 2 s with it
    on screen the page asks the server for no « moved » text of that job (beyond those answered « Envoyer » before on this
    page) and the fake GoHighLevel's log (cleared before the move) gets nothing; answered « Envoyer le texto »: told once.
    `changed` false: no question at all. */
const movedAsked = (page, first) => (page.notified || []).filter((n) => n.kind === 'moved' && n.job_id === J[first]).length;
async function textAskIf(page, changed, first) {
  if (!changed) {
    await page.waitForTimeout(1500);
    assert.equal(await page.getByTestId('text-ask').count(), 0, `no « Texter ${first} ? »: the window told did not change`);
    return null;
  }
  await page.getByTestId('text-ask').waitFor({ timeout: 20000 });
  // a send by itself racing the question would have reached the local server and its fake GoHighLevel by then (review L3)
  await page.waitForTimeout(2000);
  page.movedSent = page.movedSent || {};
  const before = page.movedSent[first] || 0;
  assert.equal(movedAsked(page, first), before, `the server not asked to text ${first} before the answer`);
  assert.deepEqual(await d.textsTo(first, /a changé/), [], `nothing texted to ${first} before the answer`);
  // Part 28 (REARRANGE.md §1.3, « Planned ≠ told while the state is 'ok' »): a sure arrival still inside the window he was
  // TOLD that day leaves him nothing new to hear when it is a minute pointed (the exact move) or his planned window does
  // not hold it; « Envoyer le texto » then goes under the server's lease, which answers `already` (why « told ») and
  // texts nothing (the world is written as told: stopOf). A window chosen by hand that holds the arrival is a new one to
  // tell him, even when the arrival is also inside the told one (review R0)
  const row = jobRow(J[first]);
  const inPlanned = row.win_start != null && row.eta_min >= row.win_start && row.eta_min <= row.win_end;
  const insideTold = row.told_at != null && row.told_day === row.day && row.told_start != null && row.eta_min >= row.told_start && row.eta_min <= row.told_end
    && (row.arrive_at != null || !inPlanned);
  const ta = await h.textAsk(page);
  page.movedSent[first] = before + 1;
  assert.equal(ta.title, `Texter ${first} ?`);
  if (insideTold) {
    await page.waitForTimeout(3000);
    assert.equal(movedAsked(page, first), before + 1, `the server asked once to text ${first}, after « Envoyer le texto »`);
    assert.deepEqual(await d.textsTo(first, /a changé/), [], `${first} arrives inside the window told (${row.told_start}–${row.told_end}): nothing new, no text`);
    return { ...ta, sms: [], already: true };
  }
  const sms = await until(() => d.textsTo(first, /a changé/), (v) => v.length > 0, 15000);
  assert.equal(sms.length, 1, `${first} told once, after « Envoyer le texto »`);
  assert.equal(movedAsked(page, first), before + 1, `the server asked once to text ${first}, after « Envoyer le texto »`);
  return { ...ta, sms };
}

before(async () => {
  originalCounts = h.rowCounts();
  h.saveDb();
  h.seed();
  const n = Date.now().toString(36);
  const person = async (key, name, short, roles) => {
    const email = `${key}-dp-${n}@test.local`;
    who[key] = { email, id: await h.makePerson({ email, password: PW, name, short, roles }) };
    who[key].jwt = await x.jwtOf(email);
  };
  await person('owner', 'Hassan Jeha', 'Hassan', ['owner']);
  await person('nadia', 'Nadia Bureau', 'Nadia', ['office']);
  // nothing measured, « Vraies routes » off, the fake TomTom and OSRM normal
  h.sql(`delete from public.drive_times`);
  h.sql(`delete from public.drive_spend`);
  h.sql(`delete from public.rate_limits where key like 'drive%'`);
  if (x.roadsOn()) x.forceRoads(false);
  await x.calm();
  // the texts go out through GoHighLevel (the fake one keeps them): no « text by hand » sheet over the screens
  h.sql(`insert into public.secrets (key, value) values ('ghl_token', 'pit-abcdef1234567890'), ('ghl_location', 'LOC12345678') on conflict (key) do update set value = excluded.value`);
  // the days: Camion Complet 8 h – 20 h from today to 14 days ahead, Voiture off
  h.sql(`delete from public.truck_days where truck_id in ('${T.complet}', '${T.voiture}') and day between public.local_today() and public.local_today() + 14`);
  h.sql(`insert into public.truck_days (truck_id, day, ranges)
    select '${T.complet}'::uuid, d::date, '[[480,1200]]'::jsonb from generate_series(public.local_today(), public.local_today() + 14, interval '1 day') d
    union all select '${T.voiture}'::uuid, d::date, '[]'::jsonb from generate_series(public.local_today(), public.local_today() + 14, interval '1 day') d`);
  // « Plages d'arrivée » on, by the owner (as live)
  const sw = await x.rpcAs(who.owner.jwt, 'windows_switch', { p_op: randomUUID(), p_on: true });
  assert.equal(sw.on, true, JSON.stringify(sw));
  H = x.home();
  D = h.sql(`select (public.local_today() + 3)::text`);
  customer('Alice', '514 555-0901', near(0.010, -0.020));
  customer('Benoit', '514 555-0902', near(-0.015, 0.010));
  customer('Chloe', '514 555-0903', near(0.020, 0.015));
  customer('Denis', '514 555-0904', near(-0.010, -0.025));
  customer('Emma', '514 555-0905', near(0.005, 0.025));
  customer('Fanny', '514 555-0906', near(-0.022, -0.004));
  J.Alice = stopOf('Alice', 1, 510, 480);
  J.Benoit = stopOf('Benoit', 2, 600, 540);
  J.Chloe = stopOf('Chloe', 3, 690, 600);
  J.Denis = stopOf('Denis', 4, 930, 720);
  h.buildApp();
  await h.startApp();
  // the browser started here (its first start is slow): each step's time is its own
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

const WORLD = ['Alice #1 510', 'Benoit #2 600', 'Chloe #3 690', 'Denis #4 930'];

step('1. The office, on a computer, drags the third stop of the day to 13 h 30 on the agenda’s hour grid: the question says the window told to the customer and that the others keep their hour; yes: the stop arrives at 13 h 30 (eta_min, arrive_at), its window is the garage’s rule around it, and the three others keep their order and their times', async (t) => {
  const before = d.dayOf(T.complet, D);
  assert.deepEqual(d.orderAndTimes(before), WORLD, 'the world');
  const AT = 810;
  const win = d.winFor(AT);
  // the server's own preview of that move: nobody else changes
  const pv = await preview(J.Chloe, AT);
  assert.ok(pv.ok && pv.a.exact === true, JSON.stringify(pv));
  for (const s of pv.a.stops.filter((s0) => s0.id !== J.Chloe)) assert.deepEqual([s.eta_before, s.order_before], [s.eta_after, s.order_after], `${nameOf(s.id)} keeps its place: ${JSON.stringify(s)}`);
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const moves = x.answersOf(page, 'move_job');
  const previews = x.answersOf(page, 'move_preview');
  await h.signIn(page, who.nadia.email, PW);
  await d.agendaDay(page, D);
  assert.equal((await d.gridSays(page, J.Chloe)).eta, 690, 'the grid draws her at 11 h 30');
  await h.clearMock();
  await d.dragTo(page, J.Chloe, D, AT, T.complet);
  const q = await d.question(page);
  // A3: while the question is on screen the block is held where it was let go
  await page.getByTestId(`grid-held-${J.Chloe}`).waitFor({ timeout: 5000 });
  assert.match(flat(await page.getByTestId(`grid-held-${J.Chloe}`).innerText()), new RegExp(`^${clock(AT)}`));
  await h.shot(page, 'deplacer-1-question');
  t.diagnostic(`the question: « ${q.title} » — « ${q.text} » [${q.buttons.join(' | ')}]`);
  assert.match(q.title, /Chloe/);
  assert.match(q.title, new RegExp(`à ${clock(AT)} \\?$`));
  assert.ok(q.text.includes(`Sa plage : entre ${clock(win[0])} et ${clock(win[1])}.`), q.text);
  assert.ok(q.text.includes('Les autres arrêts gardent leur heure.'), q.text);
  assert.equal(moves.length, 0, 'nothing sent before the yes');
  const asked = previews.filter((a) => a.args && a.args.p_at === AT);
  assert.ok(asked.length >= 1, `the screen asked the server's preview: ${JSON.stringify(previews.map((a) => a.args))}`);
  assert.deepEqual(asked[0].args, { p_job: J.Chloe, p_day: D, p_truck: T.complet, p_at: AT }, 'the column’s truck and the minute let go');
  await q.yes();
  await until(() => moves.length, (v) => v > 0, 20000);
  const sent = lastMove(moves);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual(sent.args.p_exact, { at: AT, late_ok: [] }, 'the 8-argument move with the minute');
  const after1 = await until(() => d.dayOf(T.complet, D), (v) => v.find((s) => s.id === J.Chloe)?.eta === AT, 20000);
  const c = after1.find((s) => s.id === J.Chloe);
  assert.deepEqual([c.eta, c.at, c.ws, c.we, c.truck, c.pinned], [AT, AT, win[0], win[1], T.complet, true], `Chloe: ${JSON.stringify(c)}`);
  assert.deepEqual(d.orderAndTimes(after1), ['Alice #1 510', 'Benoit #2 600', `Chloe #3 ${AT}`, 'Denis #4 930'], 'the others keep their order and their times');
  // the message, and the block where it was let go (no jump)
  await page.getByTestId('toast-ok').filter({ hasText: `Rendez-vous déplacé : ` }).filter({ hasText: `à ${clock(AT)}.` }).first().waitFor({ timeout: 10000 });
  await until(async () => (await d.gridSays(page, J.Chloe)).eta, (v) => v === AT, 15000);
  const g = await d.gridSays(page, J.Chloe);
  assert.deepEqual([g.eta, g.win], [AT, win], `the grid: ${g.label}`);
  const unitTop = await page.evaluate(([dd, m, tr]) => { const u = document.querySelector(`[data-testid="grid-unit-${dd}-${m}-${tr}"]`); const col = u.closest('.agenda-grid-col'); return Math.round(u.getBoundingClientRect().top - col.getBoundingClientRect().top); }, [D, AT, T.complet]);
  assert.equal(await d.blockTop(page, J.Chloe), unitTop, 'the block sits on the unit it was let go on');
  // her window changed (10 h – 14 h → 13 h – 17 h): the app asks « Texter Chloe ? » with her new window (nothing sent
  // before the answer); « Envoyer le texto »: she is told once
  await page.getByTestId('text-ask').waitFor({ timeout: 20000 });
  await h.shot(page, 'deplacer-1-text-ask');
  const ta = await textAskIf(page, true, 'Chloe');
  t.diagnostic(`then: « ${ta.title} » — « ${ta.when} »`);
  assert.ok(ta.when.endsWith(`, entre ${clock(win[0])} et ${clock(win[1])}`), ta.when);
  // 13 h 30 is inside the window she was told (10 h – 14 h): under Part 28 she has nothing new to hear (the server answers
  // « already », §1.3), and she is owed nothing on D
  assert.equal(ta.already, true, 'Chloe arrives inside what she was told');
  assert.deepEqual(await dueOn(D), [], 'nobody owed on D');
  await h.shot(page, 'deplacer-1-moved');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('2. The same drag to a time that makes the next customer late: the question names her and by how much; « Choisir une autre heure » changes nothing in the database; again, « Déplacer quand même »: moved, and he is late by what was said', async (t) => {
  const AT = 930;
  const pv = await preview(J.Chloe, AT);
  assert.ok(pv.ok && pv.a.exact === true, JSON.stringify(pv));
  const late = pv.a.stops.filter((s) => s.late);
  assert.deepEqual(late.map((s) => s.id), [J.Denis], `the server: Denis, only, would be late: ${JSON.stringify(pv.a.stops)}`);
  const L = late[0];
  t.diagnostic(`the server's preview: Denis ${clock(L.eta_before)} → ${clock(L.eta_after)}, ${L.late_min} min after his window (${clock(L.win_start)} – ${clock(L.win_end)})`);
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const moves = x.answersOf(page, 'move_job');
  await h.signIn(page, who.nadia.email, PW);
  await d.agendaDay(page, D);
  const rows0 = d.dayOf(T.complet, D);
  await h.clearMock();
  await d.dragTo(page, J.Chloe, D, AT, T.complet);
  const q = await d.question(page);
  await h.shot(page, 'deplacer-2-late-question');
  t.diagnostic(`the question: « ${q.title} » — « ${q.text} » [${q.buttons.join(' | ')}]`);
  assert.match(q.title, /met Denis en retard/);
  assert.ok(q.text.includes(`Denis : vers ${clock(L.eta_after)}, ${duration(L.late_min)} après sa plage (${clock(L.win_start)} à ${clock(L.win_end)}).`), q.text);
  // a day other than today (D = today + 3): his new window goes with the day's button (Part 28), said in the question
  const w = d.winFor(L.eta_after);
  assert.ok(q.text.includes(`Denis : vers ${clock(L.eta_after)}, ${duration(L.late_min)} après sa plage (${clock(L.win_start)} à ${clock(L.win_end)}). Il aura ${clock(w[0])} à ${clock(w[1])} avec « Envoyer les heures aux clients ».`), q.text);
  assert.ok(q.buttons.includes('Déplacer quand même') && q.buttons.includes('Choisir une autre heure'), q.buttons.join(' | '));
  // « Choisir une autre heure »: nothing written
  await q.no('Choisir une autre heure');
  await page.waitForTimeout(2500);
  assert.equal(moves.length, 0, 'no move sent');
  assert.deepEqual(d.dayOf(T.complet, D), rows0, 'the database is as it was (every stop, its time, its updated_at)');
  assert.equal(await page.getByTestId(`grid-held-${J.Chloe}`).count(), 0, 'the block is let go');
  assert.equal((await d.gridSays(page, J.Chloe)).eta, 690, 'and drawn where it is');
  // again: « Déplacer quand même »
  await d.dragTo(page, J.Chloe, D, AT, T.complet);
  const q2 = await d.question(page);
  assert.equal(q2.title, q.title, 'the same question');
  await q2.yes();
  await until(() => moves.length, (v) => v > 0, 20000);
  const sent = lastMove(moves);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual(sent.args.p_exact, { at: AT, late_ok: [J.Denis] }, 'Denis accepted late, by name');
  const after2 = await until(() => d.dayOf(T.complet, D), (v) => v.find((s) => s.id === J.Chloe)?.eta === AT, 20000);
  const c = after2.find((s) => s.id === J.Chloe), dn = after2.find((s) => s.id === J.Denis);
  assert.deepEqual([c.eta, c.at], [AT, AT], JSON.stringify(c));
  assert.equal(dn.eta, L.eta_after, 'Denis arrives when the question said');
  assert.equal(dn.eta - dn.we, L.late_min, `Denis is late by what was said (${L.late_min} min)`);
  assert.deepEqual(d.orderAndTimes(after2).slice(0, 2), ['Alice #1 510', 'Benoit #2 600'], 'the two first keep their order and times');
  assert.deepEqual(after2.map((s) => s.first), ['Alice', 'Benoit', 'Chloe', 'Denis']);
  // the message names him: his new window leaves with « Envoyer les heures aux clients » (a day other than today)
  const toast = page.getByTestId('toast-ok').filter({ hasText: 'Denis aura une nouvelle plage : elle part avec « Envoyer les heures aux clients ».' }).first();
  await toast.waitFor({ timeout: 10000 });
  t.diagnostic(`the message: « ${flat(await toast.innerText())} »`);
  // A5: the moved customer is asked about (« Texter Chloe ? », the server's `tell`) and told her new window on « Envoyer le
  // texto »; the late one is named to the office, never texted nor asked about
  const told = (await textAskIf(page, true, 'Chloe')).sms;
  assert.equal(told.length, 1, 'Chloe told once');
  await page.waitForTimeout(1500);
  assert.equal(await page.getByTestId('text-ask').count(), 0, 'one question only: none for Denis');
  assert.deepEqual(await d.textsTo('Denis'), [], 'no text to Denis: his new window goes with the day’s button');
  // Part 28: Denis is owed his new hour on D (the office's list), and his window is written only when he is told
  assert.deepEqual(await dueOn(D), ['Denis'], 'the day’s list: Denis only (Chloe was texted from the question)');
  assert.deepEqual([dn.ws, dn.we], [L.win_start, L.win_end], 'his window kept until he is told');
  await h.shot(page, 'deplacer-2-moved-late');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('3. A time the truck cannot reach (8 h, when it leaves the garage): the earliest time is offered; « Mettre à … » puts it there', async (t) => {
  const AT = 480;
  const pv = await preview(J.Chloe, AT);
  assert.deepEqual([pv.ok, pv.hint], [false, 'arrive_late'], JSON.stringify(pv));
  const E = pv.details.earliest;
  assert.ok(E > AT, JSON.stringify(pv.details));
  t.diagnostic(`the server: arrive_late, earliest ${clock(E)}, earliest without changing anybody's time ${pv.details.earliest_keep == null ? '—' : clock(pv.details.earliest_keep)}`);
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const moves = x.answersOf(page, 'move_job');
  await h.signIn(page, who.nadia.email, PW);
  await d.agendaDay(page, D);
  await h.clearMock();
  await d.dragTo(page, J.Chloe, D, AT, T.complet);
  const q = await d.question(page);
  await h.shot(page, 'deplacer-3-earliest');
  t.diagnostic(`the question: « ${q.title} » — « ${q.text} » [${q.buttons.join(' | ')}]`);
  assert.equal(q.title, `Pas possible à ${clock(AT)}`);
  assert.ok(q.text.includes(`Le camion ne peut pas être chez Chloe à ${clock(AT)} : au plus tôt ${clock(E)}.`), q.text);
  assert.ok(q.buttons.includes(`Mettre à ${clock(E)}`), q.buttons.join(' | '));
  await q.yes();
  // the held block goes to that minute
  await until(async () => flat(await page.getByTestId(`grid-held-${J.Chloe}`).innerText().catch(() => '')), (v) => v.startsWith(clock(E)) || moves.length > 0, 10000);
  // at that minute the others may arrive a little later: that is said (one more question), never in silence
  let q2 = null;
  if (!(await d.noQuestion(page, 4000))) {
    q2 = await d.question(page);
    t.diagnostic(`then: « ${q2.title} » — « ${q2.text} » [${q2.buttons.join(' | ')}]`);
    await h.shot(page, 'deplacer-3-then');
    await q2.yes();
  }
  await until(() => moves.length, (v) => v > 0, 20000);
  const sent = lastMove(moves);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.args.p_exact.at, E, 'sent at the earliest minute');
  const after3 = await until(() => d.dayOf(T.complet, D), (v) => v.find((s) => s.id === J.Chloe)?.eta === E, 20000);
  const c = after3.find((s) => s.id === J.Chloe);
  const win = d.winFor(E);
  assert.deepEqual([c.eta, c.at, c.ws, c.we], [E, E, win[0], win[1]], JSON.stringify(c));
  // what the second question said is what happened
  const pushed = (sent.body.stops || []).filter((s) => s.id !== J.Chloe && s.eta_after !== s.eta_before);
  for (const s of pushed) {
    assert.ok(q2 && q2.text.includes(`${nameOf(s.id)} : vers ${clock(s.eta_after)} au lieu de ${clock(s.eta_before)}.`), `${nameOf(s.id)} said: ${q2 && q2.text}`);
    assert.equal(after3.find((y) => y.id === s.id).eta, s.eta_after);
  }
  t.diagnostic(`the day after: ${d.orderAndTimes(after3).join(', ')}`);
  // « Texter Chloe ? » only when the window told changed (10 h – 14 h before)
  await textAskIf(page, win[0] !== 600, 'Chloe');
  await h.shot(page, 'deplacer-3-moved');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('4. On a phone: « Déplacer » from the Carte’s stop card, the calendar’s list of hours, one hour tapped (the one that makes Denis late): the same question, the same result', async (t) => {
  const AT = 930;
  const pv = await preview(J.Chloe, AT);
  const L = pv.a.stops.find((s) => s.id === J.Denis);
  assert.ok(L.late, JSON.stringify(L));
  const r = await d.openD({ kind: 'phone' });
  const { page } = r;
  const moves = x.answersOf(page, 'move_job');
  await h.signIn(page, who.nadia.email, PW);
  await page.goto(h.APP + `#/map?day=${D}`);
  // a phone: the stops are in the panel pulled up from the bottom
  const pull = page.getByTestId('map-pull-handle');
  await pull.waitFor({ timeout: 20000 });
  if ((await pull.getAttribute('aria-expanded')) !== 'true') await pull.click();
  const stop = page.getByTestId(`stop-${J.Chloe}`);
  await stop.waitFor({ timeout: 20000 });
  await stop.scrollIntoViewIfNeeded();
  await stop.click();
  await page.getByTestId('map-card').waitFor();
  await page.getByTestId('map-move').click();
  const sheet = page.getByTestId('move-sheet');
  await sheet.waitFor({ timeout: 15000 });
  assert.match(page.url(), /#\/map\?day=/, 'the sheet opened on the map');
  await page.getByTestId('pick-list').waitFor({ timeout: 20000 });
  // the stop's own day is open: its hours listed
  await page.getByTestId(`pick-daychip-${D}`).and(page.locator('[aria-pressed="true"]')).waitFor({ timeout: 20000 });
  await page.getByTestId('pick-times').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="pick-times"]')?.classList.contains('is-stale'), null, { timeout: 30000 });
  const offered = await page.$$eval('[data-testid^="pick-time-"]', (bs) => bs.map((b) => Number(b.dataset.testid.replace('pick-time-', ''))));
  t.diagnostic(`the hours offered that day: ${offered.map(clock).join(', ')}`);
  assert.ok(offered.includes(AT), `${clock(AT)} is offered`);
  await page.getByTestId(`pick-time-${AT}`).click();
  await h.shot(page, 'deplacer-4-phone-hour');
  await h.clearMock();
  await page.getByTestId('move-ok').click();
  const q = await d.question(page);
  await h.shot(page, 'deplacer-4-phone-question');
  t.diagnostic(`the question: « ${q.title} » — « ${q.text} » [${q.buttons.join(' | ')}]`);
  // both answers whole on the phone's screen (the sheet's footer takes a second line when they do not fit on one)
  const seen = await d.answersOnScreen(page);
  assert.ok(seen.ok, `the answers inside the screen (${seen.width} px): ${JSON.stringify(seen.boxes)}`);
  assert.match(q.title, /met Denis en retard/);
  assert.ok(q.text.includes(`Denis : vers ${clock(L.eta_after)}, ${duration(L.late_min)} après sa plage (${clock(L.win_start)} à ${clock(L.win_end)}).`), q.text);
  await q.yes();
  await until(() => moves.length, (v) => v > 0, 20000);
  const sent = lastMove(moves);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual(sent.args.p_exact, { at: AT, late_ok: [J.Denis] });
  assert.equal(sent.args.p_truck, null, 'its own truck');
  const after4 = await until(() => d.dayOf(T.complet, D), (v) => v.find((s) => s.id === J.Chloe)?.eta === AT, 20000);
  const c = after4.find((s) => s.id === J.Chloe), dn = after4.find((s) => s.id === J.Denis);
  assert.deepEqual([c.eta, c.at], [AT, AT]);
  assert.equal(dn.eta - dn.we, L.late_min, 'Denis late by what was said');
  await sheet.waitFor({ state: 'detached', timeout: 15000 });
  await page.getByTestId('toast-ok').filter({ hasText: 'Denis aura une nouvelle plage' }).first().waitFor({ timeout: 10000 });
  // « Déplacer » from a list of stops (MoveHost, the job screens' send): « Texter Chloe ? » too, on the phone, then the text
  await page.getByTestId('text-ask').waitFor({ timeout: 20000 });
  await h.shot(page, 'deplacer-4-phone-text-ask');
  await textAskIf(page, true, 'Chloe');
  await h.shot(page, 'deplacer-4-phone-moved');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('5. After an exact move, a NEW booking that day through the app: the pinned stop is still at its time (the others are planned again as usual)', async (t) => {
  const AT = 810;
  const m = await moveExactByApi(J.Chloe, AT);
  assert.equal(m.exact, true, JSON.stringify(m));
  const before = d.dayOf(T.complet, D);
  assert.equal(before.find((s) => s.id === J.Chloe).at, AT);
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  await h.signIn(page, who.nadia.email, PW);
  await p.bookStart(page, 'Emma', [SVC_OIL]);
  await p.gridAnswered(page, D);
  const times = await p.offeredTimes(page, D, 'grid');
  const starts = p.offeredStarts(times);
  t.diagnostic(`the windows offered to Emma that day: ${starts.map(clock).join(', ')}`);
  assert.ok(starts.length > 0, 'a window is offered');
  // the window of the morning when there is one (a stop that may go before the pin), else the first
  const ws = starts.find((w) => w <= 600) ?? starts[0];
  await p.pickWindow(page, D, ws, 'grid');
  await h.shot(page, 'deplacer-5-booking');
  await page.getByTestId('book-confirm').click();
  await page.getByTestId('job-screen').waitFor({ timeout: 20000 });
  const emma = await until(() => h.sql(`select id from public.jobs where customer_id = '${C.Emma.id}' and status = 'booked' and deleted_at is null`), Boolean, 20000);
  const after5 = d.dayOf(T.complet, D);
  const c = after5.find((s) => s.id === J.Chloe);
  assert.deepEqual([c.eta, c.at, c.ws, c.we], [AT, AT, d.winFor(AT)[0], d.winFor(AT)[1]], `the pin holds: ${JSON.stringify(c)}`);
  assert.ok(after5.some((s) => s.id === emma), 'Emma is on that truck’s day');
  for (const s of after5) assert.ok(s.eta >= s.ws && s.eta <= s.we || s.id === J.Chloe, `${s.first} inside the window told: ${JSON.stringify(s)}`);
  t.diagnostic(`before the booking: ${d.orderAndTimes(before).join(', ')}`);
  t.diagnostic(`after it: ${d.orderAndTimes(after5).map((s) => s.replace(/^(\S+)/, (w) => (w === 'Emma' ? 'Emma(new)' : w))).join(', ')}`);
  await d.agendaDay(page, D);
  assert.equal((await d.gridSays(page, J.Chloe)).eta, AT, 'the grid says 13 h 30');
  await h.shot(page, 'deplacer-5-agenda');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('6. « Laisser l’app choisir » (Changer de camion) gives the day back to the planner: arrive_at null, the truck no longer kept', async (t) => {
  const AT = 810;
  await moveExactByApi(J.Chloe, AT);
  const pinned = jobRow(J.Chloe);
  assert.deepEqual([pinned.arrive_at, pinned.truck_pinned, pinned.eta_min], [AT, true, AT]);
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const moves = x.answersOf(page, 'move_job');
  await h.signIn(page, who.nadia.email, PW);
  await page.goto(h.APP + `#/job/${J.Chloe}?do=truck`);
  const sheet = page.getByTestId('truck-sheet');
  await sheet.waitFor({ timeout: 20000 });
  await h.shot(page, 'deplacer-6-truck-sheet');
  await page.getByTestId('truck-auto').click();
  await until(() => moves.length, (v) => v > 0, 20000);
  const sent = lastMove(moves);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal('p_exact' in sent.args, false, `a move that points no time: ${JSON.stringify(sent.args)}`);
  const c = await until(() => jobRow(J.Chloe), (v) => v.arrive_at == null, 20000);
  assert.deepEqual([c.arrive_at, c.truck_pinned, c.day, c.win_start, c.win_end], [null, false, D, pinned.win_start, pinned.win_end], 'given back to the planner, the window told kept');
  assert.ok(c.eta_min >= c.win_start && c.eta_min <= c.win_end, `planned inside its window: ${c.eta_min}`);
  t.diagnostic(`the planner put her at ${clock(c.eta_min)}; the day: ${d.orderAndTimes(d.dayOf(T.complet, D)).join(', ')}`);
  // her window told is kept: nothing to tell her, no « Texter Chloe ? »
  await textAskIf(page, false, 'Chloe');
  await h.shot(page, 'deplacer-6-auto');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('7a. « Vraies routes » on, every trip measured: an exact move on the hour grid lands at the minute (measured)', async (t) => {
  await x.roadsOnByApi(who.owner.jwt);
  const on = d.dayOf(T.complet, D);
  t.diagnostic(`the day planned again with the measured times: ${d.orderAndTimes(on).join(', ')}`);
  assert.ok(on.every((s) => s.measured === true), JSON.stringify(on));
  // a minute where nobody is late and every trip is measured (the server says it)
  let AT = null, pv = null;
  for (let m = 780; m <= 1080 && AT == null; m += 15) {
    const r0 = await preview(J.Chloe, m);
    if (r0.ok && r0.a.exact && r0.a.over_hours === 0 && r0.a.stops.every((s) => s.measured === true && !s.late)) { AT = m; pv = r0.a; }
  }
  assert.ok(AT != null, 'a clean minute that afternoon');
  t.diagnostic(`the minute chosen: ${clock(AT)}; the server's preview: ${pv.stops.map((s) => `${nameOf(s.id)} ${clock(s.eta_before)}→${clock(s.eta_after)}`).join(', ')}`);
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const moves = x.answersOf(page, 'move_job');
  const drive = x.driveAnswersOf(page);
  await h.signIn(page, who.nadia.email, PW);
  await d.agendaDay(page, D);
  await h.clearMock();
  await d.dragTo(page, J.Chloe, D, AT, T.complet);
  const q = await d.question(page);
  t.diagnostic(`the question: « ${q.title} » — « ${q.text} »`);
  assert.doesNotMatch(q.text, /pas toutes mesurées|pas pu vérifier/, q.text);
  await h.shot(page, 'deplacer-7a-question');
  await q.yes();
  await until(() => moves.length, (v) => v > 0, 20000);
  const sent = lastMove(moves);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const c = await until(() => jobRow(J.Chloe), (v) => v.eta_min === AT, 20000);
  assert.deepEqual([c.eta_min, c.arrive_at, c.eta_measured], [AT, AT, true], JSON.stringify({ eta: c.eta_min, at: c.arrive_at, measured: c.eta_measured }));
  // A7: the place's trips of that day were asked (measured) before the preview
  const warms = drive.filter((a) => a.ask?.action === 'warm');
  t.diagnostic(`« drive » asked by the screen: ${JSON.stringify(drive.map((a) => [a.ask?.action, a.ask?.only || '', a.ask?.days || a.ask?.day || '', a.body?.ready]))}`);
  assert.ok(warms.length >= 1, 'A7: the move measured its place first');
  // « Texter Chloe ? » when her window told changed
  await textAskIf(page, c.win_start !== on.find((s) => s.id === J.Chloe).ws, 'Chloe');
  await h.shot(page, 'deplacer-7a-moved');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('7b. « Vraies routes » on, a stop whose trips are not measured (TomTom and OSRM down): the question says so, and the move still lands at the minute', async (t) => {
  await x.roadsOnByApi(who.owner.jwt);
  // a new address, never measured, booked while TomTom and OSRM are down
  await x.control('tomtom=fail&osrm=fail');
  const f = await x.rpcAs(who.nadia.jwt, 'book_job', { p_op: randomUUID(), p_job: { customer_id: C.Fanny.id, day: D, block: 'day', win_start: 960, duration_min: 45 }, p_items: [] });
  J.Fanny = f.job_id;
  const f0 = jobRow(J.Fanny);
  assert.equal(f0.eta_measured, false, `not measured: ${JSON.stringify({ eta: f0.eta_min, measured: f0.eta_measured })}`);
  const AT = 1080;
  const pv = await preview(J.Fanny, AT);
  t.diagnostic(`the server's preview at ${clock(AT)}: ${JSON.stringify(pv.ok ? pv.a.stops.map((s) => [nameOf(s.id), s.eta_after, s.measured, s.late]) : pv)}`);
  assert.ok(pv.ok && pv.a.exact === true && pv.a.stops.some((s) => s.measured === false), JSON.stringify(pv));
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const moves = x.answersOf(page, 'move_job');
  await h.signIn(page, who.nadia.email, PW);
  await d.agendaDay(page, D);
  await h.clearMock();
  await d.dragTo(page, J.Fanny, D, AT, T.complet);
  const q = await d.question(page, 30000);
  t.diagnostic(`the question: « ${q.title} » — « ${q.text} » [${q.buttons.join(' | ')}]`);
  await h.shot(page, 'deplacer-7b-unmeasured');
  assert.ok(q.text.includes('Les routes de cette journée ne sont pas toutes mesurées'), q.text);
  assert.ok(q.buttons.includes('Déplacer quand même') && q.buttons.includes('Annuler'), q.buttons.join(' | '));
  await q.yes();
  await until(() => moves.length, (v) => v > 0, 20000);
  const sent = lastMove(moves);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.args.p_exact.at, AT);
  const c = await until(() => jobRow(J.Fanny), (v) => v.arrive_at === AT, 20000);
  t.diagnostic(`Fanny after: eta ${c.eta_min}, arrive_at ${c.arrive_at}, measured ${c.eta_measured}, window ${c.win_start}–${c.win_end}`);
  assert.deepEqual([c.arrive_at, c.eta_min], [AT, AT], 'moved to that minute');
  assert.deepEqual([c.win_start, c.win_end], d.winFor(AT));
  // « Texter Fanny ? » when her window told changed
  await textAskIf(page, c.win_start !== f0.win_start, 'Fanny');
  await h.shot(page, 'deplacer-7b-moved');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('8. « Pas maintenant » (Hassan, 2026-11-22: « the system should ask me first »; Part 28: « put a button that will send for all clients »): a drag on the agenda, then « Déplacer » on a phone with the texts not connected; each time « Texter Chloe ? » with her new window, answered « Pas maintenant » (then, after « Voir » of the move’s message took the phone to her job where the question rose again, closed with ✕): the server is never asked to text, the fake texting service gets nothing, no « text to send by hand » sheet; then the day’s line counts Chloe and « Envoyer à 1 client » texts her the new hour once', async (t) => {
  // 14 h 30: past the window she was told (10 h – 14 h), so she is owed her new one (Part 28); nobody else changes
  const AT = 870;
  const win = d.winFor(AT);
  /** every request of the page to the server's texts (notify) */
  const textsAsked = (page) => { const l = []; page.on('request', (q) => { if (/\/functions\/v1\/notify/.test(q.url())) l.push(q.postData()); }); return l; };
  // A. the agenda's hour grid on a computer (the agenda's send), the texts connected (the fake GoHighLevel keeps them)
  const r = await d.openD({ kind: 'desktop' });
  const { page } = r;
  const asked = textsAsked(page);
  const moves = x.answersOf(page, 'move_job');
  await h.signIn(page, who.nadia.email, PW);
  await d.agendaDay(page, D);
  await h.clearMock();
  await d.dragTo(page, J.Chloe, D, AT, T.complet);
  const q = await d.question(page);
  await q.yes();
  await until(() => moves.length, (v) => v > 0, 20000);
  assert.equal(lastMove(moves).status, 200, JSON.stringify(lastMove(moves).body));
  await until(() => jobRow(J.Chloe), (v) => v.eta_min === AT, 20000);
  await page.getByTestId('text-ask').waitFor({ timeout: 20000 });
  await h.shot(page, 'deplacer-8a-text-ask');
  // the line under the moment: « Pas maintenant » leaves her for the day's button
  assert.equal(flat(await page.getByTestId('text-ask-later').innerText()), 'Pas maintenant : rien ne part, sa nouvelle heure partira avec « Envoyer les heures aux clients ».');
  assert.equal(flat(await page.getByTestId('text-ask-skip').innerText()), 'Pas maintenant');
  const ta = await h.textAsk(page, { send: false });
  t.diagnostic(`the agenda: « ${ta.title} » — « ${ta.when} », answered « Pas maintenant »`);
  assert.equal(ta.title, 'Texter Chloe ?');
  assert.ok(ta.when.endsWith(`, entre ${clock(win[0])} et ${clock(win[1])}`), ta.when);
  await page.waitForTimeout(2500);
  assert.deepEqual(asked, [], 'the server was never asked to text');
  assert.deepEqual(await d.textsTo('Chloe'), [], 'the fake texting service got nothing');
  assert.equal(await page.getByTestId('sms-sheet').count(), 0, 'no « texto à envoyer » sheet');
  assert.equal(await page.getByTestId('text-ask').count(), 0, 'asked once');
  assert.equal(await page.locator('.toast').filter({ hasText: /[Tt]exto/ }).count(), 0, 'no message about a text');
  await h.shot(page, 'deplacer-8a-no-text');
  // Part 28: the day's line now counts Chloe (told 10 h à 14 h, now 13 h à 17 h); its button lists her and texts her once
  assert.deepEqual(await dueOn(D), ['Chloe'], 'Chloe is owed her new hour on D');
  await d.agendaDay(page, D);
  const line = page.getByTestId('told-banner');
  await line.waitFor({ timeout: 20000 });
  assert.ok(flat(await line.innerText()).includes('1 client n’a pas sa nouvelle heure'), flat(await line.innerText()));
  await line.getByTestId('told-banner-send').click();
  const list = page.getByTestId('tell-sheet');
  await list.waitFor({ timeout: 15000 });
  const go = list.getByTestId('tell-go');
  await until(async () => flat(await go.innerText()), (v) => v === 'Envoyer à 1 client', 15000);
  assert.equal(flat(await go.innerText()), 'Envoyer à 1 client');
  assert.ok(flat(await list.getByTestId('tell-reach').innerText()).includes('Chloe'), 'she is in « Ils reçoivent un texto »');
  await h.shot(page, 'deplacer-8a-tell-list');
  await go.click();
  await list.getByTestId('tell-sent').waitFor({ timeout: 30000 });
  const sms = await until(() => d.textsTo('Chloe', /a changé/), (v) => v.length > 0, 15000);
  assert.equal(sms.length, 1, 'Chloe texted once, by the day’s button');
  assert.ok(sms[0].includes(`entre ${clock(win[0])} et ${clock(win[1])}`), sms[0]);
  assert.deepEqual(await dueOn(D), [], 'nobody owed on D any more');
  // pressed again: nobody to text, nothing sent
  await list.getByTestId('tell-close').click();
  await list.waitFor({ state: 'detached', timeout: 10000 });
  await until(async () => page.getByTestId('told-banner').count(), (v) => v === 0, 15000);
  assert.equal(await page.getByTestId('told-banner').count(), 0, 'the line is gone');
  assert.equal((await d.textsTo('Chloe')).length, 1, 'one text in all');
  x.nothingLeft(r);
  x.noErrors(page);
  await r.ctx.close();
  // B. the world again, the texts NOT connected (a text would give the « text to send by hand » sheet): « Déplacer » from
  // the Carte on a phone (the job screens' send), the question closed with ✕
  d.putBack('world');
  h.sql(`delete from public.secrets where key in ('ghl_token', 'ghl_location')`);
  const r2 = await d.openD({ kind: 'phone' });
  const p2 = r2.page;
  const asked2 = textsAsked(p2);
  const moves2 = x.answersOf(p2, 'move_job');
  await h.signIn(p2, who.nadia.email, PW);
  await p2.goto(h.APP + `#/map?day=${D}`);
  const pull = p2.getByTestId('map-pull-handle');
  await pull.waitFor({ timeout: 20000 });
  if ((await pull.getAttribute('aria-expanded')) !== 'true') await pull.click();
  const stop = p2.getByTestId(`stop-${J.Chloe}`);
  await stop.waitFor({ timeout: 20000 });
  await stop.scrollIntoViewIfNeeded();
  await stop.click();
  await p2.getByTestId('map-card').waitFor();
  await p2.getByTestId('map-move').click();
  const sheet = p2.getByTestId('move-sheet');
  await sheet.waitFor({ timeout: 15000 });
  await p2.getByTestId(`pick-daychip-${D}`).and(p2.locator('[aria-pressed="true"]')).waitFor({ timeout: 20000 });
  await p2.getByTestId('pick-times').waitFor({ timeout: 30000 });
  await p2.waitForFunction(() => !document.querySelector('[data-testid="pick-times"]')?.classList.contains('is-stale'), null, { timeout: 30000 });
  const offered = await p2.$$eval('[data-testid^="pick-time-"]', (bs) => bs.map((b) => Number(b.dataset.testid.replace('pick-time-', ''))));
  // a time whose window is not hers (10 h – 14 h): what she was told changes
  const at2 = offered.includes(AT) ? AT : offered.find((m) => d.winFor(m)[0] !== 600);
  assert.ok(at2 != null, `a time that changes her window: ${offered.map(clock).join(', ')}`);
  const win2 = d.winFor(at2);
  await p2.getByTestId(`pick-time-${at2}`).click();
  await p2.getByTestId('move-ok').click();
  // somebody later or late at that time: said first, answered yes (the move is not what is tested here)
  for (let i = 0; i < 3 && !(await d.noQuestion(p2, 2500)); i++) await (await d.question(p2)).yes();
  await until(() => moves2.length, (v) => v > 0, 20000);
  assert.equal(lastMove(moves2).status, 200, JSON.stringify(lastMove(moves2).body));
  await sheet.waitFor({ state: 'detached', timeout: 15000 });
  const ask2 = p2.getByTestId('text-ask');
  await ask2.waitFor({ timeout: 20000 });
  assert.equal(x.flat(await ask2.locator('h2').innerText()), 'Texter Chloe ?');
  assert.ok(x.flat(await p2.getByTestId('text-ask-when').innerText()).endsWith(`, entre ${clock(win2[0])} et ${clock(win2[1])}`));
  await h.shot(p2, 'deplacer-8b-phone-text-ask');
  // « Voir » of the move's message, above the question, tapped (review M1): a navigation never answers it; the job's
  // screen opens and the question rises again there, nothing sent
  const see = p2.locator('.toast').filter({ hasText: 'Rendez-vous déplacé' }).getByRole('button', { name: 'Voir', exact: true });
  await see.waitFor({ timeout: 4000 });
  await see.click();
  await p2.waitForURL(new RegExp(`#/job/${J.Chloe}`), { timeout: 15000 });
  await p2.getByTestId('job-screen').waitFor({ timeout: 15000 });
  await ask2.waitFor({ timeout: 15000 });
  assert.equal(x.flat(await ask2.locator('h2').innerText()), 'Texter Chloe ?', 'the question again, on the job’s screen');
  assert.deepEqual(asked2, [], 'the « Voir » sent nothing');
  await h.shot(p2, 'deplacer-8b-phone-text-ask-on-job');
  // closing the question (✕) is « Pas maintenant »
  await p2.waitForTimeout(450);
  await ask2.locator('.sheet-x').click();
  await ask2.waitFor({ state: 'detached', timeout: 10000 });
  await p2.waitForTimeout(2500);
  assert.deepEqual(asked2, [], 'the server was never asked to text');
  // (the texts are not connected here: the fake texting service could get nothing anyway; the page's own requests
  // above and no « text to send by hand » sheet are the proof)
  assert.equal(await p2.getByTestId('text-outcome').count(), 0, 'no « text to send by hand » sheet');
  assert.match(p2.url(), new RegExp(`#/job/${J.Chloe}`), 'still on the job’s screen');
  await h.shot(p2, 'deplacer-8b-no-text');
  x.nothingLeft(r2);
  x.noErrors(p2);
});
