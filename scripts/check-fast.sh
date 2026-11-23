#!/usr/bin/env bash
# The fast local gate: the judgements `make check` makes, over the tests a change
# can plausibly break instead of the whole module.
#
# What stays here and what leaves: gofmt and repolint are seconds each and catch
# errors CI reports ten minutes later, so both stay. The full `go test ./...`,
# the sensitive-path coverage gate, golangci-lint and -race need minutes and have
# their own CI jobs (ci.yml `test` and `lint`), so they are not repeated here.
# `make check` is still the pre-push gate.
#
# Speed comes from narrowing the *tests*, not the packages: one package here
# holds 1300 tests and takes two minutes, while the ones sharing a changed file's
# stem finish in seconds. Selection is by name, so it is a heuristic: a test that
# reaches a changed file from an unrelated name does not run, and a file with no
# sibling test runs its whole package. `make check` and CI cover both gaps.
#
# Usage: scripts/check-fast.sh [--base <rev>] [--print-plan]
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

base=HEAD
print_plan=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base=${2:?--base needs a revision}; shift 2 ;;
    --print-plan) print_plan=1; shift ;;
    *) echo "check-fast: unknown argument $1" >&2; exit 2 ;;
  esac
done

# Changed and untracked files alike: a new file is one no gate has opened yet.
changed=$( { git diff --name-only --no-renames "$base"; git ls-files --others --exclude-standard; } | sort -u )
if [ -z "$changed" ]; then
  echo "check-fast: nothing changed against $base"
  exit 0
fi

go_files=$(printf '%s\n' "$changed" | grep -E '\.go$' | grep -v '^desktop/' || true)
ts_files=$(printf '%s\n' "$changed" | grep -E '^desktop/frontend-next/.*\.(ts|tsx)$' || true)

# One line per package: "<package>|<run pattern>", an empty pattern meaning the
# whole package. Each package directory is read once and matched in one awk pass:
# a directory holds hundreds of test files (internal/frontend/serve has 421), and
# a shell loop over their names costs more than the tests it selects.
#
# A file and a test file belong together when they name the same feature — the
# word before the first underscore, singular and plural read alike — which is how
# this tree names them: peer_mail.go draws peer_mail_test.go and
# peer_hop_limit_test.go, while dispatch.go leaves dispatch_handoff_test.go alone
# because that test names a different subject.
plan=""
if [ -f go.mod ] && [ -n "$go_files" ]; then
  for pkg in $(printf '%s\n' "$go_files" | xargs -r -n1 dirname | sort -u); do
    stems=$(printf '%s\n' "$go_files" | sed -n "s|^$pkg/\([^/]*\)\.go$|\1|p" | sort -u)
    [ -n "$stems" ] || continue
    names=$( { printf '%s\n' $stems | paste -sd' ' -
               grep -HoE '^func Test[A-Za-z0-9_]*' "$pkg"/*_test.go 2>/dev/null | sed 's/:func /:/'
             } | awk '
                 function feature(s,   i) { i = index(s, "_"); return (i == 0) ? s : substr(s, 1, i - 1) }
                 function fold(s) { sub(/s$/, "", s); return s }
                 NR == 1 {
                   n = split($0, a, " ")
                   for (i = 1; i <= n; i++) if (a[i] != "") stem[feature(a[i])] = 1
                   next
                 }
                 {
                   colon = match($0, /:Test[0-9A-Za-z_]*$/)
                   if (colon == 0) next
                   file = substr($0, 1, colon - 1)
                   name = substr($0, colon + 1)
                   n = split(file, parts, "/"); base = parts[n]
                   sub(/_test\.go$/, "", base)
                   if (feature(base) in stem) { print name }
                 }' | sort -u || true)
    if [ -n "$names" ]; then
      plan="$plan$pkg|^($(printf '%s\n' "$names" | paste -sd'|' -))$
"
    else
      plan="$plan$pkg|
"
    fi
  done
fi

if [ "$print_plan" = 1 ]; then
  echo "check-fast: gofmt over:$(printf ' %s' $go_files)"
  printf '%s' "$plan" | while IFS='|' read -r pkg pattern; do
    [ -n "$pkg" ] || continue
    if [ -n "$pattern" ]; then
      echo "check-fast: go test ./$pkg/... -run '$pattern'"
    else
      echo "check-fast: go test ./$pkg/... (whole package: no sibling test)"
    fi
  done
  # `pnpm typecheck` is `tsc --noEmit` over the whole project, not the changed
  # files; the count says what triggered the run, never its scope.
  echo "check-fast: frontend typecheck (whole project) — $(printf '%s' "$ts_files" | grep -c . || true) frontend file(s) changed"
  exit 0
fi

status=0

if [ -n "$go_files" ]; then
  unformatted=$(printf '%s\n' "$go_files" | xargs -r gofmt -l || true)
  if [ -n "$unformatted" ]; then
    echo "check-fast: not gofmt-clean:"
    printf '%s\n' "$unformatted"
    status=1
  fi
fi

while IFS='|' read -r pkg pattern; do
  [ -n "$pkg" ] || continue
  if [ -n "$pattern" ]; then
    echo "check-fast: go test ./$pkg/... -run '$pattern'"
    go vet "./$pkg/..." || { status=1; continue; }
    go test -count=1 "./$pkg/..." -run "$pattern" || status=1
  else
    echo "check-fast: go test ./$pkg/... (whole package: no sibling test)"
    go vet "./$pkg/..." || { status=1; continue; }
    go test -count=1 "./$pkg/..." || status=1
  fi
done <<< "$plan"

# A change this wide is a feature landing, not an edit: the narrowed run is then
# most of a full one, and saying so is more useful than pretending it was fast.
if [ "$(printf '%s' "$plan" | grep -c . || true)" -gt 4 ]; then
  echo "check-fast: note: $(printf '%s' "$plan" | grep -c . ) packages changed; a run this wide is close to the full gate, so run 'make check' before pushing"
fi

if [ -n "$ts_files" ]; then
  echo "check-fast: frontend typecheck"
  ( cd desktop/frontend-next && pnpm typecheck ) || status=1
fi

# The standards gate reads the whole tree: its cross-file rules (orphans,
# layering, frontend parity) cannot be judged from one package, and it costs
# less than a narrowed run's git round trip.
if [ "${CHECK_FAST_SKIP_REPOLINT:-}" = "1" ]; then
  echo "check-fast: repolint skipped (CHECK_FAST_SKIP_REPOLINT=1)"
else
  echo "check-fast: repolint"
  go run ./tools/repolint || status=1
fi

if [ "$status" -ne 0 ]; then
  echo "check-fast: failed. Run 'make check' for the full gate before pushing." >&2
  exit 1
fi
echo "check-fast: clean"
