# 05 — Doc re-read

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02, 03, 04
Plan: [plan.md](plan.md)

Files:     modify `docs/features/usage/design.md` (only where stale)
Decisions: check every line of the § Contracts block, § The usage plugin and the "Every chat shows its line" decision
           against the landed code (`lastUsage` doc comment, the `0k` text, the store's `at` rule, chat's restore read,
           the adapter's first-emit rule); fix each stale line
Done when: every line matches the code; fixes committed, or "no changes" recorded in Proof
Commit:    one commit, when there are fixes

## Proof

