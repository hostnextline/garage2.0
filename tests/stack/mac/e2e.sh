#!/bin/bash
# The end-to-end test (tests/e2e/app.test.cjs: production build of the copy, Playwright 1.55.0, headless Chromium,
# TZ=America/Toronto as on GitHub). Pictures and the build: ./proj/tests/out/
#   bash e2e.sh                     every step (39 at commit acf46c3)
#   bash e2e.sh "Coffre"            the steps whose name matches (regular expression, as --test-name-pattern)
# SRC=<folder> tests another folder than the last up.sh's; NOSYNC=1 runs the copy as it is; FRESH=1 starts from a new database.
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
lock "e2e.sh $*"
prepare all
[ -f "$PROJ/tests/e2e/app.test.cjs" ] || die "no tests/e2e/app.test.cjs in $(cat "$STATE/src")"
# the app's preview (4173) left by a run that was cut: ours is stopped, anything else is not touched
pid=$(port_pid 4173); if [ -n "$pid" ]; then port_ours_or_die 4173 "app preview"; stop_pid "$pid"; fi
# and its browsers (only this harness's own Chromium, by its path)
for pid in $(pgrep -f "$TOOLS/browsers/" 2>/dev/null); do kill -KILL "$pid" 2>/dev/null; done
rm -f "$PROJ"/tests/out/fail-* 2>/dev/null       # so that a « fail-… » picture always belongs to this run
export NODE_PATH="$TOOLS/npm/node_modules" PLAYWRIGHT_BROWSERS_PATH="$TOOLS/browsers" SUMMARY_STEPS=1
run_tests e2e America/Toronto "${1:-}" tests/e2e/app.test.cjs
rc=$?
pid=$(port_pid 4173); if [ -n "$pid" ] && is_ours "$pid"; then stop_pid "$pid"; fi
if ls "$PROJ"/tests/out/fail-* >/dev/null 2>&1; then
  # kept apart: the next run (maybe somebody else's) writes over proj/tests/out
  keep="${LAST_LOG%.log}-fail"; mkdir -p "$keep" && cp "$PROJ"/tests/out/fail-* "$keep/" && echo "pictures of the failing steps (and what the app asked the server): $keep/"
fi
echo "all pictures of this run: $PROJ/tests/out/"
exit $rc
