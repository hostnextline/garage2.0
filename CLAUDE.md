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

- Applied on live: every migration up to `20261107000200_coffre.sql` (Part 20, from commit `28c51cc`).
- Server functions (`supabase/functions/`) are deployed from raw GitHub files pinned to a commit (`verify_jwt` off),
  currently `2610bc8`. Shared code is in `supabase/functions/_shared/`.
- Live access so far has gone through the Supabase connector (`execute_sql`, `apply_migration`, `get_advisors`).
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
- Rights: live gives « hours » to every mechanic (`settings.role_rights`), which opens every truck in Horaires.
  Without it, a mechanic still opens Horaires on the truck he drives only (`may.hours`, Part 18 follow-up), as the
  server allows (`truck_hours_editable`).

- « Réserver quand même » (Part 19, `jobs.forced`): owner/office book a full block after a warning; the forced job goes
  at the end of the route, nobody loses a place. « Coffre » (Part 20): family/friends jobs, no invoice, no taxes, own
  register (`coffre`, read only through `coffre_report`: owner and « Trésorerie », exported apart in #/coffre).
- Server function `conversation` (get/send): the customer's texts both ways through GoHighLevel.
- `.github/workflows/tests-complets.yml`: every branch except main runs the whole suite (local server, database, API,
  end-to-end on Montréal time) on a GitHub Linux machine. Steps 2, 3, 7 (signature drawing) and 13 are flaky there.

## Ideas not done yet

- A start for one day only (today the truck's start stays until changed).
