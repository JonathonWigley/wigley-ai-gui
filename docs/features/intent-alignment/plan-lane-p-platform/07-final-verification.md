# 07 — Final verification

Status: not started
Type: Task
Wave: 7 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     none (a check worth keeping becomes a self-test step in the task that owns it, not here)
Consumes:  the landed code of tasks 01–05; the drive skill (`.agents/skills/drive/SKILL.md`)
Produces:  each live check below run and its outcome recorded in the Proof
Decisions: risk tier High (`~/wigley-agents/decisions.md` § Risk): every main-process start of a program, the
           saved-form store and every page chord change. Only the checks `wigley:writing-tests` § What earns a live
           run instead admits are listed; a claim a task's test pins has no live check here.

Runs on macOS through the project's tooling: `npm run selftest -- --plugin <id>` filtered to the touched plugins
(`AGENTS.md` § Running and testing), and drive runs (`npm run drive -- start`, `do`, `keys`, `quit`; `npm run drive
-- help` is the source of truth for arguments). `--harness claude` is used only for check 7, where no fixture runs
the real CLI; name it in the report.

## Self-test runs

1. **Low-confidence** — the self-test scripts of forms and primer pass: store timing changed under the steps that
   save and finish forms (task 03). Run `npm run selftest -- --plugin forms --plugin primer`.
2. **Low-confidence** — the user-keymap self-test steps task 01 added pass, `<C-/>` logging
   `[page] <C-/> ran keys.toggleHelp`: whether Electron's synthesized Ctrl+`/` reaches the page with `key: '/'` and
   not a control character is unproven, and the by-key path rests on it. Run the script that holds
   `USER_KEYMAP_STEPS` (find it with `grep -rln USER_KEYMAP_STEPS src`), filtered to its plugin or group.
3. **Expected** — the existing `<A-o>`, `<A-;>`, `<A-'>`, `<C-S-j>`, `<D-Enter>` and Tab steps in the same run still
   pass on macOS (Option by code, the rest by key): every chord now goes through the new matcher.
4. **Expected** — the docs and unity-pool self-test scripts pass: their Python now comes through
   `resolveProgram('python')` and unity-pool's `pythonCommand` is gone (task 04). Run
   `npm run selftest -- --plugin docs --plugin unity-pool`; a plugin with no script is recorded as such.

## Drive runs

5. **Low-confidence** — with a scratch `keymap.json` in the run's temp home binding `<C-?>`, `<F5>` and `<A-Up>` to
   commands that log, pressing each fires its command: `<C-?>` rests on Electron adding Shift and sending key `?`
   (unproven); `<F5>` and `<A-Up>` are expected, since Electron documents those key names.
6. Dropped at the cold read: drive runs use `silentAlerts` (`main.ts:391`), which records no count; the
   `open-counts` and presenter tests pin the badge sum and the overlay text (task 02).
7. **Expected** — with `claude.command` empty, `start --harness claude` starts a chat session and the usage panel's
   `claude -p /usage` one-shot answers: the default command now comes from the lookup, and the pending pipe sits under
   every session (tasks 04, 05).
8. **Expected** — after the run's session host is killed (its pid is in the `host-v<protocol>.<pid>.children.json` file name in `<run>/user-data/session-host/`,
   `docs/features/session-host/design.md`), the next session start
   cold-starts the host detached, and the session answers (task 05: the host start moved onto `startDetached`).
9. **Expected** — after a `restart` of the run (a plain `quit` deletes the run's home and the saved round with it), a re-sent round prefills its draft from the
   saved file: `load()` ran before the call (task 03).
10. **Low-confidence** — after launch, the run's `endpoint.json` and `tools.json` list every contributed tool: the
    writes are now async behind a queue, and no test covers them end to end with a real relay (task 03).
11. **Expected** — the docs index builds in a drive run (`do docs.…` that indexes, per `actions`) and completes:
    its index file is written under the run's home and the log holds no `docs_index.py … not run` line (task 04).
12. **Expected** — a unity-pool Hold then Release runs in a drive run against a scratch pool config (task 04: its
    `pythonCommand` setting is removed). When the drive offers no unity-pool action, record that, and check 4 stands.

## The user's checks (wrap-up only)

Not run here; the run's wrap-up lists each with its steps (`~/wigley-agents/AGENTS.md` § Checks for the user):

- A real AltGr keyboard on Windows (`@` types, no chord fires); an AZERTY layout (`<C-&>` on the 1 key); a Cyrillic
  layout (Ctrl+С fires `<C-c>` by code); macOS Option+n dead key.
- Windows: `claude.cmd` and `py -3` through `cmd.exe` with arguments holding spaces and quotes; the taskbar overlay
  text naming forms and primer counts; a draft saved while another process holds the file open.
- A draft typed while the stable app and the dev app share the rounds folder stays saved in both.
- On the Windows machine: delete `unity-pool.pythonCommand` from `settings.json` if it is there (the config store
  refuses a removed setting), and set `programs.python` instead when the default order does not find Python.

GIVEN tasks 01–06 landed WHEN each check above runs THEN it shows what its line says.
Tests:     the self-test scripts named above; no unit tests (each task's own gate ran them).
Done when: every check 1–12 but 6 recorded in the Proof with its outcome and the command or log line that shows it; a
           failure is fixed in the task that owns the code, then its check re-run.
Commit:    none, unless a failure's fix lands (committed with its owning task's scope).

## Proof
