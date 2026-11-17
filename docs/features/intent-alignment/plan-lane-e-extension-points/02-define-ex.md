# 02 — EditorHost.defineEx

Status: in progress
Type: Task
Wave: 3 · Depends on: 01, 07 Part A
Plan: [plan.md](plan.md)

Files:
- modify `src/contracts/editor.ts`
- modify `src/renderer/codemirror-vim/codemirror-vim-host.ts`
- modify `src/renderer/codemirror-vim/document-ex-commands.ts`
- test `src/renderer/codemirror-vim/document-ex-commands.test.ts`
- create `src/renderer/codemirror-vim/ex-definitions.ts`
- test (create) `src/renderer/codemirror-vim/ex-definitions.test.ts`
- modify `src/shared/plugin-service-views.ts`
- modify `src/shared/plugin-part-harness.test-support.ts` (`countingEditors`)
- test `src/shared/plugin-part-harness.test.ts`
- test `src/renderer/plugins/page-api.test.ts`
- test `src/shared/page/editor-boxes.test.ts`, `src/plugins/forms/page/round-view.test.ts`,
  `src/plugins/forms/page/forms-view.test.ts`, `src/plugins/primer/page/primer-view.test.ts`, `src/plugins/audio-picker/page/picker-view.test.ts` (their
  `EditorHost` literals only)

The three document-editor consumers do not change: `src/plugins/docs/page/doc-view.ts`,
`src/plugins/practice/page/problem-workspace.ts` and `src/plugins/settings/page/row-box.ts` keep their `write`,
`quit` and `writeQuit` handlers.

Consumes: 01's edits to `src/shared/plugin-service-views.ts` and `src/shared/plugin-part-harness.test-support.ts`
(this task builds on them; it uses none of 01's Produces). The tree holds `DocumentEditorEvents`, `TextEditor`,
`trackedEditor`, `countingEditors`, `exBindName` and `hostedEntryOf`.

Produces:
- In `src/contracts/editor.ts`:
  - `EditorHost.defineEx(name: string, prefix: string, handler: ExHandler): Disposable`
  - `export type ExHandler = (editor: TextEditor, command: ExCall) => void`
  - `export interface ExCall { argString: string; bang: boolean }`
- In `src/renderer/codemirror-vim/document-ex-commands.ts`:
  - `export interface DocumentCommand { name: string; prefix: string; raise(events: DocumentEditorEvents, command: ExCall): void }`
  - `export const DOCUMENT_COMMANDS: readonly DocumentCommand[]`
- In `src/renderer/codemirror-vim/ex-definitions.ts`:
  - `export function exCallOf(argString: string | undefined): ExCall`
  - `export function exDefinitionProblem(name: string, prefix: string, defined: ReadonlySet<string>): string | null`
- In `src/shared/plugin-service-views.ts`: `trackedEditor` returns a view whose `defineEx` files each definition with
  `registrations.track`.
- In `src/shared/plugin-part-harness.test-support.ts`: `countingEditors()` returns `exCommands: () => number`, the count
  of live definitions.

## Decisions

Settled in the interview (`docs/features/plugin-framework/design.md` § Extension points (Lane E)):

- `defineEx(name, prefix, handler)` returns a `Disposable`. The handler gets the editor the command ran in, and
  `{ argString, bang }`.
- `:w`, `:q`, `:wq` and `:x` register through `defineEx` inside the host. They still raise the per-editor
  `DocumentEditorEvents`. Reason: docs, Practice and Settings each bind `:w` to their own editor.

Settled in this plan:

- **Scope of a definition.** The vim engine's ex commands are global. Thus a definition runs in every editor this host
  created or will create, boxes and document editors alike. The host finds the editor with `hostedEntryOf(cm, hosted)`
  and hands its `editor` to the handler. That object is the same one `create` or `createDocument` returned to the
  plugin, because `trackedEditor` returns the host's own object (it only swaps `destroy`).
- **ExCall.** `exCallOf` reads vim's `params.argString`, as `documentExEvent` reads it today ("vim reads `:q!` as `q`
  with `!` after it"):
  - `text` is `(argString ?? '')` with its leading whitespace removed.
  - `bang` is `text.startsWith('!')`.
  - `argString` is `text` without that one `!` when `bang` is true, then trimmed.
- **Name rules.** `exDefinitionProblem` returns the first problem in this order, or null. `defineEx` throws it as an
  `Error` before it touches the engine:
  1. `ex command name "<name>" must be letters only` — `name` does not match `/^[A-Za-z]+$/`. Vim ex command names
     are letters only (see `exBindName`).
  2. `ex command name "<name>" is reserved for key binds` — `name` starts with `wigleybind`, the prefix of
     `exBindName`.
  3. `ex command prefix "<prefix>" must be a non-empty start of "<name>"` — `prefix` is empty or `name` does not start
     with it.
  4. `ex command <name> is already defined` — `defined` holds `name`.
- **The host's registry.** The host keeps a `Map` from name to the live definition. `defineEx` checks the problem,
  saves the engine's current command for `name` (vim's own command, or none), calls `Vim.defineEx(name, prefix, …)`,
  and puts the definition in the map. The engine callback calls the handler. When the handler throws, the host
  catches it and logs `ex command <name> failed: <errorText(error)>` through `log('editor', …)`, with `errorText` from
  `src/shared/error-text.ts`.
- **Dispose restores the prior command.** The `Disposable` acts once, and only while the map still holds that same
  definition. It removes the map entry and gives the engine back the command it held before. After the dispose, `:name`
  does what it did before the `defineEx`: vim's own command, or vim's message for an unknown command when there was
  none. `@replit/codemirror-vim` has no known undefine call. Read the installed version's own source (its `defineEx` and
  the table that holds ex commands) or its published docs to find how to restore a prior entry. Do not assume an API.
  Name the version you read in a comment beside the restore. When the engine gives no way to restore, stop and report
  this as a concern. Do not ship a dispose that leaves the plugin's command live.
- **The document commands.** `DOCUMENT_COMMANDS` replaces `DOCUMENT_EX_COMMANDS`, `DocumentExEvent` and
  `documentExEvent`. It holds, in this order:
  - `{ name: 'write', prefix: 'w' }`, whose `raise` calls `events.write()`
  - `{ name: 'quit', prefix: 'q' }`, whose `raise` calls `events.quit(command.bang)`
  - `{ name: 'wq', prefix: 'wq' }`, whose `raise` calls `events.writeQuit()`
  - `{ name: 'xit', prefix: 'x' }`, whose `raise` calls `events.writeQuit()`

  Keep the comment that says why `wq` needs its own entry. A bang on `wq` and `xit` is ignored, as today.
- **Host wiring.** `HostedEditor.answerEx` becomes `documentEvents?: DocumentEditorEvents`. `createDocument` puts the
  editor's `events` there, and `create` leaves it unset. In place of `defineDocumentExCommands(hosted)`, the host calls
  its own `defineEx` once for each `DOCUMENT_COMMANDS` entry, at the same point in `createCodeMirrorVimHost`. Each
  handler finds the entry whose `editor` is the one it got, and calls `command.raise(entry.documentEvents, call)` when
  `documentEvents` is set. In a box it does nothing, as today. Remove `raiseDocumentEx` and `defineDocumentExCommands`.
  The host never disposes these four definitions. Thus a plugin's `defineEx('write', …)` throws
  `ex command write is already defined`.
- **The bind commands do not change.** `defineBindCommands` keeps its direct `Vim.defineEx(name, name, …)` for each
  key-bind group (near line 152 at plan time, measured at plan time, re-verify). Reason: those names are the host's
  own. `setKeymap` defines them again over the old ones, and a registration would throw on that. Rule 2 above keeps a
  plugin off their names.
- **Per-plugin view.** `trackedEditor` adds
  `defineEx: (name, prefix, handler) => registrations.track(editor.defineEx(name, prefix, handler))`. Its comment
  gains: a plugin's ex commands are removed when it stops.
- **Contract comment.** Above `defineEx` in `EditorHost`, write: it defines `:name` in every editor this host created
  or will create; vim runs it when the typed name is a start of `name` no shorter than `prefix`; the handler hears the
  editor it ran in; it throws on a name defined already (`write`, `quit`, `wq` and `xit` among them) and on a name that
  is not letters only; the `Disposable` gives back the command the name had before. The comment above
  `DocumentEditorEvents` stays true; do not change it.
- **Test fakes.** Every literal the compiler types as `EditorHost` that lacks `defineEx` gets
  `defineEx: () => ({ dispose() {} })`. At plan time these were `src/shared/page/editor-boxes.test.ts` (near line 34),
  `src/plugins/forms/page/round-view.test.ts` (near line 39), `src/plugins/forms/page/forms-view.test.ts` (near line 33),
  `src/plugins/primer/page/primer-view.test.ts` (near line 58) and `src/plugins/audio-picker/page/picker-view.test.ts`
  (`fakeHost`, near line 51) (measured at plan time, re-verify with
  `npm run typecheck`). Fakes cast with `as unknown as EditorHost` need no change. In `countingEditors`, `defineEx`
  adds 1 to a live count and returns a handle whose first `dispose` takes 1 away; `exCommands()` reads the count.

**Rulings from the plan's cold read:**

- **A shared prefix.** `defineEx` rejects a prefix that another live definition from `defineEx` holds, with a fifth
  `exDefinitionProblem` message: `ex command <name>: prefix <prefix> is already defined by <other>` (one more test
  row). A prefix that shadows one of vim's own commands (`'s'`) is allowed; the dispose brings vim's back.
- **The restore.** Dispose writes back the engine's prior entry only while the engine's entry still points at this
  definition's own callback; read and write the entry under the same key the engine stores it by (name or prefix,
  whichever `@replit/codemirror-vim` keys its table by: read its exported API and docs, not `node_modules`, and
  name the key in the Proof). With no way to read the prior entry, stop and report before the first edit.
- **Errors.** Only a plugin's handler runs inside the catch that logs through `log('editor', …)`. The four document
  commands throw as today, so vim's `:` prompt still shows their error, and `hostedEntryOf`'s "ran in an editor this
  host did not create" throws outside the catch.

## Behaviour

GIVEN a docs, Practice or Settings document editor WHEN the user types `:w`, `:q`, `:q!`, `:wq` or `:x` THEN that
editor's `write`, `quit(false)`, `quit(true)`, `writeQuit` or `writeQuit` handler runs, as before this task.
GIVEN a box WHEN the user types `:w` THEN nothing happens, as before this task.
GIVEN a plugin defined `defineEx('hello', 'he', handler)` WHEN the user types `:he! there` in an editor the plugin
made THEN the handler hears that same editor object and `{ argString: 'there', bang: true }`.
GIVEN that plugin stops WHEN the user types `:hello` THEN the plugin's handler does not run, and vim does what it did
before the definition.
GIVEN a plugin calls `defineEx('write', 'w', handler)` THEN it throws `ex command write is already defined`.

## Tests

`src/renderer/codemirror-vim/ex-definitions.test.ts` (new):
- `exCallOf_ReadsBangAndArgument`, one `it.each` table of `argString` to `ExCall`:
  - `undefined` → `{ argString: '', bang: false }`
  - `''` → `{ argString: '', bang: false }`
  - `'!'` → `{ argString: '', bang: true }`
  - `' !'` → `{ argString: '', bang: true }`
  - `' foo '` → `{ argString: 'foo', bang: false }`
  - `'! foo'` → `{ argString: 'foo', bang: true }`
  - `'foo!'` → `{ argString: 'foo!', bang: false }`
- `exDefinitionProblem_NamesTheFirstProblem`, one `it.each` table, each row with `name`, `prefix`, `defined` and the
  message, one row for each of the four messages above, and a row `('hello', 'he', new Set())` → null (each row's `defined` is a `Set`, e.g.
  `new Set(['hello'])`).

`src/renderer/codemirror-vim/document-ex-commands.test.ts`: replace the `documentExEvent` describe with a
`DOCUMENT_COMMANDS` describe:
- `names each command and its prefix`: `DOCUMENT_COMMANDS.map(({ name, prefix }) => [name, prefix])` equals
  `[['write', 'w'], ['quit', 'q'], ['wq', 'wq'], ['xit', 'x']]`.
- `raise_CallsItsEvent`, one `it.each` table over a recording `DocumentEditorEvents` fake. Each row has a name, an
  `ExCall` and the recorded calls: `write` → `['write']`; `quit` with no bang → `['quit false']`; `quit` with a bang →
  `['quit true']`; `wq` with a bang → `['writeQuit']`; `xit` → `['writeQuit']`. These carry the cases of today's
  rows `maps each command to its event`, `reads a bang as forced quit` and `ignores a bang on write-and-quit`.

`src/shared/plugin-part-harness.test.ts`: in `ends what a part left of a replaced editor and markdown at its stop`, the
part also calls `api.services.editor.defineEx('sample', 's', () => {})`. Before the stop `editors.exCommands()` is 1,
and after it 0.

`src/renderer/plugins/page-api.test.ts`: a row `services.editor.defineEx` in the registration table, beside
`services.editor.onPendingKeys`, in the same shape.

The host itself has no unit test: `codemirror-vim-host.test.ts` runs in vitest's `node` environment and builds no
`EditorView`. The engine wiring and the restore are checked live in task 12, Final verification.

## Done when

`npm run typecheck` passes. `npm run lint` passes. The test gate runs
`src/renderer/codemirror-vim/ex-definitions.test.ts`, `src/renderer/codemirror-vim/document-ex-commands.test.ts`,
`src/shared/plugin-part-harness.test.ts`, `src/renderer/plugins/page-api.test.ts`,
`src/shared/page/editor-boxes.test.ts`, `src/plugins/forms/page/round-view.test.ts`,
`src/plugins/forms/page/forms-view.test.ts`, `src/plugins/primer/page/primer-view.test.ts`,
and `src/plugins/docs/page/doc-view.test.ts`. The live checks (document commands in docs, Practice and Settings, and a plugin's command and its dispose) are
in task 12, Final verification.

Commit: one commit for the group. Message:
`EditorHost.defineEx registers ex commands per plugin; the document commands register through it inside the host`

## Proof

