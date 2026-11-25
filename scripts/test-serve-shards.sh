#!/usr/bin/env bash
# Run internal/frontend/serve as the three name-sharded suites CI runs, in
# parallel. CI cuts this package the same way because it holds ~1900 serial
# tests whose sum is what sets the wall time of one whole-tree `go test`; no
# single test is slow (the worst is ~13s), so `-p` cannot help — that
# parallelizes across packages, and this is one package.
#
# The two -run filters and the one -skip partition the names exactly: every
# test lands in exactly one shard, so no test runs twice and none is dropped.
#
# Usage: scripts/test-serve-shards.sh [go test flags...]
#
# -run and -skip are refused: each shard supplies its own, and Go keeps the
# last one, so passing either here would silently replace the partition with a
# filter every shard shares (all three then report "no tests to run").
set -euo pipefail

for arg in "$@"; do
  case "$arg" in
    -run|--run|-run=*|--run=*|-skip|--skip|-skip=*|--skip=*)
      echo "test-serve-shards: $arg would replace a shard's own partition" >&2
      echo "test-serve-shards: run the package directly for a filtered subset" >&2
      exit 2
      ;;
  esac
done

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

pkg=./internal/frontend/serve

# Keep in step with test-windows-shards in .github/workflows/ci.yml.
shards=(
  'serve-1|-run|^Test[A-E]'
  'serve-2|-run|^Test[F-R]'
  'serve-3|-skip|^Test[A-R]'
)

tmp=$(mktemp -d)
logs=()
pids=()

cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT

for shard in "${shards[@]}"; do
  IFS='|' read -r label flag filter <<<"$shard"
  log="$tmp/$label.log"
  logs+=("$log")
  # -count=1 because the result cache records every file and environment access
  # a test binary makes; on Windows resolving those costs minutes per pass.
  go test -count=1 "$flag" "$filter" "$@" "$pkg" >"$log" 2>&1 &
  pids+=($!)
  echo "test-serve: started $label ($flag $filter)"
done

failed=0
for i in "${!pids[@]}"; do
  if wait "${pids[$i]}"; then
    echo "test-serve: ok  $(basename "${logs[$i]}" .log)"
  else
    echo "test-serve: FAIL $(basename "${logs[$i]}" .log)"
    failed=1
  fi
done

for log in "${logs[@]}"; do
  echo
  echo "--- $(basename "$log" .log) ---"
  cat "$log"
done

if [ "$failed" -ne 0 ]; then
  exit 1
fi
