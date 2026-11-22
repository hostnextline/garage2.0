#!/bin/bash
# The whole suite in GitHub's order, on a new database: up, database tests, API tests, end-to-end (app.test.cjs, then
# plages.test.cjs, argent.test.cjs, mise-a-jour.test.cjs, routes.test.cjs and deplacer.test.cjs, each file alone). One
# table at the end.
#   bash all.sh [source folder]
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
pick_src "${1:-}"; SRC=$SRC_DIR; export SRC
lock "all.sh $SRC"            # held for the four commands (they see STACK_LOCKED and do not wait for each other)
line(){ printf '   %-14s %s\n' "$1" "$2"; }
res=()
run(){ local name=$1; shift; local t; t=$(date +%s); "$@" > "$LOGS/all-$name.out" 2>&1; local rc=$?
  res+=("$(line "$name" "$([ $rc = 0 ] && echo PASS || echo FAIL)  $(grep -E '^(TOTAL|UP):' "$LOGS/all-$name.out" | tail -1)  [$(( $(date +%s) - t )) s]")")
  [ $rc = 0 ] || grep -E '^(FAIL|   FAIL|MIGRATION FAILED|ERROR)' -A3 "$LOGS/all-$name.out" | head -60
  return $rc; }
run up bash "$H/up.sh" "$SRC" || { printf '%s\n' "${res[@]}"; echo "ALL: FAIL (the stack did not come up: $LOGS/all-up.out)"; exit 1; }
bad=0
run database bash "$H/db-tests.sh" || bad=1
run api bash "$H/api-tests.sh" || bad=1
run end-to-end bash "$H/e2e.sh" || bad=1
# the other end-to-end files, one at a time (each puts the database back by itself), as tests-complets.yml
for f in plages argent mise-a-jour routes deplacer; do run "e2e-$f" bash "$H/e2e.sh" "$f" || bad=1; done
echo; echo "== $(src_label "$SRC")"; printf '%s\n' "${res[@]}"
[ $bad = 0 ] && echo "ALL: PASS in $(took)" || echo "ALL: FAIL in $(took)  (details: $LOGS/all-*.out and the *.last.log files)"
exit $bad
