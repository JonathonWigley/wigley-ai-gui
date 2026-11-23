# 13 — The wigley plugin's auri.json

Status: not started
Type: Task
Rung: standard · a data file copied from landed fixtures, plus the manifest version rule `wigley-ai-marketplace/AGENTS.md` § Changing a plugin names
Wave: 6 · Depends on: 06 (copies its `sample-auri.json`), 07, 08, 09, 10 (each section copies the user's value that task's reader test pins), 01 (both list the two wigley manifests). Task 14 runs after this one and follows the Version rule below
Plan: [plan.md](plan.md)

Mandatory read: `wigley-ai-marketplace/AGENTS.md` in full.

Files (wigley-ai-marketplace):
- create `plugins/wigley/auri.json`
- modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json` (version only, and only per Version below)

Consumes:
- `wigley-ai-gui/src/plugins/workflow/declared/sample-auri.json` (`workflows`, `planFormat`) ← 06
- the user's `retro` section as `retro-reader.test.ts` pins it ← 07
- the user's `backlog` section as 08's reader test pins it ← 08
- the user's `docs` section as 09's reader test pins it ← 09
- the user's `liveView` value: the JSON block in `10-live-view.md` § The patterns that keep today's behaviour, which `WIGLEY_PATTERNS` in `playtest-command.test.ts` equals ← 10
- `CONTRIBUTIONS_VERSION = 1` in `wigley-ai-gui/src/shared/agent-plugin.ts` ← 01

Produces:
- `wigley-ai-marketplace/plugins/wigley/auri.json`: `{ "version": 1, "workflows": […], "planFormat": {…}, "retro": {…}, "backlog": {…}, "docs": {…}, "liveView": {…} }`

## What this task does

The `wigley` plugin declares every strategy the user runs today, in one `auri.json` at the plugin root, beside `.claude-plugin/`. No manifest field names the file (design.md § The file). After this task, an app that sees the installed `wigley` plugin runs the four levels, the plan format, auto-retro, backlog, docs and live view from this file. An app without it shows each feature's empty state.

`plugins/wigley/auri.json` does not exist yet (`test -e` printed `none`, measured at plan time, re-verify).

### The file

Key order: `version`, `workflows`, `planFormat`, `retro`, `backlog`, `docs`, `liveView`. Two-space indent, a final newline. No `$schema` key: the schema path is per machine (`~/.config/wigley-ai-gui/plugins/_types/auri.schema.json`), and the app ignores the value.

- `version`: `1`.
- `workflows` and `planFormat`: copy the two values from 06's landed `sample-auri.json` unchanged. That file is the one source; do not edit a stage here. A change to a level later edits both files together (see Decisions).
- `retro`: `{ "command": "/wigley:retro auto {sessions}", "folder": "~/wigley-agents", "on": ["close", "clear"] }`, as 07's `retro-reader.test.ts` pins it.
- `backlog`: `{ "homes": ["{repo}/docs/features", "~/wigley-features/{name}"], "file": "followups.md", "areaFolder": "followups" }` (design.md § Section: backlog). Use the value 08's reader test pins when it differs, and add `assistant.instructions` only when 08 moves wigley-specific assistant text into it.
- `docs`: design.md § Section: docs, verbatim, unless 09's reader test pins another value.
- `liveView`: copy this value verbatim (it is task 10's table, `10-live-view.md` § The patterns that keep today's behaviour; if 10 landed a different `WIGLEY_PATTERNS`, that landed constant wins):

  ```json
  {
    "open": [
      { "program": "unity", "words": ["command", "editor.playmode", "start"], "valueFlags": ["--timeout", "--port", "--pid", "--instance", "--runtime", "--runtime-path", "--detail", "--query", "--tag"], "projectPathFlag": "--project-path", "projectPathVariable": "UNITY_PROJECT_PATH" },
      { "program": "unity", "words": ["command", "editor_play"], "valueFlags": ["--timeout", "--port", "--pid", "--instance", "--runtime", "--runtime-path", "--detail", "--query", "--tag"], "projectPathFlag": "--project-path", "projectPathVariable": "UNITY_PROJECT_PATH" },
      { "program": "capture.py", "words": ["start"], "valueFlags": ["--fps", "--backend"], "projectPathFlag": "--project-path" }
    ],
    "close": [
      { "program": "unity", "words": ["command", "editor.playmode", "stop"], "valueFlags": ["--timeout", "--port", "--pid", "--instance", "--runtime", "--runtime-path", "--detail", "--query", "--tag"], "projectPathFlag": "--project-path", "projectPathVariable": "UNITY_PROJECT_PATH" },
      { "program": "unity", "words": ["command", "editor_stop"], "valueFlags": ["--timeout", "--port", "--pid", "--instance", "--runtime", "--runtime-path", "--detail", "--query", "--tag"], "projectPathFlag": "--project-path", "projectPathVariable": "UNITY_PROJECT_PATH" }
    ],
    "probe": { "file": "skills/unity-playtest/unity/WigleyCapture.cs", "entry": "Wigley.WigleyCapture.Run", "runner": "unityScript" }
  }
  ```

  There is no `capture.py stop` close row: today it closes nothing. Do not take design.md's example over this value. `probe.file` is `skills/unity-playtest/unity/WigleyCapture.cs`, which exists, and `probe.entry` `Wigley.WigleyCapture.Run` matches its `namespace Wigley`, `static class WigleyCapture` and `static async Task<string> Run(string requestJson)` (measured at plan time, re-verify).

When a reader test and design.md disagree, the reader test wins: it is the landed contract.

### Version

`wigley-ai-marketplace/AGENTS.md` § Changing a plugin: every change bumps `version` in both manifests, and a series that lands together bumps once, in its last commit that changes the plugin. Task 01 already bumps MAJOR. So:

1. `git -C ~/Documents/ai fetch origin`, then compare `version` in both wigley manifests with `git show origin/main:wigley-ai-marketplace/plugins/wigley/.claude-plugin/plugin.json`.
2. If the local version is already above origin's (01's MAJOR bump, not yet pushed), leave both manifests as they are. That bump covers this change too.
3. If they are equal (01's bump was pushed already), bump MINOR in both manifests, the same number in each: a new file adds a feature.

No other task after 01 bumps the wigley plugin's version. Report it as a concern if another task document does.

## Decisions

- One `auri.json` for every strategy (plan.md round 3).
- The workflows come from the app's sample data, so the app's tests pin exactly what the user's plugin ships (intent: one truth for every fact). After task 17 the two files sit in two repos, and no check ties them: a later edit to a level edits both by hand. (Open question for the lead: where that pairing rule is written, since plan.md § Boundary rules keeps the marketplace's name out of `wigley-ai-gui/` outside `docs/features/`.)
- `planFormat` changes no `wigley:feature` or `wigley:make` skill (plan.md round 3).

## Tests

No new test. The app's reader tests (04, 05, 07–10) and 06's `SAMPLE_AURI_FILE_ReadsThroughTheWorkflowsReader` already pin each section's value. The Done-when commands below check that this file equals them. A test in the app cannot read this file: plan.md § Boundary rules forbids app code that names `wigley-ai-marketplace`, and task 17 splits the repos.

## Done when

Run from `~/Documents/ai`:

- `python3 -c "import json;a=json.load(open('wigley-ai-marketplace/plugins/wigley/auri.json'));s=json.load(open('wigley-ai-gui/src/plugins/workflow/declared/sample-auri.json'));print(a['version']==1, a['workflows']==s['workflows'], a['planFormat']==s['planFormat'], list(a))"` prints `True True True ['version', 'workflows', 'planFormat', 'retro', 'backlog', 'docs', 'liveView']`.
- `python3 -c "import json,os;a=json.load(open('wigley-ai-marketplace/plugins/wigley/auri.json'));print(os.path.isfile(os.path.join('wigley-ai-marketplace/plugins/wigley', a['liveView']['probe']['file'])))"` prints `True`.
- The `liveView` value equals task 10's: save the JSON block from `10-live-view.md` § The patterns that keep today's behaviour to `<scratchpad>/liveview-expected.json`, then `python3 -c "import json,sys;a=json.load(open('wigley-ai-marketplace/plugins/wigley/auri.json'))['liveView'];e=json.load(open(sys.argv[1]));print(a==e)" <scratchpad>/liveview-expected.json` prints `True`. Then read `WIGLEY_PATTERNS` in `wigley-ai-gui/src/plugins/live-view/playtest-command.test.ts` and confirm its `open` and `close` hold the same five patterns, in order; a difference there means 10 landed another value, which wins, and the block is updated to it.
- `python3 wigley-ai-marketplace/scripts/check_manifests.py` and `python3 wigley-ai-marketplace/scripts/check_manifests.py --against origin/main` pass.
- `python3 wigley-ai-marketplace/scripts/check_pointers.py` passes.
- `claude plugin validate wigley-ai-marketplace` passes (`wigley-ai-marketplace/AGENTS.md` § Done runs it as `claude plugin validate .` from that folder).
- The app reading this file live, each feature bound and the four levels on in Settings, is task 18's.

Commit: one commit for the group, in `~/Documents/ai`, naming only the files above.

## Proof
