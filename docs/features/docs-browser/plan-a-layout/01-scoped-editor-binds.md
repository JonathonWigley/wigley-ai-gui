# 01 — Scoped editor binds

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/keymap.ts` (`EditorBind.scope`; `PendingKeys` editor variant gains `scope`)
- modify `src/contracts/plugin.ts` (`PluginKeys.editor` entries gain `scope`)
- modify `src/contracts/editor.ts` (`CreateEditorHost`'s `run`)
- modify `src/shared/plugin-manifests.ts` · test `src/shared/plugin-manifests.test.ts`
- modify `src/renderer/key-sequences.ts` (export `firesIn`)
- create `src/renderer/editor-binds.ts` · test `src/renderer/editor-binds.test.ts`
- modify `src/renderer/codemirror-vim/codemirror-vim-host.ts`
- modify `src/renderer/codemirror-vim/ex-command-name.ts` · test `src/renderer/codemirror-vim/ex-command-name.test.ts`
- modify `src/renderer/pending-keys.ts` · test `src/renderer/pending-keys.test.ts`
- modify `src/renderer/renderer.ts`
- modify `src/plugins/keys/page/help-sections.ts`, `key-bar.ts`, `which-key.ts` · test `help-sections.test.ts`,
  `key-bar.test.ts`, `which-key.test.ts` (same folder)
- test `src/shared/key-hints.test.ts` (its editor bind fixtures gain `scope: 'any'`; expectations unchanged)
- modify `src/plugins/forms/manifest.ts` · test `src/plugins/forms/manifest.test.ts`
- modify `src/plugins/sessions/manifest.ts`, `src/plugins/keys/manifest.ts`

Consumes: members already in the tree — `ViewScope`, `qualify`, `withLeader` / `vimTokens` (`src/shared/key-hints.ts`),
`createScopeStack().current()`, `CommandRegistry.run`.

Produces:
- `export interface EditorBind { keys: string; scope: ViewScope; command: CommandId; }` in `src/contracts/keymap.ts`
- `PendingKeys` in `src/contracts/keymap.ts`:
  `| { where: 'page'; keys: string[]; scope: ViewScope } | { where: 'editor'; keys: string[]; scope: ViewScope }`
- `PluginKeys.editor: { keys: string; scope: S | 'any'; command: PageC }[]` in `src/contracts/plugin.ts`
- in `src/contracts/editor.ts`:
  ```ts
  export type CreateEditorHost = (
    keymap: EditorKeymap,
    run: (binds: EditorBind[], editor: TextEditor) => void,
  ) => EditorHost;
  ```
- `export function firesIn(bind: { scope: ViewScope }, scope: ViewScope): boolean` in `src/renderer/key-sequences.ts`
- in `src/renderer/editor-binds.ts`:
  `export function requireUnambiguousEditorBinds(binds: EditorBind[], leader: string): void`
  `export type EditorBindChoice = { kind: 'run'; bind: EditorBind } | { kind: 'none'; message: string };`
  `export function editorBindInForce(binds: EditorBind[], scope: ViewScope): EditorBindChoice`
- `export function exBindName(index: number): string` in `src/renderer/codemirror-vim/ex-command-name.ts`, replacing
  `exCommandName`
- `PendingSources` in `src/renderer/pending-keys.ts` gains `scope(): ViewScope`

Decisions:
- An editor bind carries a scope as a page bind does: `S | 'any'` in a manifest; `mergeKeymap` qualifies it as
  `<pluginId>.<scope>` and keeps `any` unqualified, the rule `qualifiedPageBinds` holds today. Core editor binds
  (`src/config/keymap.ts`, `binds: []` today) write a qualified scope or `any`. (plan.md Decisions; design.md § Core
  services and seams.)
- One vim mapping per distinct key sequence. The host groups `keymap.binds` by their keys with `<Leader>` spelled
  (`withLeader`), in keymap order of first appearance; group `i` maps `nnoremap <keys> :<exBindName(i)><CR>` and
  defines that ex command, which calls `run(group's binds in keymap order, the editor it fired in)`. The host no
  longer names a command, so the "share the ex name" throw goes. (plan.md Decisions, File Structure.)
- `exBindName(index)` is `wigleybind` followed by each decimal digit of `index` spelled with the existing digit
  words: `0` → `wigleybindzero`, `12` → `wigleybindonetwo`. Ex names stay letters only, and the `wigleybind` stem
  matches no vim ex command. (Drafter's decision.)
- The bind is picked in `editor-binds.ts`, so a unit test pins the choice and its message:
  `editorBindInForce(binds, scope)` returns `{ kind: 'run', bind }` for the first bind in `binds` for which
  `firesIn(bind, scope)` holds — `firesIn` is the page keys' own rule in `src/renderer/key-sequences.ts`
  (`bind.scope === 'any' || bind.scope === scope`), exported and used by both — else
  `{ kind: 'none', message: \`${binds[0].keys} has no bind in ${scope}\` }`, e.g.
  `<Leader>x has no bind in keys.help`. The composition root calls it with `scopeStack.current()`: `run` →
  `commands.run(bind.command, { editor })`; `none` → `log('page', message)` and nothing runs. (plan.md Decisions:
  "none in force → nothing runs".)
- A key sequence bound in any scope is taken from vim in every editor, so outside its scopes it runs nothing and vim's
  own meaning of those keys is gone. (Consequence of one global vim mapping; the core's editor keymap is global to
  the engine today.)
- `renderer.ts` builds `scopeStack` before the editor host (today it is built after), and calls
  `requireUnambiguousEditorBinds(keymap.editor.binds, keymap.editor.leader)` before `createCodeMirrorVimHost`, so a
  bad keymap fails start.
- `requireUnambiguousEditorBinds` throws on (a) two binds with the same keys (leader spelled) whose scopes overlap
  (either `any`, or equal), message
  `Editor binds "<keys>" [<scope>] <command> and "<keys>" [<scope>] <command> share a scope`; and (b) a bind whose
  key tokens (`vimTokens`) begin a different bind's longer tokens, in any scopes, message
  `Editor bind "<keys>" <command> begins "<keys>" <command>; vim runs the shorter at once`. (b) holds because vim
  maps are global and the engine runs a complete map without waiting (the comment on `vimrcLines` today).
- Forms' editor binds keep firing in every scope a forms box can hold focus in today: `forms` and `review`. Measured
  at plan time, re-verify: `shownBoxes` in `src/plugins/forms/page/boxes.ts` gives boxes only in the `forms` view
  (item boxes) and the `review` view (the round note); in `confirm` and `idle` it gives none and `mountFormsView`'s
  render leaves a box not shown; help (`keys.help`) blurs the box (`toggleHelp` calls `context.editor?.blur()`). The
  forms manifest writes each editor bind once per scope in `['forms', 'review']`: every bind of today's list with
  scope `forms`, in today's order, then the same list with scope `review`. (plan.md Decisions.)
- Sessions' `<Leader>;` → `closeTab` and keys' `<Leader>?` → `toggleHelp` take scope `any`.
- Pending editor keys carry the scope in force when vim reports them: `createPendingKeys` reads
  `sources.scope()` (renderer passes `() => scopeStack.current()`) and reports
  `{ where: 'editor', keys, scope }`.
- Key hints by scope (keys plugin; the binding answer to "which scope's editor binds each shows"):
  - **Help** (`helpSections`): for each scope in `scopes` order, the page section titled `info.title` as today,
    then at once an editor section titled `` `${info.title}, in a text box` `` (e.g. `In the form, in a text box`,
    `Everywhere, in a text box`) holding `editorHints` of the editor binds whose scope is exactly `info.id`. Then
    `Remaps in a text box`, `App chords`, `System-wide chords` as today. The old single section
    `In a text box (vim normal mode)` goes. Empty sections are left out, as today.
  - **Key bar** (`barHints`) in a box: the editor binds that fire in `scope` (its scope equals `scope`, or is
    `any`), leaving out leader sequences as today.
  - **Which-key** (`whichKeyModel`) for `where: 'editor'`: candidates are the editor binds firing in
    `pending.scope` (equal or `any`), keymap order, as the page branch filters page binds.
  The keys plugin cannot import `src/renderer`, so it writes the `=== scope || === 'any'` filter itself, as
  `pageHints` and `bindsFor` do today.

GIVEN forms binds `<Esc>` → `forms.leaveBox` in `forms.forms` and `forms.review` WHEN Esc fires in a box while the
scope is `forms.review` THEN `forms.leaveBox` runs with that box's editor.
GIVEN an editor bind on `<Leader>x` only in `forms.forms` WHEN it fires while the scope is `keys.help` THEN nothing
runs and the page logs `<Leader>x has no bind in keys.help`.
GIVEN binds `<Leader>d` [a.x] and `<Leader>dd` [b.y] WHEN the renderer starts THEN start fails naming both.

Tests:
- `src/shared/plugin-manifests.test.ts`: fixture plugin `p`'s editor bind becomes
  `{ keys: '<Leader>g', scope: 'view', command: 'go' }`; the merge test expects
  `{ keys: '<Leader>g', scope: 'p.view', command: 'p.go' }`. New `keeps an editor bind's any scope unqualified`:
  `{ keys: '<Leader>h', scope: 'any', command: 'go' }` merges to `{ keys: '<Leader>h', scope: 'any', command: 'p.go' }`.
  The core fixture's editor bind gains `scope: 'any'`.
- `src/renderer/editor-binds.test.ts` (new), each building its own binds:
  - `editorBindInForce picks the bind whose scope is in force` — binds `[{ '<Esc>', 'a.one', 'a.leave' },
    { '<Esc>', 'b.two', 'b.close' }]`, scope `b.two` → `{ kind: 'run', bind: <the b.close bind> }`.
  - `editorBindInForce takes an any bind in every scope` — `[{ '<Leader>?', 'any', 'k.help' }]`, scope `z.q` →
    `{ kind: 'run', bind: <it> }`.
  - `editorBindInForce names the keys and scope when no bind is in force` —
    `[{ '<Leader>x', 'forms.forms', 'forms.toggleNotApplicable' }]`, scope `keys.help` →
    `{ kind: 'none', message: '<Leader>x has no bind in keys.help' }`.
  - `requireUnambiguousEditorBinds rejects the same keys in one scope, naming both` — two `<Leader>x` binds in
    `a.one` → throws containing `a.x` and `a.y`.
  - `requireUnambiguousEditorBinds rejects an any bind sharing keys with a scoped one` — `<Esc>` [any] and `<Esc>`
    [a.one] → throws.
  - `requireUnambiguousEditorBinds rejects keys that begin a longer bind in another scope` — `<Leader>d` [a.one],
    `<Leader>dd` [b.two] → throws containing `vim runs the shorter at once`.
  - `requireUnambiguousEditorBinds accepts the same keys in different scopes` — `<Esc>` [a.one], `<Esc>` [a.two] →
    no throw.
  - `requireUnambiguousEditorBinds compares keys with the leader spelled` — leader `<Space>`, `<Leader>x` [a.one]
    and `<Space>x` [a.one] → throws.
- `src/renderer/codemirror-vim/ex-command-name.test.ts` rewritten for `exBindName`: `0` → `wigleybindzero`;
  `12` → `wigleybindonetwo`; `2` and `3` differ; the result matches `/^[a-z]+$/`.
- `src/renderer/pending-keys.test.ts`: the fake sources gain `scope: () => 'forms.forms'`; the editor report test
  expects `[{ where: 'editor', keys: ['<Space>', 'a'], scope: 'forms.forms' }]`.
- `src/plugins/keys/page/help-sections.test.ts`: `lists each scope's editor binds after its page binds` — keymap
  with page bind `j` [`a.view`] and editor binds `<Leader>x` [`a.view`] and `<Leader>?` [`any`], scopes
  `[{ id: 'a.view', title: 'In the view' }, { id: 'any', title: 'Everywhere' }]` → section titles in order
  `In the view`, `In the view, in a text box`, `Everywhere, in a text box`; no section titled
  `In a text box (vim normal mode)`.
- `src/plugins/keys/page/key-bar.test.ts`: `lists in a box only the editor binds firing in the scope` — editor binds
  `<Esc>` [`a.view`] → `a.leave`, `x` [`b.other`] → `b.x`, `q` [`any`] → `c.q`; scope `a.view`, in a box → hints
  for `a.leave` and `c.q` only.
- `src/plugins/keys/page/which-key.test.ts`: `lists in a box only the editor binds firing in the pending scope` —
  editor binds `<Leader>x` [`a.view`] and `<Leader>y` [`b.other`], pending
  `{ where: 'editor', keys: ['<Space>'], scope: 'a.view' }` → one entry, `x`. The existing editor case
  (`{ where: 'editor', keys: ['<Space>'] }`) gains `scope` and binds `any` so it keeps its expectation.
- `src/plugins/forms/manifest.test.ts`: `EXPECTED_EDITOR` becomes today's list with `scope: 'forms.forms'`, then the
  same list with `scope: 'forms.review'`.
- The live proof that forms' editor binds still fire in `review` (Esc in the round note) and in `forms` is task 06's
  self-test; the editor host's vim wiring has no unit test, as today.

Done when: `npm run typecheck`, `npm test`, `npm run lint` pass; `grep -n "exCommandName" -r src` finds nothing;
`grep -n "scope: ViewScope" src/contracts/keymap.ts` shows `EditorBind`'s field.
Commit: one commit for the group.

## Proof

