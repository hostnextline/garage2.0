#!/bin/bash
# Fetches the programs of the harness into $HIS_STACK/tools: only what is missing, so it is safe to run again.
# Needed once per Mac, or again if the stack's folder ($HIS_STACK, default ~/.his-stack) was removed.
# Public downloads only, each checked: npm packages, PostgREST's release, Go + the source of supabase/auth (GoTrue has
# no macOS program: it is built here, about 1 minute), the Python wheel « pgserver » for psql and pg_dump.
# Nothing is installed outside this folder (Go's caches and Deno's cache included).
H=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)           # the scripts: tests/stack/mac of the repository
S=${HIS_STACK:-$HOME/.his-stack}; mkdir -p "$S"; S=$(cd "$S" && pwd); TOOLS=$S/tools; DL=$S/dl   # the stack's own folder
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
set -euo pipefail
[ "$(uname -sm)" = "Darwin arm64" ] || { echo "this harness is for a Mac with Apple silicon (found: $(uname -sm))"; exit 1; }
mkdir -p "$TOOLS" "$DL" "$S/logs" "$S/run"
say(){ echo "== $*"; }
sha(){ echo "$1  $2" | shasum -a 256 -c - >/dev/null || { echo "checksum of $2 is wrong"; exit 1; }; }

# 1. Postgres 16 server WITH pgcrypto and uuid-ossp (postgres, initdb, pg_ctl), Deno, pg, Playwright
if [ ! -x "$TOOLS/npm/node_modules/@embedded-postgres/darwin-arm64/native/bin/postgres" ] || [ ! -x "$TOOLS/npm/node_modules/@deno/darwin-arm64/deno" ] \
   || [ ! -f "$TOOLS/npm/node_modules/pg/package.json" ] || [ ! -f "$TOOLS/npm/node_modules/playwright/package.json" ]; then
  say "npm: Postgres 16.15 (server), Deno 2.9.6, pg 8.16.3, Playwright 1.55.0"
  mkdir -p "$TOOLS/npm"; echo '{"name":"his-mac-stack-tools","private":true}' > "$TOOLS/npm/package.json"
  npm install --no-audit --no-fund --prefix "$TOOLS/npm" deno@2.9.6 pg@8.16.3 playwright@1.55.0 "@embedded-postgres/darwin-arm64@16.15.0-beta.19" > "$S/logs/install-npm.log" 2>&1
fi

# 2. Playwright 1.55.0's headless Chromium (revision 1187) and its ffmpeg
if [ ! -d "$TOOLS/browsers/chromium_headless_shell-1187" ]; then
  say "Playwright's headless Chromium"
  PLAYWRIGHT_BROWSERS_PATH="$TOOLS/browsers" node "$TOOLS/npm/node_modules/playwright/cli.js" install chromium-headless-shell ffmpeg > "$S/logs/install-browsers.log" 2>&1
fi

# 3. psql, pg_dump, pg_isready (Postgres 16 client programs): the wheel « pgserver » 0.1.4 (its own server has no pgcrypto: not used)
if [ ! -x "$TOOLS/pgclient/pgserver/pginstall/bin/psql" ]; then
  say "psql and pg_dump (wheel pgserver 0.1.4)"
  rm -rf "$DL/pgwheel"; mkdir -p "$DL/pgwheel"
  python3 -I -m pip download --quiet --no-deps --only-binary=:all: --dest "$DL/pgwheel" pgserver==0.1.4 > "$S/logs/install-pgclient.log" 2>&1
  mkdir -p "$DL/pgwheel/x" && (cd "$DL/pgwheel/x" && unzip -q ../pgserver-*.whl)
  mkdir -p "$TOOLS/pgclient/pgserver"
  cp -R "$DL/pgwheel/x/pgserver/pginstall" "$DL/pgwheel/x/pgserver/.dylibs" "$TOOLS/pgclient/pgserver/"
  chmod +x "$TOOLS/pgclient/pgserver/pginstall/bin/"*
fi

# 4. PostgREST: the project pins v12.2.3, which has no macOS arm64 build; v12.2.12 is the last fix release of the same 12.2 line.
#    Its macOS build looks for Homebrew's libpq: it is pointed at the libpq of step 3 instead.
if [ ! -x "$TOOLS/postgrest/postgrest" ]; then
  say "PostgREST v12.2.12"
  rm -rf "$DL/postgrest"; mkdir -p "$DL/postgrest" "$TOOLS/postgrest"
  curl -sSfL -m 600 -o "$DL/postgrest/postgrest.tar.xz" https://github.com/PostgREST/postgrest/releases/download/v12.2.12/postgrest-v12.2.12-macos-aarch64.tar.xz
  sha 66eb150109409caea1b90c819418d326b2a5fd59789209e0dd45c87078c71909 "$DL/postgrest/postgrest.tar.xz"
  tar -xJf "$DL/postgrest/postgrest.tar.xz" -C "$TOOLS/postgrest"
  cp "$TOOLS/pgclient/pgserver/.dylibs/libpq.5.dylib" "$TOOLS/postgrest/libpq.5.dylib"
  install_name_tool -change /opt/homebrew/opt/libpq/lib/libpq.5.dylib @executable_path/libpq.5.dylib "$TOOLS/postgrest/postgrest"
  codesign -f -s - "$TOOLS/postgrest/postgrest" 2>/dev/null
  "$TOOLS/postgrest/postgrest" --version
fi

# 5. Auth (GoTrue) v2.180.0, the project's version: built from the official source (supabase/auth has no macOS program)
if [ ! -x "$TOOLS/gotrue/auth" ] || [ ! -d "$TOOLS/gotrue/migrations" ]; then
  if [ ! -x "$TOOLS/go/bin/go" ]; then
    say "Go 1.27.4 (only to build GoTrue)"
    rm -rf "$DL/go"; mkdir -p "$DL/go"
    curl -sSfL -m 900 -o "$DL/go/go.tgz" https://go.dev/dl/go1.27.4.darwin-arm64.tar.gz
    sha 91a44a2b8a716600ad94a4f143e156116620db8828086a6e3602291be9bd0bb4 "$DL/go/go.tgz"
    tar -xzf "$DL/go/go.tgz" -C "$TOOLS"
  fi
  say "GoTrue v2.180.0 from source (about 1 minute)"
  rm -rf "$DL/auth-src"; mkdir -p "$DL/auth-src" "$TOOLS/gotrue"
  curl -sSfL -m 600 -o "$DL/auth-src/auth-src.tgz" https://github.com/supabase/auth/archive/refs/tags/v2.180.0.tar.gz
  sha cf322965e33787689933d59448aa26a20cc73532fe2ead5e86a9b730d8511007 "$DL/auth-src/auth-src.tgz"
  tar -xzf "$DL/auth-src/auth-src.tgz" -C "$DL/auth-src"
  ( export GOROOT="$TOOLS/go" GOPATH="$TOOLS/gopath" GOCACHE="$TOOLS/gocache" GOMODCACHE="$TOOLS/gopath/pkg/mod" GOTOOLCHAIN=local CGO_ENABLED=0 GOTELEMETRY=off
    "$TOOLS/go/bin/go" build -C "$DL/auth-src/auth-2.180.0" -ldflags "-X github.com/supabase/auth/internal/utilities.Version=v2.180.0" -o "$TOOLS/gotrue/auth" . ) > "$S/logs/install-gotrue.log" 2>&1
  rm -rf "$TOOLS/gotrue/migrations"; cp -R "$DL/auth-src/auth-2.180.0/migrations" "$TOOLS/gotrue/migrations"
  "$TOOLS/gotrue/auth" version | tail -1
fi

# 6. psql, pg_dump, pg_isready by their names, first on the tests' PATH
chmod +x "$H/bin/pgtool" "$H"/*.sh
for t in psql pg_dump pg_isready; do ln -sf pgtool "$H/bin/$t"; done
say "programs ready in $TOOLS  (then: bash $H/up.sh [source folder])"
