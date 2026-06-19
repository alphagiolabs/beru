#!/usr/bin/env bash
# ===========================================================================
# Loop A: 🔁 Video Regression Guard
#
# Protege el pipeline de video de Beru ejecutando tests automáticos cada vez
# que cambian archivos críticos.
#
# Trigger: python/*, main/handlers/process.js, main/utils/processor-spawn.js
#
# USO:
#   bash scripts/regression-guard.sh              # working tree
#   bash scripts/regression-guard.sh --cached     # staged (pre-commit)
#   bash scripts/regression-guard.sh --prepush    # vs upstream (pre-push)
#
# Para saltar: git push --no-verify  (o commit --no-verify)
# ===========================================================================
set -euo pipefail

# ── Windows/Git-Bash robustness ────────────────────────────────────────────
# Git on Windows can close or corrupt stdout (fd 1) when invoking hooks via
# exec + subprocess. Redirect all log/banner output to stderr (fd 2), which
# Git keeps stable for the entire hook lifetime. Preserve the original stdout
# on fd 3 in case a future caller needs it.
exec 3>&1 1>&2

# ── Colores (seguros para cron/CI) ─────────────────────────────────────────
# Check fd 3 (original stdout) for TTY since fd 1 is now stderr.
if [[ -t 3 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; BOLD='\033[1m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; CYAN=''; MAGENTA=''; BOLD=''; NC=''
fi

BERU_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BERU_DIR"

PASS=0; FAIL=0; ERRORS=""

# ── Helpers ─────────────────────────────────────────────────────────────────
# Use printf (POSIX, robust) instead of echo -e (bash builtin, fragile on
# Windows). Guard with || true so a broken fd never kills the hook under
# `set -e` — a log line failing must not block a push/commit.
ok()   { PASS=$((PASS+1)); printf '%b\n' "  ${GREEN}[PASS]${NC} $1" || true; }
fail() { FAIL=$((FAIL+1)); ERRORS="${ERRORS}\n  ${RED}[FAIL]${NC} $1"; printf '%b\n' "  ${RED}[FAIL]${NC} $1" || true; }
info() { printf '%b\n' "  ${CYAN}[INFO]${NC} $1" || true; }
warn() { printf '%b\n' "  ${YELLOW}[WARN]${NC} $1" || true; }
say()  { printf '%b\n' "$1" || true; }

# ── Detectar archivos modificados ─────────────────────────────────────────
MODE="working tree"
if [[ "${1:-}" == "--cached" ]]; then
    CHANGED=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
    MODE="staged (pre-commit)"
elif [[ "${1:-}" == "--prepush" ]]; then
    # Commits on this branch not yet on upstream (what is about to be pushed).
    UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "origin/main")
    CHANGED=$(git diff --name-only "${UPSTREAM}...HEAD" 2>/dev/null || true)
    MODE="vs upstream (pre-push)"
else
    CHANGED=$(git diff --name-only --diff-filter=ACMR 2>/dev/null || true)
    UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null || true)
    CHANGED=$(printf "%s\n%s" "$CHANGED" "$UNTRACKED" | grep -v '^$' || true)
fi

if [[ -z "${CHANGED// /}" ]]; then
    say "${YELLOW}[WARN] No hay archivos cambiados. Nada que validar.${NC}"
    exit 0
fi

# ── Banner ──────────────────────────────────────────────────────────────────
say "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
say "${BOLD}${CYAN}  Loop A: 🔁 Video Regression Guard  [${MODE}]${NC}"
say "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
say ""
say "${BOLD}Archivos modificados:${NC}"
printf '%s\n' "$CHANGED" | head -15 | sed 's/^/    /' || true
COUNT=$(printf '%s\n' "$CHANGED" | grep -c . 2>/dev/null || echo 0)
if [[ $COUNT -gt 15 ]]; then say "    ... y $((COUNT-15)) archivos más"; fi
say ""

# ═══════════════════════════════════════════════════════════════════════════
#  TRIGGER A: python/ — cualquier archivo en el pipeline Python
# ═══════════════════════════════════════════════════════════════════════════
PYTHON_CHANGED=false
if printf '%s\n' "$CHANGED" | grep -qE '^python/'; then
    PYTHON_CHANGED=true
    say "${MAGENTA}┌─[Trigger A] python/ cambió ─────────────────────────────${NC}"
    say "${MAGENTA}│${NC} Ejecutando tests de delogo..."

    # ── Smoke test: delogo filter graphs ──
    say "\n${CYAN}├── Smoke test: delogo filter graphs${NC}"
    if python python/test_delogo.py 2>/dev/null; then
        ok "test_delogo.py — todos los filtros OK"
    else
        fail "test_delogo.py — algunos filtros fallaron"
    fi

    # ── E2E visual test ──
    say "\n${CYAN}├── E2E visual: pipeline delogo${NC}"
    if python python/test_delogo_e2e.py 2>/dev/null; then
        ok "test_delogo_e2e.py — pipeline visual OK"
    else
        fail "test_delogo_e2e.py — pipeline visual falló"
    fi

    # ── Robust test (si existe) ──
    if [[ -f python/test_delogo_robust.py ]]; then
        say "\n${CYAN}├── Robust test: casos extremos${NC}"
        if python python/test_delogo_robust.py 2>/dev/null; then
            ok "test_delogo_robust.py — casos extremos OK"
        else
            fail "test_delogo_robust.py — casos extremos fallaron"
        fi
    fi

    # ── Baseline comparison ──
    if [[ -f tests-baseline.log ]]; then
        say "\n${CYAN}├── Comparación contra baseline${NC}"
        BASELINE_TOTAL=$(grep -oP '\d+ passed.*\(\K\d+(?=\))' tests-baseline.log 2>/dev/null | tail -1 || echo "")
        BASELINE_PASSED=$(grep -oP '(\d+) passed' tests-baseline.log | tail -1 | grep -oP '\d+' || echo "0")

        npm test 2>&1 | tee /tmp/beru-regression-current.log
        CURRENT_TOTAL=$(grep -oP '\d+ passed.*\(\K\d+(?=\))' /tmp/beru-regression-current.log 2>/dev/null | tail -1 || echo "")
        CURRENT_PASSED=$(grep -oP '(\d+) passed' /tmp/beru-regression-current.log | tail -1 | grep -oP '\d+' || echo "0")

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
    say "${MAGENTA}└─────────────────────────────────────────────────────────${NC}"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  TRIGGER B: main/handlers/process.js  (handler IPC del pipeline)
# ═══════════════════════════════════════════════════════════════════════════
PROCESS_JS_CHANGED=false
if printf '%s\n' "$CHANGED" | grep -qE '^main/handlers/process\.js$'; then
    PROCESS_JS_CHANGED=true
    say "${MAGENTA}┌─[Trigger B] main/handlers/process.js cambió ─────────────${NC}"
    say "${MAGENTA}│${NC} Ejecutando tests del pipeline IPC..."

    PROCESS_TESTS=(
        "tests/processing-errors.test.js"
        "tests/processing-logs.test.js"
        "tests/process-input-validation.test.js"
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

# ═══════════════════════════════════════════════════════════════════════════
#  TRIGGER C: main/utils/processor-spawn.js  (spawn del procesador Python)
# ═══════════════════════════════════════════════════════════════════════════
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
        "tests/batch-materialize.test.js"
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

# ═══════════════════════════════════════════════════════════════════════════
#  TRIGGER D: Otros cambios en main/ (genérico)
# ═══════════════════════════════════════════════════════════════════════════
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

# ═══════════════════════════════════════════════════════════════════════════
#  TRIGGER E: Ningún trigger crítico — full suite
# ═══════════════════════════════════════════════════════════════════════════
if ! $PYTHON_CHANGED && ! $PROCESS_JS_CHANGED && ! $SPAWN_CHANGED && ! $MAIN_OTHER; then
    say "\n${CYAN}┌─[Trigger E] cambios generales — suite completa${NC}"
    if npm test 2>&1; then
        ok "npm test — suite completa OK"
    else
        fail "npm test — algunos tests fallaron"
    fi
fi

# ═══ REPORTE FINAL ══════════════════════════════════════════════════════════
say ""
say "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
say "${BOLD}${CYAN}  📊 Reporte: ${PASS} ✅  |  ${FAIL} ❌${NC}"
say "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"

if [[ $FAIL -gt 0 ]]; then
    say "${RED}${BOLD}❌ Regresión detectada:${NC}$ERRORS"
    say ""
    say "${YELLOW}[WARN] Revisa los errores antes de continuar.${NC}"
    say "${YELLOW}[WARN] Para saltar: git push --no-verify (o commit -n)${NC}"
    exit 1
else
    say "${GREEN}${BOLD}✅ Pipeline de video OK — sin regresiones.${NC}"
    exit 0
fi
