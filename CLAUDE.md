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
| Database rules and server functions (44) | `node --test --test-concurrency=1 tests/db/*.test.mjs tests/api/*.test.mjs` | needs the local copy |
| The whole app (16 steps, production build, real sign-in) | `node --test tests/e2e/app.test.cjs` (one step: `--test-name-pattern="…"`) | needs the local copy; puts the database back at the end; pictures in `tests/out/` |

On a Mac only the first two rows work as-is: run the others in a Claude Code cloud session (`claude --cloud "…"`
or claude.ai/code), which is Linux. Photon (addresses) is mocked in the end-to-end test with `ctx.route`.

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

- Applied on live: every migration up to `20261110000100_hermes_questions.sql` (Part 24 octies, applied 2026-11-10 from commit `b87b956`;
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
- Server functions (`supabase/functions/`) are deployed from raw GitHub files pinned to a commit (`verify_jwt` off):
  `notify`, `book` at `408de6c`; `client` at `d8f87f6`; `enroute` at `a4f2da6`; `team` at `9835d52`; `backup` at `b87b956`; `hermes` at `8db1695`;
  the others (`conversation`, `stripe`, `vin`) at `2610bc8`.
  Shared code is in `supabase/functions/_shared/` (a pinned function also reads `_shared` at its own commit).
- Live access: since 2026-11-09 through the Claude Code MCP server `supabase-garage` (scoped to this project; the claude.ai Supabase
  connector now points at another organization). Before: the claude.ai connector (`execute_sql`, `apply_migration`, `get_advisors`).
- Free plan: the project pauses after a week without use.

## Things to know before touching them

- Planner (`supabase/migrations/20261104000300_planner.sql`, replaced in Part 17): customers book a block (matin
  8–12, après-midi 12–16, soir 16–20); `plan_block` puts each job on a truck by cheapest insertion from the trucks'
  starting point, then `route_improve` reorders each truck's stops. Driving is estimated in a straight line × detour
  at `speed_kmh` (settings `booking`), not real traffic. Jobs en route or on site never move.
- « Départ des camions » = `settings.booking.home` {label, address, lat, lng}. Live: Centrale, 1401 rue Legendre
  Ouest, Montréal (45.5312898, -73.6544639). Edited in Réglages → Réservations (first panel); also reached from
  Horaires (first row of « Les camions ») and the map legend (« Changer »). Moving it, or changing a number of the
  route estimate, re-plans every coming booked block (trigger `settings_replan`); the name alone does not.
- Positions: addresses are found with Photon (`src/features/customers/locate.ts`, only a sure answer is taken);
  `src/app/locator.ts` finds missing positions in the background; a position found later re-plans its block (Part 15).
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
  them right after the stops en route / on site; moving a job to another day, block or truck clears its place.
- « Réserver en ligne » is **switched off since 2026-11-09** (live `settings.booking.web.on = false`: the page says « fermée », `book`
  refuses with `web_off`; the « Réservation en ligne » panel is hidden in Réglages) until Hassan and Claude rework it together.
- « Réserver en ligne » (Part 23, `20261107000500_web_booking.sql`, applied on live 2026-11-07 from commit `7b1b86b` with the
  sha256 check; server function `book` deployed pinned to `7b1b86b`, link open): one public link `client.html#reserver` (Réglages → Réservations, second panel « Réservation en ligne »: on/off, copy). The
  customer picks services, an address (Photon, must be ≤ `booking.web.max_km` (60) from the start), one of the 6 best blocks
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
- `.github/workflows/tests-complets.yml`: every branch except main runs the whole suite (local server, database, API,
  end-to-end on Montréal time) on a GitHub Linux machine. Steps 2, 3, 7 (signature drawing) and 13 are flaky there.

## Ideas not done yet

- A start for one day only (today the truck's start stays until changed).
