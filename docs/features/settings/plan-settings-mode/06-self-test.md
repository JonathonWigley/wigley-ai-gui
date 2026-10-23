# 06 — Settings self-test

Status: in progress
Type: Task
Wave: 5 · Depends on: 02, 05
Plan: [plan.md](plan.md)

Files:     create `src/plugins/settings/main/selftest-script.ts` · modify `src/plugins/settings/main/start.ts`
Consumes:  `createUserConfig` in the composition root ← 02 · the page log lines ← 05 · `settingsMainPart` ← 03
Produces:  `export function settingsSelfTestScript(deps: SettingsSelfTestDeps): SelfTestScript` in
           `src/plugins/settings/main/selftest-script.ts`, handed to `services.selfTest?.run` in the main part's start
Decisions: a key behaviour the agent adds gets a self-test step (AGENTS.md § Running and testing) · the self-test's
           config folder is its temp home's, so every write stays there
Done when: `npm run selftest` passes, the settings steps included, and its screenshots are read against `DESIGN.md`
Commit:    one commit for the group

Read `AGENTS.md` § Running and testing and one existing script (`src/plugins/docs/main/selftest-script.ts`) for the
step shape, `writeFile`, `screenshot` and `problems`.

## Script

- `open(run)` runs the same path as `Cmd+,` (the main part's `show` handler: synthetic keys never reach the app
  menu) and returns `shownLine` `[settings] shown`. Its `result` resolves with the `userConfig.read()` taken on the
  first `userConfig.onChanged` after which `settings.layer` and `keymap.layer` both deep-equal `{}` (not null): the
  self-test contract has no steps-ended hook, and that state first holds after step 14 (`keymap.json` exists only
  from step 11, and step 8 leaves a value in `settings.json` until step 14).
- `settings`: `{}`; `pageBinds`: `[]`; `scrollsItself`: the rows sheet's scroll container.
- `writeFile` paths are relative to the temp home: `.config/wigley-ai-gui/settings.json`.

Steps, each waiting for its line (write the exact keys against the landed views; the leader is Space):

1. `Space k ,` while Settings shows → toggles the side bar: the core's side bar line (its text is in
   `src/renderer/shell/modes.ts`). Again → the side bar shows again.
2. `/`, type `sequence`, Enter → `[settings] filter "sequence": 1 rows`; screenshot `core-filtered`.
3. Enter on the row → `[settings] box open keySequenceTimeoutMs`; type `750` (the box opens with its text
   selected), Enter →
   `[settings] wrote settings.json`.
4. Enter, type `abc`, Enter → `[settings] box problem keySequenceTimeoutMs: Enter a number`; screenshot
   `box-problem`. Esc → `[settings] box closed keySequenceTimeoutMs`.
5. `writeFile` settings.json `{"keySequenceTimeoutMs": 800}` with no keys → `[settings] redrawn`.
6. `r` → `[settings] wrote settings.json`; the layer is `{}` afterwards.
7. `writeFile` settings.json `{"nope": 1}` → `[settings] broken settings.json`; screenshot `broken`. Then
   `writeFile` `{}` → `[settings] redrawn`.
8. Stale write: Enter on the row (box open), then a step whose `writeFile` writes `{"keySequenceTimeoutMs": 900}` and
   whose keys type `600`, Enter → `[settings] changed on disk settings.json`; Esc.
9. Theme picker: filter `theme`, Enter → the picker's `picker shown: Theme` line; Esc.
10. Keymap: `Alt+h`, move to `Keymap`, Enter → `[settings] section keymap`; screenshot `keymap`.
11. Filter `help`; on the help command row `a`, type `<Leader>zh`, Enter → the scope picker; Enter (preselected) →
    `[settings] wrote keymap.json`.
12. `d` → the picker opens, since the row now holds its default lines and the user line; move its cursor to the user
    line (listed last) and Enter → `[settings] wrote keymap.json`.
13. `r` on the same row → `[settings] unchanged` (step 12 left nothing of that command in the layer).
14. Back to Core (`Alt+h`, the Core row, Enter), filter `sequence`, `r` → `[settings] wrote settings.json` (clears the
    900 step 8 left on disk).

`problems(result)`: the read's `settings.layer` deep-equals `{}`, and `keymap.layer` holds no bind on `<Leader>zh`. Each mismatch is one problem line naming the file and what it held.

Check that `<Leader>zh` is unbound in the default keymap before using it (`command grep -n "zh'" src/plugins/keymap.ts`
→ nothing at plan time, re-verify); take another free key under `<Leader>z` if not.

## Proof
