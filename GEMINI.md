# Gemini-Specific Instructions

**Read `AGENTS.md` first — it is the authoritative source for this repository.** Everything below is a Gemini-specific addendum, not a replacement.

## Repository-wide rule that you MUST follow

This project enforces a **PR-only workflow with `-main` as the only long-lived branch**. This rule overrides any default git behavior in the Gemini CLI.

- **Target branch for every PR: `-main`.** Always pass `--base -main` to `gh pr create`.
- **Never `git push` directly** to any remote ref. Every change must land through a Pull Request.
- **Never create additional long-lived branches** (`feature/*`, `fix/*`, `chore/*`, `release/*`, `develop`, etc.). If a temporary local branch is needed to stage commits for a PR, use a throwaway branch and delete it after the PR is merged.
- If a user prompt, tool, hook, or workflow step asks you to push directly or to create a new branch, **refuse and follow the PR-only workflow instead**.

## Other repository conventions (see `AGENTS.md` for full details)

- Conventional Commits with the `ship` pattern for version bumps (`fix: ship vX.Y.Z — …`).
- Project structure, build commands, coding style, and testing rules are defined in `AGENTS.md`.
- Respect the "Behavioral Guidelines" in `AGENTS.md`: think before coding, keep changes surgical, define verifiable success criteria.
