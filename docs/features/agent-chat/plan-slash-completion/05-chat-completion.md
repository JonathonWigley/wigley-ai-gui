# 05 — Chat completion, descriptions setting and row hook

Status: not started
Type: Task
Wave: 3 · Depends on: 02, 03, 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/page/completion-rows.ts` · test `src/plugins/chat/page/completion-rows.test.ts` · modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/page/slash-commands.ts` · test `src/plugins/chat/page/slash-commands.test.ts` · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/manifest.ts` · modify `src/plugins/chat/page/chat.css` · modify `src/plugins/chat/main/selftest-script.ts`
Consumes:  `AgentCommand`, `ChatSessionState.commands: AgentCommand[]` ← 02 · `CompletionItem`, `EditorCompletions.items` / `drawRow` ← 03
Produces:  in `src/plugins/chat/contract.ts`:
           `export interface CompletionCommand { name: string; description: string; argumentHint: string; aliases: readonly string[]; source: 'app' | 'agent'; }`
           `export type CompletionRowDraw = (command: CompletionCommand, row: HTMLElement) => boolean;`
           `ChatPageExports.addCompletionRow(draw: CompletionRowDraw): Disposable`
           in `src/plugins/chat/page/completion-rows.ts`:
           `export interface CompletionRows { add(draw: CompletionRowDraw): Disposable; draw(command: CompletionCommand, row: HTMLElement): void; }`
           `export function createCompletionRows(): CompletionRows`
           in `src/plugins/chat/page/slash-commands.ts`: `SlashCommands.list(): AppSlashCommand[]` (replaces `names()`, registration order) · `export function completionCommands(app: readonly AppSlashCommand[], agent: readonly AgentCommand[]): CompletionCommand[]` (replaces `completionWords`)
           in `src/plugins/chat/manifest.ts`: setting `completionDescriptions: true` with its `settingInfo`
Decisions: the hook hands a plugin the command and the row element (round 3) · newest draw first, the first returning `true` ends the row, `dispose` removes only that draw (Decided) · chat's own description draw is added through the same registry at page start (Decided) · descriptions behind `chat.completionDescriptions`, default on (round 2) · app commands keep winning over an agent command with the same name, and an agent command one of whose aliases equals an app name keeps its other texts (the app name wins that word)
Pinned:    setting key `completionDescriptions`, label `Completion descriptions`, description `Show each command's description beside its name in the / completion list.` · the app command record: `{ name, description, argumentHint: '', aliases: [], source: 'app' }` · agent records carry `source: 'agent'`
Behaviour: `completionCommands` lists the app commands first, then each agent command whose name is not an app name, as `completionWords` does today; from each agent command kept it drops the aliases that equal an app name. chat-view's `completions` option: `items: () => completionCommands(deps.slashCommands(), tab.state.commands).map(({ name, aliases }) => ({ word: name, aliases }))`, read on each call as today; `drawRow: (word, row) => rows.draw(commandFor(word), row)` where `commandFor` looks the word up in the same list; the `offered`/`accepted` log lines stay word for word (`completions offered: /a, /b`, `completion accepted: /a`) since the self-test waits on them. `ChatViewDeps.slashCommandNames()` becomes `slashCommands(): AppSlashCommand[]` and gains `completionRows: CompletionRows`.
           Chat's draw (in `start.ts`, beside the `exports`): when `api.settings().completionDescriptions` is true and the command's description is not empty, append a `span` with class `chat-completion-description` holding the description and return `true`; else return `false`. Reading the setting per draw makes a settings change apply to the next popup (hot reload).
           CSS in `chat.css`: `.chat-completion-description` in `fg-tertiary`, one line cut with an ellipsis, a gap from the name, per `DESIGN.md` (tokens only; `npm run lint`'s style check enforces it). The popup is drawn on the page body, so the rule is not scoped under the Chat tab.
GIVEN draws A then B registered WHEN a row draws and B returns true THEN A is not called
GIVEN draws A then B where B returns false WHEN a row draws THEN A is called
GIVEN B disposed WHEN a row draws THEN only A is called
GIVEN app command `status` and agent commands `status` and `wigley:feature` WHEN listed THEN `status` appears once, as the app's, then `wigley:feature`
Tests:     `completion-rows.test.ts` (draws are fakes recording calls; `row` is a plain object cast once in a helper — no DOM in the test run): `draw_NewestFirst_StopsAtTrue` · `draw_FalseFallsThrough` · `dispose_RemovesOnlyThatDraw` · `draw_NoDraws_DoesNothing`
           `slash-commands.test.ts`: `completionWords_AppFirstNoRepeats` becomes `completionCommands_AppFirstNoRepeats` (sources and fields asserted); `completionCommands_AliasEqualToAppName_Dropped` — agent `{ name: 'x', aliases: ['status', 'y'] }` with app `status` keeps `x` with aliases `['y']`; `list` replaces the `names` assertions
Self-test: `selftest-script.ts` — the step at `keys: ['/', 'f', 'a']` becomes `keys: ['/', 'a', 'l', 'i']`, still expecting `[chat] completions offered: /fake-command`: `ali` matches only the fake's alias `fake-alias` (task 02), not its name or `/login`, `/logout`, `/status`, so the step proves alias matching end to end. The Tab step and the later `send` assertion (`/fake-command `) stay as they are.
Done when: `npm run typecheck`, `npm run lint`, the tests above, and `npm run selftest` pass
Commit:    one commit for the group

## Proof

