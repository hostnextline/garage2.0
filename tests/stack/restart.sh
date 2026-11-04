#!/bin/bash
# Restarts one part of the local test copy by its port: functions (8011), mocks (8021), gateway (54331), postgrest (3011), auth (9997).
S=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for name in "$@"; do
  case $name in functions) p=8011;; mocks) p=8021;; gateway) p=54331;; postgrest) p=3011;; auth) p=9997;; *) echo "unknown $name"; continue;; esac
  fuser -k -TERM $p/tcp >/dev/null 2>&1; for i in $(seq 1 30); do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null || break; sleep 0.2; done
done
bash "$S/start.sh" >/dev/null 2>&1
echo restarted "$@"
