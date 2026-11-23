# 10 — Live view reads its playtest commands and Game View probe from contributions

Status: not started
Type: Task
Rung: hard · it replaces a hand-tuned shell-command parser's runner rules with data, and must keep every command form the user runs today
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/plugins/live-view/manifest.ts` (the comment and `dependsOn`)
- modify `wigley-ai-gui/src/plugins/live-view/playtest-command.ts`
- modify `wigley-ai-gui/src/plugins/live-view/main/playtest-watch.ts`
- modify `wigley-ai-gui/src/plugins/live-view/main/game-view-probe.ts`
- modify `wigley-ai-gui/src/plugins/live-view/main/start.ts`
- modify `wigley-ai-gui/src/plugins/live-view/main/live-tools.ts` (the two tool descriptions at lines 22 and 42, measured at plan time, re-verify)
- modify `wigley-ai-gui/src/plugins/live-view/window-pick.ts` (the error text at line 118, measured at plan time, re-verify)
- create `wigley-ai-gui/src/plugins/live-view/main/live-view-reader.ts`
- test `wigley-ai-gui/src/plugins/live-view/main/live-view-reader.test.ts` (create)
- test `wigley-ai-gui/src/plugins/live-view/playtest-command.test.ts`
- test `wigley-ai-gui/src/plugins/live-view/main/game-view-probe.test.ts`
- test `wigley-ai-gui/src/plugins/live-view/main/start.test.ts`
- test `wigley-ai-gui/src/plugins/live-view/window-pick.test.ts` (its row at line 220 asserts the line-118 text, measured at plan time, re-verify)

Consumes:
- `LiveViewContribution`, `CommandPattern` from `wigley-ai-gui/src/contracts/contributions.ts` ← 03
- `contributionsMainKey`, `ContributionsMainExports.registerFeature`, `.strategies`, `.onChanged`, `.ready`, `FeatureReader`, `Strategy`, `ContributionSource` from `wigley-ai-gui/src/plugins/contributions/contract.ts` ← 03
- the `auri:live-view` skill (`wigley-ai-gui/agent-plugin/skills/live-view/SKILL.md`), which documents the probe protocol below for plugin authors ← drafter B5's task

Produces:
- `export const liveViewReader: FeatureReader<LiveViewContribution>` in `wigley-ai-gui/src/plugins/live-view/main/live-view-reader.ts`
- `export interface PlaytestPatterns { open: readonly CommandPattern[]; close: readonly CommandPattern[] }` in `playtest-command.ts`
- `export function parsePlaytestCommand(command: string, patterns: PlaytestPatterns): PlaytestSignal | null` in `playtest-command.ts` (a new second parameter)
- `export interface ProbeScript { file: string; entry: string; pluginName: string }` in `game-view-probe.ts`
- `GameViewProbeDeps.locateScript(): Promise<ProbeScript | null>`, in place of `Promise<string | null>`

The names in Produces are live-view's own: no other task reads them.

## Why

Live view knows two programs by name: `unity command …` and `python3 …/capture.py` (`playtest-command.ts:218-249`, `:345-360`). It finds its Game View probe in the wigley plugin's install (`start.ts:71`, through `locateWigleyFile`), as `skills/unity-playtest/unity/WigleyCapture.cs` with entry `Wigley.WigleyCapture.Run` (`game-view-probe.ts:9-12`). After this task the commands that open and close the view, and the probe, come from every installed `liveView` strategy. With none, Live view still answers `show_live_view` and `hide_live_view`, but no Bash call opens it and the view streams the whole editor.

## Decisions

### The reader

`liveViewReader.label` is `'Live view'`. It refuses, with each reason:
- not a JSON object: `"liveView" is not an object`
- `open` or `close` not an array of one or more patterns: `<open|close>: not a list of command patterns`
- a pattern's `program` not a non-empty string with no `/`: `<open|close>[<i>].program: not a program name`
- a pattern's `words` not an array of one or more non-empty strings: `<open|close>[<i>].words: not a list of words`
- `valueFlags` present and not an array of strings that each start with `-`: `<open|close>[<i>].valueFlags: not a list of flags`
- `projectPathFlag` present and not a string that starts with `-`: `<open|close>[<i>].projectPathFlag: not a flag`
- `projectPathVariable` present and not a shell variable name (`[A-Za-z_][A-Za-z0-9_]*`): `<open|close>[<i>].projectPathVariable: not a variable name`
- `probe` present and not `{ file, entry, runner: 'unityScript' }`, with `file` a relative path that has no `..` part and `entry` a non-empty string: `probe: not { file, entry, runner: "unityScript" }`

Its value fills `valueFlags` with `[]`. The reader reads no file.

### Merging strategies

Live view is a merged feature, not a picked one: it shows no strategy control.
- `PlaytestPatterns` is the concatenation of every strategy's `open` and `close`, in source order.
- The probe is the first strategy in source order that has a `probe`. Its file is `paths.join(source.root, probe.file)`. `ProbeScript.pluginName` is the strategy's `source.pluginName`, for the error text.
- `start.ts` registers the reader under `'liveView'`. It computes the patterns and the probe after `contributions.ready` and on each `contributions.onChanged('liveView', …)`. Until `ready` settles, the patterns are empty. `dependsOn.main` adds `'contributions'`.

### Matching a segment

`parsePlaytestCommand(command, patterns)` keeps today's segment split, heredoc skip, quote handling, `$NAME` expansion and `cd` tracking. Today's `Runner`, `runnerOf`, `kindOf`, `UNITY_VALUE_FLAGS`, `CAPTURE_VALUE_FLAGS`, `UNITY_PROJECT_PATH_VARIABLE` and `CAPTURE_SCRIPT` go. A segment matches a pattern when every rule holds:

1. **Program.** Skip the leading `NAME=value` words. If `pattern.program` ends in `.py`, the next word expands to a Python program (`PYTHON_PROGRAM`, kept). The first word after Python's own `-` flags expands to a path whose base name is `program`. Otherwise the next word's base name equals `program` (today: `unity` or a path ending `/unity`).
2. **Words.** `readArgs` reads the words after the program word, or after the script word, with `pattern.valueFlags` as the value flags and `pattern.projectPathFlag` as the path flag. Today's flag is the constant `--project-path`. The pattern matches when the positionals start with `pattern.words`, word for word.
3. **Kind.** A match in `open` gives `start`, a match in `close` gives `stop`. The first match wins, `open` before `close`, each in order. The last segment that signals still wins.
4. **Project path.** When `projectPathFlag` is set and its value is on the segment, the path is that value expanded. Otherwise, when `projectPathVariable` is set, the variable from an assignment before the program or earlier on the line, then the folder the line `cd`s into. Otherwise null. Today's code applies this fallback to `unity` only. The PWD fallback is tied to `projectPathVariable` because a CLI that reads a project variable is the kind that also reads its working folder (see § Open questions).

Rule 2 widens one case. Today `unity` must be followed directly by `command`. With `words: ['command', …]` a flag before `command` (`unity --timeout 5 command editor_play`) now matches too. That is the CLI's own reading.

### The patterns that keep today's behaviour

Task 13 copies these into the wigley plugin's `auri.json`. `<unity flags>` is `["--timeout", "--port", "--pid", "--instance", "--runtime", "--runtime-path", "--detail", "--query", "--tag"]`.

| List | program | words | valueFlags | projectPathFlag | projectPathVariable |
|---|---|---|---|---|---|
| open | `unity` | `["command", "editor.playmode", "start"]` | `<unity flags>` | `--project-path` | `UNITY_PROJECT_PATH` |
| open | `unity` | `["command", "editor_play"]` | `<unity flags>` | `--project-path` | `UNITY_PROJECT_PATH` |
| open | `capture.py` | `["start"]` | `["--fps", "--backend"]` | `--project-path` | — |
| close | `unity` | `["command", "editor.playmode", "stop"]` | `<unity flags>` | `--project-path` | `UNITY_PROJECT_PATH` |
| close | `unity` | `["command", "editor_stop"]` | `<unity flags>` | `--project-path` | `UNITY_PROJECT_PATH` |

The probe: `{ "file": "skills/unity-playtest/unity/WigleyCapture.cs", "entry": "Wigley.WigleyCapture.Run", "runner": "unityScript" }`. design.md's `liveView` example differs from this table. It writes the unity patterns without `command` (`"words": ["editor_play"]`), and its close patterns lack the value flags and the variable (see § Open questions). Today's `capture.py stop` signals nothing (`kindOf` gives `capture` only `start`), so the table has no close row for it.

### The probe

- `runner: 'unityScript'` is the only runner. It is today's call: `unity command script run --file <file> --entry <entry> --args [<{"action":"probe"}>] --timeout 8 --json --project-path <folder>`, or `run_script` below com.unity.pipeline 0.9 (`probeCall`, unchanged). `ENTRY` gives way to `ProbeScript.entry`. `PROBE_ARGS`, the reply shape (`{ ok, playing, window: [x, y, w, h] | null }`, under `result` up to `MAX_REPLY_DEPTH` levels), `PROBE_ATTEMPTS` and the retry stay as they are. The `auri:live-view` skill documents this protocol (drafter B5).
- `locateScript` returns null when no strategy has a probe. It also returns null when the probe's file is not a file (`files.realPath` fails). In that case it logs once per strategy change: `live view: <pluginName>'s probe file <path> is missing`.
- The null error text becomes `no installed plugin gives a Game View probe`. The view then streams the whole editor, as it does today with no wigley install.
- `CAPTURE_SCRIPT_IN_INSTALL` goes, and `start.ts` no longer imports `wigley-install.ts`. Task 09 removes that file's other caller. See 09 § Open questions for who deletes the file.

### Wording

These texts name no boundary name after this task:
- **manifest comment:** Live view opens a session's view when a Bash call matches an installed plugin's open pattern, cropped to the Game View that plugin's probe reports, and closes it on a close pattern.
- **`start.ts` comment above the part:** the same.
- **`game-view-probe.ts` comments:** each "as capture.py …" comment says what the value is, with no reference to capture.py. For example, `LEGACY_CLI_SLACK_S` reads "the CLI's timeout this far past the script's, on an old pin". The comment at line 8 says the probe script comes from the strategy.
- **`playtest-command.ts:400-408`:** the doc comment describes pattern matching and names no program.
- **`live-tools.ts:22`:** `show_live_view`'s description: `Call it after each playtest capture starts, --append included. … gameRect is the Game View's render area in global screen points, top-left origin, [x, y, width, height], as the capture tool reports it.` The rest stays.
- **`live-tools.ts:42`:** `hide_live_view`: `Call it after the playtest's last capture stops.`
- **`window-pick.ts:118`:** `… Call show_live_view again with the Game View rect of a fresh capture, or with no gameRect to stream the whole editor.`

Task 11 owns the tool-description wording elsewhere. It does not edit these two files.

## Behaviour

- GIVEN the wigley strategy's patterns WHEN a session runs `unity command editor.playmode start --project-path /p` and it succeeds THEN the view opens on `/p`'s editor, cropped to the probe's Game View (today's behaviour).
- GIVEN the same patterns WHEN a session runs `UNITY_PROJECT_PATH=/p unity command editor_play` THEN the signal is `start` on `/p`.
- GIVEN no installed liveView strategy WHEN a session runs `unity command editor.playmode start` THEN no view opens, and `show_live_view` still streams.
- GIVEN a strategy `{ open: [{ program: 'godot-play', words: ['run'] }], close: [{ program: 'godot-play', words: ['quit'] }] }` WHEN a session runs `cd /g && godot-play run` THEN the signal is `start` with project path null, since the pattern names no variable.
- GIVEN a strategy whose probe file is missing WHEN a playtest opens the view THEN the whole editor streams and the log holds one missing-file line.

## Tests

- `live-view-reader.test.ts` (new) — one table over `liveViewReader.read`: the table's patterns plus the probe read ok. Then one row per reason above, each asserting the exact text, and a probe `file` with `..` refused.
- `playtest-command.test.ts` — today's `describe('parsePlaytestCommand')` table runs with a `WIGLEY_PATTERNS` constant equal to § The patterns table. Every row's expected signal stays, which proves the table keeps behaviour. Add rows:
  - `NoPatterns_UnityStart_NoSignal` — catches a leftover built-in runner.
  - `CustomProgram_Words_Start` — the godot row above.
  - `CustomProgram_NoVariable_CdIgnored` — catches a PWD fallback applied to every pattern.
  - `ScriptPattern_PythonFlagsBeforeScript_Start` — `python3 -u /x/capture.py start` with the capture row.
  - `UnityFlagBeforeCommand_Start` — `unity --timeout 5 command editor_play`, the widened case.
  - `OpenBeforeClose_SameWords_Start` — a strategy that lists one pattern in both lists signals `start`.
- `game-view-probe.test.ts` — `SCRIPT` and the entry come from a `ProbeScript` fixture. The "no wigley install" row becomes `no installed plugin gives a Game View probe`. Add `probe_StrategyEntry_PassedToTheCli`: entry `Acme.Probe.Run` appears after `--entry`.
- `start.test.ts` — drop the `WIGLEY_PLUGIN_KEY` import and the plugin-cache install fixture. The harness gets a contributions fake holding the wigley strategy, with `source.root` at a temp plugin folder that holds the probe file. Today's playtest rows keep their expected picks. Add:
  - `playtest_NoStrategy_NoAutoOpen`.
  - `playtest_ProbeFileMissing_WholeEditorAndOneLogLine`.
  - `strategyChanged_NewPatternsApply` — fire `onChanged('liveView')` with a godot strategy, then a godot run opens the view.

## Verification

```
cd /Users/jonathonwigley/Documents/ai/wigley-ai-gui
npm test -- src/plugins/live-view
npm run typecheck
npm run lint
grep -rn "wigley\|WigleyCapture\|capture\.py\|locateWigleyFile\|UNITY_PROJECT_PATH" src/plugins/live-view --include='*.ts' | grep -v '\.test\.ts'
```

The grep prints nothing.

## Done when

- The checks above pass, and the grep prints nothing.
- Runtime check: deferred to the final verification task (a Unity playtest in a session opens the cropped Live view once task 13's `auri.json` is installed).

Commit: one commit for the group.

## Open questions

- **design.md's liveView example.** It gives the unity patterns as `"words": ["editor_play"]`, without `command`, and close patterns without `valueFlags` or `projectPathVariable`. Copied as written, those patterns would match no command the user runs. This task's table is the one task 13 copies. The lead may want design.md's example brought in line.
- **The PWD fallback.** `CommandPattern` has no field for "the CLI reads its working folder". This task ties the fallback to `projectPathVariable`. A separate `projectPathFromCwd: boolean` would say it outright: that is a contract change for the lead.
- **`capture.py stop`.** Today it does not close the view, and this task keeps that. Adding a close row for it is the user's call.

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
