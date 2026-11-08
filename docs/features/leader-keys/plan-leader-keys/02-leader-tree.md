# 02 — The new leader tree

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Re-read every file below before editing: keyboard-reach and form-popup land first and change `keymap.ts` and the
self-test scripts. Members, banner sections and step text are named here; line numbers were measured at plan time,
re-verify.

Files:     modify `src/plugins/keymap.ts` (`defaultKeymap.groups`; the `// ── Windows and modes ──` and
           `// ── Tabs and sessions ──` banner sections of `defaultKeymap.binds`; `formsBoxBinds`) · modify
           `src/plugins/chat/main/selftest-script.ts` · modify `src/plugins/sessions/main/selftest-script.ts` ·
           modify `src/plugins/session-log/main/selftest-script.ts` · modify
           `src/plugins/forms/main/selftest-script.ts` · modify `src/plugins/gallery/page/gallery-view.ts`
Consumes:  nothing from this plan. `sessions.togglePopup` and its `<Leader>vf` bind from the form-popup plan (a
           precondition in plan.md).
Produces:  the tree `docs/keymap.md` § Leader groups states, in `defaultKeymap`. 03 consumes the `<Leader>b` group
           named `session` (its which-key self-test step).

## Decisions

- **The tree is `docs/keymap.md` § Leader groups, written ahead.** That table is the spec; this task makes
  `keymap.ts` match it and moves nothing else.
- **`defaultKeymap.groups`**: add `'<Leader>b': 'session'`; change `'<Leader>k'` from `'windows'` to `'go to'`;
  remove `'<Leader>r': 'rename'`. Every other entry stays (`v` view, `z` debug, `zl` layout previews, `c` chat
  controls, `a` answer, `n` notes, `w` workflow, `p` projects).
- **Moves**, each the same command, scope `any`, no `where`, as the bind it replaces:

  | Old keys | New keys | Command |
  | --- | --- | --- |
  | `<Leader>kn` | `<Leader>bn` | `chat.newSession` |
  | `<Leader>rr` | `<Leader>br` | `sessions.renameSession` |
  | `<Leader>vs` | `<Leader>bh` | `chat.toggleSideParts` |
  | `<Leader>vf` | `<Leader>bp` | `sessions.togglePopup` (form-popup's bind) |
  | `<Leader>:` | `<Leader>bX` | `chat.stopAll` |

- **New binds** beside the one-key shortcuts that stay: `<Leader>bd` → `sessions.closeSession` and `<Leader>bs` →
  `session-stash.stash`, both scope `any`. `<Leader>;` (close) and `<Leader>'` (stash) stay as they are. `:` binds
  nothing after this task.
- **Placement and order**: the seven `b` binds sit together in the `// ── Tabs and sessions ──` section, right after
  `<Leader>'`, in the table's order: `bn`, `br`, `bd`, `bs`, `bX`, `bp`, `bh`. Which-key lists a group's entries in
  keymap order, so this order is the popup's. The one-key `<Leader>;` and `<Leader>'` lines stay before them, so a
  command whose hint prints its first bind still prints the same key it does today. Remove `<Leader>kn` and
  `<Leader>vs` from `// ── Windows and modes ──`, and `<Leader>:` and `<Leader>rr` from `// ── Tabs and sessions ──`;
  remove `<Leader>vf` from wherever form-popup put it.
- **Forms' not-applicable**: in `formsBoxBinds`, `<Leader>x` → `<Leader>ax`, same command
  (`forms.toggleNotApplicable`), still box-only in both `forms.forms` and `forms.review`; it moves after
  `<Leader>ac`, so the `a` group reads digits, `ac`, `ax`.
- **`k` keeps only the modes** (`ks`, `kd`, `kb`, `k,`), as the table says; nothing else is added to it.
- **No new unit test**: the tree is data. `keymap.test.ts`'s `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks`
  already fails on a clash, on a prefix beginning another bind's keys in a box, and on a wrong command name; the
  self-test steps below prove the moved keys fire. A test listing the tree would only restate it.
- **Self-test steps and comments that press or print a moved key** (measured at plan time, re-verify; the step
  text, not the line, is the anchor):
  - `chat/main/selftest-script.ts`: every `keys: [' ', 'k', 'n']` → `[' ', 'b', 'n']` (in `TWO_SESSIONS_STEPS`,
    `INTERRUPT_AND_CLOSE_STEPS`, `RESUME_LIST_STEPS`); the `RESUME_LIST_STEPS` why "…the session step only Space k n
    offers." → "…only Space b n offers."; the `session hub` group's why "Space v s hides…" → "Space b h hides…" and
    both its `['Escape', ' ', 'v', 's']` steps → `['Escape', ' ', 'b', 'h']`; the `stop all` group's why "Space :
    stops every session process; the rows stay, resting." → "Space b X stops every session process; the rows
    stay, resting." and its step `['Escape', ' ', ':']` → `['Escape', ' ', 'b', 'X']`. Expected lines stay
    (`[chat] picker shown: Folder`, `[chat] session hub hidden` / `shown`, `[chat] stopping every session`). The
    `LAYOUT_PREVIEW_STEPS` step `['Escape', ' ', ';']` and its why "Space ; closes the session" stay: `;` stays.
  - `sessions/main/selftest-script.ts`: both `RENAME_STEPS` steps' `' ', 'r', 'r'` → `' ', 'b', 'r'`; the comment
    above it "`Space r r` renames panes-a, …, and a second `Space r r` …" → `Space b r` both times.
  - `session-log/main/selftest-script.ts`: the `recently closed` group's `[' ', 'k', 'n']` → `[' ', 'b', 'n']`.
  - `forms/main/selftest-script.ts` (the `user keymap` group, `USER_KEYMAP_STEPS`, and its fixture
    `MOVED_NOT_APPLICABLE_KEYMAP`): the fixture's `unbind` becomes `[{ keys: '<Leader>ax', scope: 'forms.forms',
    where: 'box' }]`; its comment "moving the text box's not-applicable toggle in the form from <Leader>x to
    <Leader>q" → "from <Leader>ax to <Leader>q" (`<Leader>q` stays the target: nothing binds it). Steps:
    `['Escape', ' ', 'x']` → `['Escape', ' ', 'a', 'x']` expecting `[page] <Leader>ax has no bind in forms.forms`
    (vim still maps `<Leader>ax` for `forms.review`, so forms.forms logs the miss, as it did for `<Leader>x`);
    `[',', 'x']` → `[',', 'a', 'x']`; both `[' ', 'x']` → `[' ', 'a', 'x']`; the why "{} restores the Space leader
    and <Leader>x, …" → "…and <Leader>ax, …". Expected `[forms] …` lines stay.
  - `gallery/page/gallery-view.ts`, `emptyStateCells`: `kbd('Space k n', platform)` → `kbd('Space b n', platform)`.
  - After keyboard-reach and form-popup land, re-run the sweep and treat each new hit the same way:
    `grep -rnE -e '<Leader>(kn|rr|vs|vf|x|:)[^a-zA-Z0-9]' -e 'Space (k n|r r|v s|v f|x|:)([^a-z]|$)' -e "' ', '(k',
    'n|r', 'r|v', 's|v', 'f|x|:)'" <repo>/src` with `<repo>` the run's absolute repo path (one line; the quoting
    is zsh-safe as written). After this task it returns only the samples below.
- **Unit tests judged arbitrary samples, left as they are** (each builds its own binds and never reads
  `defaultKeymap`; any key would serve):
  - `src/renderer/editor-binds.test.ts`, `editorBindInForce reports none, naming the keys, when no bind is in
    force` — `<Leader>x` for `forms.toggleNotApplicable` in `forms.forms`; it checks that the message names the keys.
  - `src/renderer/codemirror-vim/vim-binds.test.ts` — `bind('<Leader>x', 'a.one')`.
  - `src/plugins/settings/page/keymap-rows.test.ts` and `keymap-edits.test.ts` — `<Leader>x` on `p.s` / `p.a`.
- **Docs**: `docs/keymap.md`, `AGENTS.md`, `DESIGN.md` and the feature designs were moved ahead (plan.md § Docs
  written ahead); 06 re-reads them. Any `src` comment naming a moved key that the sweep finds is fixed here.

GIVEN the default keymap WHEN the user presses Space b THEN which-key lists `n r d s X p h` under the name `session`
GIVEN focus in a forms text box in normal mode WHEN the user presses Space a x THEN the item toggles not applicable
GIVEN any scope WHEN the user presses Space : THEN nothing runs (the key is unbound)

## Tests

No unit test is added or changed (see Decisions). `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` in
`src/plugins/keymap.test.ts` runs as it is. The self-test steps above are the proof.

Done when: `npm run typecheck`, `npm run lint` and `npm test -- src/plugins/keymap.test.ts` pass, and `npm run
selftest -- --plugin chat --plugin sessions --plugin session-log --plugin forms` passes. The keys-plugin popup
over `Space b` is drawn in 03 and checked in `07-final-verification.md`.
Commit:    one commit for the group

## Proof

