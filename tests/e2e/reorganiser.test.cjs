// « Réorganiser la journée » and « Envoyer les heures aux clients » (Part 28, REARRANGE.md §6.4; Hassan, 2026-11-22: « i want
// to be able to easely rearange a day » — he chose « Drag in a list » — and « dont send any text, put a button that will
// send for all clients, ill press it when day is filled and im done re organizing ») end to end: the real app in a real
// browser against the real local server, « Plages d'arrivée » on (as live), « Vraies routes » off.
// The world: Camion Complet and Voiture work 8 h – 20 h from today to 14 days ahead. Its day D (today + 3) holds four
// stops on the Camion written as a planner would have left them (stop order and arrival stored) — Alice 8 h 30 (8 h –
// 12 h), Benoit 10 h (9 h – 13 h), Chloe 11 h 30 (10 h – 14 h), Denis 15 h 30 (12 h – 16 h) — and two on the Voiture —
// Omar 9 h (8 h – 12 h), Paula 11 h 30 (10 h – 14 h). Every stop is written AS TOLD (its booking text went: told_* =
// what told_install() writes), so the day's line counts only the clients a step leaves owed their new hour. Each step
// starts from that world and leaves it as it found it (a snapshot put back after every step); the database is saved
// before the file and put back exactly as it was after (harness.cjs).
// The oracle of what the sheet shows is the server's own preview (day_order_preview asked by the test, as the same
// person, with what the page asked); the proof of what was done is the database (dayRows) and the fake GoHighLevel's log
// (every text it was asked to send). Every request of a browser to a host that is not 127.0.0.1 and not faked fails the
// step (routes.helpers.cjs fakeWorld).
//   bash tests/stack/mac/e2e-file.sh reorganiser   (a Mac; not in all.sh nor CI)   ·   node --test tests/e2e/reorganiser.test.cjs   (Linux stack)
// then FRESH=1 bash tests/stack/mac/db-tests.sh
const { test, before, after } = require('node:test');
const R = require('./reorganiser.helpers.cjs');
const { x, h, d, assert } = R;
const { PW, randomUUID, clock, flat, until } = x;

const T = { complet: '7c1a0000-0000-4000-8000-000000000001', voiture: '7c1a0000-0000-4000-8000-000000000002' };
const who = {};
const C = {};          // customers: first name → { id, lat, lng }
const J = {};          // the world's appointments: first name → job id
const N = {};          // and their numbers (the sheet's rows are named by number)
let D;                 // the day of the world (today + 3)
let TODAY;
let H;                 // « Départ des camions »
let originalCounts;

const step = (name, fn) => test(name, async (t) => {
  try { await fn(t); } catch (e) { await R.onFail(name); throw e; } finally { await R.endStep(); }
});

const near = (dlat, dlng) => ({ lat: Math.round((H.lat + dlat) * 1e6) / 1e6, lng: Math.round((H.lng + dlng) * 1e6) / 1e6 });
const customer = (first, phone, pt) => {
  const id = h.sql(`insert into public.customers (first_name, last_name, phone, address, lat, lng, lang, sms_ok)
    values ('${first}', 'Journée', '${phone}', '${first} e2e, Montréal, QC', ${pt.lat}, ${pt.lng}, 'fr', true) returning id`);
  C[first] = { id, first, ...pt };
  return C[first];
};
/** a stop of the world: written as the planner leaves one, and as told (its booking text went) */
const stopOf = (first, truck, order, eta, ws, day = D) => {
  const id = h.sql(`insert into public.jobs (customer_id, day, block, status, truck_id, duration_min, stop_order, eta_min, travel_min, win_start, win_end, win_flex, address, lat, lng,
      confirm_sent_at, told_day, told_start, told_end, told_at, told_how)
    values ('${C[first].id}', '${day}', 'day', 'booked', '${truck}', 45, ${order}, ${eta}, 10, ${ws}, ${ws + 240}, false, '${first} e2e, Montréal, QC', ${C[first].lat}, ${C[first].lng},
      now(), '${day}', ${ws}, ${ws + 240}, now(), 'install') returning id`);
  J[first] = id;
  N[first] = Number(h.sql(`select number from public.jobs where id = '${id}'`));
  return id;
};
const nameOf = (id) => Object.keys(J).find((k) => J[k] === id) || id;
const numberOf = (id) => N[nameOf(id)];
const firsts = (rows) => rows.map((s) => s.first);
/** the clients owed their hour on that day, as the office's list says it (tell_list as Nadia): first names */
const dueOn = async (day) => (await x.rpcAs(who.nadia.jwt, 'tell_list', { p_day: day })).filter((r) => r.state !== 'drift').map((r) => nameOf(r.id)).sort();
/** a save through the API as that person (another phone): preview, then save with what it said */
async function saveByApi(jwt, lists, moved) {
  const was = R.wasOf([...new Set(lists.map((l) => l.truck))], D);
  const pv = await x.rpcAs(jwt, 'day_order_preview', { p_day: D, p_lists: lists, p_moved: moved, p_was: was, p_auto: false });
  assert.equal(pv.basis_ok, true, JSON.stringify(pv));
  return x.rpcAs(jwt, 'day_order_save', { p_op: randomUUID(), p_day: D, p_lists: lists, p_moved: moved, p_was: was, p_auto: false, p_accept: pv.accept });
}
/** the last preview the page received for a draft that moved that stop */
const lastPreviewMoving = (previews, id) => previews.filter((a) => a.status === 200 && a.args && (a.args.p_moved || []).includes(id) && a.body && a.body.basis_ok).pop();
/** the times and windows of an answer, by stop: what the screen and the database are compared with (Part 29: the minute
    pinned, pin_new for a stop dragged) */
const verdict = (a) => Object.fromEntries(a.stops.map((s) => [s.id, { truck: s.truck_id, eta: s.eta, eta_before: s.eta_before, new_win: s.new_win, win_back: s.win_back, late: s.late_min, early: s.early_min, pin: s.pin, pin_new: s.pin_new === true }]));
/** what the sheet prints as a stop's hour for an answer: « fixé à … » for a stop dragged (Part 29), else « vers … » */
const etaWords = (s) => (s.pin_new ? R.fixe(s.pin) : R.vers(s.eta));

before(async () => {
  originalCounts = h.rowCounts();
  h.saveDb();
  h.seed();
  const n = Date.now().toString(36);
  const person = async (key, name, short, roles, truck = null) => {
    const email = `${key}-ro-${n}@test.local`;
    who[key] = { email, id: await h.makePerson({ email, password: PW, name, short, roles, truck }) };
    who[key].jwt = await x.jwtOf(email);
  };
  await person('owner', 'Hassan Jeha', 'Hassan', ['owner']);
  await person('nadia', 'Nadia Bureau', 'Nadia', ['office']);
  await person('marc', 'Marc Mécano', 'Marc', ['mechanic'], 'Camion Complet');
  // nothing measured, « Vraies routes » off, the fake TomTom and OSRM normal
  h.sql(`delete from public.drive_times`);
  h.sql(`delete from public.drive_spend`);
  h.sql(`delete from public.rate_limits where key like 'drive%' or key like 'tell:%'`);
  if (x.roadsOn()) x.forceRoads(false);
  await x.calm();
  await x.control('ghl=ok&ghl_ms=0&ghl_msg_ms=0');
  // the texts go out through GoHighLevel (the fake one keeps them)
  h.sql(`insert into public.secrets (key, value) values ('ghl_token', 'pit-abcdef1234567890'), ('ghl_location', 'LOC12345678') on conflict (key) do update set value = excluded.value`);
  // the days: both vehicles 8 h – 20 h from today to 14 days ahead
  h.sql(`delete from public.truck_days where truck_id in ('${T.complet}', '${T.voiture}') and day between public.local_today() and public.local_today() + 14`);
  h.sql(`insert into public.truck_days (truck_id, day, ranges)
    select t::uuid, d::date, '[[480,1200]]'::jsonb from generate_series(public.local_today(), public.local_today() + 14, interval '1 day') d, unnest(array['${T.complet}', '${T.voiture}']) t`);
  // « Plages d'arrivée » on, by the owner (as live)
  const sw = await x.rpcAs(who.owner.jwt, 'windows_switch', { p_op: randomUUID(), p_on: true });
  assert.equal(sw.on, true, JSON.stringify(sw));
  H = x.home();
  TODAY = h.sql(`select public.local_today()::text`);
  D = h.sql(`select (public.local_today() + 3)::text`);
  customer('Alice', '514 555-0701', near(0.010, -0.020));
  customer('Benoit', '514 555-0702', near(-0.015, 0.010));
  customer('Chloe', '514 555-0703', near(0.020, 0.015));
  customer('Denis', '514 555-0704', near(-0.010, -0.025));
  customer('Omar', '514 555-0705', near(0.012, 0.022));
  customer('Paula', '514 555-0706', near(-0.018, -0.012));
  stopOf('Alice', T.complet, 1, 510, 480);
  stopOf('Benoit', T.complet, 2, 600, 540);
  stopOf('Chloe', T.complet, 3, 690, 600);
  stopOf('Denis', T.complet, 4, 930, 720);
  stopOf('Omar', T.voiture, 1, 540, 480);
  stopOf('Paula', T.voiture, 2, 690, 600);
  h.buildApp();
  await h.startApp();
  // the browser started here (its first start is slow): each step's time is its own
  const warm = await h.open();
  await warm.ctx.close();
  R.snapshot('world');
});
after(async () => {
  await h.closeAll();
  h.stopApp();
  try { await x.calm(); await x.control('ghl=ok&ghl_ms=0&ghl_msg_ms=0'); } catch { /* mocks down */ }
  h.restoreDb();
  const now = h.rowCounts();
  const diff = Object.keys(originalCounts).filter((k) => originalCounts[k] !== now[k]);
  assert.deepEqual(diff, [], 'the database is back exactly as it was');
});

const CAMION = ['Alice', 'Benoit', 'Chloe', 'Denis'];

step('B1 + B3. The office, on a computer: the last stop dragged to the top with the mouse (the ghost under the pointer all the way), the times shown are the server’s for that order, whoever changes hour is said (« Nouvelle plage », « Enregistrer quand même »); saved: the database holds those very times and windows, and no text went', async (t) => {
  assert.deepEqual(firsts(R.dayRows(T.complet, D)), CAMION, 'the world');
  const r = await R.openO({ kind: 'desktop' });
  const { page } = r;
  const previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  await h.signIn(page, who.nadia.email, PW);
  await h.clearMock();
  const sheet = await R.openSheet(page, D, previews);
  assert.deepEqual(await R.rowsShown(page, T.complet), CAMION.map((f) => N[f]), 'the Camion’s stops in their order');
  assert.deepEqual(await R.rowsShown(page, T.voiture), [N.Omar, N.Paula], 'the Voiture’s');
  // nothing changed yet: « Fermer », nothing to save
  await sheet.getByTestId('dayorder-close').waitFor();
  await h.shot(page, 'reorganiser-b1-open');
  // the drag: Denis's row (a mouse drags the whole row) to the top half of Alice's
  const dr = await R.mouseDrag(page, sheet.getByTestId(`dayorder-main-${N.Denis}`), sheet.getByTestId(`dayorder-row-${N.Alice}`), 'top');
  t.diagnostic(`the ghost half way: ${JSON.stringify(dr.ghost)}`);
  assert.ok(dr.ghost.ok, `the ghost under the pointer, on document.body: ${JSON.stringify(dr.ghost)}`);
  assert.equal(await page.getByTestId('dayorder-menu').count(), 0, 'a drag opens no row menu');
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Denis, N.Alice, N.Benoit, N.Chloe], 'Denis first, nothing saved');
  await sheet.getByTestId('dayorder-unsaved').waitFor({ timeout: 5000 });
  // the server's answer for that order (asked 600 ms after the drop), and the oracle: the same question asked by the test
  const mine = await until(() => lastPreviewMoving(previews, J.Denis), Boolean, 20000);
  assert.ok(mine, 'the sheet asked the server for that order');
  assert.deepEqual(mine.args.p_moved, [J.Denis], 'the stop moved');
  const oracle = await x.rpcAs(who.nadia.jwt, 'day_order_preview', mine.args);
  const v = verdict(oracle);
  assert.deepEqual(verdict(mine.body), v, 'the page’s answer is the server’s');
  // Part 29: Denis, dragged, at the hour of his new place (« fixé à … »); the others at the server's hour
  assert.equal(v[J.Denis].pin_new, true, 'Denis, dragged, is pinned at the hour of his new place');
  for (const f of CAMION) {
    await sheet.getByTestId(`dayorder-eta-${N[f]}`).filter({ hasText: etaWords(v[J[f]]) }).waitFor({ timeout: 10000 });
  }
  const changes = CAMION.filter((f) => v[J[f]].new_win && !v[J[f]].win_back);
  t.diagnostic(`the server: ${CAMION.map((f) => `${f} ${clock(v[J[f]].eta)}${v[J[f]].new_win ? ` → ${clock(v[J[f]].new_win[0])}–${clock(v[J[f]].new_win[1])}${v[J[f]].win_back ? ' (back)' : ''}` : ''}`).join(', ')}`);
  assert.ok(changes.includes('Denis'), 'Denis, put first, arrives before his window: a new one');
  for (const f of changes) assert.equal(flat(await sheet.getByTestId(`dayorder-pill-${N[f]}`).innerText()), 'Nouvelle plage', `${f}: « Nouvelle plage »`);
  for (const f of CAMION.filter((g) => !changes.includes(g))) assert.equal(await sheet.getByTestId(`dayorder-pill-${N[f]}`).count(), 0, `${f}: no pill`);
  const sum = flat(await page.getByTestId('dayorder-summary').innerText());
  t.diagnostic(`the summary: « ${sum} »`);
  assert.ok(sum.includes('Rien ne leur est envoyé maintenant.') || sum.includes('Rien ne lui est envoyé maintenant.'), sum);
  for (const f of changes) assert.ok(sum.includes(f), `${f} named in the summary: ${sum}`);
  // Part 29, G2 (the reviews' S6): the stops he did not drag never come earlier; one the drag pushes later is named in the
  // summary and its row says its hour before (the reviews' S1: a warning, « Enregistrer quand même »)
  for (const f of CAMION.filter((g) => g !== 'Denis')) {
    const o = v[J[f]];
    assert.ok(o.eta >= o.eta_before, `${f} (not dragged) never earlier: ${clock(o.eta)} ≥ ${clock(o.eta_before)}`);
    if (o.eta - o.eta_before > 4) {
      if (!changes.includes(f)) assert.ok(/plus tard/.test(sum) && sum.includes(f), `${f}, pushed later, named: ${sum}`);
      assert.ok((await R.notesOf(page, N[f])).includes(R.avant(o.eta_before)), `${f}: « ${R.avant(o.eta_before)} »`);
    }
  }
  await h.shot(page, 'reorganiser-b1-moved');
  // « Enregistrer » shows the verdict and becomes « Enregistrer quand même »; the second tap saves
  const btn = sheet.getByTestId('dayorder-save');
  await until(async () => (await btn.innerText()).trim(), (s) => /quand même/.test(s), 15000);
  assert.equal(flat(await btn.innerText()), 'Enregistrer quand même');
  const sv = await R.saveDay(page, saves);
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  assert.equal(sv.body.saved, true);
  assert.deepEqual(sv.args.p_accept, oracle.accept, 'the save carries what the screen showed');
  await page.getByTestId('toast-ok').filter({ hasText: 'Journée enregistrée. Aucun texto n’est parti.' }).first().waitFor({ timeout: 10000 });
  const after1 = R.dayRows(T.complet, D);
  assert.deepEqual(firsts(after1), ['Denis', 'Alice', 'Benoit', 'Chloe'], 'saved in that order');
  for (const s of after1) {
    const o = v[s.id];
    assert.equal(s.eta, o.eta, `${s.first}: the time previewed`);
    const w = o.new_win || [s.ws, s.we];
    assert.deepEqual([s.ws, s.we], w, `${s.first}: the window previewed`);
    assert.equal(s.manual, null, `${s.first}: no order by hand (C1)`);
    assert.equal(s.told_how, 'install', `${s.first}: what he was told is untouched`);
    assert.equal(s.at, o.pin, `${s.first}: the minute pinned as previewed (Part 29: Denis at his new hour, the others none)`);
  }
  assert.deepEqual(await R.allTexts(), [], 'no text went');
  // the sheet stays on the saved day: « Envoyer les heures aux clients (N) », N = the clients now owed their hour
  const due = await dueOn(D);
  assert.deepEqual(due, [...changes].sort(), 'those whose window changed are owed it');
  assert.equal(sv.body.due_after, due.length);
  await sheet.getByTestId('dayorder-send').filter({ hasText: `Envoyer les heures aux clients (${due.length})` }).waitFor({ timeout: 10000 });
  await h.shot(page, 'reorganiser-b1-saved');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('B2. A stop dragged by its grip onto the other truck’s column (computer): saved on that truck, the truck kept (truck_pinned); the fake texting service got nothing', async (t) => {
  const r = await R.openO({ kind: 'desktop' });
  const { page } = r;
  const previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  await h.signIn(page, who.nadia.email, PW);
  await h.clearMock();
  const sheet = await R.openSheet(page, D, previews);
  const dr = await R.mouseDrag(page, sheet.getByTestId(`dayorder-grip-${N.Chloe}`), sheet.getByTestId(`dayorder-head-${T.voiture}`), 'centre');
  assert.ok(dr.ghost.ok, JSON.stringify(dr.ghost));
  // a vehicle of the other kind would ask first (« … ira avec la voiture »): answered « Le mettre là »
  if (!(await d.noQuestion(page, 1500))) { const q = await d.question(page); t.diagnostic(`asked: « ${q.title} »`); await q.yes(); }
  await until(() => R.rowsShown(page, T.voiture), (l) => l.includes(N.Chloe), 10000);
  assert.deepEqual(await R.rowsShown(page, T.voiture), [N.Omar, N.Paula, N.Chloe], 'at the end of the Voiture');
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Alice, N.Benoit, N.Denis]);
  const mine = await until(() => lastPreviewMoving(previews, J.Chloe), Boolean, 20000);
  const oracle = await x.rpcAs(who.nadia.jwt, 'day_order_preview', mine.args);
  const v = verdict(oracle);
  assert.equal(v[J.Chloe].truck, T.voiture);
  // Part 29: dragged onto the Voiture, she is pinned at the hour of her new place there
  assert.equal(v[J.Chloe].pin_new, true);
  await sheet.getByTestId(`dayorder-eta-${N.Chloe}`).filter({ hasText: R.fixe(v[J.Chloe].pin) }).waitFor({ timeout: 10000 });
  await h.shot(page, 'reorganiser-b2-other-truck');
  const sv = await R.saveDay(page, saves);
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  const c = R.dayRows(T.voiture, D).find((s) => s.first === 'Chloe');
  assert.ok(c, 'Chloe is on the Voiture');
  assert.deepEqual([c.truck, c.pinned, c.eta, c.at], [T.voiture, true, v[J.Chloe].eta, v[J.Chloe].pin], JSON.stringify(c));
  assert.equal(R.dayRows(T.complet, D).some((s) => s.first === 'Chloe'), false);
  assert.deepEqual(await R.allTexts(), [], 'no text went');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('B4 + B5. « Annuler » with a change asks « Quitter sans enregistrer ? » and leaves the day as it was; « Laisser l’app choisir » asks first, the planner’s order becomes the draft, and saved it is that order', async (t) => {
  const before = R.dayRows(T.complet, D);
  const r = await R.openO({ kind: 'desktop' });
  const { page } = r;
  const previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  await h.signIn(page, who.nadia.email, PW);
  let sheet = await R.openSheet(page, D, previews);
  await R.rowMenu(page, N.Alice, 'down');
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Benoit, N.Alice, N.Chloe, N.Denis]);
  await sheet.getByTestId('dayorder-cancel').click();
  const q = await d.question(page);
  t.diagnostic(`« Annuler »: « ${q.title} » [${q.buttons.join(' | ')}]`);
  assert.equal(q.title, 'Quitter sans enregistrer ?');
  await q.yes();
  await sheet.waitFor({ state: 'detached', timeout: 10000 });
  assert.equal(saves.length, 0, 'nothing saved');
  assert.deepEqual(R.dayRows(T.complet, D), before, 'the day as it was (every stop, its time, its updated_at)');
  // « Laisser l'app choisir »
  sheet = await R.openSheet(page, D, previews);
  await sheet.getByTestId('dayorder-auto').click();
  const q2 = await d.question(page);
  t.diagnostic(`« Laisser l’app choisir »: « ${q2.title} » — « ${q2.text} »`);
  assert.equal(q2.title, 'Laisser l’app refaire toute la journée ?');
  await q2.yes();
  const auto = await until(() => previews.filter((a) => a.status === 200 && a.args && a.args.p_auto === true && a.args.p_lists == null).pop(), Boolean, 20000);
  assert.ok(auto && auto.body.basis_ok, JSON.stringify(auto && auto.body));
  await sheet.getByTestId('dayorder-auto-shown').waitFor({ timeout: 10000 });
  const lists = auto.body.lists;
  for (const tr of [T.complet, T.voiture]) {
    const want = lists.filter((l) => l.truck === tr).flatMap((l) => l.jobs).map(numberOf);
    assert.deepEqual(await R.rowsShown(page, tr), want, `${tr}: the planner’s order is the draft`);
  }
  t.diagnostic(`the planner’s order: ${lists.map((l) => `${l.truck === T.complet ? 'Camion' : 'Voiture'}: ${l.jobs.map(nameOf).join(', ')}`).join(' / ')}`);
  await h.shot(page, 'reorganiser-b5-auto');
  const sv = await R.saveDay(page, saves);
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  assert.equal(sv.args.p_auto, true);
  assert.deepEqual(sv.args.p_lists, lists, 'the lists the preview showed');
  for (const l of lists) assert.deepEqual(R.dayRows(l.truck, D).map((s) => s.id), l.jobs, 'saved in the planner’s order');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('B6. A mechanic (no « Réserver »): only his truck, no other truck to put a stop on, no « Laisser l’app choisir »; his save keeps every window (the late ones are noted for the office, hand_at)', async (t) => {
  h.sql(`update public.settings set role_rights = role_rights || '{"mechanic": {"book": false, "money": false, "hours": true}}'::jsonb where id = 1`);
  const before = R.dayRows(T.complet, D);
  const r = await R.openO({ kind: 'desktop' });
  const { page } = r;
  const previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  await h.signIn(page, who.marc.email, PW);
  await page.goto(h.APP + `#/job/${J.Alice}`);
  await page.getByTestId('job-order').click();
  const sheet = page.getByTestId('dayorder-sheet');
  await sheet.waitFor({ timeout: 15000 });
  await until(() => previews.filter((a) => a.status === 200).length, (n) => n > 0, 20000);
  assert.equal(await sheet.getByTestId(`dayorder-truck-${T.complet}`).count(), 1, 'his truck');
  assert.equal(await sheet.getByTestId(`dayorder-truck-${T.voiture}`).count(), 0, 'not the other');
  assert.equal(await sheet.getByTestId('dayorder-auto').count(), 0, 'no « Laisser l’app choisir »');
  assert.equal(await sheet.locator('[data-dayord-chip]').count(), 0, 'no truck chips');
  await sheet.getByTestId(`dayorder-main-${N.Alice}`).click();
  const m = page.getByTestId('dayorder-menu');
  await m.waitFor({ timeout: 10000 });
  assert.equal(await m.locator('[data-testid^="dayorder-menu-on-"]').count(), 0, 'no « Mettre sur … »');
  await page.waitForTimeout(150);
  await m.getByTestId('dayorder-menu-down').click();
  await m.waitFor({ state: 'detached', timeout: 10000 });
  await R.rowMenu(page, N.Alice, 'down');
  await R.rowMenu(page, N.Alice, 'down');
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Benoit, N.Chloe, N.Denis, N.Alice], 'Alice last');
  const mine = await until(() => lastPreviewMoving(previews, J.Alice), Boolean, 20000);
  const v = verdict(mine.body);
  t.diagnostic(`the server for the mechanic: ${CAMION.map((f) => `${f} ${clock(v[J[f]].eta)}${v[J[f]].late ? ` +${v[J[f]].late} min` : ''}${v[J[f]].early ? ` −${v[J[f]].early} min` : ''}`).join(', ')}`);
  assert.ok(Object.values(v).every((s) => !s.new_win), 'no window re-cut for a mechanic');
  const sv = await R.saveDay(page, saves);
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  const after6 = R.dayRows(T.complet, D);
  assert.deepEqual(firsts(after6), ['Benoit', 'Chloe', 'Denis', 'Alice']);
  for (const s of after6) {
    const b0 = before.find((y) => y.id === s.id);
    assert.deepEqual([s.ws, s.we], [b0.ws, b0.we], `${s.first}: his window kept`);
    assert.equal(s.hand_at != null, !!(v[s.id].late || v[s.id].early), `${s.first}: hand_at only when the save leaves him late or early`);
  }
  assert.deepEqual(await R.allTexts(), [], 'no text went');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('B7. No network: the sheet says so, a stop still moves, « Enregistrer » waits; the network back, it saves', async () => {
  const r = await R.openO({ kind: 'desktop' });
  const { page, ctx } = r;
  const previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  await h.signIn(page, who.nadia.email, PW);
  const sheet = await R.openSheet(page, D, previews);
  await ctx.setOffline(true);
  await sheet.getByTestId('dayorder-offline').waitFor({ timeout: 10000 });
  await R.rowMenu(page, N.Alice, 'down');
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Benoit, N.Alice, N.Chloe, N.Denis]);
  await page.waitForTimeout(1200);
  assert.equal(await sheet.getByTestId('dayorder-save').isDisabled(), true, '« Enregistrer » waits for the network');
  await h.shot(page, 'reorganiser-b7-offline');
  await ctx.setOffline(false);
  await sheet.getByTestId('dayorder-offline').waitFor({ state: 'detached', timeout: 15000 });
  const sv = await R.saveDay(page, saves);
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  assert.deepEqual(firsts(R.dayRows(T.complet, D)), ['Benoit', 'Alice', 'Chloe', 'Denis']);
  x.nothingLeft(r);
  x.noErrors(page);
});

step('B8. A phone (390 × 844) with a real finger (touch events of the browser itself): the grip dragged up reorders and opens no menu; held on the chip « Voiture » it lands at that truck’s end; a finger elsewhere still scrolls the list; saved', async (t) => {
  // more stops on the Voiture, so the list is longer than the screen
  for (const [i, f] of ['Quentin', 'Rosa', 'Sami', 'Tina', 'Ugo'].entries()) {
    customer(f, `514 555-07${20 + i}`, near(0.004 * (i + 1), -0.006 * (i + 1)));
    stopOf(f, T.voiture, 3 + i, 780 + i * 60, 720 + Math.min(i, 3) * 60);
  }
  const r = await R.openO({ kind: 'phone' });
  const { page, ctx } = r;
  await page.setViewportSize({ width: 390, height: 844 });
  const previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  await h.signIn(page, who.nadia.email, PW);
  await h.clearMock();
  const sheet = await R.openSheet(page, D, previews);
  const cdp = await ctx.newCDPSession(page);
  // 1. Chloe's grip up onto Benoit's row
  const f1 = await R.fingerDrag(page, cdp, sheet.getByTestId(`dayorder-grip-${N.Chloe}`), sheet.getByTestId(`dayorder-row-${N.Benoit}`), { where: 'top' });
  t.diagnostic(`the ghost half way (finger): ${JSON.stringify(f1.ghost)}`);
  assert.ok(f1.ghost && f1.ghost.ok, `the ghost under the finger: ${JSON.stringify(f1.ghost)}`);
  await until(() => R.rowsShown(page, T.complet), (l) => l[1] === N.Chloe, 5000);
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Alice, N.Chloe, N.Benoit, N.Denis], 'Chloe before Benoit');
  await page.waitForTimeout(700);
  assert.equal(await page.getByTestId('agenda-menu').count(), 0, 'no appointment menu (a long press there would open one)');
  assert.equal(await page.getByTestId('dayorder-menu').count(), 0, 'no row menu');
  await h.shot(page, 'reorganiser-b8-finger');
  // 2. Denis's grip held on the chip « Voiture »: the end of the Voiture
  await R.fingerDrag(page, cdp, sheet.getByTestId(`dayorder-grip-${N.Denis}`), sheet.getByTestId(`dayorder-chip-${T.voiture}`), { where: 'centre', hold: 700 });
  if (!(await d.noQuestion(page, 1500))) await (await d.question(page)).yes();
  await until(() => R.rowsShown(page, T.voiture), (l) => l[l.length - 1] === N.Denis, 8000);
  const vo = await R.rowsShown(page, T.voiture);
  assert.equal(vo[vo.length - 1], N.Denis, `Denis at the Voiture’s end: ${vo.join(', ')}`);
  // 3. a finger on a row's name (not the grip) scrolls the list
  const body = page.locator('[data-testid="dayorder-sheet"] .sheet-body');
  await body.evaluate((el) => { el.scrollTop = 0; });
  const top0 = await body.evaluate((el) => el.scrollTop);
  const max = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
  t.diagnostic(`the sheet’s body: ${max} px more than it shows`);
  assert.ok(max > 50, 'the list is longer than the screen');
  const at = await R.centre(sheet.getByTestId(`dayorder-main-${N.Alice}`));
  await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(at.x), y: Math.round(at.y), yDistance: -250, gestureSourceType: 'touch', speed: 800 });
  await until(() => body.evaluate((el) => el.scrollTop), (s) => s > top0 + 20, 5000);
  assert.ok((await body.evaluate((el) => el.scrollTop)) > top0 + 20, 'scrolled by a finger outside the grip');
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Alice, N.Chloe, N.Benoit], 'nothing moved by the scroll');
  await h.shot(page, 'reorganiser-b8-scrolled');
  const sv = await R.saveDay(page, saves);
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  assert.deepEqual(firsts(R.dayRows(T.complet, D)), ['Alice', 'Chloe', 'Benoit']);
  const dn = R.dayRows(T.voiture, D);
  assert.equal(dn[dn.length - 1].first, 'Denis', 'Denis saved at the Voiture’s end');
  assert.deepEqual(await R.allTexts(), [], 'no text went');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('B9. Someone else saves the day meanwhile (another stop moved there): the sheet names that person, takes the other order for every stop this session did not move and keeps its own move; saved again', async (t) => {
  const r = await R.openO({ kind: 'desktop' });
  const { page } = r;
  const previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  await h.signIn(page, who.nadia.email, PW);
  const sheet = await R.openSheet(page, D, previews);
  await R.rowMenu(page, N.Chloe, 'first');
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Chloe, N.Alice, N.Benoit, N.Denis]);
  await until(() => lastPreviewMoving(previews, J.Chloe), Boolean, 20000);
  // meanwhile, the owner on his phone: Denis before Benoit
  const other = await saveByApi(who.owner.jwt, [{ truck: T.complet, block: 'day', jobs: [J.Alice, J.Denis, J.Benoit, J.Chloe] }], [J.Denis]);
  assert.equal(other.saved, true, JSON.stringify(other));
  assert.deepEqual(firsts(R.dayRows(T.complet, D)), ['Alice', 'Denis', 'Benoit', 'Chloe'], 'the owner’s order is saved');
  // this session's « Enregistrer »: the server says the day changed; the sheet reloads it and keeps Chloe's move
  const refused = await R.saveDay(page, saves);
  t.diagnostic(`the save answered ${refused.status}: ${JSON.stringify(refused.body).slice(0, 200)}`);
  assert.notEqual(refused.status, 200, 'refused: the day changed');
  assert.equal(refused.body.hint, 'day_changed', JSON.stringify(refused.body));
  const banner = sheet.getByTestId('dayorder-changed');
  await banner.waitFor({ timeout: 20000 });
  const said = flat(await banner.innerText());
  t.diagnostic(`the sheet: « ${said} »`);
  assert.ok(said.includes('Hassan vient d’enregistrer cette journée'), said);
  await until(() => R.rowsShown(page, T.complet), (l) => l.join() === [N.Chloe, N.Alice, N.Denis, N.Benoit].join(), 15000);
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Chloe, N.Alice, N.Denis, N.Benoit], 'the owner’s order, Chloe still first');
  await h.shot(page, 'reorganiser-b9-rebased');
  const sv = await R.saveDay(page, saves);
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  assert.deepEqual(firsts(R.dayRows(T.complet, D)), ['Chloe', 'Alice', 'Denis', 'Benoit'], 'saved: both people’s moves');
  x.nothingLeft(r);
  x.noErrors(page);
});

step('B10. The day’s line « N clients n’ont pas leur nouvelle heure » on the agenda’s day and on Aujourd’hui (one button per day); its list; « Envoyer à N clients » texts each of them once (the fake texting service’s log), pressed again nothing; then a client expected TODAY moved to D and answered « Pas maintenant »: the move’s message has the button, Aujourd’hui says « aujourd’hui (1) » and D’s, one press texts him once and both go', async (t) => {
  // a save by the owner (Denis first) leaves the clients whose window changed owed it
  const saved = await saveByApi(who.owner.jwt, [{ truck: T.complet, block: 'day', jobs: [J.Denis, J.Alice, J.Benoit, J.Chloe] }], [J.Denis]);
  assert.equal(saved.saved, true, JSON.stringify(saved));
  const due = await dueOn(D);
  t.diagnostic(`owed their new hour on D: ${due.join(', ')}`);
  assert.ok(due.includes('Denis') && due.length >= 1, due.join(', '));
  const r = await R.openO({ kind: 'desktop' });
  const { page } = r;
  await h.signIn(page, who.nadia.email, PW);
  await h.clearMock();
  // Aujourd'hui: one button for D
  await page.goto(h.APP + '#/');
  const days = page.getByTestId('told-days');
  await days.waitFor({ timeout: 20000 });
  const n = due.length;
  assert.ok(flat(await days.innerText()).includes(n === 1 ? '1 client n’a pas sa nouvelle heure' : `${n} clients n’ont pas leur nouvelle heure`), flat(await days.innerText()));
  await days.getByTestId(`told-day-${D}`).waitFor();
  assert.ok(flat(await days.getByTestId(`told-day-${D}`).innerText()).endsWith(`(${n})`));
  // the agenda's day: the line and its button
  await page.goto(h.APP + `#/agenda/${D}?view=day`);
  const line = page.getByTestId('told-banner');
  await line.waitFor({ timeout: 20000 });
  await h.shot(page, 'reorganiser-b10-line');
  await line.getByTestId('told-banner-send').click();
  const list = page.getByTestId('tell-sheet');
  await list.waitFor({ timeout: 15000 });
  const go = list.getByTestId('tell-go');
  await until(async () => flat(await go.innerText()), (s) => s === (n === 1 ? 'Envoyer à 1 client' : `Envoyer à ${n} clients`), 15000);
  for (const f of due) assert.ok(flat(await list.getByTestId('tell-reach').innerText()).includes(f), `${f} in the list`);
  await h.shot(page, 'reorganiser-b10-list');
  await go.click();
  await list.getByTestId('tell-sent').waitFor({ timeout: 40000 });
  for (const f of due) {
    const sms = await until(() => d.textsTo(f), (l) => l.length > 0, 15000);
    assert.equal(sms.length, 1, `${f} texted once`);
    const row = R.dayRows(T.complet, D).find((s) => s.first === f);
    assert.ok(sms[0].includes('a changé') && sms[0].includes(`entre ${clock(row.ws)} et ${clock(row.we)}`), `${f}: the new hours in words: ${sms[0]}`);
  }
  assert.equal((await R.allTexts()).length, n, 'exactly N texts');
  assert.deepEqual(await dueOn(D), [], 'nobody owed any more');
  await list.getByTestId('tell-close').click();
  await list.waitFor({ state: 'detached', timeout: 10000 });
  await until(() => page.getByTestId('told-banner').count(), (c) => c === 0, 15000);
  // pressed again (the sheet from the day order's footer would say the same): nobody, nothing sent
  await page.getByTestId('agenda-reorg').click();
  const sheet = page.getByTestId('dayorder-sheet');
  await sheet.waitFor({ timeout: 15000 });
  assert.equal(await sheet.getByTestId('dayorder-send').count(), 0, 'no « Envoyer les heures aux clients » left');
  await sheet.getByTestId('dayorder-close').click();
  assert.equal((await R.allTexts()).length, n, 'still N texts');
  x.nothingLeft(r);
  x.noErrors(page);
  await r.ctx.close();
  // a client expected TODAY (16 h – 20 h), moved to D on a phone and « Pas maintenant »
  const nowMin = Number(h.sql(`select public.now_min()`));
  if (nowMin >= 1080) { t.diagnostic(`it is ${clock(nowMin)} in Montréal: today's last window is nearly over, the « today » part is not run`); return; }
  customer('Gaby', '514 555-0740', near(0.006, 0.006));
  stopOf('Gaby', T.complet, 1, 990, 960, TODAY);
  const p = await R.openO({ kind: 'phone' });
  const pg = p.page;
  const moves = x.answersOf(pg, 'move_job');
  await h.signIn(pg, who.nadia.email, PW);
  await h.clearMock();
  await pg.goto(h.APP + `#/map?day=${TODAY}`);
  const pull = pg.getByTestId('map-pull-handle');
  await pull.waitFor({ timeout: 20000 });
  if ((await pull.getAttribute('aria-expanded')) !== 'true') await pull.click();
  const stop = pg.getByTestId(`stop-${J.Gaby}`);
  await stop.waitFor({ timeout: 20000 });
  await stop.scrollIntoViewIfNeeded();
  await stop.click();
  await pg.getByTestId('map-card').waitFor();
  await pg.getByTestId('map-move').click();
  const ms = pg.getByTestId('move-sheet');
  await ms.waitFor({ timeout: 15000 });
  await pg.getByTestId(`pick-daychip-${D}`).click();
  await pg.getByTestId(`pick-daychip-${D}`).and(pg.locator('[aria-pressed="true"]')).waitFor({ timeout: 20000 });
  await pg.getByTestId('pick-times').waitFor({ timeout: 30000 });
  await pg.waitForFunction(() => !document.querySelector('[data-testid="pick-times"]')?.classList.contains('is-stale'), null, { timeout: 30000 });
  const offered = await pg.$$eval('[data-testid^="pick-time-"]', (bs) => bs.map((b) => Number(b.dataset.testid.replace('pick-time-', ''))));
  const at = offered[offered.length - 1];
  t.diagnostic(`Gaby to ${D} at ${clock(at)} (offered: ${offered.map(clock).join(', ')})`);
  await pg.getByTestId(`pick-time-${at}`).click();
  await pg.getByTestId('move-ok').click();
  for (let i = 0; i < 3 && !(await d.noQuestion(pg, 2500)); i++) await (await d.question(pg)).yes();
  await until(() => moves.length, (v) => v > 0, 20000);
  assert.equal(moves[moves.length - 1].status, 200, JSON.stringify(moves[moves.length - 1].body));
  await ms.waitFor({ state: 'detached', timeout: 15000 });
  const ta = await h.textAsk(pg, { send: false });
  assert.equal(ta.title, 'Texter Gaby ?');
  const toast = pg.getByTestId('toast-info').filter({ hasText: 'Gaby attendait aujourd’hui : sa nouvelle heure n’est pas partie.' }).first();
  await toast.waitFor({ timeout: 10000 });
  const tb = toast.getByRole('button', { name: 'Envoyer les heures aux clients (1)' });
  await tb.waitFor({ timeout: 5000 });
  const box = await toast.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 + 1, `the message fits the phone: ${JSON.stringify(box)}`);
  // its words keep the toast's width (the long button goes under them, never squeezing them to one word a line)
  const words = await toast.locator('.toast-text').boundingBox();
  assert.ok(words.width >= box.width * 0.6, `the words use the toast's width: ${JSON.stringify({ words, box })}`);
  await h.shot(pg, 'reorganiser-b10-toast');
  assert.deepEqual(await R.allTexts(), [], 'nothing texted on « Pas maintenant »');
  assert.deepEqual(await dueOn(TODAY), ['Gaby'], 'owed on today (what he was told)');
  assert.deepEqual(await dueOn(D), ['Gaby'], 'and on D (his new day)');
  // Aujourd'hui: the line counts him once, a button for today and one for D
  await pg.goto(h.APP + '#/');
  const days2 = pg.getByTestId('told-days');
  await days2.waitFor({ timeout: 20000 });
  assert.ok(flat(await days2.innerText()).includes('1 client n’a pas sa nouvelle heure'), flat(await days2.innerText()));
  assert.equal(flat(await days2.getByTestId(`told-day-${TODAY}`).innerText()), 'aujourd’hui (1)');
  await days2.getByTestId(`told-day-${D}`).waitFor();
  await h.shot(pg, 'reorganiser-b10-today');
  await days2.getByTestId(`told-day-${D}`).click();
  const l2 = pg.getByTestId('tell-sheet');
  await l2.waitFor({ timeout: 15000 });
  await until(async () => flat(await l2.getByTestId('tell-go').innerText()), (s) => s === 'Envoyer à 1 client', 15000);
  await l2.getByTestId('tell-go').click();
  await l2.getByTestId('tell-sent').waitFor({ timeout: 30000 });
  const g = await until(() => d.textsTo('Gaby'), (l) => l.length > 0, 15000);
  assert.equal(g.length, 1, 'Gaby texted once');
  assert.ok(g[0].includes('a changé'), g[0]);
  assert.deepEqual([await dueOn(TODAY), await dueOn(D)], [[], []], 'both days done');
  await l2.getByTestId('tell-close').click();
  await until(() => pg.getByTestId('told-days').count(), (c) => c === 0, 15000);
  assert.equal(await pg.getByTestId('told-days').count(), 0, 'the line is gone');
  x.nothingLeft(p);
  x.noErrors(pg);
});

step('B15. A draft kept on the phone: three moves, the page reloaded (an iPhone home-screen app reloads after a call), the sheet opened again on that day says « Ton ordre pas encore enregistré … est revenu » with the three moves; saved', async (t) => {
  const r = await R.openO({ kind: 'desktop' });
  const { page } = r;
  let previews = x.answersOf(page, 'day_order_preview');
  await h.signIn(page, who.nadia.email, PW);
  let sheet = await R.openSheet(page, D, previews);
  await R.rowMenu(page, N.Alice, 'down');
  await R.rowMenu(page, N.Denis, 'first');
  await R.rowMenu(page, N.Chloe, 'up');
  const want = [N.Denis, N.Benoit, N.Chloe, N.Alice];
  assert.deepEqual(await R.rowsShown(page, T.complet), want);
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByTestId('app').waitFor({ timeout: 20000 });
  previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  sheet = await R.openSheet(page, D, previews);
  const back = sheet.getByTestId('dayorder-draft-back');
  await back.waitFor({ timeout: 15000 });
  t.diagnostic(`the sheet: « ${flat(await back.innerText())} »`);
  assert.match(flat(await back.innerText()), /^Ton ordre pas encore enregistré \(\d{1,2} h( \d{2})?\) est revenu : vérifie, puis enregistre\./);
  assert.deepEqual(await R.rowsShown(page, T.complet), want, 'the three moves are back');
  await h.shot(page, 'reorganiser-b15-draft-back');
  const sv = await R.saveDay(page, saves);
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  assert.deepEqual(firsts(R.dayRows(T.complet, D)), ['Denis', 'Benoit', 'Chloe', 'Alice']);
  x.nothingLeft(r);
  x.noErrors(page);
});

/* ---------- Part 29 (Hassan, 2026-11-22: « when re-arranging the day, if i move an appointement down, i need it to change
   its hour, and accept the appointement where i put it without moving all the others arround »; STATE.md 10:35 G1–G7,
   drag-keeps-spec.md §6.3) ---------- */
const OTHERS = ['Alice', 'Chloe', 'Denis'];
/** the drag DOWN of B16 / B17 seen on the screen and in the database: Benoit under Chloe takes the hour of his new place
    (« fixé à … », « avant : vers 10 h »), Alice, Chloe and Denis keep theirs; saved: his order, Benoit pinned at that
    minute; then a booking of that day by API (the planner plans the whole day again): Benoit still at his minute */
async function dragDownChecked(t, page, sheet, previews, saves, at0, tag) {
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Alice, N.Chloe, N.Benoit, N.Denis], 'Benoit under Chloe, nothing saved');
  // right after the drop: the others still show their hour (only the stop dragged is worked out)
  for (const f of OTHERS) assert.equal(flat(await sheet.getByTestId(`dayorder-eta-${N[f]}`).innerText()), R.vers(at0[f]), `${f}: its hour right after the drop`);
  const mine = await until(() => lastPreviewMoving(previews, J.Benoit), Boolean, 20000);
  assert.deepEqual(mine.args.p_moved, [J.Benoit], 'the stop moved');
  const oracle = await x.rpcAs(who.nadia.jwt, 'day_order_preview', mine.args);
  const v = verdict(oracle);
  assert.deepEqual(verdict(mine.body), v, 'the page’s answer is the server’s');
  const b = v[J.Benoit];
  t.diagnostic(`the server: ${['Alice', 'Chloe', 'Benoit', 'Denis'].map((f) => `${f} ${clock(at0[f])} → ${clock(v[J[f]].eta)}${v[J[f]].pin_new ? ` (fixé ${clock(v[J[f]].pin)})` : ''}${v[J[f]].new_win ? ` [${clock(v[J[f]].new_win[0])}–${clock(v[J[f]].new_win[1])}]` : ''}`).join(', ')}`);
  assert.equal(b.pin_new, true, 'Benoit is pinned at the hour of his new place (G1)');
  assert.equal(b.pin, b.eta);
  assert.ok(b.eta >= at0.Chloe + 50, `Benoit after Chloe’s end (${clock(at0.Chloe)} + 45 min + 5): ${clock(b.eta)}`);
  assert.equal(b.eta_before, at0.Benoit);
  for (const f of OTHERS) assert.equal(v[J[f]].eta, at0[f], `${f} keeps its hour (G2)`);
  // the screen: his hour changed, the others not
  await sheet.getByTestId(`dayorder-eta-${N.Benoit}`).filter({ hasText: R.fixe(b.pin) }).waitFor({ timeout: 10000 });
  assert.ok((await R.notesOf(page, N.Benoit)).includes(R.avant(at0.Benoit)), JSON.stringify(await R.notesOf(page, N.Benoit)));
  for (const f of OTHERS) {
    assert.equal(flat(await sheet.getByTestId(`dayorder-eta-${N[f]}`).innerText()), R.vers(at0[f]), `${f}: the same hour`);
    assert.deepEqual(await R.notesOf(page, N[f]), [], `${f}: nothing said`);
  }
  const sum = flat(await page.getByTestId('dayorder-summary').innerText());
  t.diagnostic(`the summary: « ${sum} »`);
  assert.ok(sum.startsWith(`Benoit à ${clock(b.pin)} : fixé là où tu l’as mis. Les autres gardent leur heure.`), sum);
  await h.shot(page, `reorganiser-${tag}-dropped`);
  const sv = await R.saveDay(page, saves);
  assert.equal(sv.status, 200, JSON.stringify(sv.body));
  assert.deepEqual(sv.args.p_accept, oracle.accept, 'the save carries what the screen showed');
  assert.deepEqual(oracle.accept.at, { [J.Benoit]: b.pin }, 'the one minute pinned: Benoit’s');
  const after = R.dayRows(T.complet, D);
  assert.deepEqual(firsts(after), ['Alice', 'Chloe', 'Benoit', 'Denis'], 'saved in his order (G3)');
  const bs = after.find((s) => s.first === 'Benoit');
  assert.deepEqual([bs.at, bs.eta, bs.pinned, bs.manual], [b.pin, b.pin, true, null], `Benoit pinned at his minute, on his truck: ${JSON.stringify(bs)}`);
  for (const f of OTHERS) {
    const s = after.find((y) => y.first === f);
    assert.deepEqual([s.eta, s.at], [at0[f], null], `${f}: its hour, no minute pinned`);
  }
  assert.deepEqual(await R.allTexts(), [], 'no text went');
  // the sheet stays on the saved day: his order, Benoit « Heure fixée »
  await until(() => R.rowsShown(page, T.complet), (l) => l.join() === [N.Alice, N.Chloe, N.Benoit, N.Denis].join(), 10000);
  await sheet.getByTestId(`dayorder-eta-${N.Benoit}`).filter({ hasText: R.vers(b.pin) }).waitFor({ timeout: 10000 });
  assert.ok((await R.notesOf(page, N.Benoit)).includes(`Heure fixée ${clock(b.pin)}`), JSON.stringify(await R.notesOf(page, N.Benoit)));
  for (const f of OTHERS) await sheet.getByTestId(`dayorder-eta-${N[f]}`).filter({ hasText: R.vers(at0[f]) }).waitFor({ timeout: 10000 });
  await h.shot(page, `reorganiser-${tag}-saved`);
  return b.pin;
}
/** a booking of day D by API on the Camion (book_job plans the whole day again, apply_plan_keep): the stop dragged is still
    at its minute, on its truck; every stop of the Camion inside its window (G4: the others may be planned around him) */
async function bookAndCheck(t, first, ws, pin) {
  customer(first, `514 555-07${first === 'Gael' ? 50 : 51}`, near(0.008, -0.016));
  const bk = await x.rpcAs(who.nadia.jwt, 'book_job', { p_op: randomUUID(), p_job: { customer_id: C[first].id, day: D, block: 'day', win_start: ws, truck_id: T.complet, duration_min: 45 }, p_items: [] });
  assert.ok(bk && bk.job_id, `booked: ${JSON.stringify(bk).slice(0, 300)}`);
  const camion = R.dayRows(T.complet, D);
  t.diagnostic(`after the booking: ${camion.map((s) => `${s.first} ${clock(s.eta)}${s.at != null ? ` (fixé ${clock(s.at)})` : ''}`).join(', ')}`);
  assert.ok(camion.some((s) => s.first === first), `${first} is on the Camion`);
  const b = camion.find((s) => s.first === 'Benoit');
  assert.deepEqual([b.at, b.eta, b.truck, b.pinned], [pin, pin, T.complet, true], `Benoit still at his minute after the plan (G4): ${JSON.stringify(b)}`);
  for (const s of camion) assert.ok(s.eta >= s.ws && s.eta <= s.we, `${s.first} inside its window: ${clock(s.eta)} in ${clock(s.ws)}–${clock(s.we)}`);
}

step('B16. Part 29, a computer: Benoit dragged DOWN under Chloe with the mouse → his row says the hour of his new place « fixé à … » (« avant : vers 10 h »), Alice, Chloe and Denis keep their hour (right after the drop too); « Enregistrer »: his order, Benoit pinned at that minute; then a booking of that day by API (an automatic plan of the day): Benoit still at his minute', async (t) => {
  const at0 = Object.fromEntries(R.dayRows(T.complet, D).map((s) => [s.first, s.eta]));
  const r = await R.openO({ kind: 'desktop' });
  const { page } = r;
  const previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  await h.signIn(page, who.nadia.email, PW);
  await h.clearMock();
  const sheet = await R.openSheet(page, D, previews);
  for (const f of CAMION) await sheet.getByTestId(`dayorder-eta-${N[f]}`).filter({ hasText: R.vers(at0[f]) }).waitFor({ timeout: 10000 });
  // the mouse drags Benoit's whole row to the lower half of Chloe's
  const dr = await R.mouseDrag(page, sheet.getByTestId(`dayorder-main-${N.Benoit}`), sheet.getByTestId(`dayorder-row-${N.Chloe}`), 'bottom');
  assert.ok(dr.ghost.ok, `the ghost under the pointer: ${JSON.stringify(dr.ghost)}`);
  assert.equal(await page.getByTestId('dayorder-menu').count(), 0, 'a drag opens no row menu');
  const pin = await dragDownChecked(t, page, sheet, previews, saves, at0, 'b16');
  // reopened: the same hours
  await sheet.getByTestId('dayorder-close').click();
  await sheet.waitFor({ state: 'detached', timeout: 10000 });
  const again = await R.openSheet(page, D, previews);
  assert.deepEqual(await R.rowsShown(page, T.complet), [N.Alice, N.Chloe, N.Benoit, N.Denis], 'reopened: his order');
  await again.getByTestId(`dayorder-eta-${N.Benoit}`).filter({ hasText: R.vers(pin) }).waitFor({ timeout: 10000 });
  x.nothingLeft(r);
  x.noErrors(page);
  await bookAndCheck(t, 'Gael', 600, pin);
});

step('B17. Part 29, a phone (390 × 844) with a real finger on the grip: the same drag DOWN (Benoit under Chloe) → the same hours shown, before and after « Enregistrer »; then a booking of that day by API: Benoit still at his minute', async (t) => {
  const at0 = Object.fromEntries(R.dayRows(T.complet, D).map((s) => [s.first, s.eta]));
  const r = await R.openO({ kind: 'phone' });
  const { page, ctx } = r;
  await page.setViewportSize({ width: 390, height: 844 });
  const previews = x.answersOf(page, 'day_order_preview');
  const saves = x.answersOf(page, 'day_order_save');
  await h.signIn(page, who.nadia.email, PW);
  await h.clearMock();
  const sheet = await R.openSheet(page, D, previews);
  for (const f of CAMION) await sheet.getByTestId(`dayorder-eta-${N[f]}`).filter({ hasText: R.vers(at0[f]) }).waitFor({ timeout: 10000 });
  const cdp = await ctx.newCDPSession(page);
  const f1 = await R.fingerDrag(page, cdp, sheet.getByTestId(`dayorder-grip-${N.Benoit}`), sheet.getByTestId(`dayorder-row-${N.Chloe}`), { where: 'bottom' });
  assert.ok(f1.ghost && f1.ghost.ok, `the ghost under the finger: ${JSON.stringify(f1.ghost)}`);
  await until(() => R.rowsShown(page, T.complet), (l) => l[2] === N.Benoit, 5000);
  assert.equal(await page.getByTestId('dayorder-menu').count(), 0, 'no row menu');
  const pin = await dragDownChecked(t, page, sheet, previews, saves, at0, 'b17');
  x.nothingLeft(r);
  x.noErrors(page);
  await bookAndCheck(t, 'Hugo', 840, pin);
});
