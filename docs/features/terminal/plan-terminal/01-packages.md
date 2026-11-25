# 01 — Packages

Status: not started
Type: Task
Rung: rote · checks the user's install of three packages and commits it; it writes no code and decides nothing
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     commit `package.json` · commit `package-lock.json` (the user's install changed both)
Consumes:  the user's run of `npm install --save-exact node-pty@1.1.0 @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0`
           in this tree ← plan.md § Preconditions
Produces:  `package.json` `dependencies` entries `"node-pty": "1.1.0"`, `"@xterm/xterm": "6.0.0"`, `"@xterm/addon-fit": "0.11.0"`
           the matching resolved entries in `package-lock.json`
           one commit that holds both files

Decisions:
- **Run no install.** `~/.claude/settings.json` denies package-manager installs to every agent. The user runs the
  install before wave 1 (plan.md § Preconditions). This task checks the result and commits it. Do not run
  `npm install`, `npm ci`, `npm update` or `npm uninstall`. Do not edit `package.json` or `package-lock.json` by hand.
- The user approved these three packages at these three versions for this run (plan.md § Preconditions, forms
  answer 2026-11-25). That approval covers no other package.
- The three packages go in `dependencies`, not `devDependencies`. The app uses them at run time: the session host
  loads `node-pty`, and the renderer bundles `@xterm/xterm` and `@xterm/addon-fit`. The repo puts its run-time
  packages in `dependencies` (`fzf`, `markdown-it`, `fabric`, `@modelcontextprotocol/server`). The list does not
  make `node-pty` ship: Forge's Vite plugin ships only `.vite` (plan.md § Preconditions), and task 04's Forge hook
  copies `node-pty`.
- The exact-version specifier style is the repo's style. The packages added most recently (`fzf` `0.5.2`,
  `markdown-it` `15.0.3`, `fabric` `7.4.0`, `@modelcontextprotocol/server` `2.3.1`) carry no `^`. `--save-exact`
  writes that style.
- Known fact, nothing to do: node-pty 1.1.0 ships no Linux prebuild, so its install on Linux builds it with node-gyp.
- **When a check fails, stop.** Do not repair it. Report the failed check and its output, so the lead can ask the
  user to run the install command again. The checks are:
  - `npm ls node-pty @xterm/xterm @xterm/addon-fit` prints all three at the pinned versions and exits 0.
  - `package.json` puts the three in `dependencies`, with no `^` or `~`, and none in `devDependencies`.
  - `git status --short` shows `package.json` and `package-lock.json` changed. A change to another tracked file is
    not this task's: leave it, and do not commit it.
  - `git diff package.json` adds the three entries and changes no other line.

Pinned values:
- `node-pty` `1.1.0` · `@xterm/xterm` `6.0.0` · `@xterm/addon-fit` `0.11.0`.

GIVEN the user ran the install WHEN `npm ls node-pty @xterm/xterm @xterm/addon-fit` runs THEN it prints
`node-pty@1.1.0`, `@xterm/xterm@6.0.0` and `@xterm/addon-fit@0.11.0` and exits 0
GIVEN the user ran the install WHEN `git diff package.json` runs THEN it adds the three `dependencies` entries and
changes no other line

Tests:     none · the task adds no code. The checks under Decisions are the checks.
Done when: every check under Decisions passes; `npm run typecheck` passes; the commit below exists.
Commit:    one commit, `package.json` and `package-lock.json` only, by pathspec: "Add node-pty 1.1.0, @xterm/xterm
           6.0.0 and @xterm/addon-fit 0.11.0 as dependencies for the session terminal"

## Proof
