#!/usr/bin/env bash
#
# MiWarp Desktop — Release Candidate Verification Pipeline
#
# Runs the full CI gate (lint + format + svelte-check + i18n + unit tests +
# Rust fmt/clippy + production build) and, on success, optionally boots the
# Tauri dev server once for smoke verification. Designed to be run before
# tagging any v1.x.y-rc.N tag.
#
# Usage:
#   ./scripts/verify-rc.sh              # full gate, then dev smoke (default)
#   ./scripts/verify-rc.sh --skip-dev   # full gate only, skip dev smoke
#   ./scripts/verify-rc.sh --only lint,check,test   # subset
#
# Exit codes:
#   0  — gate passed (and dev smoke passed unless --skip-dev)
#   1  — any required step failed
#   2  — required tool missing (e.g. cargo not on PATH)
#

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Colors (TTY + NO_COLOR aware)
if [[ -t 1 ]] && [ -z "${NO_COLOR:-}" ]; then
  BRAND='\033[38;5;214m'
  GREEN='\033[38;5;71m'
  RED='\033[38;5;167m'
  DIM='\033[38;5;245m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  BRAND='' GREEN='' RED='' DIM='' BOLD='' NC=''
fi

ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
info()  { printf "${BRAND}→${NC} %s\n" "$1"; }
fail()  { printf "${RED}✗${NC} %s\n" "$1"; }
dim()   { printf "${DIM}%s${NC}\n" "$1"; }
header(){ printf "\n${BRAND}${BOLD}═══ %s ═══${NC}\n\n" "$1"; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

SKIP_DEV=false
ONLY_STEPS=""
ALL_STEPS=(lint format check i18n test rust build dev)

for arg in "$@"; do
  case "$arg" in
    --skip-dev)     SKIP_DEV=true ;;
    --only=*)       ONLY_STEPS="${arg#--only=}" ;;
    --only)
      shift
      ONLY_STEPS="${1:-}"
      ;;
    --help|-h)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      fail "Unknown argument: $arg"
      exit 1
      ;;
  esac
done

# Build the set of steps to run
if [ -n "$ONLY_STEPS" ]; then
  IFS=',' read -r -a STEPS <<< "$ONLY_STEPS"
else
  STEPS=("${ALL_STEPS[@]}")
fi

is_step_enabled() {
  local needle="$1"
  for s in "${STEPS[@]}"; do
    [ "$s" = "$needle" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Tooling presence
# ---------------------------------------------------------------------------

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Required tool not found on PATH: $1"
    dim "  Hint: install via scripts/setup.sh or your package manager"
    exit 2
  fi
}

require_tool node
require_tool npm
require_tool cargo

# ---------------------------------------------------------------------------
# Step runners
# ---------------------------------------------------------------------------

FAILED_STEPS=()

run_step() {
  local name="$1"
  local description="$2"
  shift 2

  header "$description"
  if "$@"; then
    ok "$description — passed"
    return 0
  else
    fail "$description — FAILED"
    FAILED_STEPS+=("$name")
    return 1
  fi
}

step_lint()    { npm run lint; }
step_format()  { npm run format:check; }
step_check()   { npm run check; }
step_i18n()    { npm run i18n:check; }
step_test()    { npm test; }
step_rust()    { npm run rust:check; }
step_build()   { npm run build; }

step_dev() {
  # Smoke boot the Vite dev server for ~8 seconds to confirm the shell
  # actually starts. We do NOT spawn tauri dev (that requires a desktop
  # session and can hang); vite dev alone covers the frontend startup
  # contract for RC verification.
  info "Booting vite dev for smoke check (~8s)…"
  if timeout 12 npm run dev >/tmp/miwarp-verify-rc-dev.log 2>&1; then
    if grep -q "Local:.*http" /tmp/miwarp-verify-rc-dev.log; then
      ok "vite dev served the Vite local URL"
      return 0
    fi
    fail "vite dev exited but did not report a Local URL"
    dim "  See /tmp/miwarp-verify-rc-dev.log"
    return 1
  fi
  rc=$?
  # 124 = timeout reached (expected)
  if [ "$rc" -eq 124 ]; then
    if grep -q "Local:.*http" /tmp/miwarp-verify-rc-dev.log; then
      ok "vite dev served the Vite local URL (timed out as expected)"
      return 0
    fi
  fi
  fail "vite dev failed (exit $rc)"
  dim "  See /tmp/miwarp-verify-rc-dev.log"
  return 1
}

# ---------------------------------------------------------------------------
# Run pipeline
# ---------------------------------------------------------------------------

header "MiWarp RC verify-rc pipeline"
info "Steps: ${STEPS[*]}"
info "Skip dev smoke: $SKIP_DEV"
[ -n "${MIWARP_VERSION:-}" ] && dim "  MIWARP_VERSION=$MIWARP_VERSION"
[ -n "${MIWARP_RC_TAG:-}" ] && dim "  MIWARP_RC_TAG=$MIWARP_RC_TAG"

is_step_enabled lint    && run_step lint    "Lint (ESLint)"                   step_lint    || true
is_step_enabled format  && run_step format  "Format check (Prettier)"          step_format  || true
is_step_enabled check   && run_step check   "Svelte type check (svelte-check)" step_check  || true
is_step_enabled i18n    && run_step i18n    "i18n key alignment + placeholders" step_i18n  || true
is_step_enabled test    && run_step test    "Unit tests (Vitest)"             step_test    || true
is_step_enabled rust    && run_step rust    "Rust fmt + clippy"               step_rust    || true
is_step_enabled build   && run_step build   "Frontend production build"       step_build   || true

if is_step_enabled dev && [ "$SKIP_DEV" = false ]; then
  run_step dev "Dev server smoke boot (vite)" step_dev || true
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

header "RC verify-rc summary"

if [ "${#FAILED_STEPS[@]}" -eq 0 ]; then
  ok "All steps passed. Safe to tag ${MIWARP_RC_TAG:-the RC}."
  exit 0
fi

fail "Failed steps:"
for s in "${FAILED_STEPS[@]}"; do
  dim "  - $s"
done
dim "See docs/v1.1.0-rc-checklist.md for the 12-condition gate."
exit 1
