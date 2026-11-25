# 06 — Doc re-read

Status: done
Type: Task
Rung: standard · doc-only: prose checked against settled, landed code
Wave: 4 · Depends on: 01 (reads the landed code), 02 (reads the landed code), 03 (reads the landed code), 04 (reads the landed code), 05 (reads the landed code)
Plan: [plan.md](plan.md)

Files:
- modify `docs/features/permission-review/design.md`
- modify `docs/features/agent-harnesses/design.md`
- modify `docs/features/agent-chat/design.md`
- modify `docs/features/agent-commands/design.md`
- modify `docs/features/layouts/design.md`
- modify `docs/features/agent-chat/claude-stream.md`
- modify `README.md`
- modify `CHANGELOG.md`
- modify `AGENTS.md`
- modify `DESIGN.md`

Consumes: the landed code of 01–05, read at the run's tip.

Produces: the docs above, true to the landed code.

Decisions:
- Each doc was written ahead in commit `f521d579`. Read its part of that commit with `git show f521d579 -- <path>`, then check every line it added or changed against the landed code, line by line: every name, signature, slot id, setting key, CLI flag, log line, copy string, file path and behaviour it states. A doc line that disagrees with the code is fixed to the code. When the code is the one that looks wrong, the line is left and the mismatch goes in the report for the lead.
- Lines to check by name, each against the file that owns it:
  - `AgentAsk`, `AgentHarness.ask` and the permission entry's `summary` (`src/contracts/agent.ts`), the `claude -p` flags, the `claude-code-ask` temp folder and the `claude-code.askModel` setting with default `sonnet` (`src/plugins/claude-code/`), `setAskReply`, `failNextAsk` and `FAKE_ASK_REPLY` (`src/shared/fake-agent-harness.ts`).
  - `addEntryPart`, `kit.entryParts`, `PermissionInput.summary` and the default permission card's order and Full call expander (`src/plugins/chat/`).
  - `ConfirmSubject`, `ConfirmRequest.subject`, `forms.confirms` and its `OpenConfirm` value (`src/plugins/forms/contract.ts`), and the `toolName` agent-commands fills (`src/plugins/agent-commands/`).
  - `permission-review.reviews`, its keys `<sessionId>/<entryId>` and `confirm/<roundId>`, the 60 s limit and its reason text, the reply parser's failure text, the two outcome log lines, the `permission-review.layout` setting, the verdict copy `Reviewing…`, `Approve · low risk`, `Review unavailable`, the page log line `verdict <key>: <heading>`, the demo step's section and order (`sessions`, 75), and the page's `dependsOn` holding `sessions` (`src/plugins/permission-review/`).
  - The plugin tree row, the `addEntryPart` line in chat's entry and the self-test script list in `AGENTS.md`, the README's plugin, setting and slot lines, the layouts design's Adopters row, and DESIGN.md's permission card paragraph.
- A doc line from the plan that the code changed during the run (a Contract change or Ruling in plan.md's Run log) follows the code.
- No doc marks anything planned: `f521d579` added no "planned in" mark (`git grep -n "planned in" f521d579 -- AGENTS.md README.md CHANGELOG.md DESIGN.md docs/features/permission-review docs/features/agent-chat docs/features/agent-harnesses docs/features/agent-commands docs/features/layouts` finds none in these docs). If the run added one, drop it once its code has landed.
- `CHANGELOG.md` keeps its entries under `## Unreleased`, one line per user-visible change, under `### Added`, `### Changed`, `### Fixed` or `### Removed`. Each entry still matches what landed.
- Prose follows `wigley:writing-for-agents` for `AGENTS.md` (read `/Users/jonathonwigley/Documents/ai/wigley-ai-marketplace/plugins/wigley/skills/writing-for-agents/SKILL.md`), and the user's style everywhere: "the agent" and "the user", plain words.

GIVEN each doc line written ahead WHEN it is read against the landed code THEN it states what the code does, or it is fixed
GIVEN the fixed docs WHEN `npm run lint` and the README coverage test run THEN both pass

Tests: none added. The README coverage test `scripts/readme-coverage.test.mts` runs as it stands.

Done when: every listed doc is checked line by line and each stale line fixed; `npm run lint` passes (layers, styles, changelog, boundary, oxlint, oxfmt); `npm test -- scripts/readme-coverage.test.mts` passes. A doc fix changes no code, so no other test runs.

Commit: one commit for the fixes, by pathspec, only when a fix was made: `git commit -m "Docs: permission review docs re-read against the landed code" -- docs/features/permission-review/design.md docs/features/agent-harnesses/design.md docs/features/agent-chat/design.md docs/features/agent-commands/design.md docs/features/layouts/design.md docs/features/agent-chat/claude-stream.md README.md CHANGELOG.md AGENTS.md DESIGN.md`

## Proof

Commit 18551103 · proof: diff read: design.md and AGENTS.md fixed to the landed code; layouts design already lists permission-review; lint and readme-coverage pass · concerns: kit.entryParts returns void though the ChatKit header says every part returns what it appended; edited design.md lines run past the file's wrap width
