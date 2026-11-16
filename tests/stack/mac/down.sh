#!/bin/bash
# Stops everything this harness started (and nothing else). The database's files are kept; up.sh makes a new one anyway.
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
lock "down.sh"
pid=$(port_pid 4173); if [ -n "$pid" ] && is_ours "$pid"; then stop_pid "$pid"; fi
for pid in $(pgrep -f "$TOOLS/browsers/" 2>/dev/null); do kill -KILL "$pid" 2>/dev/null; done    # this harness's own Chromium, left by a cut run
stop_services
db_stop
left=
for p in 54331 8011 8021 3011 9997 $DBPORT; do pid=$(port_pid $p); [ -n "$pid" ] && is_ours "$pid" && left="$left $p"; done
[ -z "$left" ] && echo "DOWN: ok (nothing of this harness runs any more)" || { echo "DOWN: still running on port(s)$left"; exit 1; }
