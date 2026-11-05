# 05 — Chat completion, descriptions setting and row hook

Status: in progress
Type: Task
Wave: 3 · Depends on: 02, 03, 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/page/completion-rows.ts` · test `src/plugins/chat/page/completion-rows.test.ts` · modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/page/slash-commands.ts` · test `src/plugins/chat/page/slash-commands.test.ts` · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/manifest.ts` · modify `src/plugins/chat/layouts/layout.d.ts`, `src/plugins/chat/layouts/default/layout.js`, `layout.css`, `layout.test.ts` · modify `src/plugins/chat/page/read-chat-layout.ts` · modify `src/plugins/chat/main/selftest-script.ts`
Consumes:  `AgentCommand`, `ChatSessionState.commands: AgentCommand[]` ← 02 · `CompletionItem`, `EditorCompletions.items` / `drawRow` ← 03
Produces:  in `src/plugins/chat/contract.ts`:
           `export interface CompletionCommand { name: string; description: string; argumentHint: string; aliases: readonly string[]; source: 'app' | 'agent'; }`
           `export type CompletionRowDraw = (command: CompletionCommand, row: HTMLElement) => boolean;`
           `ChatPageExports.addCompletionRow(draw: CompletionRowDraw): Disposable`
           in `src/plugins/chat/page/completion-rows.ts`:
           `export interface CompletionRows { add(draw: CompletionRowDraw): Disposable; draw(command: CompletionCommand, row: HTMLElement): void; }`
           `export function createCompletionRows(log: (text: string) => void): CompletionRows` — a draw that throws is caught, logged, and counts as `false`, because one plugin's bug must not break the popup
           `export function descriptionDraw(deps: { isEnabled(): boolean; drawPart(row: HTMLElement, description: string): void }): CompletionRowDraw`
           in `src/plugins/chat/page/slash-commands.ts`: `SlashCommands.list(): AppSlashCommand[]` (replaces `names()`, registration order) · `export function completionCommands(app: readonly AppSlashCommand[], agent: readonly AgentCommand[]): CompletionCommand[]` (replaces `completionWords`)
           in `src/plugins/chat/layouts/layout.d.ts`: `export interface CompletionDescriptionInput { description: string; }`, and on `ChatLayout` the optional part `completionDescription?(parent: HTMLElement, input: CompletionDescriptionInput): PartView<CompletionDescriptionInput>` (no kit: a leaf with no keys or anchors)
           in `src/plugins/chat/manifest.ts`: setting `completionDescriptions: true` with its `settingInfo`
Decisions: the hook hands a plugin the command and the row element (round 3) · the newest draw goes first, the first returning `true` ends the row, `dispose` removes only that draw (Decided) · chat's own description draw is added through the same registry at page start (Decided) · descriptions sit behind `chat.completionDescriptions`, default on (round 2) · the description draws through a chat layout part (Decided 2026-11-04, `AGENTS.md` "Everything draws through a layout") · app commands keep winning over an agent command with the same name, and an agent command one of whose aliases equals an app name keeps its other texts (the app name wins that word)
Pinned:    setting key `completionDescriptions`, label `Completion descriptions`, description `Show each command's description beside its name in the / completion list.` · the app command record: `{ name, description, argumentHint: '', aliases: [], source: 'app' }` · agent records carry `source: 'agent'`
Behaviour: `completionCommands` lists the app commands first, then each agent command whose name is not an app name, as `completionWords` does today. From each agent command kept it drops the aliases that equal an app name. The app now holds `login`, `logout`, `status`, `clear`, `reset` and `new`, so Claude's own `clear` drops by name.
           chat-view's `completions` option: `items: () => completionCommands(deps.slashCommands(), tab.state.commands).map(({ name, aliases }) => ({ word: name, aliases }))`, read on each call as today; `drawRow: (word, row) => rows.draw(commandFor(word), row)`, where `commandFor` looks the word up in the same list. A word the list no longer holds draws nothing, so the row shows the name alone. The `offered` and `accepted` log lines stay word for word (`completions offered: /a, /b`, `completion accepted: /a`), since the self-test waits on them. `ChatViewDeps.slashCommandNames()` becomes `slashCommands(): AppSlashCommand[]`, and `ChatViewDeps` gains `completionRows: CompletionRows`. `start.ts` fills both.
           Chat's draw: `descriptionDraw` returns `true` after `drawPart` when `isEnabled()` is true and the command's description is not empty; else it returns `false`. `start.ts` adds it to the registry, beside the `exports`, with `isEnabled: () => api.settings().completionDescriptions` and a `drawPart` that draws the `completionDescription` part into `row` through `layouts.draw`, the way `picker.ts` draws `pickerRow`. Reading the setting per draw makes a settings change apply to the next popup (hot reload). `drawPart` drops the `dispose` that `layouts.draw` returns on purpose: the part is a leaf with no anchors and its element dies with the popup row. A layout change applies at the next popup. `createCompletionRows`'s `log` writes under `chat`.
           Layout: add `completionDescription: true` beside `pickerRow: true` in `read-chat-layout.ts` and in the part list of `layout.test.ts`. The default part in `layout.js` appends a `span` with class `chat-completion-description` holding the description.
           CSS in `layouts/default/layout.css`: `.chat-completion-description` in `fg-tertiary`, one line cut with an ellipsis, a gap from the name, per `DESIGN.md` (tokens only; `npm run lint`'s style check enforces it). `tooltipsOnBody()` mounts the popup on the body, so the rule is not scoped under the Chat tab.
GIVEN draws A then B registered WHEN a row draws and B returns true THEN A is not called
GIVEN draws A then B where B returns false WHEN a row draws THEN A is called
GIVEN B disposed WHEN a row draws THEN only A is called
GIVEN app command `status` and agent commands `status` and `wigley:feature` WHEN listed THEN `status` appears once, as the app's, then `wigley:feature`
Tests:     `completion-rows.test.ts` (draws are fakes recording calls; `row` is a plain object cast once in a helper, with no DOM in the test run): `draw_NewestFirst_StopsAtTrue` · `draw_FalseFallsThrough` · `dispose_RemovesOnlyThatDraw` · `draw_NoDraws_DoesNothing` · `draw_ThrowingDraw_LogsAndFallsThrough` · `descriptionDraw_SettingOff_ReturnsFalse` · `descriptionDraw_EmptyDescription_ReturnsFalse` · `descriptionDraw_Enabled_DrawsAndReturnsTrue`
           `slash-commands.test.ts`: `completionWords_AppFirstNoRepeats` becomes `completionCommands_AppFirstNoRepeats` (sources and fields asserted); `completionCommands_AliasEqualToAppName_Dropped` — agent `{ name: 'x', aliases: ['status', 'y'] }` with app `status` keeps `x` with aliases `['y']`; `list` replaces the `names` assertions
           `layout.test.ts`: `completionDescription_Default_DrawsDescription` — a `span.chat-completion-description` whose `textContent` is the description
Self-test: in `SLASH_COMPLETION_STEPS` of `selftest-script.ts`, the step at `keys: ['/', 'f', 'a']` becomes `keys: ['/', 'a', 'l', 'i']`, still expecting `[chat] completions offered: /fake-command`. `ali` matches only the fake's alias `fake-alias` (task 02), not its name or any app name (`login`, `logout`, `status`, `clear`, `reset`, `new`), so the step proves alias matching end to end. The Tab step and the later `send` assertion (`/fake-command `) stay as they are.
Done when: `npm run typecheck`, `npm run lint`, the tests above, and `npm run selftest` pass
Commit:    one commit for the group

## Proof

