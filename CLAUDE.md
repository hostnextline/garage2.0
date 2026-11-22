# CLAUDE.md — Mécanique Mobile H.I.S (garage2.0)

The team app of Hassan's mobile garage in Montréal. Read `docs/ARCHITECTURE.md` (code map, data layer, RPCs, test ids)
and `docs/DESIGN.md` (the look and the writing rules) before changing anything. `README.md` is the short French tour.

## Working with Hassan

- He writes in French: answer in informal Québécois French (English if he writes English). He is visual: prefer
  tables (before / after, tested / not tested) to technical paragraphs.
- « Fini » means tested from A to Z: unit, database, API and end-to-end tests, plus the real thing on the live app
  when it matters, with real writes put back exactly as they were. Always say clearly what was NOT tested.
- The people using the app are beginners: simple words, one obvious action per screen, help bubbles « ? ».
  French (Québec) first, English second, phones first. Every text exists in `src/i18n/fr` and `src/i18n/en`.
- Commit messages in French. `[important]` in the first line makes the phones show the update notice.

## Branches and publishing

- `main` and `construction-v2` stay equal: push `main`, then `git push origin main:construction-v2`.
- A push to `main` runs `.github/workflows/deploy.yml`: `npm test`, build, then publishes two branches (the notes
  shown in « Mise à jour de l'app » are the first line of the last commit that changes the app itself: commits of
  only `CLAUDE.md`, `docs/`, `README.md`, `tests/`, `.github/` or `ops/` are skipped, so write that line for the team):
  - `vercel` → https://mecanique-mobile-his.vercel.app/ (Vercel team NextLine Pro, project mecanique-mobile-his;
    see `ops/vercel/README.md`). This is the app's address; links sent to customers use it.
  - `gh-pages` → https://hostnextline.github.io/garage2.0/ (old address, still works, shows « new address »).
- CI runs only the unit tests. Run the database and end-to-end suites yourself before pushing a change to them.

## Tests

| What | Command | Where it runs |
|---|---|---|
| Types | `npx tsc --noEmit` | anywhere |
| Calculations and screens (~860) | `npm test` | anywhere |
| Local copy of the server | `bash tests/stack/start.sh` (new migrations: `bash tests/stack/migrate.sh`, rebuild: `bash tests/stack/reset.sh`) | Linux x86_64 only (Postgres 16 in `/usr/lib/postgresql`, Linux GoTrue and PostgREST binaries) |
| Database rules and server functions (45) | `node --test --test-concurrency=1 tests/db/*.test.mjs tests/api/*.test.mjs` | needs the local copy |
| The whole app (17 steps, production build, real sign-in) | `node --test tests/e2e/app.test.cjs` (one step: `--test-name-pattern="…"`) | needs the local copy; puts the database back at the end; pictures in `tests/out/` |
| Database rules on a Mac | `bash tests/stack/mac/db-tests.sh [file or pattern]` (« Vraies routes »: `bash tests/stack/mac/db-tests.sh vraies-routes`); after any end-to-end run: `FRESH=1 bash tests/stack/mac/db-tests.sh` | the Mac stack (`tests/stack/mac/README.md`, `export HIS_STACK=…`); a browser run leaves rows the reconciliation tests then see: FRESH=1 starts from a new database |
| Server functions on a Mac | `bash tests/stack/mac/api-tests.sh [file or pattern]` (« Vraies routes »: `drive`; the nightly job and the way back of CUTOVER.md: `bash tests/stack/mac/api-tests.sh ops/tests/sauvegardes.test.mjs`) | the Mac stack; fake TomTom (key `tt-test`) and OSRM on 8021 |
| « Vraies routes » end to end (9 steps) | `bash tests/stack/mac/e2e-file.sh routes` (Mac) or `node --test tests/e2e/routes.test.cjs` (Linux) | its own production build WITH a fake browser TomTom key (`tt-browser-test`); every request to a host it does not fake fails the step; about 1 min |
| « Déplacer à l'heure choisie » end to end (9 steps; the last: « Texter … ? » answered « Pas de texto ») | `bash tests/stack/mac/e2e-file.sh deplacer` (Mac) or `node --test tests/e2e/deplacer.test.cjs` (Linux) | window mode, the real server's `move_preview` / `move_job` with `p_exact`; « Vraies routes » on in its two last steps (the fake TomTom and OSRM); every request to a host it does not fake fails the step; about 30 s; then `FRESH=1` for the database tests |
| The other browser files | `bash tests/stack/mac/e2e-file.sh plages` (window mode, switch off), `… argent`, `… mise-a-jour` (yesterday's app with its data updated to this build) | the Mac stack; `tests/stack/mac/all.sh` runs these three, `routes` and `deplacer` after `app.test.cjs`; GitHub's `tests-complets.yml` runs `app`, `plages` and `argent` (not `mise-a-jour`, `routes`, `deplacer`) |

On a Mac, the rows with `tests/stack/mac/…` run the database, API and end-to-end suites (`bash tests/stack/mac/e2e.sh`
for the steps of `app.test.cjs`, `bash tests/stack/mac/e2e.sh <name>` or `bash tests/stack/mac/e2e-file.sh <name>`, the
same, for the other files); the
`bash tests/stack/start.sh` and `node --test …` rows are for Linux (a Claude Code cloud session, or GitHub's
`tests-complets.yml`). Photon (addresses) is mocked in the end-to-end tests with `ctx.route`; `routes.test.cjs` also
fakes TomTom's tiles, routing and geocoding for the browser.

## The live database (Supabase project `garage2`, ref `wyxvizxabqgvsiiemvfw`)

It holds the garage's real customers and appointments.

- Never `DELETE`, `DROP` or `TRUNCATE` on live. Never insert jobs to test (`job_number_seq` is not rolled back).
- Try a change on live inside a block that ends with `raise exception` (everything is rolled back) and returns what
  you need to see as JSON; then check the live state is unchanged.
- Migrations live in `supabase/migrations/` (numbered « Part N » in their first comment). After pushing, apply one
  to live by fetching the file at the pushed commit and checking its sha256 (`sha256sum` locally):

```sql
do $do$
declare r record; body text; sha text;
begin
  select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<commit>/supabase/migrations/<file>.sql');
  body := r.content;
  sha := encode(extensions.digest(convert_to(body, 'UTF8'), 'sha256'), 'hex');
  if sha <> '<sha256 of the local file>' then raise exception 'sha mismatch: %', sha; end if;
  execute body;
  insert into supabase_migrations.schema_migrations (version, name, statements) values ('<version>', '<name>', array[body]);
end $do$;
```

- THE REBUILD (« refonte ») IS LIVE since 2026-11-21: its six migrations `20261116000100` … `20261116000600` and twelve server
  functions at `837c89d8` (20:06), the app `d7b6c0d2` (published about 23:10; `main`). `ops/live/CUTOVER.md` sections 1–5 tell
  that night (done). Part 27 alone, from today's live: `ops/live/PARTIE27.md`.
- Applied on live before the rebuild: every migration up to `20261119000100_heures.sql` (« Heures travaillées », Part 26 of live, applied 2026-11-19 from commit `5e77db6` of the
  live branch with the sha256 check; this file is the same byte for byte); before it: `20261115000100_fenetres.sql` (« Plages d'arrivée », applied 2026-11-15 from commit `6b978bd` with the sha256
  check; INERT while `settings.booking.windows_on` is not true: the owner flips it in Réglages → Réservations, `windows_switch`, and back the
  same way, nothing lost; functions `notify`, `book`, `client` deployed pinned to `6b978bd` the same day);
  before it: `20261114000100_garde_route.sql` (Part 25, applied 2026-11-15 from commit `aabe852`;
  before it: `20261113000300_appels_reglage.sql`; `20261113000100_suivi_huile.sql`, Part 24 sedecies, applied 2026-11-13 from commit `06851dd`;
  before it: `20261112000400_texto_entrant.sql`, Part 24 quindecies, applied 2026-11-13 from commit `4142fac`;
  Part 24 quaterdecies applied 2026-11-12 from commit `665ba06`;
  Part 24 terdecies applied 2026-11-12 from commit `502e7a3`,
  BEFORE its app is published: neutral while every vehicle has `tire_machine = true` and `shared_routes` is off;
  Part 24 duodecies applied 2026-11-12 from commit `a5d1edf`;
  Part 24 undecies applied 2026-11-11 from commit `2f75cc5`;
  Part 24 decies applied 2026-11-11 from commit `9791d65`;
  Part 24 nonies applied 2026-11-10 from commit `c8c507c`;
  Part 24 octies applied 2026-11-10 from commit `b87b956`;
  Part 24 septies applied 2026-11-09 from commit `9d06aa3`;
  Part 24 sexies from commit `d8f87f6`
  through the Claude Code MCP `supabase-garage`; Parts 24 quater and quinquies from
  commit `9c02c8b`; Part 24 ter from `a4f2da6`;
  Part 24 bis from `e9d9652`, Part 24 from `9835d52`, all with the
  sha256 check; Parts 21–22 were applied through the connector's `apply_migration` and recorded under the wrong versions, fixed the
  same day with `ops/live/2026-11-08_versions_migrations.sql`, so `schema_migrations` now matches the file names). Part 22: the
  mechanic of the job's truck may also put jobs in the Coffre (`coffre_may_add`). Part 24 bis (`20261108000150_coffre_pour_tous.sql`):
  « Payé par le Coffre » is for every member of the team (`coffre_may_add` = `is_staff()`; the app's `mayCoffre`, the Coffre sheet
  and the job menu follow).
- NOT on live: Part 27 « Vraies routes » (`20261119000200_vraies_routes.sql`, the function `drive`, the TomTom keys):
  its runbook from today's live is `ops/live/PARTIE27.md` (the keys, the measure and the switch: `ops/live/CUTOVER.md`
  section 5 bis; the way back: section 7), nothing without Hassan's go.
- Server functions (`supabase/functions/`) are deployed from raw GitHub files pinned to a commit (`verify_jwt` off):
  since 2026-11-21 the twelve functions of the rebuild all at `837c89d8` (`drive`, Part 27's, not deployed). Before the
  rebuild: `notify`, `book` at `408de6c`; `conversation`, `ring` at `5f6640b` (2026-11-13, pictures and documents; before: `4142fac`); `client` at `d8f87f6`; `enroute` at `a4f2da6`; `team` at `8f15959`; `backup` at `b87b956`; `hermes` at `8db1695`;
  the others (`conversation`, `stripe`, `vin`) at `2610bc8`.
  Shared code is in `supabase/functions/_shared/` (a pinned function also reads `_shared` at its own commit).
- Live access: since 2026-11-09 through the Claude Code MCP server `supabase-garage` (scoped to this project; the claude.ai Supabase
  connector now points at another organization). Before: the claude.ai connector (`execute_sql`, `apply_migration`, `get_advisors`).
- Free plan: the project pauses after a week without use.

## Things to know before touching them

- Planner (`supabase/migrations/20261104000300_planner.sql`, replaced in Part 17): customers book a block (matin
  8–12, après-midi 12–16, soir 16–20); `plan_block` puts each job on a truck by cheapest insertion from the trucks'
  starting point, then `route_improve` reorders each truck's stops. Driving: with « Vraies routes » off (live today) it
  is estimated in a straight line × detour at `speed_kmh` (settings `booking`), not real traffic; on, it is the real
  road times measured by TomTom (OSRM behind), never a straight line (« Vraies routes », Part 27, below). Jobs en route
  or on site never move.
- « Départ des camions » = `settings.booking.home` {label, address, lat, lng}. Live: Centrale, 1401 rue Legendre
  Ouest, Montréal (45.5312898, -73.6544639). Edited in Réglages → Réservations (first panel); also reached from
  Horaires (first row of « Les camions ») and the map legend (« Changer »). Moving it, or changing a number of the
  route estimate, re-plans every coming booked block (trigger `settings_replan`); the name alone does not. With
  « Vraies routes » on, `speed_kmh` and `detour` re-plan nothing (they are not used) and « Heures de pointe »
  (`roads_rush`) does (`plan_inputs`).
- Positions: addresses are found with TomTom (when the app has its browser key) and Photon together
  (`src/shared/places/places.ts`, `locate.ts`, `match.ts`, `tomtom.ts`): TomTom first; when its answer does not have the
  door typed with its position, Photon is asked too and the two lists are merged (a door with its position wins over a
  street without one; two answers with the same street words but 250 m apart or more are both kept, so the person is
  asked which: `apart` in `photon.ts`); TomTom gets 2.5 s and rests a minute after a refusal or no answer; without the key,
  Photon alone, exactly as before. A postal area after a comma (« …, H4P ») is not taken for the town (`match.ts`). Only a
  sure answer is taken. `src/shared/customers/locator.ts` finds missing positions in the
  background (TomTom answered but Photon is down: the address is asked again at the next round, not in 6 h); a position
  found later re-plans its block (Part 15).
- « Besoins de la semaine » (`#/needs`, Part 16): oil, filters, tires and parts the week's appointments need, from
  `services.needs` and the car's facts.
- Start per truck (Part 18, `20261106000400_truck_start.sql`, applied on live 2026-11-07): `trucks.start`
  {label, address, lat, lng} or null (= « Départ des camions »), changed with `set_truck_start` (owner, office with
  « hours », or the truck's driver) in Horaires → « Départ de ce camion ». The morning leaves from the truck's start;
  the afternoon and evening from its last stop of the block before; each block tries to end near the truck's first
  stop of the next block (`route_min_to`, counted in the order, not in the block's room: an order that no longer
  fits in the truck's hours is never taken for it). When a block's plan changes, `apply_plan` re-plans the day's
  other coming blocks in block order (the block that changed again when one before it moved, so every block counts
  from where its truck really is), unless that would push a booked job to « À placer ». `replan_days` (hours, starts,
  route numbers) goes day by day in block order without that chain (twice faster; ~0.4 s for 240 coming jobs).
- Réglages opens for everyone (`may.settings` is always true): a mechanic sees only « L'app » (« Mise à jour de l'app »);
  the sections that change the garage need the « settings » right (`may.settingsEdit`), « Apparence » and « Connexions » the owner.
- Rights: live gives « hours » to every mechanic (`settings.role_rights`), which opens every truck in Horaires.
  Without it, a mechanic still opens Horaires on the truck he drives only (`may.hours`, Part 18 follow-up), as the
  server allows (`truck_hours_editable`).

- « Réserver quand même » (Part 19, `jobs.forced`): owner/office book a full block after a warning; the forced job goes
  at the end of the route, nobody loses a place. « Coffre » (Part 20): family/friends jobs, no invoice, no taxes, own
  register (`coffre`, read only through `coffre_report`: owner and « Trésorerie », exported apart in #/coffre).
- « Ordre des arrêts » (Part 21, `jobs.manual_order`): owner, office (« book ») or the truck's driver put a truck's
  booked stops of a block in the order wanted (`set_stop_order`, empty list = back to the planner). `plan_block` keeps
  them right after the stops en route / on site; moving a job to another day, block or truck clears its place. Switch
  « Vraies routes » on: the arrival times and « Hors plage » / « En retard » of the order built are the server's
  (`stop_order_preview`, asked 600 ms after the last change); a stop whose trips are not all measured has no time
  (« heure : trajets pas encore mesurés ») and is never said late; no answer: no time, « Heures d’arrivée : pas encore
  calculées », saving still works.
- « Réserver en ligne » is **switched off since 2026-11-09** (live `settings.booking.web.on = false`: the page says « fermée », `book`
  refuses with `web_off`; the « Réservation en ligne » panel is hidden in Réglages) until Hassan and Claude rework it together.
- « Réserver en ligne » (Part 23, `20261107000500_web_booking.sql`, applied on live 2026-11-07 from commit `7b1b86b` with the
  sha256 check; server function `book` deployed pinned to `7b1b86b`, link open): one public link `client.html#reserver` (Réglages → Réservations, second panel « Réservation en ligne »: on/off, copy). The
  customer picks services, an address (TomTom and Photon, must be ≤ `booking.web.max_km` (60) from the start), one of the 6 best blocks
  over 14 days (`suggest_core`, same ranking as `suggest_blocks`; « Voir d'autres dates » = next 14), then name/phone/car.
  `web_book` finds the customer by phone (file not changed) or creates one, books with `source = 'web'`, sends the usual
  booking text. Brakes: 2 coming web jobs per phone, 30 web bookings an hour, a hidden field for robots.
- Phase 0 of the audit of 2026-11-08 (Part 24, `20261108000100_phase0_safety.sql`, live since 2026-11-08): `block_open(day, block)` is the one rule for « may this block still be re-planned »; `replan_block`
  and `set_job_duration` leave a started block alone (a cancel at 11:20 no longer throws the other morning jobs to « À placer »).
  `rate_limits` + `rate_hit(key, window_sec, max)`: the brake of the public `book` function (« slots » 20 / 10 min per visitor,
  150 / h in all; « book » 12 tries / h per visitor → `busy`, 429). `web_book` makes the customer's link itself (`p.token_hash`), returns the
  job already made for the same booking sent again within 10 min (`again: true`, no second job or text), and counts its brakes under
  a lock; `web_suggest` caps at 14 days. The robot field of the booking page is `bk_f` (« website » was filled by phones' autofill);
  a filled one is noted in `activity` (`web_robot`). `remove_member(staff)` = « Retirer » in one transaction; `setSecrets` writes the
  three Stripe secrets together and every database refusal is an error. The backup now includes `coffre`, `positions`,
  `position_log`, `op_log`, `stripe_events` (test: every table is backed up or listed in `never`). `ops/live/2026-11-08_versions_migrations.sql`
  fixes two misrecorded versions in live's `schema_migrations` (to run by hand, dry run first).
- 🤖 Hermes (Part 24 octies, `20261110000100_hermes_questions.sql`; function `hermes`; `src/features/hermes/`): a round button at the
  bottom right of every screen for everyone on the team (not while « Voir l'app comme… »). Each question goes with a picture of the
  garage built by the app from what THAT person may see (`context.ts`: their jobs; prices only with « Argent »/« Factures »; unpaid
  invoices with « Factures »; stock with « Inventaire »; the month's expenses with « Trésorerie »; never customer phones or addresses)
  to the Hermes server (DigitalOcean 142.93.150.240, profile `garage` of the multiplexed gateway, `https://142-93-150-240.sslip.io/p/garage`,
  its own `API_SERVER_KEY`; memory, user profile, session search and skills switched off so nothing passes from one person to another;
  model through the owner's ChatGPT subscription). Brakes: 30 questions an hour per person, 200 for the garage (`rate_hit`).
  Private: each person sees only their own conversation (the panel says the owner can read the questions); every question is kept
  with its answer in `hermes_questions` (no access from the app; backed up) and only the owner reads them (« Questions de l'équipe »,
  `{ action: 'log' }`). The key lives only in `secrets` (`hermes_url`, `hermes_key`); it was put there by the Hermes server itself
  with `{ action: 'pair', code, url, key }` and a one-time code (`hermes_pair` = sha256|expiry, 10 minutes, then deleted): to change
  the key, do the same pairing again, never copy the key by hand.
- « Modifier le rendez-vous » (Part 24 nonies, `20261110000200_job_customer.sql`; `src/features/jobs/JobEdit.tsx`): a « Modifier »
  button on the job screen (also first in its ⋯ menu and in the agenda's right-click / long-press menu, `?do=edit`) gathers every
  fix of an appointment: customer, car, address of this appointment only, day and block, truck, services and prices, problem and
  notes. « Changer de client » = `job_customer(op, job, customer, vehicle)`: booked only, no finished invoice, book right or the
  truck's mechanic; the chosen car (must be that customer's) or the customer's only car; the customer's address; the wrong
  customer's links revoked and signatures cleared, `confirm_sent_at` null (resend the booking text), draft invoice follows,
  activity `customer_changed`. The address view keeps a min height (`.jobs-edit-address`) so closing the suggestions does not
  move the « Garder » button under the finger.
- « Modifier la facture » (Part 24 decies, `20261110000300_facture_modifiable.sql`): the invoice changes before and during the
  appointment, without cancelling it. `invoice_reopen(op, invoice)`: a finished invoice not paid, its job booked / en route / on
  site, for whoever may finish it (`invoice_editable`) → back to a draft with its number; its payments wait on the job
  (`invoice_id` null, « Le client a déjà payé … ») and the customer's open card page is forgotten (`public_links.last_session*`);
  activity `invoice_reopened`. `invoice_finish` keeps a reopened invoice's number (`again: true`, no number spent). On live
  until the refonte it refuses a total under what was paid (`below_paid`); in the refonte (owner's decision of 2026-11-20: « easy for
  the mechanic, prevent mistakes, don't restrict them too much ») it finishes « paid » with `over_cents` and the activity `overpaid`:
  the phone asks first (« {over} à remettre au client », « Oui, terminer ») and the office gives the difference back (« Trop-perçu »). `payment_add`: a card payment (no person) landing on a reopened draft waits on the
  job instead of being refused. Trigger `job_items_invoice_follow`: a job line taken off (removed, declined, deleted) leaves the
  draft invoice; a new price / quantity / words go on its line (only what changed: a price typed on the invoice stays when the work
  is only marked done); a person may not take off or reprice work billed on a FINISHED invoice (`invoice_done`: « Modifier la
  facture » first; « a person » = the request's `role` setting, which a security definer function does not change).
  `job_item_price` answers the invoices too. App: `ReopenButton` / `mayReopen` (`InvoicePanel.tsx`; finished invoice panel, invoice
  screen, and the line sheet of billed work: `item-locked`); the draft shows `draft-reopened`; removing a line of the job's work in
  the invoice editor marks that work « Pas fait » (`onRemoveWork`, undo puts it back); after a `job_items` change is sent the phone
  pulls `invoices` (`sync.ts`), so the draft on screen follows even without realtime.
- Stripe test keys are refused on live (`team` `secrets-set`, since 2026-11-11): the app has one database, so a test card payment
  would mark a real invoice PAID and an online payment cannot be removed (`payment_remove` refuses `card_online`). A test copy of
  the server allows them with a `secrets` row `stripe_test_ok = 'on'` (the API tests insert it; never on live).
- « Historique du véhicule » (Part 24 undecies, `20261111000100_historique_niv.sql`; `src/features/customers/VinHistory.tsx`): the car
  has its own file by its VIN (like Serti). `vin_history(vin, customer)` (every member of the team): each visit of a car with that VIN,
  whoever owned it (not cancelled / no show; a Coffre visit only for the owner): day, number, status, the work lines, `here` (this
  customer's) and `open` (`job_id_visible`); never the other owner's name, phone, address or prices. App: under any VIN of 17
  characters (`VinField`, so the add sheet, the new customer's car and « Modifier » the car) « Déjà venu chez nous : N visites » +
  « Voir l'historique » (`VinSeen`); the car's screen shows « Historique du véhicule » from the server (`useVinHistory`, asked
  before any early return), the local job tickets when there is no VIN or no network. Live had only 2 VINs of 35 cars (2026-11-11).
- « Le NIV de l’auto » before the work starts (no server change; `src/features/jobs/vinStep.ts`, `CarCheckSheet.tsx`, `nextStep.ts`): once
  on site, while the job's car has no VIN (or the job has no car), the red button is the step `vin` (before the signature, for
  whoever may act; a walk-in too). Its sheet (the same `car-check`, opened by itself after « Je suis arrivé », `need`): scan or type
  the VIN, or pick one of the customer's cars that already has one (`car-check-pick` → `jobs.vehicle_id`), the km still optional; no
  « Plus tard » there, but « NIV illisible » (two taps, `car-check-skip`): the job goes on, remembered on that device only
  (`his-vin-skip`). `vinPlan`: a VIN the customer's other car already has → that car becomes the job's; else it goes on the job's car
  (with what the VIN says where the file is empty); a job with no car gets a new car made from the VIN. Only in the app: the server
  does not refuse a signature or an invoice without VIN.
- « Historique de l’auto » (`src/features/customers/CarHistory.tsx`, `CarHistoryButton`): on the job's car card (`CarFirst`), beside each
  car of the customer's file, and on the car's file. With a VIN of 17 characters: `vin_history` (every visit with us, whoever owned
  the car; « Autre propriétaire » on the others, never their name or prices); without VIN, without network, or when the server has
  nothing: the visits of that car's own file from the phone.
- « La voiture » à l’arrivée (Part 24 duodecies, `20261112000100_km_visite.sql`; `src/features/jobs/CarCheckSheet.tsx`): right after
  « Je suis arrivé » (after the « text to send by hand » sheet, `outcomeClosed`), a sheet asks the km on the dashboard and the VIN when
  the car has none (scan); « Plus tard » skips it. `jobs.odometer_km` (column grant like the notes; `jobs_upd` decides who); trigger
  `jobs_km_follow` raises `vehicles.odometer_km` to the highest visit km (never lowers it); `vin_history` answers `km`. The job sheet
  shows « N km à cette visite » with « Noter le km » / « Corriger » (on site or done); the invoice PDF writes the visit's km.
- Routes by the streets everywhere (`src/shared/map/useRoads.ts`, `roads.ts`), switch « Vraies routes » on or off: « Carte »,
  « Aperçu », « Vue d'ensemble » and « Voir sur la carte » ask TomTom when the app has its browser key, then OSRM
  (`router.project-osrm.org`), then its FOSSGIS copy (`routing.openstreetmap.de/routed-car`); today's routes « now »,
  another day's for its usual hours (11:30, `departOf`; a day gone: the same weekday to come), kept apart (today's under its
  date); each total says its planner and what a stop adds is said only when one planner measured both (`roadAdded`).
  NOTHING is drawn between two stops until a real road comes (no straight piece to the street either; Hassan's rule,
  2026-11-19); the legend says « Route en cours de calcul… » / « Route indisponible pour l’instant » / « Route impossible à
  tracer » (`roadState`, `roadNote`). A route nobody answered is asked again a minute later; a live trip without the
  server's road is asked at most once a minute per stop, never when the server gave its road; a stored two-point « road »
  (old « Je pars ») is not a road. Tiles (`src/shared/map/MapView.tsx`, `src/client/track/TrackMap.tsx`): TomTom's with
  the key; a tile fails → one plain request of that tile (`checkTile`, `src/lib/tomtom.ts`): TomTom refuses (400 / 401 /
  403 / 429 / 5xx) → OpenStreetMap's tiles on every map for the rest of the visit, never back; no answer (no network, a
  tunnel, a Wi-Fi asking to sign in) never switches; a tile from the phone's cache proves nothing (the service worker keeps
  the tiles it showed, TomTom's too: `vite.config.ts`).
- « Voir sur la carte » of a booking moment (`src/shared/moment/RoutePreview.tsx`, `preview.ts`) and « Choisir sur la carte »
  (`MomentMap.tsx`): right-click / long press on a suggestion or a calendar cell of `BlockPicker` (menu « Choisir ce moment »,
  « Voir sur la carte »), or the button under the moment chosen. « Vraies routes » OFF: the vehicle's day with the new stop
  where the phone's estimate puts it (the place and the number only: no km of it is ever said), the day's road by the
  streets for that day, and what the stop adds only from two totals of the same planner (`roadAdded`), else « Route
  ajoutée : pas encore calculée »; the same estimate gives « Arrêt 2 sur 4 de la journée » on every suggestion (`stopRank`,
  tag `bp-sugg-order`). ON, nothing by straight line: the vehicle, the place and the order come from the server's row
  (`src/domain/moment/serverPlace.ts`: rank / route read only in window mode, `block = 'day'`; blocks mode says nothing of
  the order and the new stop is a pin without a number), what it adds and the day with it are the row's real driving
  (« pas encore mesurée » while a trip is not measured), never another vehicle's numbers. The block calendar's room comes
  from the rows (a row = room, an answered page without one = « Complet », no answer = « À vérifier », pickable); a banner
  says when the address is being measured or could not be (« Réessayer »), and the pickers ask again by themselves when a
  measure lands (`roadsTick`). The agenda's drag and drop asks « Beaucoup de route ce jour-là » after the confirm question,
  waiting the measure's seconds too.
- « Appel entrant » (`#/call`, `src/features/booking/CallScreen.tsx`; « + » menu first): the number finds known customers (`callMatches`:
  phone digits, 3 at least) with « Réserver pour … », file, next appointment. New caller: « L’adresse » / « La voiture » / « La job »
  → `#/book?call=1&start=…&phone=…`: BookScreen shows the panels in that order (`callOrder`), the name and number last (`call-who`);
  « Réserver » makes the customer (with the address) and the car once (`makeCaller`, kept in a ref), then books (`source = 'phone'`).
  A number already on file: « C’est lui ».
  Several cars for a new caller (`cars` in BookScreen, « Ajouter une autre voiture » `call-car-add`, tabs `call-car-tab-N`): each car
  typed has the id its file will get, so the per-car work (`carts`, `chooseVehicle`) and `bookCars` work as for a known customer's
  cars: one appointment per car, same block. With several cars, a car that has work must be described (`carBad`).
- « Appel entrant » from GoHighLevel (Part 24 quaterdecies, `20261112000300_appel_ghl.sql`; function `ring`; `src/features/booking/CallBanner.tsx`):
  a GoHighLevel automation (inbound call → Webhook POST) calls `ring?k=<key>` (the key is made by `{ action: 'link' }`, owner only, kept in
  `secrets.call_hook`; made once, never changed from the app: `renew` is refused, Hassan's rule), which notes the call in `incoming_calls` (owner-only read, not backed up, a day kept). The
  owner's app (`CallHost` in the shell: realtime + asked every 10 s) shows a banner with the number and the name (our customer's if the
  number is on file) for 3 minutes; « Ouvrir » → `#/call?phone=…&name=…` (the name pre-fills a new caller). Réglages → Branchements →
  « Appels entrants »: the address, the GoHighLevel steps, « Essayer » (`{ action: 'test' }`: a pretend call from « Client TEST »).
- « Texto entrant » from GoHighLevel (Part 24 quindecies, `20261112000400_texto_entrant.sql`; functions `ring`, `conversation`;
  `src/features/conversation/TextHost.tsx`, rules in `texts.ts`): a GoHighLevel automation (« Customer Replied », SMS → Webhook POST)
  calls `ring?k=<key>&t=sms` (the calls' key), which notes the text in `incoming_texts` (phone, name, body; read only by an owner who switched it on for their own account,
  `staff.prefs.texts = true`, the switch « Recevoir les textos dans mon compte »: live has two owners, only Hassan takes the texts; not
  backed up, a week kept). That account's app (`TextHost` in the shell: realtime + asked every 15 s) shows a messenger-like bubble beside 🤖:
  on a computer the small window opens (one at a time), on a phone a round head with a few words; « Réduire » = round head with the
  count of new texts, « Fermer » = gone until that number writes again (state per number on the device, `his-text-chats`). The window
  shows GoHighLevel's conversation (`conversation get`; by `phone` for a number with no file, owner only) and answers from the garage's
  number. Réglages → Branchements → « Textos entrants »: the address, the GoHighLevel steps, « Essayer » (`{ action: 'test', kind: 'text' }`).
  The alert while the app is closed (same Part): « M’avertir quand l’app est fermée » (per device, `src/features/conversation/push.ts`)
  asks the browser for a Web Push address and keeps it in `push_subs` (own rows only, an owner only, not backed up); `ring` sends each
  new text there (`alertText`: the owners with `prefs.texts`; the name is ours when the number is on file) with
  `_shared/webpush.ts` (RFC 8291 encryption and VAPID signature with the platform's crypto, no package; keys made once by
  `{ action: 'push-key' }`, in `secrets.vapid_public` / `vapid_private`); a device answering 404 / 410 is forgotten. The service worker
  shows it (`public/push-sw.js`, loaded with workbox `importScripts`); a tap opens the app. An iPhone must have the app on its home
  screen first (the panel says so).
- « Rappels d’huile » (`#/oil`, Part 24 sedecies, `20261113000100_suivi_huile.sql`, applied on live 2026-11-13 from commit `06851dd` with the sha256 check; `src/features/oil/`): the cars
  due for an oil change, for the owner or the office to call (`may.oil`; a mechanic only holds his own truck's visits). Hassan's rule
  (`due.ts`, pure, tested): the last finished visit had an oil change → call 6 months after it; it had none → 3 months after that visit
  (never before 6 months after the last oil change). The last oil change = the latest of our own and the day the customer gives. Ours
  (`oilJobIds`): a line whose service uses oil (its `needs`, else its name: `isOilService`), a line whose own words say it (`oilWords`:
  huile, oil, vidange, lube, LOF, synthétique, a grade like 5W-30; each piece of the line read alone, and never another fluid, a leak
  or a part: `OTHER`), or engine oil of the stock on the job (a line that sells it, or « Pièces utilisées »: `isOilStock`). A miss is
  fixed in one tap in the line's sheet (« L’huile a été changée à cette visite » sets `last_oil_on` to that visit). The customer's day: `vehicles.last_oil_on`, the box « Dernier changement d’huile » of the car
  form (`LastOilField` in `CarForm`: new customer, new caller in the booking, « Ajouter un véhicule ») and of « Modifier » the car;
  a car with that day is listed even before its first visit. The car's file and the customer's car line show it (`lastOil`). A car
  with a coming appointment that has an oil change is not listed; one without says so. Tabs « À appeler » / « Bientôt » (30 days) /
  « Tous »; the number to call is on the « Plus » tile. A line's sheet: call, text, book (`#/book?customer=&vehicle=`: the car already
  chosen), and after the call « Rappeler dans 1 semaine / 1 mois / 3 mois » or « Ne plus appeler pour cette auto », kept on the car
  (`vehicles.oil_followup` { at, by, again_on | stop }; a visit finished after `at` makes it old). Worked out on the device from the
  synced visits: nothing on the server but those two columns.
- Oil always said (`CarFirst`, `OilHint`): the job card says what the oil change still needs (grade, quantity, filter: `oilLine().missing`)
  with « Compléter » (the car's « Fiche technique » `SpecPanel` in a sheet; without year/make/model, a link to the car); the booking
  screen shows the chosen car's oil under the car.
- « Départ et heure » from the map (`src/features/map/TruckDaySheet.tsx`): a button on each truck of the legend (owner, « hours », or the
  truck's driver): the start time of the day shown (`withStart`: keeps the end of the day; `apply_hours` mode day) and « Départ de ce
  camion » (`TruckStartPanel`).
- « Modifier le travail » (`WorkPanel`): one button puts the work panel in edit mode: « Retirer » (on site: the line becomes « Pas
  fait »; before: it leaves the job) and « Changer » (the line's sheet: price) on every line, « Ajouter du travail » next to it,
  « Terminé ». Work billed on a finished invoice has no « Retirer » (« Modifier la facture » first).
- Postal codes (2026-11-12): OpenStreetMap's are often wrong in Canada, so Photon's code is never written in the address nor saved
  (`photon.ts`: no code in `place.address`; `AddressField` and `locator.ts` keep only a code the person typed). `place.postal_code`
  still helps `locate.ts` recognise the area (first 3 characters). The online booking sends the code the customer typed when it
  is a whole one, else the suggestion's whole valid code (Photon's too), never the 3-character area of a TomTom street or
  door range (`src/client/book/book-state.ts` `placeOf`, `AddressStep.tsx`).
- « La voiture ou le camion » (Part 24 terdecies, `20261112000200_voiture_camion.sql`): `trucks.tire_machine`
  (Horaires → the vehicle's sheet, « Monte et balance les pneus »; false = « la voiture »), `services.needs_machine` (Réglages →
  Services, « Camion seulement »), `jobs.needs_machine` (kept by the trigger `job_items_machine` from the lines: a marked service, or
  words `words_need_machine`: montage, non montés, balancement), `jobs.vehicle_kind` ('car' | 'truck' | null: asked when booking).
  `plan_block`: a job for the machine (or asked « truck ») only on a vehicle with it, « car » only on one without, nothing said: the
  car first (+10000 on a vehicle with the machine). `book_job` refuses machine work on the car (`needs_truck`); `suggest_blocks` takes
  `p_need`, `p_kind`. App: the switch « Peu importe / Voiture / Camion » above the moments offered (`BlockPicker`, only when the
  garage has both kinds; machine work shows a note instead), each suggestion tagged « Avec la voiture » / « Avec le camion » (never a
  vehicle's or a mechanic's name: Hassan's rule). The kind is KEPT: `jobs_kind_follow` sets `vehicle_kind` from the vehicle a job is
  put on, so a replan never slides a job from the truck to the car or back; `trucks_kind_keep` when a vehicle's switch changes;
  `move_job` with a truck changes the kind by hand. With every vehicle on `tire_machine = true` (the default) nothing changes.
- « La voiture ferme » (no server change; `src/features/hours/closing.ts`, `CloseDaySheet.tsx`): Horaires → « Appliquer » with hours that
  close a block holding booked appointments of that vehicle, when the garage has the other kind: a sheet lists them (`closedJobs`,
  `movesFor`: a vehicle of the other kind open in that block; tire-machine work never to the car), shows the other vehicle's route
  that day with them in it, and asks: « Déplacer vers le camion » (`move_job` each, same day and block, then `apply_hours`),
  « Fermer sans déplacer » (they go to « À placer »), or cancel. The route shown: switch « Vraies routes » off, the phone's
  estimate (`moveStops` in `src/shared/moment/preview.ts`); on, the server's (`move_preview`, `src/features/hours/closeRoute.ts`:
  its order, numbers and « Route de la journée », never a km while a trip is not measured; an arrival only when every trip
  of that day is measured, else « heure : trajets pas encore mesurés »; a refused move says why, `close-day-why`), and until it
  answers the day as it is with the moved appointments as pins without numbers (« Ordre et route : pas encore calculés »); a
  day where nothing goes to that vehicle shows the server's day as it is (`move_preview` with an empty list); the streets of
  that day (`useRoads(…, day)`).
- « Routes partagées » (same migration; `settings.booking.shared_routes`, Réglages → Réservations, off by default): the vehicles are
  nobody's own (Hassan: mechanics switch during the day). On, `my_truck_ids()` gives every vehicle to every mechanic, so each sees
  every route and may move any job forward; « Ma journée » gets « La route que je fais » (Les deux / Voiture / Camion, kept on the
  phone: `myRoute` in `today/select.ts`).
- « Appel entrant » is a switch in each owner's own account (Part 24 septdecies, `20261113000300_appels_reglage.sql`, like the texts):
  « Recevoir les appels dans mon compte » (Réglages → Branchements, `calls-mine`) = `staff.prefs.calls` (`update_me`). `sees_calls()`,
  my_access « calls », the `incoming_calls` policy and `callsOn()` (CallBanner) all ask: owner AND the switch. Any owner branches
  (function `ring`). `staff.sees_calls` (Part 24 quindecies, `20261113000200`) is unused now; its guard lets everything through.
- « Vue propriétaire » / « Vue mécano » (no server change): someone who is owner (or office) AND mechanic gets two tabs on top of
  Aujourd'hui (`today-views`; `dayView`, `hasTwoViews`, `pickDay` in `today/select.ts`), kept on the phone (`his.dayView`). Only the
  day shown changes: the rights stay the owner's.
- « Réservé par » (no server change, `src/features/jobs/bookedBy.ts`): the « Le rendez-vous » panel says who booked the appointment
  and when (`jobs.created_by`, `created_at`, `source`: on the spot, from an estimate, « Le client, en ligne »).
- « Retour à la Centrale » (Part 24 ter, `20261108000160_retour_centrale.sql`): when a mechanic's last job of the day is done,
  « Ma journée » shows the way back (the truck's own start, else « Départ des camions ») with « Je pars vers {place} » →
  `enroute { action: 'return', pos }`: a trip with no job (`trips.kind = 'return'`, `dest_label`, one active per person), the route
  and the arrival time, and a text to `settings.booking.return_phone` (Réglages → Réservations, « Numéro texté au retour »; template
  `messages.*.return_trip`, switch `on.return_trip`) with the live map link, like a customer's. « Je suis arrivé » = `return_end`;
  ending the day marks the trip arrived. `public_track` answers `kind` and `dest_label` for it (the page says « … est en route vers la
  Centrale », owner's language). App: `activeReturnTrip`, `doReturn`/`doReturnEnd`, `ReturnCard` in `MechanicDay`.
- Parts and inventory (Part 24 quater, `20261108000170_pieces_confirmees.sql`): « Terminer la job » first opens « Pièces utilisées »
  (`PartsSheet`, `confirmParts()`; the list from `plannedParts()`: the job's lines that are items + `service_parts` × quantity) and
  sends the confirmed quantities with the step (`job_step finish`, `p_data.parts`); `use_parts(job, parts)` takes exactly those off
  the inventory, once per job (no list = the planned parts, as before). « Supprimer cet article » in the item sheet =
  `inventory_delete(op, item)` (owner or « inventory » right): the item, its moves and its service links are deleted for good;
  the phone forgets them (`forgetLocal`).
- Buying stock (Part 24 quinquies, `20261108000180_achat_inventaire.sql`): « Entrée » in an item's sheet has « Payé par »
  (Rien / Trésorerie / Coffre) and the total paid. `inventory_buy(op, item, qty, total, from, vendor, note)` moves the stock and the
  money in one transaction: Trésorerie = an expense « Pièces » (taxes split from the total), Coffre = a `coffre` row of
  `kind = 'purchase'` (`item_id`, `item_name`, `qty`); the item's `cost_cents` becomes the unit price paid. `coffre_report` gives
  `amount_cents` (received), `spent_cents`, `balance_cents` (all time); the Coffre screen and its exports show purchases as money out.
- « Copier / Coller un rendez-vous » (agenda, no server change): right-click a job on a computer, or a long press (500 ms, `pressProps`
  in `ContextMenu.tsx`: iPhone and Android; the iPhone link preview is off there) on a phone (week chip or day ticket)
  → « Copier le rendez-vous » (`copyJob`, kept in `sessionStorage` for the visit, banner « Rendez-vous copié » with « Oublier la copie »);
  right-click an open block that has not started → « Coller ici » (also a button in each such block) → `#/book?copy=JOB&day=&block=`:
  `BookScreen` fills in the customer, car, the job's own address, the work (`draftsFromJob`: planned/done/approved lines), problem,
  notes and card, in that block; the person checks and taps « Réserver » (the usual rules, « Réserver quand même » included).
  Files: `src/features/agenda/copy.ts`, `actions.tsx`, `ContextMenu.tsx`.
  The same menu is the agenda's shortcut menu (`jobActions` / `blockActions` in `actions.tsx`, each shortcut only for those who
  may): on a job: open, copy, move (`#/job/ID?do=move`), customer file, text (`#/customer/ID?do=text`), call, directions, add a vehicle
  (`?do=car`), new estimate, new appointment for this customer, see the invoice; on a block: paste, book in this block, see the day
  (computer), map of the day. The list of customers has the same menu on each row (`customerActions` in
  `src/features/customers/shortcuts.tsx`, shared with the agenda; plus « Modifier la fiche » = `#/customer/ID?do=edit`). The menu host
  (`ContextMenuHost`) is mounted once in the shell.
- « Déplacer » from the trucks' stops (Hassan, 2026-11-21, « move apts time from here »; no server change, the same `move_job`,
  sheet, rules and rights): the Carte (« Déplacer » on the stop's card, `map-move`; the menu on each row of « Arrêts de … »),
  Vue d'ensemble (the menu on each row) and Aujourd'hui (« Les camions »: « Voir les N arrêts » lists each truck's stops as
  tickets with the menu; « Ma journée »'s tickets too) open the move sheet IN PLACE (`MoveHost` / `openMove`). The menu is
  the agenda's (right-click, long press; a tap does what it did): `jobActions` / `jobMenu` / `jobPress` / `menuProps`,
  `MoveSheet`, `copy` and the rule `mayMove` (booked, « Réserver », no move waiting: `movesWaiting`) now live in
  `src/shared/jobs/` (shortcuts, MoveSheet, MoveHost, moving, copy); `features/agenda/actions.tsx`, `copy.ts`, `move.ts` re-export
  them and `JobSheet` imports `MoveSheet` from there (both unchanged in behaviour). After a move the Carte asks `team_map`
  again and the message (« Rendez-vous déplacé : … ») stays 6 s with « Voir » (the appointment). A move kept on the phone
  (no signal) shows « En attente d'envoi » on the row / card / ticket (`MoveWaiting`), says « Quand le déplacement sera
  envoyé, l’app te demandera s’il faut texter le client (si l’app reste ouverte). », and MoveHost asks « Texter … ? » once
  it lands when the answer says `tell`
  (the agenda's way). « Waiting » = `movesWaiting` OR a `move_job` still pending in the outbox (`moveWaiting`: covers the
  job screen's own « Déplacer », which marks nothing, and a reload; the agenda's MENU reads it too, its drag and chips
  still read `movesWaiting` only). The sheet closes by itself when the stop goes under way meanwhile. Vue d'ensemble's
  map drops a server stop only when it was moved from this phone in the last minute (`movedLately`). Not done (the lead /
  Hassan): a visible ⋯ on the rows (only the Carte's card has a visible « Déplacer »), « Ordre des arrêts » from the
  stops, « À placer » on Aujourd'hui.
- « Déplacer à l'heure choisie » (Hassan, 2026-11-21: « when i move an appointement, i want it to move exactly where i point
  it to move, but the rest stays the same. keep showing the timeframe of 1h before and 2 hours after »; STATE.md 20:00 and
  20:25; Part 27's migration, fragment `ops/generateurs/vraies-routes/exact.sql`, NOT on live; app `src/data/exact.ts`,
  `src/shared/jobs/exactMove.ts`; names in docs/ARCHITECTURE.md, section of that name). Window mode only. Every place that
  shows a TIME and lets one pick it sends that minute: the agenda's hour grid (the quarter hour let go, the column's
  truck), the week's time grid, « Déplacer » (PickGrid on a computer, PickList on a phone; a best moment's « Vers … »), the
  agenda's window list (the arrival the row prints), « Changer de camion » (keeps the time). The server (`move_job`'s
  8-argument form, `p_exact { at, late_ok }`) puts the appointment on its truck at THAT minute (`jobs.arrive_at`), the
  window told is the garage's rule around it (`win_for`: 13 h 30 → 13 h – 17 h; unchanged), and at the move the other
  stops keep their order and their times (each held not before its arrival). Before saving, the app asks the server's
  `move_preview(p_job, p_day, p_truck, p_at)` (nothing written) and asks ONE question: nobody changes → « Sa plage :
  entre … et … . Les autres arrêts gardent leur heure. » (the grid always asks; a sheet's tap asks only when there is
  something to hear: someone pushed later inside their window is said); somebody late → « Déplacer Chloe à 15 h 30 met
  Denis en retard » with his time and by how much, « Choisir une autre heure » (nothing written) / « Déplacer quand même »
  (the move names him in `late_ok`; the message « Avertis Denis : servi après sa plage. »: the app texts the late customers
  nothing; for the moved customer, when the server's `tell` says what he was told changed, the app asks « Texter … ? »,
  below); the truck cannot be there →
  « Pas possible à 8 h … au plus tôt 8 h 06 », « Mettre à 8 h 06 » (asked again at that minute); not measured or no
  answer (6 s) → said plainly, « Déplacer quand même » / « Annuler ». Then « Garde-route » as before. The grid holds the
  block where it was let go while it is asked and sent (`grid-held-<id>`), so nothing jumps. A move to a time needs the
  network (« Pas de réseau … », nothing kept on the phone); moves that point no time are kept as before. After it, every
  later plan (a booking, a cancel, hours, measures, the evening lock) holds that stop at its minute — placed late and
  said late (`window_late` `why: 'pin'`), a booking that would push it is not offered — and plans the OTHER stops as
  always (Hassan's correction of 20:25, « i disagree with first one »: they may be reordered around it). « Vraies
  routes » on: the place's trips of that day are measured first (A7, the suggestions' wait), never refused nor called
  late from a trip not measured. The pin is cleared by a move that points no time (« Laisser l'app choisir », Flexible,
  the old app), an « Ordre des arrêts » that lists it, the windows switched off. The demo (`?demo=owner&fenetres=1`)
  fakes the preview and the move. The calendar of « Déplacer » lists every quarter hour of a window the server offers,
  including ones the truck cannot keep (8 h when it leaves the garage at 8 h): the question then says so. Tests: unit
  (docs/ARCHITECTURE.md), database `tests/db/exact-move*.test.mjs`, end to end `tests/e2e/deplacer.test.cjs` (« Tests »
  above); the sheets' answers take a second line on a phone when they do not fit side by side (`.sheet-foot`
  `flex-wrap`, `src/ui/sheetFoot.test.tsx`: « Déplacer quand même » was cut at the screen's edge).
- « Texter … ? » (Hassan, 2026-11-22: « for the text messages, i do not want them to receive a text automatically when i
  change their appointement. the system should ask me first »; no server change: `notify` only texts when the app calls
  it): after ANY change of an appointment that used to send the « moved » text by itself (the agenda's drag, hour grid and
  window list, « Déplacer » from the job and from the stops lists, the exact move, « Changer de camion », a move kept on
  the phone that reaches the server later), the app sends nothing and asks (`src/shared/jobs/textAsk.tsx`, `askMovedText`,
  the ONE question of every path; same condition as before: the switch « Rendez-vous changé » on, what the customer was
  told changed (`tell`), and the customer has a cell that takes texts, `wantsText`). The sheet `text-ask`: « Texter Julie ? »,
  the new moment as the text says it (`text-ask-when`: « Mercredi 25 novembre, entre 13 h et 17 h », a block « …,
  après-midi (12 h à 16 h) »), « Envoyer le texto » (`text-ask-send`: the very send of before with all its outcomes; the
  job screens' send where their « text to send by hand » host is, else the agenda's, whose sheet shows on any screen) /
  « Pas de texto » (`text-ask-skip`; ✕, Escape, back and the dimmed area too). A navigation never answers it (the
  « Voir » of the move's message): it rises again on the next screen (`Sheet` `onNavigate`). Two changes of the same
  appointment: one question, the latest moment (the row as it was right after the move when the phone no longer holds
  it); two appointments: one question each, the next once the send before answered and its hand-text sheet closed. It
  lives in its own root, so a move kept on the phone that lands asks wherever the person is (if the app is open). Not
  asked (unchanged): the booking confirmation (at once), « Je pars », invoices and payments, « Fixer les plages », every
  « Envoyer » button. Réglages → Textos says « Demande d’abord » beside « Rendez-vous changé » (off = never asked). A
  customer with no cell or who refuses texts gets no question (the job screens used to show « pas de numéro » with the
  message to share). Tests: `src/shared/jobs/textAsk.test.tsx`, each path's unit tests (agenda `move.test.ts`,
  `exact-move.test.tsx`, `MoveSheet-exact.test.tsx`, the three `stops-move-more.test.tsx`, `TruckSheet-exact.test.tsx`,
  `JobScreen.test.tsx`), `SettingsScreen.test.tsx`; end to end `deplacer` (step 8 and every move step: nothing asked of
  `notify` while the question is up), `app`, `plages`, `mise-a-jour`.
- The booking text and the estimate page (Part 24 sexies, `20261109000100_texte_reservation.sql`; functions `notify`, `book`, `client`):
  the text lists each service with its price (`{services}`, one line each, `servicesList` in `_shared/texts.ts`) and « Total :
  {soustotal} » = « 159,98 $ + tx » (`subtotalWords`; work by the hour: « …, plus le travail à l’heure »; nothing priced: « selon le
  travail sur place »); `fill()` keeps the lines of a text. No « pay now » before the work (`{payer}` empty for booking, the page's
  pre-payment box only once the mechanic is there). The page's sign panel is one button « J’accepte et je signe » (`client sign
  { click: true }`: signed electronically in the name on the customer's file, no picture, the authorization of work included; the
  proof in `activity` `signed_online`: signer, time, waiver version, amount, link, device, IP fingerprint); « Signer avec le doigt
  plutôt » keeps the drawing. `can_sign` no longer needs a total above zero.
  « Changer le prix » (same Part): on a line of an appointment (its sheet), every account that sees the appointment, while it is
  coming or under way and its invoice not finished: `job_item_price(op, item, unit_cents)` (a discount stays negative; the old and new
  prices in `activity` `price_changed`); the app says to resend the confirmation when the customer already got it.
- « Changer de camion » (no server change): on a booked appointment whose block has not started, for those who may move appointments
  (⋯ menu of the job, the agenda's right-click menu → `#/job/ID?do=truck`): `TruckSheet` lists the trucks working that block with
  their free time (`blockLoad`, the job left out); a tap = `move_job(same day, same block, truck)` (the truck is kept: `truck_pinned`;
  the server refuses `truck_full`); « Laisser l’app choisir » = `move_job(…, null)`. No text to the customer (day and time unchanged).
  Switch « Vraies routes » on: no free time worked out by the phone; each other truck says what the server says
  (`move_preview` with only that job and `p_as_told`: the very move the tap sends): « Il y a de la place : arrivée vers … »,
  « Il y a de la place (heure : trajets pas encore mesurés) », the words of the refusal's code (`refused_why`, `codeWords`;
  tire work on the car: « Ne peut pas : ce travail demande le camion »), or « Place : pas encore calculée ».
- New customer with the car (no server change): « Nouveau client » has « Son véhicule (facultatif) », the same form as « Ajouter un
  véhicule » (`CarForm`, `carErrors`, `carRow` in `VehicleBits.tsx`: year → make → model from the lists, or the VIN); saved right after
  the customer (`saveVehicle`), so « Créer et réserver » opens the booking with that car already chosen.
- The Coffre's own stock (Part 24 septies, `20261109000200_stock_coffre.sql`): `inventory_items.pool` = 'garage' | 'coffre' (fixed once
  made, trigger `inventory_pool_fixed`). `inventoryList` is the garage's only (so « À commander », the week's needs, the services'
  parts, the stock value never see Coffre items); `coffreStock` the Coffre's. Inventaire has « Garage / Coffre » (`?pool=coffre`).
  `inventory_buy`: a Coffre item is paid by the Coffre or « Rien » (no taxes, no expense, a `coffre` purchase row: only in the Coffre's
  report), a garage item by the Trésorerie or « Rien » (`bad_from` otherwise). `coffre_report.stock_cents` = the Coffre stock's value
  at cost, shown on the Coffre screen with a link to that stock. Coffre items have no selling price.
- Server function `conversation` (get/send): the customer's texts both ways through GoHighLevel.
  Pictures and documents (MMS): each message carries `files` (the web addresses GoHighLevel gives in `attachments`, read by
  `_shared/files.ts` `filesOf`; https only, 10 at most), and a message with a file and no words is kept. The app draws them in both
  conversations (`src/features/conversation/Attachments.tsx`, rules `fileKind` / `fileName` in `texts.ts`): a picture in place (a tap
  opens it), a video or voice note plays, anything else is a link. The files stay at GoHighLevel, nothing is copied to our server. A
  text with no words in `incoming_texts` is shown as « 📎 Photo ou document » until GoHighLevel's list has its message (`lines`, 10 min).
  Sending a picture from the app is not done.
  `{ action: 'contact', customer_id }` (`syncContact`): the customer's name and number go to their GoHighLevel contact (made, or the
  name put on a number already there); the app asks it by itself once a new customer, or a changed name / number, has reached the
  server (`sentHooks.customer` in `sync.ts`, set in `api.ts`). Deployed on live 2026-11-12; the app side is not published yet.
- The end-to-end step « Changer de camion » was red from 2026-11-12 to 2026-11-13 for two reasons that were the test's own, not the
  app's (`move_job` and the sheet were fine): it looked where the appointment was BEFORE opening the other truck's day, and opening
  a day re-plans the block, so the planner could put the appointment on the truck just opened (the test then clicked the line of the
  truck it was already on, which is not a button); and on a Friday « tomorrow » is the Saturday an earlier step gives to Voiture for
  10 h to 12 h only (`on conflict do nothing` kept it closed in the afternoon). The step now opens both trucks first, writing over
  the hours, then reads where the appointment is.
- « Garde-route » (Part 25, `20261114000100_garde_route.sql`, applied on live 2026-11-15 from commit `aabe852` with the sha256 check;
  `src/features/booking/logic.ts`, `MomentMap.tsx`, `momentDays.ts`, `RoutePreview.tsx`): made after Tuesday 2026-11-17, where a third stop
  was booked at the other end of the island from the vehicle's two others (about 125 min and 94 km of real driving) without a word.
  `day_drive(day, truck, plan, extra, exclude)` = one vehicle's driving over its whole day (start → stops block after block → start).
  Each moment of `suggest_blocks` / `suggest_core` also says `add_min`, `add_km` (what the appointment adds over the day), `day_min`,
  `hop_min` (the longest drive between it and the customer before or after it), `stops`, and `far`: 'hop' (over `booking.max_hop_min`,
  35) or 'day' (over `booking.max_day_drive_min`, 105, on a day that already has stops); 0 switches a limit off (Réglages →
  Réservations). Moments not far come first, then the least driving added. The server refuses nothing (`book_job`, `move_job`,
  `plan_block` untouched) and an override is not recorded: the app marks a far moment in the calendar, never offers it in the
  suggestions, warns with « Plutôt … » buttons when one is chosen (`bp-far-warn`), and asks « Beaucoup de route ce jour-là » before
  booking (BookScreen) or moving (MoveSheet). `web_suggest` never offers a far moment.
  « Choisir sur la carte » (`moment-map`, above the suggestions, in booking and in « Déplacer »): the days of the page in a strip
  (appointments that day, the driving added, « Meilleur choix », « loin »), then the day's three blocks. On a phone the map is in
  the page (overview « Tous les jours »: every coming appointment as a dot with its date; a day: its routes with the new stop). On a
  computer (`(hover: hover) and (pointer: fine)`) there is no map in the page: the mouse resting on a day, a block, a suggestion, a
  calendar cell, a best moment or a time of « Plages d’arrivée » opens the real map of that day in a window (`route-hover`,
  `MapHover` / `RouteHover` in `src/shared/moment/RoutePreview.tsx`; asked by Hassan on 2026-11-19: « i want the actual map to open,
  we are visual »): up to 640 × 460, every vehicle's route by the streets with its numbered stops at full size (nothing drawn
  between two stops before a real road comes: « Vraies routes » below), the new stop in black with its name, under it the
  stops of the route it joins in order and what it adds (never a straight-line distance: « Route ajoutée : pas encore
  calculée » until measured). It goes beside the whole picker (`popPlace` in `place.ts`, the picker marked `data-pop-group`),
  so it does not move, stays open and follows while the mouse goes from a moment to the next (`useHover`: opens after 250 ms,
  follows after 110 ms, closes 220 ms after the mouse left, at once at a scroll or when a menu opens); it never takes the mouse.
  Known limits: with « Vraies routes » off (live today) the driving is still the straight-line estimate (Tuesday's real driving
  was well over it) and the pickers print it as minutes and km, as live does (decided 2026-11-21: off is the way back); on,
  it is measured (Part 27, below: `far` is never decided by a guess, a moment not measured is never offered online nor
  marked best). The planner still places inside one block (it can put a job on an empty vehicle while another is
  already next door that day).
  The dev demo (`?demo`) only runs in one browser tab at a time: a second tab stays blank while an older one is open.
- `.github/workflows/tests-complets.yml`: every branch except main runs the whole suite (local server, database, API,
  end-to-end on Montréal time) on a GitHub Linux machine. Steps 2, 3, 7 (signature drawing) and 13 are flaky there.
- « Plages d’arrivée » (Part 25, `20261115000100_fenetres.sql`; database side only, NOT applied on live, tested in `tests/db/windows.test.mjs`):
  a 4-hour arrival window (1 h before the estimated arrival, 3 h after) instead of the blocks. INERT while `settings.booking.windows_on`
  is not true (blocks, answers and errors are the ones of before). The switch is `windows_switch(op, on)` only (owner; a plain settings
  save never flips it: trigger `settings_windows_guard`): ON turns today's and the coming jobs into `block = 'day'` with
  `win_start` / `win_end` = the hours of their old block, OFF puts each back in the block of its planned arrival; the coming days are
  planned again, a day whose new plan would throw an appointment to « À placer » stays as it was; past days are never touched.
  Window mode: `blocks()` = one block `('day', 480, 1200, 1)` (`blocks_set()` = the blocks written in the settings, `day_span()`);
  `block_open` keeps today open until the day ends (same-day bookings); `win_for(eta)` cuts the window (`win_before_min` 60,
  `win_after_min` 180, `win_round_min` 60). `plan_block`: a stop may carry `ws` / `we` (`jobs.win_start` / `win_end`, or the extra's);
  `route_walk` walks a route (early = waiting until the window opens, which counts in `used` and in the cost like driving; after the
  window = refused); the stop being added goes in last and only where every promised window still holds; `route_improve`'s order is
  kept only when the windows hold; stops en route / on site, in order by hand or booked « quand même » are not held to theirs; an
  appointment already booked is never thrown to « À placer » because of a window (placed late, listed in the plan's `late`). Today:
  each truck counts from where it is (the stop it is at, else the last one finished), a job under way counts only the time it still
  needs, and `apply_plan` never un-places an appointment on a day already started. `book_job` / `web_book`: `block: 'day'` with
  `win_start` (refused `window_full` when it cannot be reached inside; `bad_window` outside the day), `win_flex` (no window), or
  neither (window = `win_for` of the planned arrival); a block key is refused (`bad_block`). `move_job` has a 7-argument form
  (`…, p_win_start, p_win_flex`); the 5-argument one keeps the window on the same day and cuts a new one on another day.
  `suggest_blocks` rows gain `eta`, `win_start`, `win_end`, `wait_min` (one row per day); `suggest_windows(lat, lng, duration, day,
  exclude, need, kind)` = every window still possible that day (`web_windows` for the online page). « Flexible » jobs get their window
  from `lock_windows(op, day)` (owner / office → `{ fixed, jobs }`, activity `window_fixed`), from `lock_windows_due()` (pg_cron every
  10 minutes when the database has it: today's, and tomorrow's from `win_lock_min` 1080 = 18:00), or at once when booked / moved into
  a day already locked (« Vraies routes » on: only from an arrival measured, `jobs.eta_measured`; a window asked to be cut from
  an arrival not measured leaves the appointment « flexible » instead). Not done here: the texts to customers, `team_map` (it does not answer the windows), the app's screens.
  The database tests run on a Mac too against any Postgres with the migrations (`GARAGE_DB_PORT`, see `tests/db/helpers.mjs`).
- « Vraies routes » (Part 27, `20261119000200_vraies_routes.sql`, the server function `drive`, NOT on live; its cutover and way
  back: `ops/live/CUTOVER.md` sections 5 bis and 7): the planner counts the driving with real road times measured by TomTom
  (its usual traffic of that weekday and hour; OSRM + 20 % when TomTom cannot answer), never a straight line. Hassan's rule
  (2026-11-19): « i don't want straight line guesses please » — a road drawn is a real road; with the switch on, a km or a
  time shown is a measured one, or it is said « pas encore mesuré ». With the switch OFF the screens keep the numbers they
  have today, the server's estimate (« 48 min de route (27,8 km) », « +9 min de route », « Plutôt … : 13 min de route en
  moins », the arrival « vers 10 h »): off is the app as it is live, kept as the way back (the lead's decision of
  2026-11-21, to tell Hassan). The migration is made by a generator, `ops/generateurs/vraies-routes/build.py`
  (with `measure.sql` and `previews.sql`; `python3 ops/generateurs/vraies-routes/build.py` rewrites the very same file): it
  copies each planner function from its latest earlier definition and changes it by exact replacements, which is what
  proves « nothing else changed ». While the migration is not applied on live, change the generator, not the file.
  The switch is `settings.booking.roads_on`, flipped only by `roads_switch(op, on)` (owner; Réglages → Réservations → « Vraies
  routes » → « Compter les vraies routes »; trigger `settings_roads_guard`: a plain settings save never flips it, and only the
  owner changes the four numbers that decide what TomTom costs, `roads_month_tx`, `roads_web_tx`, `roads_keep_days`,
  `roads_rush_min`; the server key stays free). INERT while it is off:
  the planner answers exactly as before (same numbers, same keys, same job and activity rows: `tests/db/vraies-routes-off.test.mjs`
  compares with the definitions of before, `book_job`, `move_job`, `lock_windows_core` and `log_activity` included), the
  phone's own estimates that mirror it stay (where a new stop goes, « Arrêt n sur N »), the
  screens send nothing to `drive` (`warmRoads` answers at once) and the background sweep does nothing. What is true switch
  on OR off: no straight line on a map nor « à vol d'oiseau » in a text, « Je pars » never gets a straight-line time, the
  nightly sweep measures (so the switch can go on), and a build with the browser key asks TomTom first for maps and
  addresses. A restore never turns it on (`ops/sauvegardes/restaurer.mjs`: `--remplacer` keeps it as the base has it,
  `--neuve` writes it off); from the SQL editor `roads_switch` works only in the owner's name (CUTOVER.md section 7). ON is refused `roads_cold` while a usual-hours trip of [today, today + `horizon_days`) has no time at all;
  ON and OFF plan the coming days again (`roads_replan`): a block whose new plan would throw an appointment to « À placer »
  is kept with its real arrival times written again (`route_retime`); the answer and the activity `roads_switch` say
  `planned`, `kept`, `late`, and the panel lists the customers to call (« N clients à rappeler », a ready text). OFF does not
  give back the very same orders of before (the planner's heuristics), only the estimate's times, and sets every
  `jobs.eta_measured` back to null.
  The table `drive_times(a, b, slot, minutes, km, source, at, tt_none_at)`: a / b = `drive_key` (about 100 m), each direction its own
  row; three times a trip (`drive_slot(dow, minute)`): 0 = the usual hours (also weekends), 1 = Monday–Friday leaving
  6 h 30–9 h 29, 2 = Monday–Friday leaving 15 h–18 h 29 (garage → Brossard: 24 min at 11 h 30, 44 at 17 h);
  « Heures de pointe » off (`roads_rush` false) = slot 0 only. `source` 'tomtom' | 'osrm' | 'none' (no time to use: no road,
  TomTom and OSRM both said so; or a time of more than a day; or a rush cell TomTom could not answer; minutes and km null;
  counts as not measured; asked again after 7 days); `tt_none_at` = TomTom said « no road » (or could not answer) to a trip OSRM gave a
  time for: TomTom is asked again 7 days later, not every day. `drive_prune(30)` (the nightly sweep) deletes the rows older
  than 30 days with an end that is no place of the coming days (an address typed and never booked, the public page's): the
  table does not grow for ever. `drive_spend(month, tx, requests)`:
  TomTom's Matrix transactions of the month, added BEFORE each request by `drive_spend_add(tx)` under `roads_month_tx`
  (10 000; 0 = never TomTom). Neither table is backed up (`backup` `NOT_BACKED_UP`: a cache and a counter).
  ONE clock: switch on, every decision of the planner (does it fit: used / left / over, is it late, where a new stop goes,
  the longest hop and the day's driving of « Garde-route ») counts the same times as the arrival times it writes, each leg
  at the minute the truck leaves for it (`route_clock`, `drive_min`'s 8-argument form with the minute); `route_improve` may
  search an order with the usual-hours times, the order is then counted on the clock before it is taken. « Near » =
  `near_min` (10) minutes of measured driving (off: `near_km`); « farthest first » by measured minutes; `web_in_area` (60 km)
  stays a radius.
  The FROZEN vehicle (switch on): a vehicle whose appointments no longer fit its block with the real times is frozen in that
  block (`plan_route`, found again on every plan, never stored): its stops stay in their order with the real arrival times,
  nothing new goes on it (`block_full`; `truck_full` when that vehicle is asked; « Réserver quand même » goes at the end);
  the other vehicles keep their room. An automatic re-plan that makes an appointment late writes activity `window_late`
  (`{ day, block, eta, win_start, win_end, end, truck_id, why: 'roads' | 'replan' | 'chain' }`; no screen lists them yet; the
  nightly job's summary names the ones its sweep made late: « N rendez-vous arrivent maintenant après l’heure dite au
  client … : à rappeler. n° 1234 (2026-11-24, am) … », numbers only, never a customer's name).
  « Not measured » (switch on): a trip with no time counts the garage's fixed « Trajet inconnu » (`booking.unknown_min`, 20),
  never the straight line, and every answer says it: `unmeasured` (`day_drive`, the suggestion rows, `move_preview`), `add_km`
  / `day_km` / `km` null, `far` never decided by a guess (`hop_known`), `measured` false (`stop_order_preview`); `web_suggest` /
  `web_windows` never offer such a moment; booking is never blocked. Such a moment comes AFTER every measured one (among
  themselves never by its guessed minutes: `suggest_core` a block with a stop near first, then by day and block;
  `suggest_windows_core` by the window's start) and never gets « Meilleur
  choix », ★, the day strip's best day, the move sheet's « Meilleur » nor « Plutôt … ». The screens say « Route pas encore mesurée », « Route de
  la journée : pas encore mesurée », « heure : trajets pas encore mesurés », « Les routes vers cette adresse ne sont pas encore
  mesurées. Tu peux réserver quand même… ». With blocks, a moment says nothing of its place in the day (rows' `rank` /
  `route` null; exact only in window mode).
  The appointment's own flag `jobs.eta_measured` (switch on; null off and for a job with no arrival): true when every trip of
  its vehicle's day up to it is measured, false while one counts the « Trajet inconnu ». The planner writes it right after
  the arrival times (`route_mark`, at the end of `route_retime` and in `apply_plan`; `eta_walk` is the walk); `log_activity`
  skips it like `eta_min`. With it: a window is never cut from an arrival not measured (`eta_known`: in window mode, a
  booking or a move with no window chosen — `book_job` / `move_job` — leaves the appointment « flexible » — the customer is told « dans la journée ; nous vous confirmons la veille une plage de
  4 heures » — and it gets its window at the usual flexible lock, from 18 h the day before, once measured); « late »
  (`late`, `window_late`, the customers to call) is never judged from it; the screens say « heure : trajets pas encore
  mesurés » instead of « Vers 9 h 40 », never « Hors plage » (the ticket, « Ma journée », the job's « Le rendez-vous », the
  agenda's lanes, « Vue d'ensemble », the map and its legend, the move-window sheet, Hermes; the agenda's time grid only in
  the block's label and hover text). `team_map` does not send the flag: the map and « Vue d'ensemble » read the phone's own
  row (`assemble(raw, { measuredOf })`).
  What to measure (`drive_wanted(point, from, days)`): a day's places = the start of each truck that works that day, the
  day's appointments with a position, the address asked about; trips start ↔ stop, stop ↔ stop, the address ↔ every
  place, never start ↔ start; slot 0 for all; slots 1 and 2 only Monday–Friday, with `roads_rush`, for a trip whose usual
  time is there and ≥ `roads_rush_min` (15), between two places OF THAT DAY (an address typed but not booked: usual hours
  only). Missing = no row, a row older than `roads_keep_days` (120), an OSRM row a day old (asked to TomTom again; 7 days
  when TomTom said « no road » to it), a « none » row 7 days old; each pair says why (`new` | `old` | `osrm` | `none`).
  `drive_store(rows, days)` keeps a TomTom time against
  an OSRM one while it is young, never lets « none » replace a real time, leaves out a bad row (no OSRM time for a rush slot,
  km over 99 999), stores a time of more than a day as « none » (asked again after 7 days, not at every call), then (switch
  on) plans again the days given plus every coming day with a booked appointment at one end of a trip stored by that call;
  that re-plan runs on its own, so a failed one keeps the rows (`replan: [days], replan_error` in the answer: `drive` asks
  it once more). `roads_state()` = `{ on, left, left0, month, rows }`. The two previews `move_preview(truck,
  day, block, jobs, as_told)` and `stop_order_preview(…)` RUN `move_job` / `set_stop_order` inside a block always undone
  (nothing stays: call them with POST, never offline).
  The function `drive` (`supabase/functions/drive/handler.ts`, measuring in `_shared/roads.ts`, TomTom in `_shared/tomtom.ts`):
  `warm` (any member; the address within 150 km of the start, else `far`; `only: 'point'` stops after the address's two
  requests, 1 × N and N × 1; without an address: owner / office only), `sweep` (owner / office, « Mesurer maintenant »
  called again while `more`; or the nightly job with GitHub's signed ticket, which may ask nothing else; that one first
  deletes the old unused trips, `drive_prune(30)`, and its answer adds `pruned` and `late_jobs: [{ id, number, day, block }]`),
  `status` (`{ ok, key: the server has TOMTOM_KEY, on, left, left0, month, rows }`). Answer of warm / sweep: `{ ok, ready, left, left0,
  stored, planned, kept, late, no_road, tomtom: ok | no_key | refused | busy | over_budget | unused, osrm: ok | down | unused,
  spent, more }`. TomTom Matrix v2 (synchronous, `traffic: historical`, `departAt` without an offset: the next Tuesday,
  Wednesday or Thursday at least a day ahead, not 1 January, 24 June, 1 July, 25 or 26 December, at 11:30 / 08:00 / 17:00),
  grouped to pay the least (1 × N or N × 1; a square only when both sides are above 5 and it is cheaper). A cell « no road »
  → OSRM's opinion (TomTom asked again after 7 days), then 'none'; a few cells TomTom could not answer, the rest fine: the
  usual hours from OSRM, the rush times 'none' (never paid again at every call); 401 / 403 → `refused`, 429 → `busy` (asked
  once more after 1.5 s), 5xx, no answer or more than half the cells failed → `busy`; then OSRM for the usual hours;
  nothing → nothing stored. At most 500 trips a round (the next round the rest; Supabase gives a function 2 s of CPU: 3 000
  trips are grouped in about 0.2 s), each slot stored as soon as it is measured, a failed store asked once more with the
  same rows. The brakes (`rate_hit`): 60 calls an hour a person, 300 for the garage; a person's own TomTom allowance, 30
  calls an hour that ask TomTom for an address's own trips (`drive:tt:<person>`; past it OSRM measures the address and the
  answer says `over_budget`); `status` 120 an hour a person; the nightly ticket 20 sweeps an hour (`drive:night`); a call
  stops after ~40 s, 60 requests or 12 rounds and says `more`; 5 TomTom requests at a time, 100 cells a request; two calls
  never pay the same trips (leases in `rate_limits` `drive:claim:…`).
  `book` « slots »: online booking closed → `web_off` before anything is measured; else it measures the address before
  `web_suggest` (switch on, inside the area, 8 s, 6 requests) with its own brakes: 30 calls an hour that have something to
  measure for an address, TomTom or OSRM (`drive:web`; past it the address is not measured at all, so no moment is
  offered), and `booking.roads_web_tx` (1 000 a month, counted in the month's ceiling too), then OSRM. When it offers nothing
  because moments were left out as not measured (`web_unmeasured`), it answers `unmeasured: true` and the page says « On ne
  peut pas proposer de moment en ligne pour cette adresse en ce moment : appelez-nous. », never « Aucun moment libre ».
  `enroute` (« Je pars »): TomTom's road with the traffic of now (server key), else OSRM + 20 % (its own server, then its
  FOSSGIS copy: main's second planner), else no time (the text without a time); « Je pars » and « Je pars vers la Centrale » ask a road at most 30 times an hour a person
  (`enroute:road:<person>`: past it the trip and the text still go, without a time); a `refresh` of an ended trip is refused
  `not_en_route` (409) before any road and makes no trip and no text; never by another member (403); at most one every 4
  minutes and 8 a trip (429).
  The app: `src/data/roads.ts` (`warmRoads` before `suggestBlocks` / `suggestWindows`: the address measured first, the screen
  waits 3.5 s at most and never gets a refusal; one request per place and page of 14 days, remembered 10 minutes; the rest
  asked behind; after a booking, a move, « Changer de client » or a new position, its place is measured in the background;
  after a new « Départ de ce camion » (`set_truck_start`) or « Départ des camions » (`booking.home`) reached the server,
  `warmStart` measures that start at once for today + 14 days (later days: the background sweep or the nightly job);
  `roadsSwitch` asks the SAME op again when the answer was lost, so the list of customers to call comes back; the pickers'
  keys hold the switch, so a picker open while the owner flips it asks again);
  `src/services/roadsSweep.ts` (owner / office, switch on: a few seconds after the app opens, then every 10 minutes, only
  while something can be measured now, called again while the server says `more`, 5 calls a turn at most, never because
  `left` > 0: without TomTom the rush times never come); `src/services/tripRefresh.ts` (during a trip to a job the
  mechanic's phone asks the arrival time again: at most every 5 min, only after moving 300 m since the last real time (a
  trip without a time: no move needed), at most 8 times a trip (the count shared by the copies of the app on the phone),
  only to a stop of the vehicles he drives (« La route que je fais » with Routes partagées), never offline nor while the app
  is not on the screen (Waze in front: no update), never a text; « Renvoyer le texto en route » restarts the 5 min and the
  300 m; the way back to the Centrale is not refreshed). Réglages → Réservations → « Vraies routes » (`RoadsPanel.tsx`,
  `roadsModel.ts`): where the measures stand (« Clé de TomTom », « Trajets à mesurer », « Ce mois-ci chez TomTom »),
  « Mesurer maintenant » (owner / office; stops when the person leaves the screen), the switch (owner), « Heures de pointe »,
  « Plafond du mois chez TomTom » and « Enveloppe du mois pour la réservation en ligne » (owner only), « Distance « proche »
  en minutes » (only while on); « Le calcul de la route » marks speed, detour and near km « Utilisé seulement sans les vraies
  routes ». Réglages → Branchements → « Cartes et vraies routes (TomTom) » (`TomtomPanel.tsx`, read only: which key is there).
  The tickets, « Ma journée », the agenda's grid, « Vue d'ensemble » and the map legend never say the plan's time as an
  arrival for a stop en route (the trip's real time, or nothing). The help articles « Garde-route » and « Réserver un
  rendez-vous », and the « ? » of « Ta journée en bref » (`today.summary.helpRoads`), have their twin text while on. The
  online booking page's « no moment » words: « On ne peut pas proposer de moment en ligne pour cette adresse en ce moment :
  appelez-nous. » when the server says `unmeasured` (`book.slots.notMeasured`), else « Aucun moment libre » as before.
  The demo: `?demo&routes=1` (on, all measured), `&tomtom=nokey|refuse|busy|over|down|missing`; the demo NEVER has the
  TomTom key (`tomtomKeyFor`, `src/lib/config.ts`).
  The nightly sweep: `ops/sauvegardes/sauvegarde.mjs --fin`, after « done » and the reconciliation: `drive { action: 'sweep' }`
  with the same GitHub ticket, again while `more`, 10 calls at most; switch off too (it is what lets the switch go on), in
  the month's ceiling; it first deletes the old unused trips (`drive_prune(30)`); the appointments it made late are named in
  the summary and as a warning (numbers, days and blocks, never a name); a server without `drive` = a warning, TomTom
  refusing the key = a warning, a sweep that fails = red (the night's copy is kept).
  TomTom first, the free services behind, for: map tiles (OpenStreetMap's when TomTom refuses), roads drawn (OSRM, then
  FOSSGIS), addresses (Photon), the planner's times (OSRM's table, usual hours only), « Je pars » (OSRM). Two keys: the
  BROWSER key (public, restricted on TomTom's site to `mecanique-mobile-his.vercel.app` AND `hostnextline.github.io`; it
  needs only Map Display (raster tiles), Routing and Search / Geocoding — `src/lib/tomtom.ts` asks nothing else —, never
  Matrix; the GitHub repository variable `TOMTOM_KEY` → `VITE_TOMTOM_KEY` at build time in `deploy.yml` → `TOMTOM_KEY` of
  `src/lib/config.ts`; empty = the free services, as before) and the SERVER key (the function secret `TOMTOM_KEY`: Matrix
  Routing v2 for `drive`, Routing for « Je pars »; never the browser one, and both are named `TOMTOM_KEY`: one paste in the
  wrong place puts the server key in the public app; `TOMTOM_BASE` only on test copies). Free a month per service (checked
  2026-11-19): Matrix 2 500, Routing 20 000, Geocoding 20 000, tiles 200 000; the prices past them were not confirmed. What
  it costs (final-money's runs on the stack, BRIEF's billing rule): about 90 Matrix transactions for each address asked
  (new or on file: it is measured against every stop of the coming 14 days), about 125 once booked, the same again for a
  « Déplacer » or a « Voir d'autres dates »; about 20 000 a month at 8 bookings a working day with 2 trucks; the default
  ceiling stays 10 000 (Hassan chooses; past it, the rest of the month: usual hours by OSRM without traffic, no rush time).
  The free fallback is OSRM's public DEMO server (`router.project-osrm.org`, the default `OSRM_BASE`; its rules, read by the
  last review on its wiki: non-commercial use, one request a second): without the server key, when TomTom refuses or is
  busy, or past a ceiling, the planner's measuring, « Je pars » and the online page lean on it, and so does the nightly
  sweep every night from the cutover until the server key is there (CUTOVER.md 5 bis: the owner's call).
  Tests: database `tests/db/vraies-routes*.test.mjs` (10 files: `-off` = switch off identical, `-horloge` the one clock,
  `-mesure`, `-apercu`, `-replan`, `-reponses`, `-fix`, `-join`, `-final` = the last review's decisions: the order of
  moments not measured, the flag, the window and « late » never from a guess, the guard's four numbers, « no road » kept 7
  days, a time over a day, a failed re-plan keeps the rows, `drive_prune`, `web_unmeasured`), API `tests/api/drive.test.mjs`
  (16; + « Je pars » and its brake in `refonte-terrain.test.mjs`), the nightly job, its late appointments, the restore of the
  switch and the way back `ops/tests/sauvegardes.test.mjs`, end to end `tests/e2e/routes.test.cjs` (9 steps; step 3b: booked
  while TomTom and OSRM are down, the ticket says « heure : trajets pas encore mesurés », then measured it says « Vers … »;
  « Tests » above for the commands), unit `src/data/roads*.test.ts`,
  `src/services/roadsSweep.test.ts`, `tripRefresh.test.ts`, `src/shared/map/server-road.test.ts` (the server's pure parts:
  3 000 trips grouped fast, 500 a round, the store retried), `src/features/jobs/eta-measured.test.tsx` (the words on every
  screen), `src/domain/moment/roads-rules.test.ts` and `src/shared/moment/roads-*.test.tsx` (never « best » unmeasured),
  `src/client/book/BookPage.test.tsx` (the page's sentence), `src/app/vraies-routes.flow.test.tsx` (the whole path on the
  phone). The fake TomTom (key `tt-test`) and OSRM of
  `tests/stack/mocks.mjs` answer a made-up road whose times differ from the estimate, between slots and between directions.
  Known limits (not done): the switch OFF prints the estimate's minutes and km as live does (decided, the way back); no
  screen lists the `window_late` appointments (the nightly summary names the ones its sweep made late; the panel lists
  them after the switch); the settings panel's help (`monthTxHelp`) does not say the cost above, and `webTxHelp` still says
  that past 30 addresses an hour the online page measures « sans la circulation » (it now measures nothing then); `team_map`
  does not send `eta_measured` (a job the phone does not hold keeps its time on the map); the agenda's time grid says « pas
  encore mesurés » only in its label and hover text; a moment not measured still says « N h de libre »; a new truck start is
  measured at once for 14 days only (later days: the sweep, the nightly job); the map legend's road total is TomTom's route
  at 11 h 30 of that day, today « now », and the first answer is kept all day; « Ma journée »'s « … de route » counts 0 for a
  stop with no travel time (it adds « trajets pas encore tous mesurés » when an arrival is not measured); a real road of two
  points is not drawn (taken for the old straight line; enroute keeps 3 points of any road the planner gave with more:
  `roadLine`); in blocks mode a moment's vehicle and `day_min` may differ from what
  the booking then does (as before Part 27); `left` still counts idle minutes before a break; an empty day's « Voir sur la
  carte » (switch on, blocks) shows only the new pin; the demo's `stop_order_preview` answers null (« pas encore
  calculé » in « Ordre des arrêts »; its `move_preview` of the exact move is there, the 5-argument one answers `{ ok: true }` with nothing in it); `his.tripRefresh` is not cleared at sign-out; the way back to the Centrale is never refreshed; Photon's
  whole postal code is sent by the online booking when the customer typed none; switch off, the planner is a little slower
  than before Part 27 (×1.1–1.8: `drive_min` reads the switch at every leg); a phone still on yesterday's app (acf46c3)
  knows nothing of the switch (CUTOVER 5 bis.4: every phone on the new app first); CI (`tests-complets.yml`) runs `app`,
  `plages` and `argent` of the browser files (not `routes` nor `deplacer`), and the stack folder's own `lib/common.sh` has no TomTom key (use the copy's
  `tests/stack/mac/e2e-file.sh`).
  Never proven: the real TomTom (the tests fake it, following the documented shapes: the Matrix request, its `detailedError`
  codes, whether a square is billed by cell or 5 × max, a 403 for a quota, the prices); the public OSRM server's limits;
  Supabase's real CPU and wall-clock limits; the speed at 1 500 coming jobs with the switch on (nor what `route_mark` adds);
  a real phone (iPhone home-screen app, Android) and a phone moving on the road; English beyond the unit tests; a
  phone-sized screen only once, by the last review, on the demo (headless 390 × 844, pictures, no test); window mode in a
  browser with the switch on; the online booking page and « Je pars » / its refresh with the switch on in a browser; drag
  and drop, « Déplacer » or « Changer de camion » with the switch on; what the background sweep does (unit tests only; the
  browser step 3b measures with the owner's own `drive sweep` call); no API test runs the functions without the server key
  (the state live starts in); the round-5 API and ops tests were not run on the code of before.
- « Heures travaillées » (`#/timesheet`, Part 26 of live, `20261119000100_heures.sql`, applied on live 2026-11-19 from commit `5e77db6` with the sha256 check; `src/features/timesheet/`): the
  hours worked from « Commencer / Terminer ma journée » (`shifts`), a week at a time from Monday to Sunday (Hassan's choice for the
  hours; the schedule's week stays Sunday–Saturday), a day counted on the day it began, totals in h min and in decimals (pay), the
  month's total. A mechanic sees only his own (« Mes heures », also « Voir mes heures » on the day card, `src/features/today/ShiftCard.tsx`); the owners and the
  treasurer (`may.timesheetAll` in `src/domain/rights.ts`, server `hours_all()`) see the team and each person (`#/timesheet/STAFF?week=`), and correct:
  `shift_save(op, shift, staff, start, end)` (fix a day, or add one with shift null; an open day keeps no end; refused: end not
  after start, more than 24 h, not yet passed, overlap with the person's other days) and `shift_remove(op, shift)` (closed days
  only, `deleted_at`). Each correction: `shifts.fixed_by` / `fixed_at` and an `activity` row (`hours_fix` / `hours_add` /
  `hours_remove`, before / after). « À vérifier » = a closed day of 16 h or more not corrected (`toCheck`): the night's
  housekeeping closes a forgotten day 16 h after it began (3 h 17), so it always shows that way; the 3 h 17 is not offered as the
  end in the sheet. The read rule of `shifts` adds `hours_all()` (the treasurer even without « Carte »). Dry run on live
  2026-11-19 (rolled back): applied clean, mechanic refused, treasurer's fix kept with its history. Tests: `logic.test.ts`,
  `TimesheetScreen.test.tsx`, `tests/db/heures.test.mjs` (green on live's « Tests complets », run 44578750496). Live had 4 days « à vérifier »
  that day (closed by the night: 33.8 h, 22.6 h, 16.5 h, 19.2 h).
  In the refonte: the moments are read and written on the garage's clock (`dayOf`, `minuteOf`, `instantOf` of `lib/dates`), like
  the rest of the app; `too_long` of a day has its words under `errors.at.shift_save` (`errors.too_long` is a message too long);
  `shift_save`, `shift_remove` (APP) and `hours_all` (AS_PERSON) are named in `tests/db/refonte-droits.test.mjs`; the demo is
  `src/dev/demo-extra/timesheet.ts`. On a fresh database the file runs after the six forward migrations (`20261116000050` …
  `000500`); the end state is the same as on live, where it ran before them (the D1 grant loop of `000300` only goes over its
  own list of names, which does not hold `hours_all`, `shift_save`, `shift_remove`; the migration grants them itself).
- The customer's tracking page, live (`client.html#suivi=…`, `src/client/track/`; asked by Hassan on 2026-11-20: « see the mechanic
  moving in real time, smoothly, as if there was no refresh »; no server change for that part): `useTrack` asks `public_track` every
  5 s (15 / 30 / 60 s after failures, nothing while the page is hidden), the truck glides from one position to the next along the
  road's bends (`glide.ts`, requestAnimationFrame), the map does not refit, and the arrival is live (`liveEta`: what is left of the
  road over its length × the planned minutes, kept calm; the server's `eta_at` when the position is over 2 min old or over 400 m
  from the road).
  The road itself is the REAL one (2026-11-21, Hassan on the first picture: « it's a straight line, it doesn't show the actual
  route »): « Je pars » (`enroute`, `route()`) asks for the road in FULL (TomTom's polyline first when the server has its key,
  « Vraies routes »; OSRM's `overview=full`) and keeps the points that shape it
  (`supabase/functions/_shared/road.ts`, `thinRoad`: a point is dropped only when the line passes within 3 m of it, 400 points at
  most, the smallest bends first on a very long road; 5 km of city = about 35 points, 47 km = about 140). Before, the « simplified »
  road was asked: about 15 points for 9 km on live (39 trips looked at), up to 15 m off the streets on a short trip and over 100 m
  on a long one; a road thinned to its two ends (one straight street) keeps one point of its middle (`roadLine`), since
  the app never draws a line of two points (the old server's straight line: `isRoadLine`). The team's « Carte » draws the
  same line. Without a road the page draws no line at all (never a straight one, not even dotted: « Vraies routes »), the
  truck and the house still show; the streets are TomTom's tiles when the app has its key (OpenStreetMap's once refused). The demo's pretend trip (`src/client/demo.ts`, `WAY`) is a real road
  thinned the same way. Tests: `src/client/track/server-road.test.ts`, and `tests/api/functions.test.mjs` (the stand-in planner
  answers a road with a corner when asked in full: the trip keeps the corner). Only on the test copies until the functions are
  deployed; live's `enroute` (`837c89d8` since 2026-11-21) asks OSRM's full road, thinned by `thinRoad`, then the straight line.
  Two road planners (Hassan, same day: « yes add it just in case »; on live 3 trips of 39 had no road at all, the planner had not
  answered): `route()` asks TomTom first (server key, 8 s), then OSRM's own server, then its FOSSGIS copy
  (`routing.openstreetmap.de/routed-car`, the same two and the same order as the app's maps), each OSRM waited 6 s at most,
  then NO road and NO time (the text without a time; Hassan's rule of 2026-11-19, « Vraies routes »: main's version, live
  today, still ends with the straight-line estimate « as before », `route_source` `line`: merged 2026-11-21, the merge keeps
  no straight line); `route_source` says `tomtom`, `osrm`, `osrm-backup` or null. A copy of the server with `OSRM_BASE` set
  (the tests) asks `<OSRM_BASE>-backup` as its second planner, never the real one (`OSRM_BACKUP_BASE` names another); the
  stand-in fails on demand (`/control?tomtom=fail`, `?osrm=fail`, `?osrm_backup=fail`).

## Ideas not done yet

- A start for one day only (today the truck's start stays until changed).
