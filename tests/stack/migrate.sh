#!/bin/bash
# Applies the garage's migrations (supabase/migrations/*.sql, in name order) that this copy does not have yet.
set -euo pipefail
S=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); R=$(cd "$S/../.." && pwd)
P="psql -h 127.0.0.1 -p 54332 -U postgres -q -v ON_ERROR_STOP=1"
$P -c "create table if not exists public.local_migrations(name text primary key, at timestamptz default now()); revoke all on public.local_migrations from anon, authenticated;"
for f in $(ls "$R"/supabase/migrations/*.sql | sort); do
  n=$(basename "$f")
  if [ "$($P -Atc "select 1 from public.local_migrations where name = '$n'")" != "1" ]; then
    $P -f "$f" && $P -c "insert into public.local_migrations(name) values ('$n')" && echo "   applied $n"
  fi
done
# PostgREST reloads its view of the database (when it runs)
$P -c "notify pgrst, 'reload schema'" || true
