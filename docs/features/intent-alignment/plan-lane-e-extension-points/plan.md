# Lane E: extension points — plan

Feature: intent alignment, Lane E · Implements: none · Ticket: none
Target: main · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Seven closed lists in the app become registrations, so a plugin adds to each without an edit to its owner:
markdown `:::name` blocks, vim ex commands, a manifest's editor remaps, setting control kinds (with the layout name
picker as the first new kind), forms item kinds and finding origins. A finding's `proof` becomes required on a Nit
alone, and saved rounds carry each finding's action word, so retro in wigley-ai-marketplace reads data instead of
its own table. The lane ends by splitting `form-state.ts` and renaming forms' screen union.

## Architecture

Systems touched:

- **Markdown adapter** (`src/contracts/markdown.ts`, `src/renderer/markdown-it/`) and a new built-in plugin
  `src/plugins/markdown-blocks/`.
- **Editor adapter** (`src/contracts/editor.ts`, `src/renderer/codemirror-vim/`) and the per-plugin service views
  (`src/shared/plugin-service-views.ts`).
- **Manifests and keymap merge** (`src/contracts/plugin.ts`, `src/shared/plugin-manifests.ts`,
  `src/shared/plugin-catalog/`).
- **Settings**: main's config (`src/main/config/`, `src/config/settings.ts`), the user-config contract
  (`src/contracts/user-config.ts`), and the settings plugin's page and layouts (`src/plugins/settings/`).
- **Forms** (`src/plugins/forms/`): contract, main kinds and round logic, page state, kinds, layout tables, the
  layout contract and `default` layout.
- **wigley-ai-marketplace**: `plugins/wigley/scripts/retro/answers.py` and its tests, `scripts/forms/README.md`,
  `skills/review/triage.md`. **wigley-agents**: `forms.md` § Findings.

Every wigley repo lands through `~/wigley-agents/WigleyRepos.md` § Landing: one worktree for every folder the session changes, a fast-forward into
`main`, then the push.

## Preconditions

`make` re-runs each command before the first dispatch, and the gate commands before the group they gate. `GUI` is the
wigley-ai-gui folder of the clone or worktree the run works in; `MKT` is `/Users/jonathonwigley/Documents/ai/wigley-ai-marketplace`.

1. Wave 1 step 1 (disposable registrations) has landed:
   `grep -n "\[x\] Disposable registrations, disposed per plugin" GUI/docs/features/intent-alignment/master-plan.md`
   prints one line.
2. **Gate for task 06 and every forms task after it.** Lane H's Structured round results has landed:
   `grep -n "\[x\] Structured round results" GUI/docs/features/intent-alignment/master-plan.md` prints one line. Until
   it does, tasks 06–10 wait, and so does 02 (it runs after 07 Part A); tasks 01, 03, 04 and 05 may run. At plan time (2026-11-09) it had not landed. When it lands, the
   forms task documents were written against the tree before it: each forms implementer reads the Structured round
   results commits (`git log --oneline -- src/plugins/forms/main/round.ts src/plugins/forms/main/kinds`) first and
   reports any Produces it moved as a concern.
3. **Order against Lane L.** Lane L's forms items (dialog confirms, forms and primer column chrome, layout hot reload's
   forms redraw) have not started on the forms files: `git log --oneline main -- src/plugins/forms/page/round-view.ts
   src/plugins/forms/layouts` shows no Lane L commit after this plan's first commit. Lane L waits for task 10.
4. The ex command table is closed today: `grep -n "DOCUMENT_EX_COMMANDS" GUI/src/renderer/codemirror-vim/*.ts` finds
   the table in `document-ex-commands.ts` and its loop in `codemirror-vim-host.ts`.
5. Three plugins open document editors with their own `:w`/`:q` handlers:
   `grep -rln "createDocument" GUI/src/plugins --include='*.ts' | grep -v test` lists `docs/page/doc-view.ts`,
   `practice/page/problem-workspace.ts` and `settings/page/row-box.ts`.
6. `SettingControl` in `GUI/src/contracts/user-config.ts` has six kinds (number, string, boolean, choice, theme,
   json) — measured at plan time, re-verify.
7. `pluginKeys()` in `GUI/src/shared/plugin-manifests.ts` passes no `remaps`, and `PluginKeys` in
   `GUI/src/contracts/plugin.ts` has no `remaps` field: `grep -n "remaps" GUI/src/contracts/plugin.ts` prints nothing.
8. Forms has no main exports and settings has no page exports today:
   `grep -n "FormsMainExports\|formsMainKey" GUI/src/plugins/forms/contract.ts` and
   `grep -n "SettingsPageExports\|settingsPageKey" GUI/src/plugins/settings/contract.ts` print nothing.
9. Retro keeps its own action table: `grep -n "ORIGIN_ACTION_LABELS" MKT/plugins/wigley/scripts/retro/answers.py`
   prints its definition (line 48), its two reads (266, 284) and the docstring mention (line 10).
10. Two types share the name `FormsView`: the union in `src/plugins/forms/contract.ts` and the interface in
    `src/plugins/forms/page/forms-view.ts`; `viewChanged` has no listener outside forms:
    `grep -rn "viewChanged" GUI/src --include='*.ts' | grep -v "plugins/forms/"` prints nothing.

## Docs written ahead

- `docs/features/plugin-framework/design.md` § Extension points (Lane E), commit `cdc8e91ff`.

Every other doc — `AGENTS.md`, `docs/keymap.md`, the settings, visuals and layouts design docs, the marketplace's
forms README and `triage.md`, and `~/wigley-agents/forms.md` — is written by the task that lands its behaviour
(task 09 for the marketplace and `forms.md`) or by task 11 for `AGENTS.md` and the repo's docs. Those docs are read by
sessions running beside this plan (Lanes H, L and P), and by every agent sending a round, so text written ahead would
describe registrations and a tool contract that do not exist yet.

## Mandatory Reads

- `AGENTS.md` (the wigley-ai-gui folder's), sections by task: § Intent and § Architecture for every task; "A registration", "A plugin",
  "A plugin talks", "A disabled plugin" and the `npm run lint` layer rules for every task; "A key" for 03; "A setting",
  "The user config folder" and "A layout" for 04 and 05; "An item kind", "A finding origin", "A forms layout" and "An
  MCP tool" for 06–10; § Running and testing for 12.
- `DESIGN.md` for 04, 05 and any task that changes a view or CSS.
- `docs/keymap.md` for 03.
- `docs/features/plugin-framework/design.md` § Extension points (Lane E) for every task.
- `docs/features/layouts/design.md` for 04, 05, 07, 08.
- `docs/features/settings/design.md` for 04, 05.
- `docs/features/visuals/design.md` (fence registry) for 01.
- `MKT/AGENTS.md` and `MKT/plugins/wigley/scripts/forms/README.md` for 08 and 09.
- The wigley-ai-gui folder has no `.claude/rules/` folder and no `CLAUDE*.md` (checked at plan time).

## Design Overview

```
 markdown-blocks plugin ──addBlock──► MarkdownRenderer (adapter owns :::name, close, nesting)
        ▲ page dependsOn: forms, chat (switch locks it on)

 EditorHost.defineEx(name, prefix, handler(editor, {argString, bang})) ──► Vim.defineEx
        host registers :w :q :wq :x through it → per-editor DocumentEditorEvents (unchanged)

 manifest keys.remaps ──► keymap merge (layer under the user's keymap.json)

 manifest settingControls {path: kindId} ──► main settingControl() → SettingLeaf.control.kind (string)
 settings page export addControlKind({id, text, edit}) ──► Settings rows + layout `settingRow` (control: string)
        built-in six kinds + `layout` (names from UserConfigRead.layoutNames) register the same way

 forms main export registerKind(MainItemKind) ──► parse · schema (tool contribution) · fingerprint · wire keys
 forms page export registerKind(PageKind)     ──► restore · reduce · boxes · card input · rail order
 forms main+page export registerFindingOrigin(FindingOriginSpec) ──► parser · tool text · card · chip
        built-in kinds and origins register through the same calls in forms' own start
 saved round finding_answers[].action_label, recommend_action_label ──► retro answers.py (no ORIGIN_ACTION_LABELS)
```

**Decisions** (each settled in the interview; reasons in the design doc):

- The adapter owns `:::name` syntax; a block renders its inside to HTML through helpers.
- `:::changes`, `:::tree`, `:::details` move to the built-in `markdown-blocks` plugin; forms and chat depend on it.
- `defineEx` hands the handler its editor; `:w`/`:q` stay per-editor events.
- Manifest remaps take `{ mode, keys, to }`; a later layer wins, as binds do.
- A setting's control kind is a string; the manifest binds paths to kinds; the page registers each kind; main
  registers nothing and keeps checking values by each default's shape.
- One `settingRow` layout part with `control: string`.
- Unknown layout names in `settings.json` stay valid.
- Forms kinds register per process, tied by id; built-ins use the same calls; saved files stay byte-identical,
  pinned by a fixed-hash test; rounds hold a record by kind inside and convert at the edge; `LayoutCards` keeps its
  three named cards and gains a string-keyed record.
- Finding origins register through `registerFindingOrigin`; card, origin, action and severity are strings in the
  layout contract.
- `finding_answers[].action_label` and `recommend_action_label` carry the card's action words.
- A disabled plugin's remaps leave the served keymap, as its binds do; a paused plugin keeps them.
- `proof` is required on `nit` alone; an omitted proof is left out of the fingerprint; a proof off a Nit is accepted.
- The screen union is `FormsScreen`; the `viewChanged` event keeps its name.
- Followups removal and master-plan ticks land in task 11 in one commit, not per task: tasks in one wave may not share
  a file.

**Out of scope:** the command palette and fuzzy finders (planned in its own session); every Lane H, L and P item.

## File Structure

Names and types more than one task uses. A task's own internals are its document's.

**Markdown and editor (01 then 02: both edit `src/shared/plugin-service-views.ts`, the part harness and its test, and `src/renderer/plugins/page-api.test.ts`)**

- `src/contracts/markdown.ts`: `MarkdownRenderer.addBlock(block: BlockContribution): Disposable`;
  `interface BlockContribution { name: string; render(block: MarkdownBlock, helpers: BlockHelpers): string }`;
  `interface MarkdownBlock { header: string; body: readonly string[] }`;
  `interface BlockHelpers { block(text: string): string; inline(text: string): string; escape(text: string): string }`.
- New plugin `src/plugins/markdown-blocks/` (manifest, `page/`), listed in `src/plugins/manifests.ts` and
  `src/plugins/page.ts`. It has no `contract.ts` and no exports: forms and chat name it in `dependsOn.page` only.

- `src/contracts/editor.ts`: `EditorHost.defineEx(name: string, prefix: string, handler: ExHandler): Disposable`;
  `type ExHandler = (editor: TextEditor, command: ExCall) => void`; `interface ExCall { argString: string; bang: boolean }`.

**Manifests (03, 04, 05 share `src/contracts/plugin.ts` and the manifest checks, so they run in sequence)**

- `PluginKeys.remaps?: readonly EditorRemap[]` (03). `jsonKind` and `JsonKind` move from `src/main/config/config-json.ts`
  to `src/shared/json.ts` (03), since the shared remap check in `src/shared/keymap-entries.ts` needs them.
- `PluginManifest.settingControls?: Readonly<Record<string, string>>`: a setting's dotted path (as `settingInfo`
  names it) to its control kind id (04). The core's own map is `settingControls` beside `settingInfo` in
  `src/config/settings.ts` (04 adds it empty; 05 makes it `{ 'shell.layout': 'layout' }`).
- `src/contracts/user-config.ts`: `SettingControl` becomes `{ kind: string; choices: readonly string[] | null }`
  (04); `UserConfigRead.layoutNames: Readonly<Record<string, readonly string[]>>`, keyed by layout owner (05).
- `src/plugins/settings/contract.ts`: `SettingsPageExports { addControlKind(kind: SettingControlKind): Disposable }`,
  `settingsPageKey`, `SettingControlKind { id; text(value); edit: SettingKindEditor }`, `SettingKindEditor` (a box
  or a picker) and `SettingKindRead { leaf; config: UserConfigRead }` (04). The built-in kinds are
  `BUILT_IN_CONTROL_KINDS` in `src/plugins/settings/page/built-in-control-kinds.ts` (04); the layout picker joins it
  as kind id `layout` (05).
- `src/main/main.ts` is edited by 03 (only if the remap layering needs it), 04 and 05, in different waves.

**Forms (06 → 07 → 08 → 10; each shares `src/plugins/forms/contract.ts`)**

- `src/plugins/forms/item-kinds.ts` (06): `BUILT_IN_KIND_SPECS: Readonly<Record<BuiltInItemKind, ItemKindSpec>>`, the
  built-in specs both processes read.
- `main/round.ts` (06): `KindRound extends Round { items }`, the record by kind main reads while the page still
  reads the named lists. 07 moves `items` into the contract `Round`, drops `questions`, `notices` and `findings`, and
  folds `KindRound` away. `FormBody` and `AnswersPayload` keep their named members plus an index signature: each
  kind's list sits at its `bodyKey` or `resultKey` (06), the shape the store saves. The contract `Round` gains
  `bodyKeys: Readonly<Record<ItemKind, string>>` (07, filled in `parseRound`, not hashed), so the page can write back
  a kind it has no registration for.

- `src/plugins/forms/contract.ts`:
  - `type BuiltInItemKind = 'notice' | 'finding' | 'question'` (06). `type ItemKind` stays that union in 06 (the
    page's mapped types need it closed) and becomes `string` in 07.
  - `interface ItemKindSpec { id: string; argsKey: string; bodyKey: string; resultKey: string;
    fingerprintJoinsWhenEmpty: boolean; answerable: boolean }` — the wire keys, data both processes register (06).
  - `interface MainItemKind` (06) and `interface PageKind` (07): each process's registration, carrying the
    `ItemKindSpec` it registers as `spec`. `PageKind` has these members, by these names: `spec`, `restore` (draft
    entry codec), `reduce` (answer updates), `boxes`, `cardInput`, `railOrder`; 07 pins their signatures, and 10
    consumes `reduce`, `restore` and `railOrder`.
  - `RoundState` (07) holds `kinds: PageKindTable`, `itemAnswers` and `heldEntries` in place of `answers`,
    `findingAnswers` and `noticeComments`; `chooseEntry`, `clearFindingPick` and `holdsPick` stay exported from
    `form-state.ts` in 07 and 08, and move to `page/kinds/finding/finding-answer.ts` in 10.
- File ownership across waves: `src/plugins/forms/manifest.ts` and `src/plugins/chat/manifest.ts` are 01's in
  Wave 1 (page `dependsOn`) and 05's in Wave 3 (`settingControls`); 08 does not edit them.
  `src/plugins/settings/page/row-box.ts` is edited by no task. `round-view.test.ts` and `forms-view.test.ts` are
  edited by 07 Part A (W2), 02 (W3, its `EditorHost` fakes), 08 (W4) and 10 (W5); 01 (W1) edits `round-view.test.ts`
  only.
  - `interface FormsMainExports { registerKind(kind: MainItemKind): Disposable;
    registerFindingOrigin(spec: FindingOriginSpec): Disposable }` and `formsMainKey` (06 adds the type with
    `registerKind`; 08 adds `registerFindingOrigin`).
  - `FormsPageExports` gains `registerKind(kind: PageKind): Disposable` (07) and
    `registerFindingOrigin(spec: FindingOriginSpec): Disposable` (08).
  - `interface FindingOriginSpec` (08): one data record per origin, registered unchanged in both processes.
  - `type FormsScreen = 'forms' | 'review' | 'confirm' | 'idle'` (10), renamed from the union `FormsView`.
- Saved-round answer entry: each `finding_answers` entry gains `action_label: string` (the card's word for the
  picked action, `''` for none) and `recommend_action_label: string` (the card's word for `recommend_action`) — 08
  writes both, 09 reads both. `FindingCard` in `layout.d.ts` gains `originToken: string` (08).
- `src/plugins/forms/page/` modules after 10: `round-model.ts` (shared round types and the rail), `round-answers.ts`
  (answer reads and writes), `round-draft.ts` (`buildBody`, `restoreRound`), `kinds/finding/finding-answer.ts`
  (finding pick rules), and `form-state.ts` (the reducer and store).
- Built-in kinds register from `src/plugins/forms/main/kinds/` (06) and `src/plugins/forms/page/kinds/` (07);
  built-in origins from the spec list in `src/plugins/forms/finding-origins.ts` (08).

**Boundary rules**

- Another plugin reaches a registration only through `contract.ts` and a dependency key, per AGENTS.md "A plugin
  talks"; every type a registration takes lives in the owner's `contract.ts` or `src/contracts/`.
- Every registration returns a `Disposable` and is filed with `consumer.track` when it comes through `exports`.
- No task edits `docs/features/followups.md` or `master-plan.md` but task 11.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Markdown block contributions](01-markdown-blocks.md)
- [x] [Plugin editor remaps](03-plugin-remaps.md)
- [ ] [Forms item kinds register in main](06-forms-kinds-main.md) — gated: Lane H's Structured round results

### Wave 2
- [x] [Setting control kinds as registrations](04-setting-control-kinds.md) — after 03
- [ ] [Forms item kinds register on the page, Part A](07-forms-kinds-page.md) — after 06; Part A as its rulings
  define it (the tree compiles after it)

### Wave 3
- [ ] [EditorHost.defineEx](02-define-ex.md) — after 01; after 07 Part A (both edit `round-view.test.ts` and `forms-view.test.ts`)
- [ ] [Layout name picker in Settings mode](05-layout-name-picker.md) — after 04
- [ ] [Forms item kinds register on the page, Part B](07-forms-kinds-page.md) — after 07 Part A; the B-tagged files

### Wave 4
- [ ] [Finding origin specs, open layout unions, proof off a Nit](08-finding-origins.md) — after 07 Part B

### Wave 5
- [ ] [Retro reads action words; proof text in the marketplace and forms.md](09-retro-and-proof-text.md) — after 08
- [ ] [Split form-state.ts and rename the screen union](10-split-form-state.md) — after 08

### Wave 6
- [ ] [Agent docs and the design re-read](11-docs.md) — after 01–10

### Wave 7
- [ ] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: 6df66e9240a22bd1da246c98f3c1070378bc37e8

### Groups
- 01 · hard · 109860c7e · diff read: every Produces present (addBlock, BlockContribution, MarkdownBlock, BlockHelpers, trackedMarkdown addBlock, harness blocks, manifest, page part, three blocks); wave typecheck and lint pass · concerns: md.block.parse of a render's non-body block() text is unbounded by maxNesting, so a render nesting its own opener recurses to a stack overflow; CSS now loads from the plugin (source order vs markdown.css changed, no specificity clash found); throwing render drops the closer line; > insert before a self-closing tag
- 03 · hard · 17b32869b · diff read: PluginKeys.remaps, readEditorRemap and the moved checks, jsonKind in shared/json.ts, appliedRemaps in served(); wave typecheck and lint pass after the lead ran oxfmt on validate-manifest.ts (KEYS_FIELDS fits one line) · concerns: served() pairs store.checks() admission with store.current() config, set in one rebuild; the user-wins merge row uses <Esc> like the default, so only the first row tells plugin-dropped apart
- 04 · hard · 30d911ed3 · diff read: every Produces present (SettingControl {kind; choices}, settingControls on manifest/definePlugin/schema/validate, pluginSettingControls, SettingControlKind/SettingsPageExports/settingsPageKey, control-kinds registry, BUILT_IN_CONTROL_KINDS, controlKindsChanged); typecheck + lint pass after one same-rung compile fix (controlKind missing from RowContext literals in keymap-view.test.ts and leader-menu-view.test.ts) · concerns: core settingControls Partial<Record<SettingPath,string>> passed as Record<string,string> (typecheck accepts); controlKindsChanged before load relies on drawRows' early return; its before-load test row proves only harmlessness
### Contract changes
- appliedRemaps(defaults): Keymap → DefaultKeymap · why: the defaults served() has (checks().deps.defaultKeymap) are a DefaultKeymap; the merged Keymap already holds plugin remaps · consumers: 03, 11, 12 · group 03
### Rulings
- FindingOriginSpec.words.finding stays in the spec, the register check and FindingCard.words, though the default layout (since 360fec02a) draws the finding text unlabelled — the user chose it (round 2026-11-16): the layout contract carries it and user layouts may draw it — one unused string per origin · user
- A throwing render draws one md_block_html of escaped <p> lines from the opener to before the close line, with no line marks — an inline token would render markdown — group 01 · group 01
- Markers split on the NUL string, not a regex (oxlint no-control-regex) — a stray NUL in render HTML would misalign parts — group 01 · group 01
- The block rule is named contributed_blocks; the :::changes header row sits in markdown-blocks.test.ts — none — group 01 · group 01
- appliedRemaps orders all manifests by dependencyOrder, drops the disabled, then lays defaultKeyLayers — matches mergeKeymap's order — group 03 · group 03
- ConfigStore.userRemaps() returns the kept keymap slice's remaps — a broken keymap.json serves its last good remaps, as binds do — group 03 · group 03
- 04: controlKindsChanged redraws the open section and relies on drawRows' early return before load; the onChanged listener in start.ts is not filed with api (the registry goes with the part) · group 04
### Review rounds
### Test gate
