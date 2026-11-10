# 13 — Harness-neutral UI copy

Status: not started
Type: Task
Wave: 10 · Depends on: 12
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/chat/layouts/default/layout.js` · test `src/plugins/chat/layouts/default/layout.test.ts`
- modify `src/plugins/chat/manifest.ts`
- modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts`
- modify `src/plugins/chat/page/chat-view.ts` (one comment)
- modify `src/plugins/chat/main/start.ts` (one comment) · modify `src/plugins/usage/manifest.ts` (one comment) ·
  modify `src/plugins/usage/main/start.ts` (one comment) · modify `src/plugins/docs/layouts/layout.d.ts` (one comment)
- modify `src/plugins/claude-code/main/claude-code-harness.ts` · test
  `src/plugins/claude-code/main/claude-code-harness.test.ts`
- modify `src/plugins/claude-code/main/session-fold.ts` · test `src/plugins/claude-code/main/session-fold.test.ts`
- modify `docs/features/agent-chat/design.md` (§ Flow, the interrupt grace bullet)
- modify `docs/features/followups.md` · modify `docs/features/intent-alignment/master-plan.md`

Consumes:
- `AgentHarness.info(): AgentHarnessInfo` with `label: string` in `src/contracts/agent.ts` ← 01
- `startProcess` and `attachProcess` in `src/plugins/chat/main/chat-sessions.ts` hold the session's
  `harness: AgentHarness` (tree today; task 10 picks which harness)
- The claude-code adapter's files in `src/plugins/claude-code/main/` ← 03

Produces:
- `function exitNoticeText(harnessLabel: string, code: number | null, error: string | null): string` in
  `src/plugins/chat/main/chat-sessions.ts`

Decisions:
- Fixed text says "the agent". Text built where the code holds a harness says that harness's label. The Claude
  adapter's own errors keep naming Claude. Source: plan.md Decisions ("Chat copy").
- The exit notice reads the label of the harness the process started or attached under: `harness.info().label`,
  read in `startProcess` and `attachProcess` and passed into `processEvents` as a new parameter
  `harnessLabel: string`. (drafter: the harness is in scope there, so no slot read is needed.)
- The adapter's turn-state refusals reword together: `setControl`'s refusal reaches the user as a toast
  (`chat-commands.ts`, `setControl failed`), and `compact`'s sits beside it. (drafter: one wording for one family.)
- The notice `This Claude Code version reports no message lifecycle; the working state follows turn results
  only.` (`session-fold.ts`, the init fallback) reaches chat as an info entry. It states a fact about the installed
  Claude Code CLI, so naming it tells the user what to update. It keeps its wording (lead).
- The new strings, verbatim:

  | Where | Today | After |
  |---|---|---|
  | `layout.js` `reasonBox` | `Optional: tell Claude why. It reads your reason.` | `Optional: tell the agent why. It reads your reason.` |
  | `layout.js` `closeConfirm` | `Claude is still working. Ending the session stops it.` | `The agent is still working. Ending the session stops it.` |
  | `manifest.ts` `settingInfo.keepIdleMinutes.description` | `How long a session whose turn has ended keeps its Claude process while the app is closed. …` | `How long a session whose turn has ended keeps its agent process while the app is closed. Past it the process ends, and the next message resumes the session. The default, 60, is the prompt cache's life.` |
  | `chat-sessions.ts` `exitNoticeText` | `` `Claude stopped (exit code ${exitCode})${reason}. Your next message resumes this session.` `` | `` `${harnessLabel} stopped (exit code ${exitCode})${reason}. Your next message resumes this session.` `` |
  | `claude-code-harness.ts` `interrupt` notice | `Interrupted again; ending the Claude process.` | `Interrupted again; ending the agent process.` |
  | `claude-code-harness.ts` `setControl` | `` `Claude is working; change ${control.label} when the turn ends` `` | `` `The agent is working; change ${control.label} when the turn ends` `` |
  | `claude-code-harness.ts` `compact` | `Claude is working; compact when the turn ends` | `The agent is working; compact when the turn ends` |
  | `session-fold.ts` interrupt grace notice | `` `Claude did not stop within ${grace}; showing the session idle.` `` | `` `The agent did not stop within ${grace}; showing the session idle.` `` |
  | `chat-view.ts` comment over the close rule | `A session closes at once unless Claude is still working on it` | `A session closes at once unless the agent is still working on it` |

- The adapter's internal errors keep naming Claude: `Claude Code process has detached`, `Claude Code process has
  ended`, `Claude Code has no control <id>`, `Claude Code control <id> has no choice <value>`, `claude exited with
  …`, `claude was not found at …`. Source: plan.md Decisions.
- The grep below covers `src/plugins/` outside `src/plugins/claude-code/` and `src/shared/`, as the tree stood at plan
  time (72 hit lines, measured at plan time, re-verify; line numbers drift with tasks 01–12, so a row names a file
  and its phrase). Each hit and its verdict. A comment that states Claude Code's own behaviour is kept; text a user
  reads follows the rule above; a file that tasks 01–12 remove or rewrite is "gone with task NN":

  | Hit | Verdict |
  |---|---|
  | `chat/layouts/default/layout.js` reason box and close confirm | reword (table above) |
  | `chat/manifest.ts` `keepIdleMinutes` description | reword (table above) |
  | `chat/manifest.ts` `profiles` description, `DEFAULT_PROFILES` and its comment | gone with task 05 (chat's `profiles` setting leaves chat) |
  | `chat/main/chat-sessions.ts` `exitNoticeText` | reword to the label (table above) |
  | `chat/main/start-session-tool.ts` "always runs on Claude" | reworded in task 10 |
  | `chat/main/permission-tool.ts` | gone with task 08 |
  | `chat/page/chat-view.ts` comment over the close rule | reword (table above) |
  | `chat/page/clear-commands.ts` comment | reworded by task 12 |
  | `sessions/page/tabs.ts` `harnessText` | gone with task 01 (`harnessLabel`) |
  | `notes/session-ref.ts` `HARNESS_LABELS` | gone with task 01 |
  | `notes/main/selftest-script.ts` `Source session: Claude Code …` | keep: the self-test's expected line follows the label notes reads, which tasks 01 and 10 own |
  | `docs/page/docs-state.ts` chip label `claude: 'Claude'` | gone with task 07 (chips from the slot) |
  | `docs/main/start.ts` drive action `seed` description, "Claude pending" chip | keep: a drive description an agent reads, not UI copy; task 16 re-reads it against the chips task 07 left |
  | `docs/main/doc-files.ts`, `docs/main/script-locator.ts` `readClaudeConfigDirs` | keep: an identifier for the docs index file's `claudeConfigDirs` list (design doc § Docs and a harness's folders) |
  | `docs/main/selftest-fixture.ts` reason `Claude Code file` | keep: fixture data in `docs_index.py`'s own words |
  | `system-stats/` `Claude Code` group, fixture and self-test lines | keep: the name of the Claude desktop app's processes in the system stats view, not a harness |
  | `system-stats/contract.ts` comment | keep: same |
  | `src/shared/fake-agent-harness.ts` comments | keep: comments on what the fake mirrors |
  | `src/shared/session-env.ts` comments (lines 1, 2 and 24 at plan time) | keep: comments naming the environment a Claude Code parent sets |
  | `forms/main/selftest-script.ts` comment (`a Claude and a Codex session in project`) | keep: the self-test's own description of the harness ids it connects |
  | `chat/contract.ts` comment (`a Claude command named plugin:name`) | keep: Claude Code's own command naming |
  | `chat/main/start.ts` comment (`Starts, resumes and runs the Claude Code sessions`) | reword: `Starts, resumes and runs the chat sessions the page asks for, …` (the rest of the comment unchanged) |
  | `chat/main/fixtures.ts` comment (`as Claude Code would for a tool call`) | keep: names Claude Code's own permission behaviour; task 08 may remove the function, then the hit is gone |
  | `chat/main/selftest-script.ts` comment (`as Claude Code would; allowed when`) | keep: names Claude Code's own permission behaviour |
  | `chat/main/worktree-name.ts` comment (`Claude Code's own .claude/worktrees/<name>/`) | keep: Claude Code's own folder |
  | `chat/main/permission-tool.ts`, every line (lines 14, 20, 42 and 69 at plan time) | gone with task 08 |
  | `chat/page/chat-view.ts` and `chat/page/clear-commands.ts` comments | the rows above |
  | `unity-pool/contract.ts` comment (`A session by its Claude Code session id`) | keep: the field holds the session id Claude Code reports today; the Codex plan owns any change |
  | `agent-skills/page/skill-list.ts` comment (`as Claude Code reports it`) | keep: Claude Code's own name form |
  | `workflow/contract.ts` comment (`the bare name Claude Code also accepts`) | keep: Claude Code's own skill-name behaviour |
  | `sessions/main/mcp/mcp-server.ts` comment (`The _meta key Claude Code sends`) | gone with task 06 (`TOOL_USE_ID_META_KEY` leaves the file) |
  | `usage/manifest.ts` and `usage/main/start.ts` comments (`through the Claude harness`) | reword to `through each registered harness`; task 05 makes usage poll every registered harness's profiles |
  | `docs/manifest.ts` comment (`each Claude config folder`) | keep: the docs index file's `claudeConfigDirs` folders, as the `script-locator.ts` row says |
  | `docs/main/index-sources.ts` comments (`A Claude session whose session run fails`, `Codex sets no Claude session id`) | keep: the index script's vocabulary (task 07 keeps `sessionRun`) |
  | `docs/page/docs-state.ts` comment (`other than its Claude copy's`) | keep: task 07 keeps `isSessionStale` |
  | `docs/layouts/layout.d.ts` comment (`Claude's chip, then Codex's`) | reword: `One chip per registered harness, in registration order; empty for a file no index entry names.` (task 07 changes the member's type, not this comment) |
  | `chat/manifest.ts` line 5 comment (`Each profile names a Claude config folder`) | gone with task 05 (the same `profiles` block) |
  | `system-stats/manifest.ts`, `layouts/layout.d.ts`, `main/grouping.ts`, `main/stats-fixture.ts`, `page/stats-view-model.ts` comments and `main/selftest-script.ts` lines | keep: the Claude group in the system stats view, as the `system-stats/` row says |

Mandatory: AGENTS.md § Intent, § An agent harness, § A chat layout; `DESIGN.md`; `docs/features/layouts/design.md`
§ Live defaults (an edit to the default `layout.js` reloads live).

GIVEN a process that ends with code 3 and error `boom` WHEN chat adds the exit notice THEN its text is
`<label> stopped (exit code 3): boom. Your next message resumes this session.`, `<label>` the harness's
`info().label`, tone `error`.
GIVEN a working session WHEN the user picks an effort THEN the toast reads
`The agent is working; change Effort when the turn ends`.
GIVEN a second Ctrl+C in the interrupt grace WHEN the adapter ends the process THEN the notice reads
`Interrupted again; ending the agent process.`
GIVEN an interrupt the process does not answer in 5 s WHEN the grace ends THEN the notice reads
`The agent did not stop within 5 s; showing the session idle.`
GIVEN the deny-reason box WHEN it shows THEN its text reads `Optional: tell the agent why. It reads your reason.`
GIVEN the end-session confirm WHEN it shows THEN its text reads
`The agent is still working. Ending the session stops it.`

Tests:
- `chat-sessions.test.ts` › `attach_LateResult_DetachesOrEnds`, row `the replay firing ended`: `resting` becomes
  `` `${test.harness.info().label} stopped (exit code 0). Your next message resumes this session.` `` (the row's
  string is built in the test body from the fake's label).
- `chat-sessions.test.ts` › add `ended_UncleanExit_NoticeNamesTheHarnessLabel`: a started session's process emits
  `ended({ code: 3, error: 'boom' })`; the last entry is a `notice` with text
  `` `${test.harness.info().label} stopped (exit code 3): boom. Your next message resumes this session.` `` and tone
  `error`.
- `claude-code-harness.test.ts` › `setControl_EffortWhileWorking_Throws`: expects
  `The agent is working; change Effort when the turn ends`.
- `claude-code-harness.test.ts`: the test near line 1960 (measured at plan time, re-verify) expects
  `The agent is working; compact when the turn ends`; the `killNotice` constant near line 1389 becomes
  `Interrupted again; ending the agent process.`; the grace notice constant near line 343 becomes
  `The agent did not stop within 5 s; showing the session idle.`
- `session-fold.test.ts`: the grace notice constant near line 30 becomes
  `The agent did not stop within 5 s; showing the session idle.`
- `layout.test.ts` › `default chat layout surfaces`: add one table test `dialogText_Default_NamesTheAgent` with rows
  `reasonBox` → `Optional: tell the agent why. It reads your reason.` and `closeConfirm` →
  `The agent is still working. Ending the session stops it.`. Each row draws the part with `drawSurface` and asserts
  the text of its `p.chat-dialog-text`. No test reads these strings today.
- Self-test: none. No self-test step reads these strings (`grep -rn 'stopped (exit code\|tell Claude\|still working'
  src/plugins/*/main/selftest-script.ts` prints nothing at plan time). The dialogs' look is a live check in task 17.

Docs:
- `docs/features/agent-chat/design.md` § Flow, the interrupt grace bullet (lines 139–141 at plan time). Two edits. The
  first sits on one line: `posts the notice `Claude did not stop within 5 s; showing the session idle.`` becomes
  `posts the notice `The agent did not stop within 5 s; showing the session idle.``. The second is wrapped across two
  lines, so the old string holds the line break and the two-space indent of the next line:
  ```
  posts `Interrupted again; ending the
    Claude process.` and ends the `claude` process
  ```
  becomes
  ```
  posts `Interrupted again; ending the
    agent process.` and ends the `claude` process
  ```
  (apply it as an exact two-line replace, or run `replace-exact` with the `\n  ` inside the old text).

Done when: `npm run lint` and `npm run typecheck` pass; this grep prints only lines that a "keep" row of the verdict
table names, and no line of a "reword" row or a "gone" row:
`grep -rn 'Claude' src/plugins src/shared --include='*.ts' --include='*.js' | grep -v '^src/plugins/claude-code/' | grep -v '\.test\.'`;
the test gate runs the test files above.

Commit: one commit. It removes the "Harness-neutral UI copy" item from `docs/features/followups.md` § Harness seams
and ticks `[ ] Harness-neutral UI copy` to `[x] Harness-neutral UI copy` in
`docs/features/intent-alignment/master-plan.md` (the chat-pass line, line 134 at plan time).

## Proof
