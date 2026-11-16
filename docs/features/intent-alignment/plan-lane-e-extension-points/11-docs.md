# 11 — Agent docs and the design re-read

Status: not started
Type: Task
Wave: 6 · Depends on: 01–10
Plan: [plan.md](plan.md)

Tasks 01–10 changed how a plugin adds a markdown block, an ex command, a remap, a setting control kind, a forms item
kind and a finding origin. This task brings the repo's agent docs and design docs in line with the landed code, in one
commit, and closes the lane's follow-ups. It writes no code. Task 09 already landed the marketplace and
`~/wigley-agents/forms.md` text; this task does not touch them.

Run `wigley:writing-for-agents` on every edit. Each line below names what is stale; the wording is the implementer's,
written against the code as it landed (read the code, not the task documents, where the two differ). Line numbers were
measured at plan time (2026-11-09); find each passage by its heading or text.

Files:
- modify `AGENTS.md`
- modify `docs/keymap.md`
- modify `docs/features/settings/design.md`, `docs/features/layouts/design.md`, `docs/features/visuals/design.md`,
  `docs/features/plugin-framework/design.md`
- modify `docs/features/followups.md`, `docs/features/intent-alignment/master-plan.md`

Consumes: the landed code of 01–10, and each task's Proof in its document.

## Edits

`AGENTS.md`:
- Folder map (near line 419, beside `usage-tab-line/`): an entry for `markdown-blocks/` (01).
- The markdown-it line (near line 251): the adapter owns the `:::name` block syntax; blocks register through
  `addBlock` beside `addFence` (01).
- "A registration" (near lines 526–531), the list of per-plugin service views: markdown blocks and ex commands (01, 02).
  Near line 909 ("destroys its editors"): a plugin's ex commands go with it (02).
- "A plugin" (near line 502): the manifest's `keys.remaps` (03) and `settingControls` (04) fields.
- "A key" (near line 697): a manifest's `keys` takes `remaps` in the user keymap's shape, layered by dependency
  order under the user's `keymap.json`; a disabled plugin's remaps leave the served keymap (03).
- "A setting" (near line 924): a setting's control kind is a string id; the manifest's `settingControls` binds a path
  to it; the settings page registers each kind through `SettingsPageExports.addControlKind`; main still checks values
  by the default's shape (04). The layout picker kind `layout` (05).
- "A layout" (near line 955): the `<owner>.layout` and `shell.layout` rows pick from the owner's layout names (05).
- "An item kind" (near lines 823–837): replace the checklist of closed tables (`FORMATS`, `ItemOf`, `ROUND_ITEMS`,
  `ANSWER_ARRAYS`, `PICK_ANSWERS`, `RECOMMENDED_PICKS`, `ANSWERABLE_ORDER`, `ROUND_ITEM_LISTS`, `FINGERPRINT_LISTS`,
  `ANSWER_LISTS`, the named arrays in `Round`/`FormBody`/`AnswersPayload`, the `formats.test.ts` sentence) with the
  two registrations: a `MainItemKind` through `FormsMainExports.registerKind` and a `PageKind` through
  `FormsPageExports.registerKind`, tied by the `ItemKindSpec` id; built-ins register the same way; where each built-in
  module now lives after 10's split (06, 07, 10).
- "A finding origin" (near lines 838–858): replace the checklist with one `FindingOriginSpec` registered through
  `registerFindingOrigin` in both processes; `proof` is required on `nit` alone; saved finding answers carry
  `action_label` and `recommend_action_label` (08).
- "A forms layout" (near line 1002): the three named cards plus `cards.kinds` and `cards.other`; card, origin, action
  and severity are strings (07, 08).
- "Other plugins reach the forms view…": `FormsPageExports` lists `registerKind` and `registerFindingOrigin`, and
  `FormsMainExports` exists (06–08).
- "An MCP tool": add one line if forms' re-contribution on a kind or origin change is a pattern another plugin would
  copy; else leave it (06).
- Every mention of the forms screen union says `FormsScreen` (10); near line 726 "(forms' view)" stays true.

`docs/keymap.md` lines 19–21: the manifest's `keys` takes `remaps` and layers them by dependency order (03).

`docs/features/settings/design.md` lines 54–60 and 176–182: control kinds as page registrations, the manifest's
`settingControls` map, and the layout picker (04, 05); near line 179, a leaf's `control` is `{ kind, choices }` with
`kind` a string id; the user config service's `read()` also serves each owner's `layoutNames` (05); a row whose kind
no registration holds draws its value as text and offers reset only (04).

`docs/features/layouts/design.md` lines 62–63 (settings layouts get a `control: string`) and line 125 (the forms row:
"question, finding and notice cards" plus `kinds` and `other`) (04, 07).

`docs/features/visuals/design.md` line 63 ("One fence registry in the core"): blocks register beside fences (01).

`docs/features/plugin-framework/design.md` § Extension points (Lane E), written ahead in `cdc8e91ff`: re-read it
against the landed code and fix each line the code proved wrong. Known at plan time:
- The setting-kinds bullet that says the kit draws the registered kind's editor: the app draws the row box and the
  list picker; no kit member was added (04).
- Plugin remaps (near line 380): a disabled plugin's remaps leave the served keymap; a paused plugin's stay (03).
- The action-word line: saved entries carry `recommend_action_label` beside `action_label` (08).
- Forms rounds: `ItemKind` closes in 06 and opens in 07; `Round.bodyKeys` (07).

## Follow-ups and the master plan

In `docs/features/followups.md`, remove these entries (each found by its bold name; line numbers at plan time):
Forms item kinds as registrations (~388), Finding origin specs and open layout unions (~397), A finding's proof
becomes optional off a Nit (~403), Markdown block contributions (~408), EditorHost.defineEx (~411), Plugin editor
remaps (~414), Setting control kinds as registrations (~416), Layout name picker in Settings mode (~484), Split
form-state.ts and rename the FormsView union (~565). Leave every other entry, including the Command palette.
A gap any task reported as a concern and left open becomes a new entry here, in the matching area.

In `docs/features/intent-alignment/master-plan.md` § Lane E, tick every box but the Command palette's: the four ∥
items, the Layout name picker, and forms chain items 1, 2 (both boxes) and 3.

GIVEN the landed code WHEN each edited passage is read beside it THEN every name, path and rule it states is in the
tree (grep each symbol the passage names).

Done when: `grep -rn "ROUND_ITEMS\|ANSWER_ARRAYS\|FINGERPRINT_LISTS\|ORIGIN_CHIPS\|DOCUMENT_EX_COMMANDS" AGENTS.md docs
--exclude-dir=plan-lane-e-extension-points` prints nothing; `grep -c "\[ \]" docs/features/intent-alignment/master-plan.md`
dropped by nine from before this task; the nine follow-ups are gone. No test runs: docs only (none picked, the
change has no code).

Commit: one commit: "Lane E docs: AGENTS.md and the design docs describe the registrations as landed; Lane E
follow-ups closed and ticked".

## Proof

