#!/bin/bash
# Shared by every command of the Mac test harness of H.I.S (garage2.0). Sourced, never run. Written for macOS's bash 3.2.
# See ../README.md. Nothing here writes in the project's folder: everything happens in this folder.
H=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)        # the scripts: tests/stack/mac of the repository (only read)
S=${HIS_STACK:-$HOME/.his-stack}                          # the stack's own folder, chosen by the developer: programs, copy, database, logs
mkdir -p "$S" && S=$(cd "$S" && pwd)
RUN=$S/run; LOGS=$S/logs; PROJ=$S/proj; TOOLS=$S/tools; STATE=$RUN/state
DEFAULT_SRC=$(cd "$H/../../.." && pwd)        # the repository these scripts belong to
DBPORT=54352                                   # the project says 54332: that port belongs to another session on this Mac
PGS=$TOOLS/npm/node_modules/@embedded-postgres/darwin-arm64/native/bin   # the server: postgres, initdb, pg_ctl (16.15, with pgcrypto)
DENO=$TOOLS/npm/node_modules/@deno/darwin-arm64/deno
mkdir -p "$RUN" "$LOGS" "$STATE"
CALLER_PWD=$PWD

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
command -v node >/dev/null 2>&1 || { echo "ERROR: node is missing (nvm)"; exit 1; }
export PATH="$H/bin:$PATH"                     # psql, pg_dump, pg_isready (the tests call them by name)
export PGPORT=$DBPORT
T0=$(date +%s)

die(){ echo "ERROR: $*" >&2; exit 1; }
took(){ echo "$(( $(date +%s) - T0 )) s"; }
port_up(){ (exec 3<>/dev/tcp/127.0.0.1/$1) 2>/dev/null; }
port_pid(){ lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1; }
# a process belongs to this harness when its command line or its working folder is inside this folder
is_ours(){
  local pid=$1 cmd cwd
  cmd=$(ps -p "$pid" -o command= 2>/dev/null) || return 1
  case "$cmd" in *"$S/"*) return 0 ;; esac
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  case "$cwd" in "$S"|"$S"/*) return 0 ;; esac
  return 1
}
# never touch a port held by somebody else
port_ours_or_die(){
  local pid; pid=$(port_pid "$1")
  [ -z "$pid" ] && return 0
  is_ours "$pid" || die "port $1 ($2) is held by a program that is not this harness's: pid $pid, $(ps -p "$pid" -o command= | cut -c1-110). Nothing of it was touched; free the port or stop that program yourself."
}
stop_pid(){
  local pid=$1 i
  kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  for i in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.1; done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
  sleep 0.2
}
# stop_service <name> <port>: only what this harness started
stop_service(){
  local name=$1 port=$2 pid i
  pid=$(cat "$RUN/$name.pid" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && is_ours "$pid"; then stop_pid "$pid"; fi
  rm -f "$RUN/$name.pid"
  pid=$(port_pid "$port")
  if [ -n "$pid" ]; then port_ours_or_die "$port" "$name"; stop_pid "$pid"; fi
  for i in $(seq 1 25); do port_up "$port" || return 0; sleep 0.1; done
  return 0
}
# start_service <name> <working folder> <program> [arguments…]   (in the background, its own session, log in logs/<name>.log)
start_service(){
  local name=$1 cwd=$2; shift 2
  : > "$LOGS/$name.log"
  node "$H/lib/daemon.mjs" "$RUN/$name.pid" "$LOGS/$name.log" "$cwd" "$@" || die "could not start $name"
}
wait_port(){
  local port=$1 name=$2 n=${3:-150} i
  for i in $(seq 1 "$n"); do port_up "$port" && return 0; sleep 0.2; done
  echo "port $port did not start ($name):"; tail -25 "$LOGS/$name.log" 2>/dev/null; return 1
}
wait_http(){
  local url=$1 n=${2:-150} i
  for i in $(seq 1 "$n"); do [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' "$url" 2>/dev/null)" = 200 ] && return 0; sleep 0.2; done
  return 1
}

# ---------- one command at a time (one database, one set of ports) ----------
LOCK=$RUN/lock
unlock(){ [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK"; return 0; }
lock(){
  [ -n "${STACK_LOCKED:-}" ] && return 0
  local waited=0 max=${LOCK_WAIT:-3600} told= pid empty=0
  while ! mkdir "$LOCK" 2>/dev/null; do
    pid=$(cat "$LOCK/pid" 2>/dev/null || true)
    if [ -z "$pid" ]; then empty=$((empty + 1)); [ $empty -gt 5 ] && rm -rf "$LOCK"; sleep 1; continue; fi
    if ! kill -0 "$pid" 2>/dev/null; then rm -rf "$LOCK"; continue; fi
    [ -n "$told" ] || { echo "… waiting: « $(cat "$LOCK/what" 2>/dev/null) » is running (pid $pid). One command at a time on this stack."; told=1; }
    sleep 3; waited=$((waited + 3))
    [ $waited -ge "$max" ] && die "still busy after ${max} s (pid $pid). If that run is dead: rm -rf $LOCK"
  done
  echo $$ > "$LOCK/pid"; echo "$1, since $(date +%H:%M:%S)" > "$LOCK/what"
  export STACK_LOCKED=1
  trap unlock EXIT; trap 'exit 130' INT TERM
}

# ---------- the scratch copy of the project ----------
sha_of(){ (cd "$PROJ" && find "$@" -type f ! -name .DS_Store -print0 2>/dev/null | LC_ALL=C sort -z | xargs -0 shasum -a 256 2>/dev/null | shasum -a 256 | cut -d' ' -f1); }
db_sha(){ sha_of tests/stack/base.sql supabase/migrations; }
fn_sha(){ sha_of supabase/functions tests/stack/functions.ts; }
side_sha(){ sha_of tests/stack/mocks.mjs tests/stack/gateway.mjs; }
key(){ node -e "console.log(require('$RUN/keys.json').$1)"; }
is_garage(){ [ -f "$1/package.json" ] && [ -d "$1/supabase/migrations" ] && [ -f "$1/tests/stack/base.sql" ]; }
# which folder is tested: SRC=<folder> (or the argument of up.sh / all.sh); else the garage2.0 folder the command is called
# from (an engineer in their worktree tests their worktree); else the folder used by the last command; else the default
# pick_src [folder] → SRC_DIR, and SRC_HOW (how it was chosen, printed beside it)
pick_src(){
  local top
  if [ -n "${1:-}" ]; then SRC_DIR=$1; SRC_HOW="given"; return; fi
  if [ -n "${SRC:-}" ]; then SRC_DIR=$SRC; SRC_HOW="given"; return; fi
  top=$(git -C "$CALLER_PWD" rev-parse --show-toplevel 2>/dev/null) || top=$CALLER_PWD
  case "$top" in "$S"|"$S"/*) top= ;; esac
  if [ -n "$top" ] && is_garage "$top"; then SRC_DIR=$top; SRC_HOW="the folder you are in"; return; fi
  if [ -s "$STATE/src" ]; then SRC_DIR=$(cat "$STATE/src"); SRC_HOW="NOT GIVEN and not called from a garage2.0 folder: this is the folder of the LAST command, maybe somebody else's"; return; fi
  SRC_DIR=$DEFAULT_SRC; SRC_HOW="the default"
}
src_folder(){ pick_src; echo "$SRC_DIR"; }
src_label(){
  local src=$1 head dirty branch
  head=$(git -C "$src" rev-parse --short HEAD 2>/dev/null) || { echo "$src"; return; }
  dirty=$(GIT_OPTIONAL_LOCKS=0 git -C "$src" status --porcelain 2>/dev/null | grep -v '__scan__' | wc -l | tr -d ' ')
  branch=$(git -C "$src" symbolic-ref --short -q HEAD 2>/dev/null) || branch="no branch"
  echo "$src ($branch @ $head, $([ "$dirty" = 0 ] && echo "no local change" || echo "$dirty local change(s)"))"
}
# the packages of a source folder: its own node_modules; a worktree that has none borrows those of a folder of the same
# repository whose package-lock.json is the same (nothing is written in the source folder: the link is made in the copy)
modules_of(){
  local src=$1 want c main
  if [ -d "$src/node_modules" ]; then (cd "$src/node_modules" && pwd -P); return 0; fi
  [ -f "$src/package-lock.json" ] || return 1
  want=$(shasum -a 256 < "$src/package-lock.json")
  main=$(git -C "$src" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')
  for c in "$main" "$DEFAULT_SRC" /Users/hassan/garage2.0; do
    if [ -n "$c" ] && [ -d "$c/node_modules" ] && [ -f "$c/package-lock.json" ] && [ "$(shasum -a 256 < "$c/package-lock.json")" = "$want" ]; then
      (cd "$c/node_modules" && pwd -P); return 0
    fi
  done
  return 1
}
# sync_copy <source folder>: sources copied (the build and the tests never write in the source folder), node_modules linked,
# this stack's keys put in, and the database port 54332 turned into 54352 in the copied tests.
sync_copy(){
  local src=$1 f mods
  [ -d "$src" ] || die "no such folder: $src"
  is_garage "$src" || die "not a garage2.0 folder with its tests: $src"
  src=$(cd "$src" && pwd)
  mkdir -p "$PROJ"
  rsync -a --delete \
    --exclude '/.git' --exclude '/node_modules' --exclude '/dist' --exclude '/coverage' --exclude '/tests/out' \
    --exclude '/tests/stack/run' --exclude '/tests/stack/node_modules' --exclude '/tests/stack/gotrue' \
    --exclude '/tests/stack/postgrest' --exclude '/tests/stack/keys.json' --exclude '/.env*' \
    --exclude '__scan__' --exclude '.DS_Store' --exclude '*.log' \
    "$src/" "$PROJ/" || die "the copy of $src failed"
  rm -f "$PROJ/node_modules"
  if mods=$(modules_of "$src"); then ln -s "$mods" "$PROJ/node_modules"; fi
  rm -f "$PROJ/tests/stack/node_modules"; ln -s "$TOOLS/npm/node_modules" "$PROJ/tests/stack/node_modules"   # pg (tests/db/helpers.mjs)
  if [ ! -s "$RUN/keys.json" ]; then node "$PROJ/tests/stack/keys.mjs" > "$RUN/keys.json.new" && mv "$RUN/keys.json.new" "$RUN/keys.json" || die "the keys of this copy could not be made"; fi
  cp "$RUN/keys.json" "$PROJ/tests/stack/keys.json"
  grep -rlE --exclude-dir=out --exclude-dir=node_modules '54332' "$PROJ/tests" "$PROJ/ops" "$PROJ/supabase" 2>/dev/null | while IFS= read -r f; do
    case "$f" in *.md|*/tests/out/*|*/node_modules/*) continue ;; esac
    sed -i '' 's/54332/54352/g' "$f"
  done
  echo "$src" > "$STATE/src"
}

# ---------- the database ----------
P(){ psql -h 127.0.0.1 -p $DBPORT -U postgres -q -v ON_ERROR_STOP=1 "$@"; }
db_ready(){ pg_isready -h 127.0.0.1 -p $DBPORT -q; }
db_stop(){
  local pid
  if [ -f "$RUN/pgdata/postmaster.pid" ]; then "$PGS/pg_ctl" -D "$RUN/pgdata" stop -m fast >/dev/null 2>&1 || true; fi
  pid=$(port_pid $DBPORT)
  if [ -n "$pid" ]; then port_ours_or_die $DBPORT database; stop_pid "$pid"; fi
}
db_start(){
  port_ours_or_die $DBPORT database
  # like GitHub's machine: the server's clock is UTC (the Mac's own zone would be America/Montreal); no socket file (TCP only)
  TZ=UTC "$PGS/pg_ctl" -D "$RUN/pgdata" -l "$LOGS/pg.log" -w -t 60 \
    -o "-p $DBPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c wal_level=logical -c timezone=UTC -c log_timezone=UTC" \
    start >/dev/null 2>&1 </dev/null || { tail -20 "$LOGS/pg.log"; die "Postgres did not start"; }
}
write_confs(){
  local SECRET; SECRET=$(key secret)
  cat > "$RUN/gotrue.env" <<EOT
GOTRUE_DB_DRIVER=postgres
DATABASE_URL="postgres://supabase_auth_admin:authpw@127.0.0.1:$DBPORT/postgres?search_path=auth&sslmode=disable"
GOTRUE_DB_NAMESPACE=auth
GOTRUE_DB_MIGRATIONS_PATH=$TOOLS/gotrue/migrations
GOTRUE_JWT_SECRET=$SECRET
GOTRUE_JWT_EXP=3600
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_ADMIN_ROLES=service_role
GOTRUE_SITE_URL=http://127.0.0.1:4173
GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:4173/**"
API_EXTERNAL_URL=http://127.0.0.1:54331/auth/v1
GOTRUE_API_HOST=127.0.0.1
PORT=9997
GOTRUE_DISABLE_SIGNUP=true
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_MAILER_AUTOCONFIRM=true
GOTRUE_LOG_LEVEL=warn
GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true
EOT
  cat > "$RUN/postgrest.conf" <<EOT
db-uri = "postgres://authenticator:authpw@127.0.0.1:$DBPORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = 3011
db-max-rows = 2000
log-level = "warn"
EOT
}
start_auth(){ port_ours_or_die 9997 auth; ( set -a; . "$RUN/gotrue.env"; set +a; export TZ=UTC; start_service auth "$TOOLS/gotrue" "$TOOLS/gotrue/auth" ); }
start_postgrest(){ port_ours_or_die 3011 postgrest; ( export TZ=UTC; start_service postgrest "$TOOLS/postgrest" "$TOOLS/postgrest/postgrest" "$RUN/postgrest.conf" ); }
start_mocks(){ port_ours_or_die 8021 mocks; ( export TZ=UTC; start_service mocks "$PROJ/tests/stack" node "$PROJ/tests/stack/mocks.mjs" ); side_sha > "$STATE/side.sha"; }
start_gateway(){ port_ours_or_die 54331 gateway; ( export TZ=UTC; start_service gateway "$PROJ/tests/stack" node "$PROJ/tests/stack/gateway.mjs" ); }
start_functions(){
  port_ours_or_die 8011 functions
  ( export TZ=UTC SUPABASE_URL=http://127.0.0.1:54331 SUPABASE_ANON_KEY="$(key anon)" SUPABASE_SERVICE_ROLE_KEY="$(key service)" JWT_SECRET="$(key secret)" \
      GHL_API_BASE=http://127.0.0.1:8021/ghl STRIPE_API_BASE=http://127.0.0.1:8021/stripe OSRM_BASE=http://127.0.0.1:8021/osrm \
      TOMTOM_KEY=tt-test TOMTOM_BASE=http://127.0.0.1:8021/tomtom \
      VPIC_BASE=http://127.0.0.1:8021/vpic PHOTON_BASE=http://127.0.0.1:8021/photon GITHUB_OIDC_JWKS=http://127.0.0.1:8021/github/jwks \
      APP_BASE_URLS=http://127.0.0.1:4173/ DENO_NO_UPDATE_CHECK=1 DENO_DIR="$TOOLS/deno-dir"
    start_service functions "$PROJ/tests/stack" "$DENO" run --allow-net --allow-env --allow-read "$PROJ/tests/stack/functions.ts" )
  fn_sha > "$STATE/functions.sha"
}
# db_build: a new database from nothing = base.sql, GoTrue's own tables, then every migration in name order
db_build(){
  local f b n=0 t; t=$(date +%s)
  rm -f "$STATE/db.sha" "$STATE/db.failed" "$STATE"/*.running
  stop_service functions 8011; stop_service postgrest 3011; stop_service auth 9997
  db_stop; rm -rf "$RUN/pgdata"
  TZ=UTC "$PGS/initdb" -D "$RUN/pgdata" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 > "$LOGS/initdb.log" 2>&1 || { tail -5 "$LOGS/initdb.log"; die "initdb failed"; }
  db_start
  echo "== base.sql" > "$LOGS/migrate.log"
  P -f "$PROJ/tests/stack/base.sql" >> "$LOGS/migrate.log" 2>&1 || { tail -8 "$LOGS/migrate.log"; die "tests/stack/base.sql failed"; }
  start_auth
  wait_http http://127.0.0.1:9997/health 300 || { tail -25 "$LOGS/auth.log"; die "Auth (GoTrue) did not make its tables"; }
  P -c "create table if not exists public.local_migrations(name text primary key, at timestamptz default now()); revoke all on public.local_migrations from anon, authenticated;" >> "$LOGS/migrate.log" 2>&1
  for f in "$PROJ"/supabase/migrations/*.sql; do
    b=$(basename "$f")
    echo "== $b" >> "$LOGS/migrate.log"
    if ! P -f "$f" >> "$LOGS/migrate.log" 2>&1; then
      echo "$b" > "$STATE/db.failed"
      echo "MIGRATION FAILED: $b  (after $n applied; the database is left as it stopped, for a look with psql.sh)"
      awk -v m="== $b" '$0 == m {on = 1; next} on' "$LOGS/migrate.log" | grep -v '^$' | tail -12 | sed 's/^/   /'
      return 1
    fi
    P -c "insert into public.local_migrations(name) values ('$b')" >> "$LOGS/migrate.log" 2>&1
    n=$((n + 1))
  done
  db_sha > "$STATE/db.sha"
  DB_BUILT="$n migrations in $(( $(date +%s) - t )) s"
}
db_current(){ [ -f "$STATE/db.sha" ] && [ -f "$RUN/pgdata/PG_VERSION" ] && [ "$(db_sha)" = "$(cat "$STATE/db.sha")" ]; }
need_modules(){ [ -d "$PROJ/node_modules" ] || die "no node_modules for $(cat "$STATE/src"): it has none and its package-lock.json matches no installed folder. Run « npm ci » in it (or link the main folder's node_modules there)."; }

# ---------- everything else ----------
stop_services(){ stop_service functions 8011; stop_service gateway 54331; stop_service mocks 8021; stop_service postgrest 3011; stop_service auth 9997; }
# start what does not run; restart what changed in the copy (the functions, the fake services, the front door)
ensure_services(){
  port_up 9997 || start_auth
  port_up 3011 || start_postgrest
  if [ "$(side_sha)" != "$(cat "$STATE/side.sha" 2>/dev/null)" ]; then stop_service mocks 8021; stop_service gateway 54331; fi
  port_up 8021 || start_mocks
  if [ "$(fn_sha)" != "$(cat "$STATE/functions.sha" 2>/dev/null)" ]; then stop_service functions 8011; FN_RESTARTED=1; fi
  port_up 8011 || start_functions
  port_up 54331 || start_gateway
  local p ok=0
  for p in "9997 auth" "3011 postgrest" "8021 mocks" "54331 gateway" "8011 functions"; do
    set -- $p; port_ours_or_die "$1" "$2"; wait_port "$1" "$2" 300 || ok=1
  done
  wait_http http://127.0.0.1:9997/health 100 || { echo "auth does not answer"; ok=1; }
  # PostgREST reads the database's shape when it starts; it must be ready before a test asks
  wait_http http://127.0.0.1:54331/rest/v1/ 150 || { echo "PostgREST does not answer through the front door"; tail -5 "$LOGS/postgrest.log"; ok=1; }
  return $ok
}
check_tools(){
  local f
  for f in "$PGS/postgres" "$PGS/initdb" "$PGS/pg_ctl" "$TOOLS/pgclient/pgserver/pginstall/bin/psql" "$TOOLS/gotrue/auth" \
           "$TOOLS/postgrest/postgrest" "$DENO" "$TOOLS/npm/node_modules/pg/package.json" "$TOOLS/npm/node_modules/playwright/package.json"; do
    [ -e "$f" ] || die "a program of the harness is missing: $f  (bash $H/install.sh fetches what is missing; README.md, « Rebuild everything from nothing »)"
  done
}
# build_all <source folder>: the copy, a new database, every service started again
build_all(){
  local src=$1
  check_tools
  sync_copy "$src"
  need_modules
  write_confs
  stop_services
  db_build || return 1
  ensure_services || return 1
}
# prepare <db|all>: what a test command needs, from the current state of the source folder
prepare(){
  local need=$1 src; pick_src; src=$SRC_DIR
  check_tools
  if [ -z "${NOSYNC:-}" ]; then sync_copy "$src"; fi
  [ -f "$PROJ/package.json" ] || die "no copy of the project yet: bash $H/up.sh [source folder]"
  [ -f "$RUN/postgrest.conf" ] || write_confs
  local why=
  if ! db_current; then why="the migrations changed (or no database yet)"
  elif ls "$STATE"/*.running >/dev/null 2>&1; then why="the last API or end-to-end run was cut before it put the database back"
  elif [ -n "${FRESH:-}" ]; then why="FRESH=1"; fi
  if [ "$need" != db ]; then need_modules; fi
  if [ -n "$why" ]; then
    echo "… $why: new database from $(ls "$PROJ"/supabase/migrations/*.sql | wc -l | tr -d ' ') migrations"
    stop_services
    db_build || die "the database could not be built (see $LOGS/migrate.log)"
    echo "… database rebuilt: $DB_BUILT"
  else
    db_ready || db_start
  fi
  if [ "$need" != db ]; then
    ensure_services || die "a service did not start (logs in $LOGS/)"
    [ -n "${FN_RESTARTED:-}" ] && echo "… the server functions changed: restarted"
    if grep -q 'could not load' "$LOGS/functions.log" 2>/dev/null; then
      echo "!! a server function did not load (it answers 404 « no function »); from $LOGS/functions.log:"
      grep -A4 'could not load' "$LOGS/functions.log" | cut -c1-240 | head -24 | sed 's/^/   /'
    fi
  fi
  return 0
}
# run_tests <name> <TZ> <test name pattern or ''> <files…>: node --test in the copy, summary on screen, full report in logs/
run_tests(){
  local name=$1 tz=$2 pattern=$3; shift 3
  local log rc; log="$LOGS/$name-$(date +%Y%m%d-%H%M%S).log"
  echo "source: $(src_label "$(cat "$STATE/src")")  [${NOSYNC:+NOSYNC: the copy as it is, last taken from this folder; }${SRC_HOW:-}]"
  [ "$name" = db ] || : > "$STATE/$name.running"      # the database tests roll back; the others clean up at their end
  ( cd "$PROJ" && TZ=$tz GARAGE_DB_PORT=$DBPORT node --test --test-concurrency=1 ${pattern:+"--test-name-pattern=$pattern"} \
      --test-reporter=spec --test-reporter-destination="$log" \
      --test-reporter="$H/lib/summary.mjs" --test-reporter-destination=stdout "$@" ) | tee "$LOGS/$name.last.summary.txt"
  rc=${PIPESTATUS[0]}
  rm -f "$STATE/$name.running"
  if [ "$rc" = 0 ] && grep -q 'NOTHING RAN' "$LOGS/$name.last.summary.txt"; then rc=3; fi    # a pattern that matches nothing is not a pass
  ln -sf "$log" "$LOGS/$name.last.log"
  LAST_LOG=$log
  echo "full report: $log"
  return "$rc"
}
# pick_files <db|api> [file name | test name pattern] [test name pattern] → FILES, PATTERN
pick_files(){
  local dir=$1 a=${2:-} b=${3:-} f
  FILES=(); PATTERN=
  if [ -n "$a" ] && [ -f "$PROJ/tests/$dir/$a.test.mjs" ]; then FILES=("tests/$dir/$a.test.mjs"); PATTERN=$b
  elif [ -n "$a" ] && [ -f "$PROJ/$a" ]; then FILES=("$a"); PATTERN=$b
  else
    PATTERN=$a
    for f in "$PROJ"/tests/"$dir"/*.test.mjs; do [ -f "$f" ] && FILES+=("tests/$dir/$(basename "$f")"); done
  fi
  [ ${#FILES[@]} -gt 0 ] || die "no test file in tests/$dir"
}
# the lines of « up »: what runs, in which version
report_stack(){
  local fl nf bad
  echo "   database    Postgres $("$PGS/postgres" --version | awk '{print $3}') on $DBPORT, clock UTC, real pgcrypto — $(P -Atc 'select count(*) from public.local_migrations' 2>/dev/null) migrations applied"
  echo "   auth        GoTrue $("$TOOLS/gotrue/auth" version 2>/dev/null | tail -1) on 9997 (the project's version, built for macOS from its source)"
  echo "   database API  $("$TOOLS/postgrest/postgrest" --version 2>/dev/null) on 3011 (the project pins 12.2.3, which has no macOS arm64 build)"
  fl=$(grep -m1 '^functions:' "$LOGS/functions.log" 2>/dev/null | sed 's/^functions: //')
  nf=$(ls -d "$PROJ"/supabase/functions/*/ 2>/dev/null | grep -vc '/_[^/]*/$')
  echo "   functions   Deno $("$DENO" --version 2>/dev/null | awk 'NR==1 {print $2}') on 8011 — $(echo "$fl" | tr ',' '\n' | grep -c .) of $nf loaded: $fl"
  bad=$(grep 'could not load' "$LOGS/functions.log" 2>/dev/null | cut -c1-300)
  [ -n "$bad" ] && echo "$bad" | sed 's/^/      !! /'
  echo "   fake services (GoHighLevel, Stripe, maps: TomTom and OSRM, VIN, Hermes, GitHub) on 8021; front door http://127.0.0.1:54331"
}
