# Claude-Specific Instructions

**Read `AGENTS.md` first — it is the authoritative source for this repository.** This file is a thin Claude-specific addendum, not a replacement. If anything here contradicts `AGENTS.md`, **`AGENTS.md` wins**.

## What to know on top of AGENTS.md

- **Shell is PowerShell on Windows.** This sandbox runs `pwsh`, not bash. `&&` doesn't chain — use `;` or `if ($?) { ... }`. Don't reach for `head`/`tail`/`grep` — use `Select-Object` / `Select-String`. Commands shown in `AGENTS.md` are POSIX-flavored for documentation; translate before executing.
- **Use sub-agents for multi-file investigation.** `explore` for code archaeology, `general` for multi-step work. Don't spin up a heavy agent for a single file read.
- **God-components are intentional here.** `src/components/VideoPreview.jsx` (44K) and `python/processor.py` (2649 lines) are large by design. Don't preemptively split them — wait for an explicit user request. AGENTS.md calls this out: _surgical changes only_.
- **One source of truth for project rules.** All workflow / commit / identity rules live in `AGENTS.md`. Don't fork them into a Claude-specific file.

For the full workflow (PRs to `main`, throwaway branches, identity lock, Conventional Commits), see `AGENTS.md` § "Git Workflow & Push Policy".
