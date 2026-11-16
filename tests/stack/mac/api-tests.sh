#!/bin/bash
# The tests of the server functions (tests/api/*.test.mjs) through the local front door (127.0.0.1:54331).
#   bash api-tests.sh                       every file
#   bash api-tests.sh functions             one file: tests/api/<name>.test.mjs (functions, backup-restore…)
#   bash api-tests.sh "invitation"          the tests whose name matches (regular expression, as --test-name-pattern)
#   bash api-tests.sh functions "stripe"    both
# SRC=<folder> tests another folder than the last up.sh's; NOSYNC=1 runs the copy as it is.
# Changed migrations → the database is rebuilt first; changed functions → they are restarted first.
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
lock "api-tests.sh $*"
prepare all
pick_files api "$@"
run_tests api UTC "$PATTERN" "${FILES[@]}"
