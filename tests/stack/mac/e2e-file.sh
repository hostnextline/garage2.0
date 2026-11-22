#!/bin/bash
# One end-to-end test FILE, the way e2e.sh runs tests/e2e/app.test.cjs: production build of the copy, Playwright 1.55.0,
# headless Chromium, TZ=America/Toronto as on GitHub. For the files e2e.sh does not run: tests/e2e/routes.test.cjs,
# plages.test.cjs, argent.test.cjs, mise-a-jour.test.cjs (app.test.cjs works too).
#   bash e2e-file.sh tests/e2e/routes.test.cjs             every step of that file
#   bash e2e-file.sh routes                                the same (tests/e2e/<name>.test.cjs)
#   bash e2e-file.sh routes "Mesurer maintenant"           its steps whose name matches (regular expression)
# SRC=<folder> tests another folder than the one you are in; NOSYNC=1 runs the copy as it is; FRESH=1 starts from a new
# database. Each file saves the database before and puts it back after by itself.
# mise-a-jour.test.cjs builds yesterday's app too: its commit is taken from the git history of the source folder
# (MAJ_OLD_REPO, only read); its build and the phones' profiles go in proj/tests/out/maj (MAJ_DIR); its signal switch
# listens on the app's port + 3 (4176).
# The same lock, the same preparation and the same lib/common.sh as e2e.sh (the functions get TOMTOM_KEY / TOMTOM_BASE
# from there): written again 2026-11-20 beside e2e.sh, the stack's own copy ($HIS_STACK/e2e-file.sh) reading the stack's
# older lib/common.sh.
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
f=${1:-}
[ -n "$f" ] || die "which file? bash $0 tests/e2e/<name>.test.cjs [test name pattern]"
case "$f" in */*) ;; *) f="tests/e2e/${f%.test.cjs}.test.cjs" ;; esac
lock "e2e-file.sh $*"
prepare all
[ -f "$PROJ/$f" ] || die "no $f in $(cat "$STATE/src")"
# the app's preview (4173) and the switch of mise-a-jour (4176) left by a run that was cut: ours are stopped, anything else is not touched
for p in 4173 4176; do pid=$(port_pid $p); if [ -n "$pid" ]; then port_ours_or_die $p "app preview / switch"; stop_pid "$pid"; fi; done
# and its browsers (only this harness's own Chromium, by its path)
for pid in $(pgrep -f "$TOOLS/browsers/" 2>/dev/null); do kill -KILL "$pid" 2>/dev/null; done
mkdir -p "$PROJ/tests/out"
rm -f "$PROJ"/tests/out/fail-* 2>/dev/null       # so that a « fail-… » picture always belongs to this run
export NODE_PATH="$TOOLS/npm/node_modules" PLAYWRIGHT_BROWSERS_PATH="$TOOLS/browsers" SUMMARY_STEPS=1
export MAJ_OLD_REPO="${MAJ_OLD_REPO:-$(cat "$STATE/src")}" MAJ_DIR="${MAJ_DIR:-$PROJ/tests/out/maj}"
name=e2e-$(basename "$f" .test.cjs)
run_tests "$name" America/Toronto "${2:-}" "$f"
rc=$?
for p in 4173 4176; do pid=$(port_pid $p); if [ -n "$pid" ] && is_ours "$pid"; then stop_pid "$pid"; fi; done
if ls "$PROJ"/tests/out/fail-* >/dev/null 2>&1; then
  # kept apart: the next run (maybe somebody else's) writes over proj/tests/out
  keep="${LAST_LOG%.log}-fail"; mkdir -p "$keep" && cp "$PROJ"/tests/out/fail-* "$keep/" && echo "pictures of the failing steps (and what the app asked the server): $keep/"
fi
echo "all pictures of this run: $PROJ/tests/out/"
exit $rc
