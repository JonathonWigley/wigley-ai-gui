# 18 — Final verification

Status: not started
Type: Task
Wave: 10 · Depends on: 16, 17 (it checks the moved repo, its installed app, and the docs 16 fixed)
Plan: [plan.md](plan.md)

`wigley:make` walks this task in its live session, after its test gate. It edits no file: a failure goes back to the
task that owns the code, and this task runs again from the failed check.

Every task defers its runtime and live checks here by name.

## Checks

### Static, in `~/Documents/wigley-ai-gui`

The app's `AGENTS.md` has no `## Done` section (measured at plan time: `grep -n '^## ' AGENTS.md` lists Intent,
Architecture, Review, README, changelog and boundary, Running and testing, Dev quirks). Its checks are the `package.json` scripts and § Running and
testing:

```
source ~/.nvm/nvm.sh && nvm use
npm run lint            # check-layers, check-styles, check-changelog, check-boundary, oxlint, oxfmt --check
npm run typecheck
npm test                # Vitest, the type tests, and task 15's README coverage test
```

Task 15's changelog lint and boundary lint, by the commands its task document names (`15-*.md`); both pass on the
final branch. The agent plugin's Python suites, one per folder task 01 moved or added:

```
(cd agent-plugin/scripts/relay && python3 -m unittest discover)
(cd agent-plugin/scripts/chatroom && python3 -m unittest discover)
(cd agent-plugin/scripts/docs-index && python3 -m unittest discover)
(cd agent-plugin/scripts/checklist && python3 -m unittest discover)
(cd agent-plugin/scripts/ask-user-question && python3 -m unittest discover)
claude plugin validate agent-plugin
claude plugin validate .
```

`npm run selftest`, filtered: `--plugin` for each plugin the plan touched — `contributions`, `workflow`, `forms`,
`primer`, `audio-picker`, `chat`, `chatroom`, `auto-retro`, `backlog`, `docs`, `live-view`, `unity-pool`, `demo`,
`settings` (each id re-verified against `src/plugins/manifests.ts`; a plugin with no script is skipped). A whole run
only on the user's ask in the current turn (app `AGENTS.md` § Running and testing).

### Static, in `~/Documents/ai/wigley-ai-marketplace`

Its `AGENTS.md` § Done, from the repo root, with the lines for folders task 01 moved out (`scripts/chatroom`,
`scripts/docs-index`, `scripts/forms`) dropped because the folders are gone:

```
python3 scripts/check_manifests.py
python3 scripts/check_manifests.py --against origin/main
python3 scripts/check_pointers.py
(cd scripts && python3 -m unittest discover -s tests)
claude plugin validate .
(cd plugins/wigley/scripts/plan && python3 -m unittest discover)
(cd plugins/wigley/scripts/retro && python3 -m unittest discover)
(cd plugins/wigley/skills/artifact-style && python3 -m unittest discover -s tests)
(cd plugins/wigley/skills/unity-playtest && python3 -m unittest discover -s tests)
(cd plugins/wigley/skills/unity-ux-flow && python3 -m unittest discover -s tests)
```

And the personal tools the plan changed:

```
(cd ~/wigley-agents/tools/wigley-land && python3 -m unittest discover -s tests)
(cd ~/wigley-agents/tools/wigley-repo-files && python3 -m unittest discover -s tests)
(cd ~/wigley-agents/tools/workflow-gate && python3 -m unittest discover -s tests)
```

### The move

- `git ls-remote git@github-personal:JonathonWigley/wigley-ai-gui.git` shows `main` equal to
  `git -C ~/Documents/wigley-ai-gui rev-parse origin/main`, and no `7a18ac69…`. Expected.
- `betterleaks git ~/Documents/wigley-ai-gui "--log-opts=--all --diff-merges=remerge" --redact --no-banner` exits 0
  with `no leaks found`, offline (no `--validation`; 1.10.1 has no `--include=merges`, and the remerge diff covers
  what merges changed). Expected.
- 17's stale-reference proof, run again: prints nothing. Expected.

### Live, through the installed app

Low-confidence where marked: these cross the app, Claude Code's plugin loading and the hooks, which no unit test joins.

1. **Fresh app session, auri tools.** Start a session in `~/Documents/wigley-ai-gui` through the installed app
   (`start_session`). In it, the agent calls `mcp__plugin_auri_auri__ask_round` with one notice; the round shows in
   the app and returns on submit. Its tool list holds no `mcp__plugin_wigley_wigley-forms__*`. Expected.
2. **Checklist gate.** In a fresh app session that has loaded no workflow skill, an Edit is denied with the auri
   gate's reason naming `set_workflow_checklist`; after one `set_workflow_checklist` call the same Edit goes through;
   with an item open, the turn's end shows the Stop reminder; the session's flow chip shows the Checklist flow.
   Low-confidence: the gate keys on `WIGLEY_SESSION_ROW`, set only for app-started sessions.
3. **Declared workflow.** In a fresh app session, loading `wigley:small` replaces the Checklist flow with the
   declared `wigley:small` workflow: the chip shows Small, `set_workflow_step` accepts its first step, and Settings'
   `strategy-list:workflows` control lists the four `wigley` workflows on. Turning `wigley:small` off in that list
   and starting another session leaves it on the Checklist flow. Expected.
4. **Permission prompt.** A tool call needing permission in an app session shows the app's permission popup, routed
   through `mcp__plugin_auri_auri__permission_prompt`. Expected.
5. **Update check.** Run it after the last landing of the run (16's landing in the new clone). First reinstall: the
   app's `install` skill from the new clone's final `main`, because 17 step 8 installed an earlier commit and 17 step
   11 and 16 landed after it. Then the installed app's update button reports no update (installed commit equals the
   new clone's `origin/main`), proving its baked clone dir and the fetch work. Expected.
6. **workflow-gate, live.** It reads the declared workflows after 17 landed the run and the `wigley` plugin update
   brought in its `auri.json`. In a fresh app session, an Edit before any level skill loads is denied with
   workflow-gate's `DENIAL`; after the agent loads `wigley:small` the same Edit passes workflow-gate (the auri
   checklist gate still needs its `set_workflow_checklist` call). After a compaction (`/compact`) the session shows
   the level skill's `## Reporting` reminder and no checklist lines from workflow-gate. `WIGLEY_SESSION_ROW` reaches the
   hook process: with it set (the app session) the compact reminder shows, and in a terminal `claude -p` session with
   it unset none shows, while the level gate still denies an Edit before a level skill there. Low-confidence: the
   gate reads the installed plugins list, which only the landed install holds.

### Terminal session with the marketplace-installed auri

7. With auri installed from the app repo's marketplace (`claude plugin list` shows `auri@auri`, in both profiles), run
   `claude -p` in `~/Documents/wigley-ai-gui` asking for the names of its tools that start with `mcp__plugin_auri_auri__`.
   It lists the app tools, and with the app running an `ask_round` call reaches it. The checklist gate does not deny
   its edits (no `WIGLEY_SESSION_ROW`). Low-confidence: a terminal session's relay finds the stable app's endpoint
   by default, which this check proves.

## Not checked by the agent

The wrap-up's `Not checked:` line carries only what needs the user's hands or eyes: the global summon shortcut and
any key behaviour a synthetic key cannot reach (app `AGENTS.md` § Running and testing). GitHub secret scanning and
push protection go in Still open, from 17.

## Done when

Every check above passed or went back to its owning task and passed on the re-run; the result of each is in the
Proof section.

## Proof

