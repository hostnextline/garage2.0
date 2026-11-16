#!/bin/bash
# Builds (or rebuilds) the whole local test stack from a source folder and starts it. Safe to run again.
#   bash up.sh [source folder]     default: the garage2.0 folder you are in; else the folder of the last up.sh; else the repository of these scripts
# The source folder is only read: its files are copied to ./proj, the database is made from the copy's migrations,
# the server functions run from the copy's supabase/functions, the end-to-end test builds the copy.
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
pick_src "${1:-}"; SRC=$SRC_DIR
[ -d "$SRC" ] || die "no such folder: $SRC"
lock "up.sh $SRC"
LOG=$LOGS/up-$(date +%Y%m%d-%H%M%S).log
main(){
  echo "== up from $(src_label "$SRC")  [$SRC_HOW]"
  if build_all "$SRC"; then
    report_stack
    echo "UP: ok in $(took)  (database built: $DB_BUILT)"
    return 0
  fi
  echo "UP: FAILED after $(took) — see $LOGS/migrate.log and the *.log files beside it"
  return 1
}
main 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
ln -sf "$LOG" "$LOGS/up.last.log"
echo "log: $LOG"
exit "$rc"
