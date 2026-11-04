#!/bin/bash
# Starts the local test copy: Postgres (54332), Auth (9997), PostgREST (3011), the garage's functions (8011),
# fake outside services (8021) and the front door (54331). Safe to run again: what already runs is left alone.
set -euo pipefail
S=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); R=$(cd "$S/../.." && pwd); RUN=$S/run
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
as_pg(){ if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
up(){ (exec 3<>/dev/tcp/127.0.0.1/$1) 2>/dev/null; }
wait_up(){ for i in $(seq 1 100); do up $1 && return 0; sleep 0.2; done; echo "port $1 did not start ($2)"; tail -20 "$RUN/$2.log" 2>/dev/null; return 1; }
[ -f "$RUN/.built" ] || bash "$S/install.sh"
cd "$S"

if ! pg_isready -h 127.0.0.1 -p 54332 -q; then
  as_pg "$PGBIN/pg_ctl -D $RUN/pgdata -l $RUN/pg.log -o '-p 54332 -k /tmp -c listen_addresses=127.0.0.1 -c wal_level=logical' start" >/dev/null
  for i in $(seq 1 50); do pg_isready -h 127.0.0.1 -p 54332 -q && break; sleep 0.2; done
fi
bash "$S/migrate.sh" >/dev/null
up 9997 || (set -a; . "$RUN/gotrue.env"; set +a; cd gotrue && setsid nohup ./auth > "$RUN/gotrue.log" 2>&1 < /dev/null &)
up 3011 || (setsid nohup ./postgrest "$RUN/postgrest.conf" > "$RUN/postgrest.log" 2>&1 < /dev/null &)
up 8021 || (setsid nohup node "$S/mocks.mjs" > "$RUN/mocks.log" 2>&1 < /dev/null &)
if ! up 8011; then
  ANON=$(node -e "console.log(require('./keys.json').anon)"); SERVICE=$(node -e "console.log(require('./keys.json').service)")
  SECRET=$(node -e "console.log(require('./keys.json').secret)")
  (export SUPABASE_URL=http://127.0.0.1:54331 SUPABASE_ANON_KEY=$ANON SUPABASE_SERVICE_ROLE_KEY=$SERVICE JWT_SECRET=$SECRET \
     GHL_API_BASE=http://127.0.0.1:8021/ghl STRIPE_API_BASE=http://127.0.0.1:8021/stripe OSRM_BASE=http://127.0.0.1:8021/osrm \
     VPIC_BASE=http://127.0.0.1:8021/vpic PHOTON_BASE=http://127.0.0.1:8021/photon GITHUB_OIDC_JWKS=http://127.0.0.1:8021/github/jwks \
     APP_BASE_URLS=http://127.0.0.1:4173/ DENO_NO_UPDATE_CHECK=1;
   setsid nohup "$S/node_modules/.bin/deno" run --allow-net --allow-env --allow-read "$S/functions.ts" > "$RUN/functions.log" 2>&1 < /dev/null &)
fi
up 54331 || (setsid nohup node "$S/gateway.mjs" > "$RUN/gateway.log" 2>&1 < /dev/null &)
wait_up 9997 gotrue; wait_up 3011 postgrest; wait_up 8021 mocks; wait_up 54331 gateway
for i in $(seq 1 150); do up 8011 && break; sleep 0.2; done
up 8011 || { echo "functions did not start"; tail -30 "$RUN/functions.log"; }
echo "local Supabase: http://127.0.0.1:54331  (anon key in tests/stack/keys.json)"
