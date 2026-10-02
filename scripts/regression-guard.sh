#!/usr/bin/env bash
# Uso: bash scripts/regression-guard.sh [--cached | --prepush]
# Sin argumentos valida el working tree; --cached valida staged y --prepush el diff vs upstream.
set -euo pipefail

# Git hooks on Windows can close stdout; log to stderr and preserve stdout for the TTY check.
exec 3>&1 1>&2

if [[ -t 3 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; CYAN=''; MAGENTA=''; BOLD=''; NC=''
fi

BERU_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BERU_DIR"

PASS=0; FAIL=0; ERRORS=""

# A broken log stream must not abort the hook under set -e.
ok()   { PASS=$((PASS+1)); printf '%b\n' "  ${GREEN}[PASS]${NC} $1" || true; }
fail() { FAIL=$((FAIL+1)); ERRORS="${ERRORS}\n  ${RED}[FAIL]${NC} $1"; printf '%b\n' "  ${RED}[FAIL]${NC} $1" || true; }
info() { printf '%b\n' "  ${CYAN}[INFO]${NC} $1" || true; }
warn() { printf '%b\n' "  ${YELLOW}[WARN]${NC} $1" || true; }
say()  { printf '%b\n' "$1" || true; }

run_verify() {
    if npm run verify 2>&1; then
        ok "npm run verify — lint + format + JS + Python OK"
        return 0
    fi
    fail "npm run verify — falló (ver log arriba)"
    return 1
}

MODE="working tree"
if [[ "${1:-}" == "--cached" ]]; then
    CHANGED=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
    MODE="staged (pre-commit)"
elif [[ "${1:-}" == "--prepush" ]]; then
    UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "origin/main")
    CHANGED=$(git diff --name-only "${UPSTREAM}...HEAD" 2>/dev/null || true)
    MODE="vs upstream (pre-push)"
else
    CHANGED=$(git diff --name-only --diff-filter=ACMR 2>/dev/null || true)
    UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null || true)
    CHANGED=$(printf "%s\n%s" "$CHANGED" "$UNTRACKED" | grep -v '^$' || true)
fi

if [[ -z "${CHANGED// /}" ]]; then
    if [[ "${1:-}" == "--prepush" ]]; then
        # An empty upstream diff still requires the full validation gate.
        warn "[WARN] --prepush: sin diff vs upstream. Corriendo suite completa como safety net."
        MODE="vs upstream (pre-push, sin diff) → safety net"
    else
        say "${YELLOW}[WARN] No hay archivos cambiados. Nada que validar.${NC}"
        exit 0
    fi
fi

say "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
say "${BOLD}${CYAN}  Loop A: Video Regression Guard  [${MODE}]${NC}"
say "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
say ""
say "${BOLD}Archivos modificados:${NC}"
printf '%s\n' "$CHANGED" | head -15 | sed 's/^/    /' || true
COUNT=$(printf '%s\n' "$CHANGED" | grep -c . 2>/dev/null || echo 0)
if [[ $COUNT -gt 15 ]]; then say "    ... y $((COUNT-15)) archivos más"; fi
say ""

PYTHON_CHANGED=false
if printf '%s\n' "$CHANGED" | grep -qE '^python/'; then
    PYTHON_CHANGED=true
    say "${MAGENTA}┌─[Trigger A] python/ cambió ─────────────────────────────${NC}"
    say "${MAGENTA}│${NC} Ejecutando tests de delogo..."

    say "\n${CYAN}├── Smoke test: delogo filter graphs${NC}"
    if python python/test_delogo.py 2>/dev/null; then
        ok "test_delogo.py — todos los filtros OK"
    else
        fail "test_delogo.py — algunos filtros fallaron"
    fi

    if [[ -f python/test_delogo_e2e.py ]]; then
        say "\n${CYAN}├── E2E visual: pipeline delogo${NC}"
        if python python/test_delogo_e2e.py 2>/dev/null; then
            ok "test_delogo_e2e.py — pipeline visual OK"
        else
            fail "test_delogo_e2e.py — pipeline visual falló"
        fi
    fi

    if [[ -f python/test_delogo_robust.py ]]; then
        say "\n${CYAN}├── Robust test: casos extremos${NC}"
        if python python/test_delogo_robust.py 2>/dev/null; then
            ok "test_delogo_robust.py — casos extremos OK"
        else
            fail "test_delogo_robust.py — casos extremos fallaron"
        fi
    fi

    say "\n${CYAN}├── Gate completo (npm run verify)${NC}"
    VERIFY_LOG=$(mktemp)
    if npm run verify 2>&1 | tee "$VERIFY_LOG"; then
        ok "npm run verify — lint + format + JS + Python OK"
    else
        fail "npm run verify — falló (ver log arriba)"
    fi

    if [[ -f tests-baseline.log ]]; then
        say "\n${CYAN}├── Comparación contra baseline${NC}"
        BASELINE_TOTAL=$(grep -oP '\d+ passed.*\(\K\d+(?=\))' tests-baseline.log 2>/dev/null | tail -1 || echo "")
        BASELINE_PASSED=$(grep -oP '(\d+) passed' tests-baseline.log | tail -1 | grep -oP '\d+' || echo "0")

        CURRENT_TOTAL=$(grep -oP '\d+ passed.*\(\K\d+(?=\))' "$VERIFY_LOG" 2>/dev/null | tail -1 || echo "")
        CURRENT_PASSED=$(grep -oP '(\d+) passed' "$VERIFY_LOG" | tail -1 | grep -oP '\d+' || echo "0")

        if [[ -n "$BASELINE_TOTAL" && -n "$CURRENT_TOTAL" ]]; then
            if [[ "$BASELINE_TOTAL" -eq "$CURRENT_TOTAL" ]]; then
                ok "Tests totales: $BASELINE_TOTAL (sin cambios vs baseline)"
            else
                warn "Baseline: $BASELINE_TOTAL tests | Actual: $CURRENT_TOTAL tests"
                if [[ "${CURRENT_PASSED:-0}" -ge "${BASELINE_PASSED:-0}" ]]; then
                    ok "Tests pasando: $CURRENT_PASSED (baseline: $BASELINE_PASSED)"
                else
                    fail "REGRESIÓN: pasaban $BASELINE_PASSED, ahora pasan $CURRENT_PASSED"
                fi
            fi
        else
            warn "No se pudo parsear baseline — comparación saltada"
        fi
    fi
    rm -f "$VERIFY_LOG"

    say "${MAGENTA}└─────────────────────────────────────────────────────────${NC}"
fi

PROCESS_JS_CHANGED=false
if printf '%s\n' "$CHANGED" | grep -qE '^main/(handlers/process|processing-run)\.js$'; then
    PROCESS_JS_CHANGED=true
    say "${MAGENTA}┌─[Trigger B] Processing Run en main cambió ──────────────${NC}"
    say "${MAGENTA}│${NC} Ejecutando tests del pipeline IPC..."

    PROCESS_TESTS=(
        "tests/process-input-validation.test.js"
        "tests/process-handler-run.test.js"
        "tests/process-run-scoped-events.test.js"
        "tests/main-quit-during-probe.test.js"
        "tests/process-cancel-output-cleanup.test.js"
        "tests/process-output-security.test.js"
        "tests/process-media-validation.test.js"
    )

    for test_file in "${PROCESS_TESTS[@]}"; do
        say "\n${CYAN}├── $test_file${NC}"
        if npx vitest run "$test_file" --reporter=verbose 2>/dev/null; then
            ok "$(basename $test_file .test.js)"
        else
            fail "$(basename $test_file .test.js)"
        fi
    done
    say "${MAGENTA}└─────────────────────────────────────────────────────────${NC}"
fi

SPAWN_CHANGED=false
if printf '%s\n' "$CHANGED" | grep -qE '^main/utils/processor-spawn\.js$'; then
    SPAWN_CHANGED=true
    say "${MAGENTA}┌─[Trigger C] main/utils/processor-spawn.js cambió ───────${NC}"
    say "${MAGENTA}│${NC} Ejecutando tests de spawn + batch + pipeline..."

    SPAWN_TESTS=(
        "tests/python.ffmpeg-path.test.js"
        "tests/python.ffprobe-na.test.js"
        "tests/python.batch-errors.test.js"
        "tests/python.logging.test.js"
        "tests/batch-process.test.js"
        "tests/batch-workers.test.js"
        "tests/export-pipeline.test.js"
    )

    for test_file in "${SPAWN_TESTS[@]}"; do
        say "\n${CYAN}├── $test_file${NC}"
        if npx vitest run "$test_file" --reporter=verbose 2>/dev/null; then
            ok "$(basename $test_file .test.js)"
        else
            fail "$(basename $test_file .test.js)"
        fi
    done
    say "${MAGENTA}└─────────────────────────────────────────────────────────${NC}"
fi

MAIN_OTHER=false
if printf '%s\n' "$CHANGED" | grep -qE '^main/' && ! $PROCESS_JS_CHANGED && ! $SPAWN_CHANGED; then
    MAIN_OTHER=true
    say "${YELLOW}┌─[Trigger D] main/ (otros) cambió — tests generales${NC}"

    OTHER_TESTS=(
        "tests/path-security.test.js"
        "tests/concurrency.test.js"
        "tests/job-manifest.test.js"
    )

    for test_file in "${OTHER_TESTS[@]}"; do
        say "\n${CYAN}├── $test_file${NC}"
        if npx vitest run "$test_file" --reporter=verbose 2>/dev/null; then
            ok "$(basename $test_file .test.js)"
        else
            fail "$(basename $test_file .test.js)"
        fi
    done
fi

if ! $PYTHON_CHANGED && ! $PROCESS_JS_CHANGED && ! $SPAWN_CHANGED && ! $MAIN_OTHER; then
    say "\n${CYAN}┌─[Trigger E] cambios generales — gate completo${NC}"
    run_verify
fi

say ""
say "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
say "${BOLD}${CYAN}  Reporte: ${PASS} OK  |  ${FAIL} FAIL${NC}"
say "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"

if [[ $FAIL -gt 0 ]]; then
    say "${RED}${BOLD}[FAIL] Regresión detectada:${NC}$ERRORS"
    say ""
    say "${YELLOW}[WARN] Revisa los errores antes de continuar.${NC}"
    say "${YELLOW}[WARN] Para saltar: git push --no-verify (o commit -n)${NC}"
    exit 1
else
    say "${GREEN}${BOLD}[OK] Pipeline de video OK — sin regresiones.${NC}"
    exit 0
fi
