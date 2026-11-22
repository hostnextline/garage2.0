# H.I.S (garage2.0): the database, API and end-to-end tests on a Mac

The project's own test stack (`tests/stack/`) is Linux x86_64 only. These scripts run the same three suites on a Mac
(Apple silicon, no Docker, no Homebrew): a full run takes about 2 minutes instead of a 40-minute GitHub run.
Nothing is written in the project's folders: every command works on a copy kept in the stack's own folder.

## Two folders

| Folder | What | Where |
|---|---|---|
| the scripts | `tests/stack/mac/` of this repository (`H` in the scripts) | in git, only read |
| the stack | the programs (1.8 GB), the copy of the source folder, the database's files, the logs (`S` in the scripts) | `HIS_STACK`, default **`~/.his-stack`** |

Choose the stack's folder once with `export HIS_STACK=<folder>` (in `~/.zshrc` to keep it), or leave the default.
Its path must not hold a space. Every command below reads the same variable: a command run with another `HIS_STACK`
talks to another stack (but the ports are the same: one stack running at a time on a Mac).

## First time

```
bash tests/stack/mac/install.sh     # 3 to 4 minutes, needs the internet, 1.8 GB in $HIS_STACK/tools
bash tests/stack/mac/up.sh          # 5 s: copies this folder, makes a new database, starts the services
bash tests/stack/mac/all.sh         # 2 minutes: every suite must pass
```

## Commands

`M` below = `tests/stack/mac`. Each one is safe to run again, prints a short pass/fail summary, and writes its full
report in `$HIS_STACK/logs/`.

| Command | What it does | Time |
|---|---|---|
| `bash M/up.sh [source folder]` | Copies the source folder, makes a NEW database from its migrations, starts every service again | 5 s |
| `bash M/db-tests.sh [file or pattern]` | `tests/db/*.test.mjs` | 2 s |
| `bash M/api-tests.sh [file or pattern]` | `tests/api/*.test.mjs` (also any test file given by its path: `bash M/api-tests.sh ops/tests/sauvegardes.test.mjs`) | 5 s |
| `bash M/e2e.sh [test name pattern]` | `tests/e2e/app.test.cjs` (production build, Playwright 1.55.0, `TZ=America/Toronto`) | 2 min |
| `bash M/all.sh [source folder]` | The four above in GitHub's order on a new database, one table at the end | about 2 min 10 s |
| `bash M/e2e-file.sh <file> [test name pattern]` | another end-to-end file the same way as `e2e.sh` (the same lock, the same preparation, the copy's `lib/common.sh`): `routes` (« Vraies routes », 9 steps, its own build WITH a fake browser TomTom key), `plages`, `argent`, `mise-a-jour` (= `tests/e2e/<name>.test.cjs`, or a path); `SRC=`, `NOSYNC=1`, `FRESH=1` as below | 1 to 3 min |
| `bash M/down.sh` | Stops everything this stack started (and nothing else) | 1 s |
| `bash M/psql.sh "<sql>"` | SQL on the test database (or psql options: `psql.sh -f file.sql`) | |

### Which folder is tested

Any garage2.0 folder works: this repository, a git worktree of it, a plain copy. In this order:

1. the folder given: `bash M/up.sh <folder>`, `bash M/all.sh <folder>`, or `SRC=<folder> bash M/db-tests.sh`;
2. else the garage2.0 folder the command is called from (anywhere inside a worktree: that worktree);
3. else the folder of the last command (on a shared stack that may be somebody else's: the command says so);
4. else the repository these scripts belong to.

Every command prints `source: <folder> (<branch> @ <commit>, N local change(s))  [how it was chosen]` first: check
that line. The folder is only read. A worktree without `node_modules` borrows the packages of a folder of the same
repository whose `package-lock.json` is identical (the link is made in the copy, not in the worktree). The database
tests need no `node_modules` at all.

### What a test command does first

It copies the CURRENT state of the folder each time (0.3 s), so `up.sh` is rarely needed:

- a changed or new migration → the database is rebuilt from nothing first (2 to 4 s);
- a changed server function (`supabase/functions/`) → the functions are restarted first; one that does not load is
  shown with its error;
- a changed test or app → it is simply what runs (the end-to-end test builds the app each time);
- something stopped (`down.sh`, a crash) → it is started again.

Options: `NOSYNC=1` runs what is already in the copy. `FRESH=1` starts from a new database. After any end-to-end run
(`e2e.sh`, `e2e-file.sh`), run the database tests with `FRESH=1 bash M/db-tests.sh`: the browser steps leave rows that
the reconciliation tests then count.

### Patterns

- Database and API tests: a file name without its ending (`jobs`, `planner`, `windows`, `functions`, `backup-restore`)
  runs that file; a path to a test file runs that file; anything else is a test name pattern (regular expression, as
  `--test-name-pattern`). Both: `bash M/db-tests.sh planner "truck"`.
- End-to-end: a test name pattern: `bash M/e2e.sh "Coffre"`. Some steps use what an earlier step made: if a step fails
  alone, run it with the ones before.
- A pattern that matches nothing prints `NOTHING RAN` and exits with 3: it is never a pass.

### Several people (or agents), one stack

One database and one set of ports: the commands run one at a time. A second command waits on a lock and says whom it
waits for (`LOCK_WAIT=<seconds>`, default one hour). A run that was cut (Ctrl-C, killed) is noticed: the next API or
end-to-end run starts from a new database. From an agent's shell, give `e2e.sh` and `all.sh` a 10-minute timeout.

## Reading a result

- Exit code: 0 = everything passed; 1 = a test failed or the stack could not be built; 3 = nothing ran.
- A migration that fails stops everything and is shown (`MIGRATION FAILED: <file>` with psql's error and line).
- Last full reports: `$HIS_STACK/logs/db.last.log`, `api.last.log`, `e2e.last.log`, `up.last.log`; the services:
  `functions.log`, `auth.log`, `postgrest.log`, `pg.log`, `mocks.log`, `gateway.log`, `migrate.log`.
- End-to-end pictures: `$HIS_STACK/proj/tests/out/*.png`; a failing step's are also kept in `logs/e2e-<date>-fail/`.
- What the fake outside services received: `curl -s http://127.0.0.1:8021/log` (`curl -s -X POST http://127.0.0.1:8021/log/clear` empties it).

## The fake outside services (port 8021, `tests/stack/mocks.mjs`)

GoHighLevel, Stripe, the maps, NHTSA vPIC, Hermes, GitHub's tickets: each answers like the real one and logs every call.
The functions are started with them (`lib/common.sh` `start_functions`, the same lines as `tests/stack/start.sh`):
`GHL_API_BASE`, `STRIPE_API_BASE`, `OSRM_BASE`, `VPIC_BASE`, `PHOTON_BASE`, `GITHUB_OIDC_JWKS`, and for TomTom
`TOMTOM_KEY=tt-test` with `TOMTOM_BASE=http://127.0.0.1:8021/tomtom` (the two go together: a functions restart without
them would start « drive » without the server key).

The maps (« Vraies routes », Part 27):
- TomTom: `GET /tomtom/routing/1/calculateRoute/…/json` (« Je pars ») and `POST /tomtom/routing/matrix/2` (the planner's
  times: at most 100 cells a request, HTTP 200 even when a cell fails, each cell its own `detailedError`; 400 for a
  `departAt` with an offset or without historical traffic). A key other than `tt-test` is refused (403).
- OSRM: `/osrm/route/v1/driving/…` and `/osrm/table/v1/driving/…`.
- Their times follow one made-up road (the straight line × 1.25) and differ ON PURPOSE from the planner's estimate,
  between TomTom's three hours (11 h 30; 8 h × 1.5; 17 h × 1.8, read in `departAt`), and between the two directions of a
  trip (+2 min going north), so a test can tell which one the planner used. Logged: `{ svc: 'tomtom', kind: 'route' |
  'matrix', origins, destinations, cells, departAt, traffic, inflight }`, `{ svc: 'osrm', kind: 'route' | 'table', … }`.

The switches (`curl -s "http://127.0.0.1:8021/control?…"`, answered with the state; they stay until changed, so a test
that changes one puts it back):

| Switch | What it does |
|---|---|
| `tomtom=ok\|fail\|refuse\|busy\|noroad\|cells` | TomTom answers; 503; 403 (the key refused); 429; « no road » for every cell (HTTP 200, `NO_ROUTE_FOUND`); every Matrix cell failed with TomTom's own trouble (HTTP 200, `COMPUTATION_TIMEOUT`) |
| `osrm=ok\|fail` | OSRM answers, or 503 |
| `tomtom_ms=N` | each TomTom answer after N ms (0: at once) |
| `noroad=lat,lng;…` | no road to or from those places (100 m) for TomTom AND OSRM (an island); `noroad=` clears |
| `ghl=…`, `ghl_ms=N`, `stripe=…` | GoHighLevel and Stripe (the header of `mocks.mjs`) |

The browser's TomTom (tiles, routing, geocoding of the app itself) is NOT these fakes: `tests/e2e/routes.test.cjs`
answers it with Playwright's `ctx.route` (build key `tt-browser-test`) and fails a step on any request to a host it does
not fake. `$HIS_STACK/e2e-file.sh`, an older copy kept in the stack's folder, reads the stack's older `lib/common.sh`
(no TomTom lines): use `bash M/e2e-file.sh` from the source folder.

## What is real, what differs from the Linux stack

Every piece is the real program: Postgres **16.15** with real `pgcrypto` and `uuid-ossp` (npm
`@embedded-postgres/darwin-arm64`), GoTrue **v2.180.0** built from its official source, PostgREST **12.2.12**
(12.2.3 has no macOS arm64 build), Deno **2.9.6** with the project's `tests/stack/functions.ts`, the project's
`mocks.mjs` and `gateway.mjs`, Playwright **1.55.0** and its headless Chromium. Never the live database, never the
published app: everything the tests call is on 127.0.0.1.

1. **Database port 54352, not 54332** (54332 may belong to another database on the Mac). In the COPY only, `54332` is
   replaced by `54352` in `tests/`, `ops/` and `supabase/`; `GARAGE_DB_PORT=54352` is set; `M/bin/psql` and
   `pg_dump` turn a `-p 54332` into 54352. **Never run `node --test tests/api/…` or `tests/e2e/…` directly in a source
   folder** while 54332 is another database: those tests would write in it.
2. Clocks: the database and every service run with `TZ=UTC`, the database and API tests too; the end-to-end test
   runs with `TZ=America/Toronto`, as the workflow does.
3. A failing migration stops the build (the project's `migrate.sh` would go on).
4. Not copied into the stack: `.git`, `node_modules` (linked), `dist`, `coverage`, `tests/out`, the Linux stack's
   programs and keys, `.env*` files (a local `.env` can never point a test build at the live project), `*.log`,
   folders named `__scan__`.
5. A Mac is much faster than a GitHub machine: steps flaky on GitHub because of timing (2, 3, 7 and 13) can pass here
   every time; that does not prove they are stable there.
6. Not run by these scripts: `npx tsc --noEmit` and `npm test` (they work anywhere: run them in the source folder).

## How the stack's folder is made

```
$HIS_STACK/
  tools/   the programs (Postgres, GoTrue, PostgREST, Deno, Playwright, Chromium, Go): 1.8 GB
  dl/      the downloads install.sh checked
  proj/    the copy of the source folder; proj/tests/out = pictures and the app's build
  run/     the database's files, the keys made up for this copy (keys.json), pid files, state, the lock
  logs/    every report and log
```

Ports (all on 127.0.0.1): database 54352, Auth 9997, PostgREST 3011, functions 8011, fake services 8021, front door
54331, the app's preview 4173 (only during the end-to-end test). A port held by a program that is not this stack's is
never touched: the command stops and names it. The services stay running between commands (about 300 MB of memory);
`down.sh` stops them.

## What install.sh does

Public downloads only, each one checked; nothing outside `$HIS_STACK`, no Homebrew, no sudo. It fetches only what is
missing, so it can be cut and run again.

| Step | From | Notes |
|---|---|---|
| Postgres 16.15 server, Deno 2.9.6, `pg` 8.16.3, Playwright 1.55.0 | npm | needs Node 22 through nvm (`~/.nvm`) |
| Headless Chromium 1187 + ffmpeg | `playwright install chromium-headless-shell ffmpeg` into `tools/browsers` | |
| `psql`, `pg_dump`, `pg_isready` 16.2 | `python3 -m pip download pgserver==0.1.4`, unzipped (no Python package is installed) | needs `/usr/bin/python3` (Command Line Tools) |
| PostgREST 12.2.12 | its GitHub release `postgrest-v12.2.12-macos-aarch64.tar.xz`, sha256 checked | `install_name_tool` + `codesign` point it at the libpq above |
| Go 1.27.4 | go.dev, sha256 checked | only to build GoTrue |
| GoTrue v2.180.0 | the source of the tag `v2.180.0` of supabase/auth, sha256 checked, `go build` | about 1 minute |

Needs on the Mac: Apple silicon, the Command Line Tools (`xcode-select -p`), Node 22 in `~/.nvm`, the internet, the
ports above free. If a download's checksum is refused, the file changed upstream: `install.sh` stops there on purpose.
To save 1.1 GB once GoTrue is built: `tools/go`, `tools/gocache`, `tools/gopath` are only needed to build it again.
To delete a stack: `bash M/down.sh`, then `chmod -R u+w $HIS_STACK/tools/gopath` (Go keeps its modules read-only),
then remove the folder.
