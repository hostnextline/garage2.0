#!/bin/bash
# Builds the local test copy of Supabase, from nothing. Safe to run again.
#   Postgres 16 (from this machine) + Auth (GoTrue v2.180.0) + PostgREST v12.2.3 (fixed, checksum-verified versions)
#   + the garage's server functions (Deno) + fake GoHighLevel, Stripe, maps and VIN services: no real service is called.
#   Keys are made up here and only work with this copy.
# Then: bash tests/stack/start.sh   (and stop.sh)
set -euo pipefail
S=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); R=$(cd "$S/../.." && pwd)
RUN=$S/run; mkdir -p "$RUN"
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
PGPORT=54332
as_pg(){ if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
say(){ echo "== $*"; }
[ -x "$PGBIN/initdb" ] || { echo "Postgres 16 is missing"; exit 1; }
cd "$S"

say "programs (fixed versions, verified)"
if [ ! -x gotrue/auth ]; then
  curl -sSfL -o auth.tgz https://github.com/supabase/auth/releases/download/v2.180.0/auth-v2.180.0-x86.tar.gz
  echo "3fe064281f5cf7bda94251a3bd9e87a690d081381d9ea93b1491163735209e2e  auth.tgz" | sha256sum -c -
  mkdir -p gotrue && tar -xzf auth.tgz -C gotrue && rm -f auth.tgz
fi
if [ ! -x postgrest ]; then
  curl -sSfL -o postgrest.tar.xz https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  echo "9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c  postgrest.tar.xz" | sha256sum -c -
  tar -xJf postgrest.tar.xz && rm -f postgrest.tar.xz
fi
[ -x node_modules/.bin/deno ] || npm install --no-audit --no-fund --no-save --prefix "$S" deno@2.9.6 pg@8.16.3 >/dev/null

say "keys of this copy"
[ -f keys.json ] || node keys.mjs > keys.json
SECRET=$(node -e "console.log(require('./keys.json').secret)")

cat > "$RUN/gotrue.env" <<EOT
GOTRUE_DB_DRIVER=postgres
DATABASE_URL="postgres://supabase_auth_admin:authpw@127.0.0.1:$PGPORT/postgres?search_path=auth&sslmode=disable"
GOTRUE_DB_NAMESPACE=auth
GOTRUE_DB_MIGRATIONS_PATH=$S/gotrue/migrations
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
db-uri = "postgres://authenticator:authpw@127.0.0.1:$PGPORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = 3011
db-max-rows = 2000
log-level = "warn"
EOT

D=$RUN/pgdata
if [ -f "$D/PG_VERSION" ] && [ ! -f "$RUN/.built" ]; then
  say "an earlier build did not finish: starting over"
  as_pg "$PGBIN/pg_ctl -D $D stop -m fast" >/dev/null 2>&1 || true
  rm -rf "$D"
fi
if [ ! -f "$D/PG_VERSION" ]; then
  say "empty database, then the garage's migrations"
  mkdir -p "$D"; [ "$(id -u)" = 0 ] && chown -R postgres "$RUN"
  as_pg "$PGBIN/initdb -D $D -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
  as_pg "$PGBIN/pg_ctl -D $D -l $RUN/pg.log -o '-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1 -c wal_level=logical' start" >/dev/null
  for i in $(seq 1 50); do pg_isready -h 127.0.0.1 -p $PGPORT -q && break; sleep 0.2; done
  psql -h 127.0.0.1 -p $PGPORT -U postgres -q -v ON_ERROR_STOP=1 -f base.sql
  say "Auth makes its own tables"
  (set -a; . "$RUN/gotrue.env"; set +a; cd gotrue && ./auth > "$RUN/gotrue-first.log" 2>&1 &)
  for i in $(seq 1 150); do
    ok=$(psql -h 127.0.0.1 -p $PGPORT -U postgres -Atc "select to_regclass('auth.users') is not null and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' and p.proname='uid')" 2>/dev/null || true)
    [ "$ok" = "t" ] && break; sleep 0.2
  done
  sleep 1; pkill -f "$S/gotrue/auth" 2>/dev/null || pkill -x auth 2>/dev/null || true
  [ "$ok" = "t" ] || { echo "Auth did not create its tables"; tail -20 "$RUN/gotrue-first.log"; exit 1; }
  bash "$S/migrate.sh"
  as_pg "$PGBIN/pg_ctl -D $D stop -m fast" >/dev/null
  touch "$RUN/.built"
fi
say "ready (start it with: bash tests/stack/start.sh)"
