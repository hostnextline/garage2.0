#!/bin/bash
# Rebuilds the test database from nothing (all migrations again). Programs and keys are kept.
S=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
bash "$S/stop.sh" >/dev/null; rm -rf "$S/run/pgdata" "$S/run/.built"; bash "$S/install.sh"
