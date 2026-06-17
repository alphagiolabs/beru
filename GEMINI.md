# Gemini-Specific Instructions

**Read `AGENTS.md` first — it is the authoritative source for this repository.** This file is a thin Gemini-specific addendum, not a replacement. If anything here contradicts `AGENTS.md`, **`AGENTS.md` wins**.

## What to know on top of AGENTS.md

- **Shell is PowerShell on Windows.** The dev sandbox runs `pwsh`, not bash. Translate `&&`, `head`, `tail`, `grep` to PowerShell equivalents (`;` / `if ($?)`, `Select-Object -First/-Last`, `Select-String`) before executing.
- **God-components are intentional here.** `src/components/VideoPreview.jsx` (44K) and `python/processor.py` (2649 lines) are large by design. Don't preemptively split them — wait for an explicit user request.
- **One source of truth for project rules.** All workflow / commit / identity rules live in `AGENTS.md`. Don't fork them into a Gemini-specific file.

For the full workflow (PRs to `main`, throwaway branches, identity lock, Conventional Commits), see `AGENTS.md` § "Git Workflow & Push Policy".
