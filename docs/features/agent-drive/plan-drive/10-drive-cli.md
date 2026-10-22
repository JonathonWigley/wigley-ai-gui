# 10 — The drive CLI

Status: done
Type: Task
Wave: 3 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     create `scripts/drive.mts` · create `scripts/drive-args.mts` · test `scripts/drive-args.test.mts` · modify `package.json` · modify `.gitignore`
Consumes:  the HTTP protocol, the command table and the run folder layout of plan.md § Drive protocol ← 05
Produces:  `"drive": "node scripts/drive.mts"` in `package.json`
           `export function parseDriveArgs(argv: string[]): DriveInvocation` in `scripts/drive-args.mts`
Decisions: one command for everything, `npm run drive -- <command>` (round 2) · `start` returns once the page is ready, `.drive/current` names the newest run (design review) · `--packaged` (round 2) · `--user-config` and `--harness claude` opt-ins (round 1)

## What changes

- **`DriveInvocation`**: `{ kind: 'start', packaged: boolean, harness: 'fake' | 'claude', userConfig: boolean }` · `{ kind: 'restart' }` · `{ kind: 'help' }` · `{ kind: 'send', command: string, args: Record<string, unknown> }`, each with `run: string | null` from `--run <id>` anywhere in argv. An unknown `--flag` throws naming it.
- **Positional forms** (`parseDriveArgs` turns each into `send`; every row that names a positional takes it positionally, even when it starts with `{`, and only the last row and `wait-log` (for `timeoutMs`) take a trailing JSON object merged into `args`; `type a b` joins its arguments with one space; `--harness` other than `fake` or `claude` throws naming both):

  | form | args |
  |---|---|
  | `key <tokens…>` | `{ keys }`: every argument split on whitespace; the token `Space` becomes `' '` |
  | `type <text>` | `{ text }` |
  | `click <selector>` | `{ selector }` |
  | `drag <selector> <dx> <dy>` | `{ selector, dx, dy }` (numbers) |
  | `resize <width> <height>` | `{ width, height }` |
  | `setting <name> <json value> [--plugin <id>]` | `{ name, value, plugin? }` |
  | `wait-log <line> [json]` | `{ line, timeoutMs? }` |
  | `log [since]` · `console [since]` | `{ since? }` |
  | `screenshot <name> [selector]` | `{ name, selector? }` |
  | `query <selector> [style,style…]` | `{ selector, styles? }` |
  | `fit [width] [selector,selector…]` | `{ width?, scrollsItself? }` |
  | `eval <script>` | `{ script }` |
  | `record start [name]` · `record stop` | `{ action, name? }` |
  | `do <name> [json]` | `{ name, args? }` |
  | any other `<command> [json]` | the JSON, or `{}` |

- **`start`**: run id `YYYYMMDD-HHMMSS-<4 hex>`, or the `--run` id, whose home is reused when it exists (`start` exits 1 with `Run <id> is already running` when its `drive.json` answers `ready`); creates `.drive/<id>/home`; writes `.drive/<id>/start.json` with the start flags and the spawned pid; with `--user-config`, copies `~/.config/wigley-ai-gui` into `home/.config/wigley-ai-gui` (absent → prints that and goes on); writes `.drive/current`. Spawns detached, stdin ignored, stdout and stderr to `<run>/app.log`, env `WIGLEY_DRIVE_DIR=<absolute run dir>` and `WIGLEY_DRIVE_HARNESS`: `node_modules/.bin/electron-forge start` (`electron-forge.cmd` on Windows) in the repo, or with `--packaged` the binary in `out/wigley-ai-gui-<platform>-<arch>/` (macOS `wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui`, Windows `wigley-ai-gui.exe`), missing → exits 1 with `No packaged build at <path>; run npm run package first`. Waits up to 120 s for `drive.json` (the first Vite build is slow); if the child exits first, prints the last 30 lines of `app.log` and exits 1. Then sends `ready` and prints `run <id>` and the run folder.
- **send**: reads `drive.json` for `--run` or `.drive/current`; POSTs; prints `result` as indented JSON; `ok: false` → the error on stderr, exit 1; a refused connection → `Run <id> is not running; npm run drive -- start` and exit 1.
- **`restart`**: sends `quit`, waits up to 15 s for the pids in `drive.json` and `start.json` to exit (exits 1 with `Run <id> did not quit within 15 s` past it), deletes `drive.json`, and starts again into the same run folder with the flags `start.json` recorded.
- **`help`**: prints the CLI's own forms, then the live run's `help` when one answers.
- `.gitignore`: `.drive/` under the self-test screenshots line.

GIVEN argv `['key', 'Space k', 's']` WHEN parsed THEN it is `send` `key` with `keys` `[' ', 'k', 's']`
GIVEN argv `['do', 'forms.openRound', '{"harness":"codex"}']` WHEN parsed THEN `args` is `{ name: 'forms.openRound', args: { harness: 'codex' } }`
GIVEN argv `['start', '--packaged', '--harness', 'claude', '--run', 'x']` WHEN parsed THEN it is `start` packaged with harness `claude` and run `x`
GIVEN argv `['start', '--bogus']` WHEN parsed THEN it throws naming `--bogus`
GIVEN argv `['setting', 'transparency', '"reduced"']` WHEN parsed THEN `args` is `{ name: 'transparency', value: 'reduced' }`
GIVEN argv `['setting', 'window', '{"width":900}']` WHEN parsed THEN `args` is `{ name: 'window', value: { width: 900 } }`
GIVEN argv `['eval', '{ document.title }']` WHEN parsed THEN `args` is `{ script: '{ document.title }' }`
GIVEN argv `['start', '--harness', 'real']` WHEN parsed THEN it throws naming `fake` and `claude`

Tests:     `drive-args.test.mts`: one test per GIVEN above, named as its sentence
Done when: typecheck, lint and the tests pass
Commit:    one commit for the group

## Proof
`cd49094` · proved: diff read against the spec, `parseDriveArgs` and the `drive` script present; typecheck clean; scripts tests 60 passed; lead smoke on `13aee03`+: `start` printed the run, `actions` listed all nine, `key j` answered `{ lines: [] }`, `screenshot smoke` wrote a PNG showing the empty sessions screen, `quit` exited 0 · concerns: Windows `.cmd` spawn uses `shell: true` (a repo path with spaces needs quoting); `restart` assumes forge exits when Electron quits; an inherited `PROOF_SELFTEST` makes `runModeOf` throw
