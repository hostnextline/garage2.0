#!/bin/bash
# SQL on the local test database (port 54352), as the superuser « postgres ».
#   bash psql.sh "select count(*) from public.jobs"        one answer per line, no decoration
#   bash psql.sh -f some.sql        any psql option instead of a sentence
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
db_ready || die "the database does not run: bash $H/up.sh"
case "${1:-}" in
  "") die "usage: bash psql.sh \"<sql>\"   (or psql options)" ;;
  -*) exec psql -h 127.0.0.1 -p $DBPORT -U postgres -v ON_ERROR_STOP=1 "$@" ;;
  *) exec psql -h 127.0.0.1 -p $DBPORT -U postgres -q -v ON_ERROR_STOP=1 -At -c "$1" ;;
esac
