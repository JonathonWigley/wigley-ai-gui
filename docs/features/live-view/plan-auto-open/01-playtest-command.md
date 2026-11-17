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
Decisions: plan decisions 2, 3 and 9 · `capture.py command -- editor_play` is no trigger (plan, Decided)

## What it does

`parsePlaytestCommand` reads the full text of a Bash call's `command` and says whether it starts a playtest, stops
one, or neither. It is pure: no imports from the plugin, the contracts or Node.

## Rules

1. **Split into simple commands.** Split the text on the shell's list and pipe operators outside quotes: `&&`, `||`,
   `;`, `|`, `&`, and a newline. A backslash before a newline joins the two lines (shell line continuation).
2. **Split each simple command into words.** Whitespace separates words outside quotes. Single quotes keep their
   text literally. Double quotes keep their text, and a backslash inside them escapes `"` and `\`. A backslash
   outside quotes escapes the next character. Quotes are removed from the word. So `echo "unity command editor_play"`
   is two words, `echo` and `unity command editor_play`, and gives no signal.
3. **Find the program word.** In each simple command, the first word whose last `/`-separated segment is exactly
   `unity` is a unity program word; the first word whose last segment is exactly `capture.py` is a capture program
   word. Words before it are ignored, so `env A=1 unity …`, `timeout 60 unity …` and `python3 /x/capture.py …` all
   match.
4. **Read the words after the program word.** Take out `--project-path <value>` (two words) and
   `--project-path=<value>` (one word); the value is the signal's `projectPath`. When it appears more than once, the
   last one wins. Then take out every other word that starts with `-`. The words left, in order, are the positionals.
5. **The signal.**
   - unity program word: positionals `command`, `editor_play` → `{ kind: 'start' }`; `command`, `editor_stop` →
     `{ kind: 'stop' }`; anything else → no signal.
   - capture program word: first positional `start` → `{ kind: 'start' }`; anything else (`stop`, `mark`, `tap`,
     `command`) → no signal.
   - `projectPath` is the value from rule 4, or null.
6. **Several signals in one text:** the last simple command that gives a signal wins. So
   `unity command editor_stop && unity command editor_play` is a start.
7. **No signal anywhere:** return null. An unclosed quote: treat the rest of the text as inside that quote (the
   words still split as far as they can); never throw.

Command substitution (`$(…)`, backticks), heredocs and variables are not expanded: their text is read as words, as
written.

## GIVEN / WHEN / THEN

GIVEN a command text WHEN `parsePlaytestCommand` reads it THEN it returns the row's result:

| Command | Result |
|---|---|
| `unity command editor_play --result-only` | `{ kind: 'start', projectPath: null }` |
| `unity command editor_stop --result-only` | `{ kind: 'stop', projectPath: null }` |
| `cd /clones/b && unity command editor_play` | `{ kind: 'start', projectPath: null }` |
| `unity command editor_play --project-path /clones/b/Game` | `{ kind: 'start', projectPath: '/clones/b/Game' }` |
| `unity --project-path /clones/b/Game command editor_play` | `{ kind: 'start', projectPath: '/clones/b/Game' }` |
| `unity command editor_play --project-path=/clones/b/Game` | `{ kind: 'start', projectPath: '/clones/b/Game' }` |
| `unity command editor_play --project-path "/Users/me/My Game"` | `{ kind: 'start', projectPath: '/Users/me/My Game' }` |
| `unity command editor_play --project-path '/Users/me/My Game'` | `{ kind: 'start', projectPath: '/Users/me/My Game' }` |
| `/usr/local/bin/unity command editor_play` | `{ kind: 'start', projectPath: null }` |
| `python3 /skills/unity-playtest/capture.py start --project-path /clones/b/Game` | `{ kind: 'start', projectPath: '/clones/b/Game' }` |
| `python3 capture.py start --append --project-path /clones/b/Game` | `{ kind: 'start', projectPath: '/clones/b/Game' }` |
| `python3 capture.py stop --project-path /clones/b/Game` | `null` |
| `python3 capture.py command --project-path /clones/b/Game -- editor_play` | `null` |
| `unity command editor_status` | `null` |
| `unity status --json` | `null` |
| `echo "unity command editor_play"` | `null` |
| `git commit -m 'unity command editor_play'` | `null` |
| `unity-pool claim --branch main` | `null` |
| `unity command editor_stop && unity command editor_play` | `{ kind: 'start', projectPath: null }` |
| `unity command editor_play \|\| true` | `{ kind: 'start', projectPath: null }` |
| `unity command editor_play; sleep 5` | `{ kind: 'start', projectPath: null }` |
| a two-line text: `cd /x` newline `unity command editor_stop` | `{ kind: 'stop', projectPath: null }` |
| `unity command \` newline `  editor_play` (line continuation) | `{ kind: 'start', projectPath: null }` |
| `echo "unclosed` | `null` |
| empty text | `null` |

In the table, `\|\|` is the shell's `||`, escaped for the markdown table.

## Tests

- `parsePlaytestCommand_ReadsTheSignal_given $given` — one `it.each` over the table above, each row with a `given`
  name; asserts `toEqual` the row's result.

Pattern: `src/plugins/live-view/window-pick.test.ts` (pure `describe` / `it.each` tables in this plugin).

Done when: compiles; the test gate runs the test above.
Commit:    one commit for the group

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
