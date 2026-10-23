# 07 — Doc re-read

Status: not started
Type: Task
Wave: 6 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     modify (only where stale) `docs/features/settings/design.md` · `AGENTS.md` · `DESIGN.md` · `docs/keymap.md` ·
           `docs/features/followups.md`
Consumes:  the landed code of tasks 01–06
Produces:  each doc written ahead (commit `e02b5f0`) true to the landed code
Decisions: a doc written before its code is a hypothesis (`wigley:writing-for-agents` § Doctrine before code)
Done when: every line of `git show e02b5f0` checked against the code; every stale line fixed; lint passes; the fixes
           committed
Commit:    one commit, or none when nothing is stale

## Check

Read `git show e02b5f0` line by line. For each claim, find the code that makes it true:

- names: `userConfig`, `settingInfo`, `SettingInfos`, the `settings` plugin's folders, `settings.showMode`,
  `settings.show`, `CommandOrControl+,`
- keys: `<Leader>k,`, the rows keys, `Alt+h` / `Alt+l`, box Enter and Esc, `:w` / `:q` in the JSON box
- copy: `Set`, `Default: …`, `Removed`, `Replaced by …`, `Replaces …`, `<file> changed on disk; the form now shows it`,
  `<file> has a problem: …`, `Not set`
- rules: a reset or default-equal commit removes the key; a stale write refused; a broken file read-only; the theme
  names served; the write runs the ConfigStore's checks

Also fix lines the move made stale beyond `e02b5f0`: AGENTS.md names `textBoxInput` as docs' (now
`src/shared/page/text-box.ts`), and the self-test paragraph may list the settings script beside docs' and chat's.
Fix the doc, not the code, unless the code contradicts a decision in `plan.md` — that goes in the report instead. Run
`wigley:writing-for-agents` on each fix.

## Proof
