# 01 — Playtest command parser

Status: not started
Type: Task
Rung: hard · adds the PlaytestSignal contract that 02 consumes
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `wigley-ai-gui/src/plugins/live-view/playtest-command.ts` · test `wigley-ai-gui/src/plugins/live-view/playtest-command.test.ts`
Consumes:  nothing
Produces:  `export type PlaytestSignal = { kind: 'start'; projectPath: string | null } | { kind: 'stop'; projectPath: string | null }` in `…/live-view/playtest-command.ts`
           `export function parsePlaytestCommand(command: string): PlaytestSignal | null` in `…/live-view/playtest-command.ts`
Decisions: plan decisions 2, 3, 5 and 9 · the parser rules (plan, Decided: "Parser") · `capture.py command -- editor_play` is no trigger

## What it does

`parsePlaytestCommand` reads the full text of a Bash call's `command` and says whether it starts a playtest, stops
one, or neither, with the `--project-path` the command names. It is pure: no imports from the plugin, the contracts
or Node. `stop` carries its `projectPath` because 02 closes an app-opened view only for the same project.

## Rules

1. **Segments.** Split the text into segments on `&&`, `||`, `;`, `|` and a newline, outside quotes. A backslash
   before a newline joins the two lines (line continuation). A lone `&` (background) is no separator: rule 4 drops it.
2. **Words.** Whitespace separates words outside quotes. Single quotes keep their text literally. Double quotes keep
   their text, and a backslash inside them escapes `"` and `\`. A backslash outside quotes escapes the next
   character. Quotes are removed from the word. An unclosed quote runs to the end of the text; the words still split
   as far as they can, and the parser never throws.
3. **Program word.** Skip leading assignments (a word matching `NAME=value`, `NAME` being letters, digits and `_`,
   not starting with a digit). The next word is the program word.
   - **unity:** the program word is `unity` or ends in `/unity`, and the word right after it is `command`.
   - **capture:** the program word is `python`, `python3` or `python3.<n>`, or a path ending in `/` and one of those.
     After it, words starting with `-` are dropped up to the first other word, the script word; the script word ends
     in `capture.py` (`capture.py` or `…/capture.py`).
   - Any other program word gives no signal for the segment: `echo`, `grep`, `env`, `timeout`, `nohup`, `bash -c '…'`,
     `sh -c`, `eval`, and a word that starts with `(` or `{` (a subshell or group). These forms are out of scope.
4. **Flags and redirections.** Read the words after `command` (unity) or after the script word (capture), left to
   right:
   - A redirection is dropped: a word matching `^[0-9]*(>>?|<)&?.+$` or `^&>>?.+$` (`2>&1`, `>f`, `>>f`,
     `2>/dev/null`, `&>f`) is dropped alone; a bare `>`, `>>`, `<`, `2>`, `2>>`, `&>` drops itself and the next word.
     A lone `&` is dropped.
   - `--project-path <value>` and `--project-path=<value>` set the project path. A missing value (the flag is the last
     word, or the next word starts with `-`) or an empty value sets no path, and the next word is not consumed. When
     the flag appears more than once, the last one wins.
   - A value-taking flag consumes the next word: for unity `--timeout`, `--port`, `--pid`, `--instance`,
     `--runtime`, `--runtime-path`, `--detail`, `--query`, `--tag`; for capture `--fps`, `--backend`. Its `--flag=value`
     form is one word.
   - Any other word starting with `-` is a boolean flag and is dropped.
   - The words left are the positionals, in order.
5. **The segment's signal.**
   - unity: the first positional `editor_play` → `{ kind: 'start' }`; `editor_stop` → `{ kind: 'stop' }`; any
     other, or none → no signal.
   - capture: the first positional `start` → `{ kind: 'start' }`; any other (`stop`, `mark`, `tap`, `command`) → no
     signal.
   - `projectPath` is the path from rule 4, or null.
6. **Several signals:** the last segment that gives a signal wins.
7. **No signal:** return null.

Command substitution (`$(…)`, backticks), heredocs and variables are not expanded: their text is read as words, as
written.

## GIVEN / WHEN / THEN

GIVEN a command text WHEN `parsePlaytestCommand` reads it THEN it returns the row's result. `P` is `/clones/b/Game`.
In the table, `\|` is the shell's `|`, escaped for the markdown table.

| given | Command | Result |
|---|---|---|
| play | `unity command editor_play --result-only --project-path /clones/b/Game` | start, P |
| stop | `unity command editor_stop --result-only --project-path /clones/b/Game` | stop, P |
| no path | `unity command editor_play --result-only` | start, null |
| path before the name | `unity command --project-path /clones/b/Game editor_play` | start, P |
| `=` form | `unity command editor_play --project-path=/clones/b/Game` | start, P |
| double-quoted path | `unity command editor_play --project-path "/Users/me/My Game"` | start, `/Users/me/My Game` |
| single-quoted path | `unity command editor_play --project-path '/Users/me/My Game'` | start, `/Users/me/My Game` |
| escaped space | `unity command editor_play --project-path /Users/me/My\ Game` | start, `/Users/me/My Game` |
| escape inside double quotes | `unity command editor_play --project-path "/x/a\"b"` | start, `/x/a"b` |
| repeated path | `unity command editor_play --project-path /a --project-path /clones/b/Game` | start, P |
| missing value | `unity command editor_play --project-path` | start, null |
| empty value | `unity command editor_play --project-path=` | start, null |
| flag after the path flag | `unity command editor_play --project-path --result-only` | start, null |
| unity by path | `/usr/local/bin/unity command editor_play --project-path /clones/b/Game` | start, P |
| assignment first | `UNITY_LOG=1 unity command editor_play --project-path /clones/b/Game` | start, P |
| flag between unity and command | `unity --project-path /clones/b/Game command editor_play` | null |
| redirect `2>&1` | `unity command editor_play --result-only --project-path /clones/b/Game 2>&1` | start, P |
| redirect to a file | `unity command editor_play --project-path /clones/b/Game > /tmp/o.txt` | start, P |
| redirect joined | `unity command editor_play --project-path /clones/b/Game 2>/dev/null` | start, P |
| value flag before the name | `unity command --timeout 30 editor_play --project-path /clones/b/Game` | start, P |
| background `&` | `unity command editor_play --project-path /clones/b/Game &` | start, P |
| chained after `cd` | `cd /clones/b && unity command editor_play --project-path /clones/b/Game` | start, P |
| `\|\|` | `unity command editor_play --project-path /clones/b/Game \|\| true` | start, P |
| pipe | `unity command editor_play --project-path /clones/b/Game \| tail -1` | start, P |
| `;` | `unity command editor_play --project-path /clones/b/Game; sleep 5` | start, P |
| newline | two lines: `cd /x`, then `unity command editor_stop --project-path /clones/b/Game` | stop, P |
| line continuation | `unity command \` newline `  editor_play --project-path /clones/b/Game` | start, P |
| stop then play | `unity command editor_stop && unity command editor_play` | start, null |
| play then stop | `unity command editor_play && unity command editor_stop` | stop, null |
| capture start | `python3 /skills/unity-playtest/capture.py start --project-path /clones/b/Game` | start, P |
| capture start appended | `python3 capture.py start --append --project-path /clones/b/Game` | start, P |
| capture with python flag | `python3 -u capture.py start --fps 30 --project-path /clones/b/Game` | start, P |
| capture by python path | `/opt/homebrew/bin/python3.12 capture.py start --project-path /clones/b/Game` | start, P |
| capture after `&&` | `cd /x && python3 capture.py start --project-path /clones/b/Game` | start, P |
| capture stop | `python3 capture.py stop --project-path /clones/b/Game` | null |
| capture command | `python3 capture.py command --project-path /clones/b/Game -- editor_play` | null |
| capture not run by python | `git add capture.py start` | null |
| other unity command | `unity command editor_status --project-path /clones/b/Game` | null |
| unity status | `unity status --json` | null |
| unity-pool | `unity-pool claim --branch main` | null |
| echo, unquoted | `echo unity command editor_play` | null |
| echo, quoted | `echo "unity command editor_play"` | null |
| commit message | `git commit -m 'unity command editor_play'` | null |
| subshell | `(unity command editor_play --project-path /clones/b/Game)` | null |
| bash -c | `bash -c 'unity command editor_play --project-path /clones/b/Game'` | null |
| timeout wrapper | `timeout 60 unity command editor_play --project-path /clones/b/Game` | null |
| unclosed quote with a signal | `unity command editor_play --project-path "/x y` | start, `/x y` |
| unclosed quote, no signal | `echo "unclosed` | null |
| empty text | (empty) | null |

"start, P" is `{ kind: 'start', projectPath: '/clones/b/Game' }`; "start, null" is `{ kind: 'start', projectPath: null }`.

## Tests

- `parsePlaytestCommand_ReadsTheSignal_given $given` — one `it.each` over the table above; asserts `toEqual` the
  row's result.

Pattern: `src/plugins/live-view/window-pick.test.ts` (pure `describe` / `it.each` tables in this plugin).

Done when: compiles; the test gate runs the test above.
Commit:    one commit for the group

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
