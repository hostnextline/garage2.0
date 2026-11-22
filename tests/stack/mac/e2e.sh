#!/bin/bash
# The end-to-end tests (tests/e2e/*.test.cjs: production build of the copy, Playwright 1.55.0, headless Chromium,
# TZ=America/Toronto as on GitHub). Pictures and the build: ./proj/tests/out/
#   bash e2e.sh                     tests/e2e/app.test.cjs, every step
#   bash e2e.sh "Coffre"            the steps of app.test.cjs whose name matches (regular expression, as --test-name-pattern)
#   bash e2e.sh plages [pattern]    another file: tests/e2e/<name>.test.cjs (app, plages, argent, mise-a-jour) or its path
#   bash e2e.sh all [pattern]       every tests/e2e/*.test.cjs, one file after the other
# Each file builds the app and puts the database back by itself. mise-a-jour.test.cjs also builds yesterday's app: its
# commit (MAJ_OLD_COMMIT, the test's default otherwise) comes from the git history of the source folder (MAJ_OLD_REPO,
# only read); its signal switch listens on the app's port + 3 (4176).
# SRC=<folder> tests another folder than the last up.sh's; NOSYNC=1 runs the copy as it is; FRESH=1 starts from a new database.
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
lock "e2e.sh $*"
prepare all
a=${1:-}; FILES=(); PATTERN=${2:-}
if [ "$a" = all ]; then for f in "$PROJ"/tests/e2e/*.test.cjs; do FILES+=("tests/e2e/$(basename "$f")"); done
elif [ -n "$a" ] && [ -f "$PROJ/tests/e2e/${a%.test.cjs}.test.cjs" ]; then FILES=("tests/e2e/${a%.test.cjs}.test.cjs")
elif [ -n "$a" ] && [ "${a%.test.cjs}" != "$a" ] && [ -f "$PROJ/$a" ]; then FILES=("$a")
else FILES=(tests/e2e/app.test.cjs); PATTERN=$a; fi
for f in "${FILES[@]}"; do [ -f "$PROJ/$f" ] || die "no $f in $(cat "$STATE/src")"; done
# the app's preview (4173) and mise-a-jour's switch (4176) left by a run that was cut: ours are stopped, anything else is not touched
for p in 4173 4176; do pid=$(port_pid $p); if [ -n "$pid" ]; then port_ours_or_die $p "app preview"; stop_pid "$pid"; fi; done
# and its browsers (only this harness's own Chromium, by its path)
for pid in $(pgrep -f "$TOOLS/browsers/" 2>/dev/null); do kill -KILL "$pid" 2>/dev/null; done
rm -f "$PROJ"/tests/out/fail-* 2>/dev/null       # so that a « fail-… » picture always belongs to this run
export NODE_PATH="$TOOLS/npm/node_modules" PLAYWRIGHT_BROWSERS_PATH="$TOOLS/browsers" SUMMARY_STEPS=1
export MAJ_OLD_REPO="${MAJ_OLD_REPO:-$(cat "$STATE/src")}"
run_tests e2e America/Toronto "$PATTERN" "${FILES[@]}"
rc=$?
for p in 4173 4176; do pid=$(port_pid $p); if [ -n "$pid" ] && is_ours "$pid"; then stop_pid "$pid"; fi; done
if ls "$PROJ"/tests/out/fail-* >/dev/null 2>&1; then
  # kept apart: the next run (maybe somebody else's) writes over proj/tests/out
  keep="${LAST_LOG%.log}-fail"; mkdir -p "$keep" && cp "$PROJ"/tests/out/fail-* "$keep/" && echo "pictures of the failing steps (and what the app asked the server): $keep/"
fi
echo "all pictures of this run: $PROJ/tests/out/"
exit $rc
