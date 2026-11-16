#!/bin/bash
# The database tests (tests/db/*.test.mjs) on the local database, from the current state of the source folder.
#   bash db-tests.sh                    every file
#   bash db-tests.sh planner            one file: tests/db/<name>.test.mjs (jobs, planner, windows…)
#   bash db-tests.sh "plan_block"       the tests whose name matches (regular expression, as --test-name-pattern)
#   bash db-tests.sh planner "truck"    both
# SRC=<folder> tests another folder than the last up.sh's; NOSYNC=1 runs the copy as it is.
# Changed migrations are seen: the database is rebuilt first. Each test rolls back what it did.
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
lock "db-tests.sh $*"
prepare db
pick_files db "$@"
run_tests db UTC "$PATTERN" "${FILES[@]}"
