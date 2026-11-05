# 12 — Final verification and landing

Status: in progress
Type: Task
Wave: 10 · Depends on: 11
Plan: [plan.md](plan.md)

Two parts: the live checks on the `workflow-levels` branch, then the landing in its order. The mandatory rule must not go live before what backs it, so the landing order is fixed, and each step has its check. A step whose check fails stops the landing, and the report names the step. This is not a game: no UX flow route.

Shell: zsh on macOS. Start each `npm run` with `source ~/.nvm/nvm.sh && nvm use &&` from the wigley-ai-gui worktree root. A real Claude run spends tokens: the report names each one. Third-party code: nothing here installs any.

Files:     modify `plugins/wigley/.claude-plugin/plugin.json`, `plugins/wigley/.codex-plugin/plugin.json` in the marketplace worktree (the version) · changed by a command: `~/.claude/settings.json` and `~/.local/bin/workflow-gate` (step 4), `/Applications/wigley-ai-gui.app` (step 3, a per-run ask)

Consumes:  `workflow-light`, its self-test script, the drive actions `workflow.reportStep` and `workflow.reportChecklist`, the log lines `<name> level <badge>`, `<name> trail <labels>`, `<name> no workflow` ← 07 · `workflow-medium`, its self-test script ← 08 · `workflow-heavy`, its six self-test groups ← 05 · `.workflow-badge`, the `No workflow` tag ← 02 · `set_workflow_step`, `set_workflow_checklist`, the session note ← 03 · `runs.jsonl` ← 04 · `workflow-gate install`, `workflow-gate hook` ← 09 · the docs ← 10, 11 · tree members: `.workflow-step-label`, `.workflow-side-tasks`, `.ui-tag--error`, `npm run drive`, `npm run selftest`, `npm run install-app`, `scripts/check_manifests.py`

Produces:  no code name. Each check's result and each landing step's result in Proof.

## Live checks

Decisions: per `wigley:writing-tests` § What earns a live run instead, this list holds only what a passing test does not cover. A stage rule, a claim, a fold and a tool's validation are pinned in tasks 01 to 08 and earn no check here. Tasks 01 to 05 defer these checks to this task.

Run these before the landing, on the branch. Keep the screenshots under each run's folder, and read each one against `DESIGN.md`.

**Self-tests.** `npm run selftest -- --plugin workflow-heavy --plugin workflow-light --plugin workflow-medium`. Exit 0. This is a filtered run: no whole-suite run.

- **S1, expected.** All groups pass: Heavy's six, `feature to plan ready`, `clear and make`, `review`, `reported fix`, `close and dismiss`, `auto-start countdown`; Light's two; Medium's two.
- **S2, low-confidence: the moved Heavy layout.** Read `.selftest/screenshots/workflow-heavy-*.png` against `DESIGN.md`. The H badge is the one new thing (02). Task 05 moved the layout, so also check `git diff --stat -M <review base> -- src/plugins/workflow-heavy/layouts/default/layout.css`: it shows a move with no line changed.

**Fake-harness drive runs.** For each workflow: `npm run drive -- start --run levels-<level>`, pass `--run` on each later command, and open a session with `do chat.start '{}'`, keeping its `sessionId`. A `chat.start` composer opens in NORMAL mode: press `i`, then `type`, then `key Escape Enter`.

| Id | Tag and why | Steps | Pinned result |
|---|---|---|---|
| D1 | low-confidence: the tag is drawn with no layout, and no test sees its colour | Send `fake: tool`. | `query .ui-tag--error` text is `No workflow`; its computed `color` equals `query -- :root --wg-status-error`. Screenshot. |
| D2 | expected: the Light badge | In that session, send `/wigley:light`. | `query .workflow-badge` text `L`; tooltip `Light`; computed `color` equals `--wg-status-info`; no `.ui-tag--error`. The row reads the badge, then `Scope`. Screenshot. |
| D3 | expected: the Light trail and checklist | `do workflow.reportStep '{"sessionId":"<id>","step":"build"}'`. `do workflow.reportChecklist` with one done of three. Then `check`, `land`, `done`. | `query .workflow-step-label` texts are `Scope`, `Build 1/3`, `Check`, `Land` at Build. The side pane's section reads `Checklist` and lists three items, one done. At `done` the last step reads `Land`. Screenshot at Build and at done. |
| D4 | low-confidence: the run log, a real file from a real fold | After D3, `find .drive/levels-light/home -name runs.jsonl`. | One line with `"workflow":"workflow-light"`, `"movedUpFrom":null`, `"fixCycles":0`, and a whole-number `activeMs`. |
| D5 | expected: the Medium badge and trail | In a new run, send `/wigley:medium`. | `.workflow-badge` text `M`, tooltip `Medium`, `color` equals `--wg-accent`. Labels `Interview`, `Build`, `Review`, `Fix`, `Land`. Screenshot. |
| D6 | expected: steps move back, and the cycle count | Report `build`, `review`, `fix`, `review`, `fix`, `land`, `done`. | At the second `fix`, the label reads `Fix · cycle 2`. `runs.jsonl` has `"workflow":"workflow-medium"`, `"fixCycles":2`. |
| D7 | low-confidence: moving up, across two plugins' layouts | In a new session: send `/wigley:light`, send `/wigley:medium`, report `done`. | The badge goes from `L` to `M`, the trail swaps in one redraw, and the checklist is empty. `runs.jsonl` has `"movedUpFrom":"workflow-light"`. |
| D8 | expected: the Heavy badge, trail and pane after the move | In a new run, send `/wigley:feature fake: workflow feature`. Then `key Space w s` twice. | `.workflow-badge` text `H`, `color` equals `--wg-status-warning`; the chip and strip read as in the `feature to plan ready` self-test screenshot; the side pane's section reads `Plan` and shows the plan's waves; `Space w s` hides and shows the pane. Screenshot. |
| D9 | expected: the preview, deferred by 05 | `key Space z l w` thirteen times, then once more. | The log reads `workflow preview step <n> of 13` for each press, each sample draws Heavy's layout, and the last press closes it. Screenshot at step 8 (the countdown). |
| D10 | low-confidence: each plugin's layout folder loads alone, and only 02's test with a fake `show` covers it | In the Light run's `home/.config/wigley-ai-gui/layouts/workflow-light/test/`, write a `layout.js` whose `chip` draws a `div.levels-test`. `setting workflow-light.layout '"test"'`. | `query .levels-test` finds it on the Light row. Open a second session and send `/wigley:feature fake: workflow feature`: its row still draws `.workflow-chip`. |

`npm run drive -- quit --run <id>` after each run.

**Real Heavy flow.** `npm run drive -- start --run levels-real --harness claude`. This spends tokens. Wait with `wait-log`, which matches a whole log line with its source prefix: the lines below omit that prefix.

- **R1, low-confidence: Clear & make on a real flow, with real stream shapes and real step reports.** No test sees the real Claude CLI here.
  1. Under the run's home, `git init` a repo with `docs/features/x/plan-x/plan.md` holding a `# X — plan` title, a `## Goal` line, and `## Tasks` with `### Wave 1` and `- [ ] [One](01-one.md)`. Commit it. Open a session there with `do chat.start`, naming that folder and a logged-in profile.
  2. Send `/wigley:feature Ask nothing and write no code. Edit docs/features/x/plan-x/plan.md: end its Goal line with a full stop. Then end your turn.` When the agent opens a round anyway, answer it with keys in the form's card, taking each recommendation.
  3. Wait for `[workflow] <name> shows planReady`. On the way, the log must hold `level H`. A `shows explore`, `shows interview` or `shows plan` line is a real `set_workflow_step` call.
  4. `key Space w w`. Wait for `[workflow-heavy] ran clearAndMake in <name>` and `[workflow] <name> shows make`. The transcript holds `/wigley:make <home>/…/docs/features/x/plan-x`. Screenshot.
  5. Quit straight after step 4: the check needs nothing from the make run. `npm run drive -- quit --run levels-real`.

## Landing order

Worktrees: `~/Documents/ai-dev/.worktrees/{wigley-ai-gui,wigley-ai-marketplace,wigley-agents}-workflow-levels`. Clones: `~/Documents/ai-dev/{wigley-ai-gui,wigley-ai-marketplace,wigley-agents}`. The standing yes in `~/wigley-agents/WigleyRepos.md` § Landing covers each merge and push in steps 1 and 5. Steps 3 and 4 are not covered by it.

**Step 1 — wigley-ai-gui and wigley-ai-marketplace land, in § Landing's order.**

- Rebase each branch onto its `main`, and re-run plan.md's Precondition 1. Preconditions 2 to 4 describe the start of the run and no longer apply.
- **The version.** Re-read it at landing, because peers keep landing: `git -C ~/Documents/ai-dev/wigley-ai-marketplace show main:plugins/wigley/.claude-plugin/plugin.json`. It read 1.16.1 when this task was written. Two new skills are a minor bump, as 1.15.3 to 1.16.0 was: the next `x.(y+1).0`. Put the same value in both manifests, in one commit that says what the series adds.
- Run the marketplace's Done commands from its root (`wigley-ai-marketplace/AGENTS.md` § Done).
- Merge with `git -C <clone> merge --ff-only workflow-levels`, in each. While `main` is unavailable, poll and retry.
- Push `main` in all four repos per § Syncing. wigley-agents' `main` does not hold the rule yet, because its branch has not merged.
- Remove the marketplace worktree and branch. **Keep the wigley-ai-gui worktree and branch:** `wigley:make` ticks this task and runs Close from there, deletes the plan folder, and lands that one commit by the same steps, removing the worktree last.
- **Check:** for each repo, `git -C <clone> merge-base --is-ancestor workflow-levels origin/main` exits 0 (the marketplace's before its branch is deleted); `git -C ~/Documents/ai-dev/wigley-ai-marketplace show origin/main:plugins/wigley/skills/light/SKILL.md` prints the skill.

**Step 2 — plugin update,** per `~/wigley-agents/AgentsStandardMapping.md` § Plugins step 4.

- `claude plugin marketplace update wigley-ai-marketplace`, then `claude plugin update wigley@wigley-ai-marketplace`. `~/.claude-personal/plugins` is a symlink to `~/.claude/plugins`, so one update serves both profiles (`~/.agents/AGENTS.local.md`). Then `codex plugin marketplace upgrade wigley-ai-marketplace`.
- **Check:** `test -f ~/.claude/plugins/cache/wigley-ai-marketplace/wigley/<new version>/skills/light/SKILL.md`, and the same for `medium`.
- **L1, low-confidence: a real Light run through the installed skill.** This runs here, because the skill reaches a real session only after the update, and it still runs ahead of the rule. Build the app from the rebased branch: `npm run drive -- start --run levels-light-real --harness claude`, a real `git init` repo under its home, then send `/wigley:light Add the line "ok" to README.md and commit. This repo has no checks.` This spends tokens. **Pinned results:** the log holds `level L`, then `shows scope`, `shows build`, `shows check`, `shows land`, `shows done`; a `progress <n>/<m>` line proves a real `set_workflow_checklist` call; `runs.jsonl` holds one line with `"workflow":"workflow-light"` and a numeric `costUsd`. A failure here stops the landing before the rule goes live. Fix it, land the fix, and repeat this check.

**Step 3 — the stable app install: a per-run ask of the user.** It quits and relaunches the app the user may be working in. Ask in a `wigley-forms` round, and in a one-line chat message as well, since the auto-mode classifier reads only chat. Name the action: "Install wigley-ai-gui `main` as the stable app now? This quits and relaunches the running app; its sessions survive." Recommend yes.

- On yes: `.agents/skills/install/SKILL.md` § Steps, from the wigley-ai-gui clone: `source ~/.nvm/nvm.sh && nvm use && npm run install-app`.
- **Check:** exit 0 with `Installed main (<commit>)`, where `<commit>` is `git -C ~/Documents/ai-dev/wigley-ai-gui rev-parse --short main`; `codesign -d -r- /Applications/wigley-ai-gui.app` prints a `designated` line that names `certificate leaf`.
- On no, or no answer: stop here. Steps 4 and 5 wait, the box stays open, and the report says the rule and the gate are not live and why.

**Step 4 — `workflow-gate install`.** It changes the Claude Code settings: when the classifier stops it, ask for the yes in one line of chat, naming the hook.

- Run the tool from the wigley-agents worktree: `python3 ~/Documents/ai-dev/.worktrees/wigley-agents-workflow-levels/tools/workflow-gate/workflow-gate install`. Its link points at the fixed path `~/wigley-agents/tools/workflow-gate/workflow-gate`, which does not exist until step 5. Until then the hook cannot start, which the Claude Code hooks docs class as a non-blocking error: an edit goes ahead with a `hook error` notice, and nothing is denied. So the gate and the rule go live together, at the merge in step 5. Keep steps 4 and 5 close together.
- Run it a second time.
- **Check:** the first result's `settingsChanged` holds only the real path of `~/.claude/settings.json`, once, because `~/.claude-personal/settings.json` is a symlink to it. The second result's `settingsChanged` is `[]`. `readlink ~/.local/bin/workflow-gate` prints `<home>/wigley-agents/tools/workflow-gate/workflow-gate`. `test -L ~/.claude-personal/settings.json` passes. In `~/.claude/settings.json`, `hooks.PreToolUse` holds one group with matcher `Edit|Write|NotebookEdit` and command `<home>/.local/bin/workflow-gate hook`, and the four groups from before keep their order.

**Step 5 — wigley-agents lands last,** in § Landing's order. This is what makes the rule live: `workflows.md`, the Required reads row, and the gate's script.

- Rebase, re-run Precondition 1, `git -C ~/Documents/ai-dev/wigley-agents merge --ff-only workflow-levels`, remove the worktree, delete the branch, push `main` in all four repos.
- **Check:** `git -C ~/Documents/ai-dev/wigley-agents merge-base --is-ancestor main origin/main` exits 0. `test -x ~/wigley-agents/tools/workflow-gate/workflow-gate` and `test -f ~/wigley-agents/workflows.md` pass.
- **G1, low-confidence: the wired hook through its real link.** Write `{"type":"user","message":{"content":"hello"}}` to a file under `/tmp/claude-feature-tiers/`, then pipe `{"hook_event_name":"PreToolUse","tool_name":"Edit","transcript_path":"<that file>"}` into `~/.local/bin/workflow-gate hook`. It prints `permissionDecision` `deny`, and the reason names `~/wigley-agents/workflows.md`. The same event with `"agent_id":"a1"` prints nothing. Delete the file.
- **G2, expected: a real session.** This run holds `wigley:make`, so its next `Edit` passes with no denial and no `hook error` notice: the plan's own tick is that edit.

Pinned after the cold read.
- L1 uses `do chat.start` naming the repo folder and a logged-in profile, as R1 does.
- G1 also pipes a bad-path event through the link and reads the printed JSON: `additionalContext` present, no `permissionDecision`.
- G2 also checks that `~/.local/bin/workflow-gate` is the command in the wired group. G2 proves only that nothing is falsely denied; G1 proves the deny path.
- When step 5 stops midway, leave the hook wired, retry it, and name the window in the report, because edits still pass with a notice and removal needs a second settings edit.

GIVEN a self-test and drive pass on the branch WHEN landing starts THEN each step runs in the order 1, 2, 3, 4, 5, and each check passes before the next step
GIVEN the user declines the install WHEN step 3 reads the answer THEN steps 4 and 5 do not run, and `workflows.md` does not reach `main`
GIVEN steps 1 to 4 are done and step 5 is not WHEN a session edits a file THEN the edit goes ahead with a `hook error` notice
GIVEN step 5 is done WHEN a new session's main agent edits with no level skill THEN the edit is denied and the reason names `workflows.md`

Tests:     none new: every check above is a live run or a command with its pinned result.

Done when: every check has its result in Proof, tagged as above; the report holds the lines below.

## The report's lines for the user

- Each repo, and what happened to it: pushed, up to date, or blocked and why. Any branch protection bypassed. The new marketplace version.
- `/reload-plugins` in an open session, or a new session, picks up `wigley:light` and `wigley:medium`.
- An open session gets the gate from the settings watcher (Claude Code docs: direct edits to hooks are normally picked up automatically). Its next main-agent edit, with no level skill in its transcript, is denied until it loads one.
- **Not fixed, for the user's eye:** `wigley:feature` and `wigley:make` call `set_workflow_step` on any host that has the tool, since the workflow-trail work. From a terminal session, that call can start a closed app. Light and Medium do not do this: only a session the app started reports. Heavy's skills do not change in this plan, so this stays as it is.
- Which checks spent real tokens: R1 and L1.
- Limits of the gate: Claude Code only, main-agent edit tools only, not a shell edit and not Windows. `tools/workflow-gate/README.md` gives the removal.
- Checks only the user can make, with steps: open the stable app after the install, run `/wigley:light` in a new session, and look at the L badge's colour at a glance down the session list.

Commit:    one commit in wigley-ai-marketplace for the version, on `workflow-levels`, before step 1's merge. No other commit here unless a check's fix needs one; a fix commits with its own message on its repo's branch before that repo lands, or lands by § Landing afterwards.

## Proof

