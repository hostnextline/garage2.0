#!/bin/bash
# Stops the local test copy (the database is kept).
S=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); RUN=$S/run
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
pkill -f "$S/gotrue/auth" 2>/dev/null; pkill -f "$S/postgrest" 2>/dev/null; pkill -f "$S/functions.ts" 2>/dev/null
pkill -f "$S/gateway.mjs" 2>/dev/null; pkill -f "$S/mocks.mjs" 2>/dev/null
if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $RUN/pgdata stop -m fast" >/dev/null 2>&1; else "$PGBIN/pg_ctl" -D "$RUN/pgdata" stop -m fast >/dev/null 2>&1; fi
echo stopped
