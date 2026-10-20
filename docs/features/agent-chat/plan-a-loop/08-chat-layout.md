# 08 — Chat layout contract and default layout

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/layouts/layout.d.ts` · create `src/plugins/chat/layouts/default/layout.js` ·
           test `src/plugins/chat/layouts/default/layout.test.ts`

Consumes:
- The `ChatEntry` variants in `src/contracts/agent.ts` ← 05, re-declared here field for field (the layout folder
  imports nothing); task 09 holds the compile-time check that each variant is assignable to its `EntryInput`.
- The `ChatKit` block in plan.md's **Shared names and signatures**.
- In the tree, as the pattern: `src/plugins/forms/layouts/layout.d.ts` and `src/plugins/forms/layouts/default/layout.js`
  (`// @ts-check`, `/** @type {import('../layout').Layout} */`, `export default layout`); `tsconfig.json`'s
  `allowJs`; `scripts/check-layers.mts`, which lets a `.test.ts` import `vitest` and its own layer.

Produces:
- `src/plugins/chat/layouts/layout.d.ts`, importing nothing:
  ```ts
  export type EntryKind = 'user' | 'assistant' | 'thinking' | 'tool' | 'permission' | 'result' | 'notice' | 'raw';
  export interface UserInput { kind: 'user'; id: string; text: string; raw: unknown[] }
  export interface AssistantInput { kind: 'assistant'; id: string; text: string; streaming: boolean; raw: unknown[] }
  export interface ThinkingInput { kind: 'thinking'; id: string; text: string; streaming: boolean; raw: unknown[] }
  export interface ToolInput { kind: 'tool'; id: string; toolUseId: string; name: string; input: unknown;
    summary: string; result: { text: string; isError: boolean } | null; raw: unknown[] }
  export interface PermissionInput { kind: 'permission'; id: string; toolName: string; input: unknown;
    answer: { allowed: boolean; reason: string | null } | null; raw: unknown[] }
  export interface ResultInput { kind: 'result'; id: string; stopReason: string; costUsd: number | null;
    durationMs: number | null; raw: unknown[] }
  export interface NoticeInput { kind: 'notice'; id: string; text: string; tone: 'info' | 'error'; raw: unknown[] }
  export interface RawInput { kind: 'raw'; id: string; raw: unknown[] }
  export interface EntryInputs { user: UserInput; assistant: AssistantInput; thinking: ThinkingInput; tool: ToolInput;
    permission: PermissionInput; result: ResultInput; notice: NoticeInput; raw: RawInput }
  export type EntryInput<K extends EntryKind> = EntryInputs[K];
  export interface EntryView<K extends EntryKind = EntryKind> {
    element: HTMLElement;
    update?(input: EntryInput<K>): void;
  }
  export interface ChatKit { /* the four members, word for word as plan.md shows, with its comments */ }
  export interface ChatLayout {
    entries: { [K in EntryKind]: (input: EntryInput<K>, kit: ChatKit) => EntryView<K> };
  }
  ```
  `EntryView` takes the kind as a type parameter (plan.md writes `update?(input)` untyped) so `update` receives its
  own kind's input. The comments the file carries, each one line above its member:
  - `ChatLayout.entries`: `Builds one entry's element from the entry and a kit made for that entry. The app appends
    the element; the builder appends it nowhere.`
  - `EntryView.update`: `Runs with each later version of the entry (same id) while it shows. A view with no update is
    built again and its element replaced.`
  - `ChatKit.expander`: plan.md's comment, plus `` `body` runs on each open; return one element and keep it to
    refill it in place. ``
  - `ChatKit.permissionActions`: plan.md's comment; the part keeps itself up to date as the entry's answer arrives.
- `src/plugins/chat/layouts/default/layout.js`: `// @ts-check`, `/** @type {import('../layout').ChatLayout} */ const
  layout = { entries: { … } }`, `export default layout`. Plain DOM through `document.createElement`, `className`,
  `classList.toggle`, `textContent`, `append` and `replaceChildren` only, so its test's fake document covers it.
- CSS class names, for task 09's `chat.css` (every root carries `chat-entry` and its kind's class):

  | Class | On |
  |---|---|
  | `chat-entry` | every entry's root |
  | `chat-user`, `chat-assistant`, `chat-thinking`, `chat-tool`, `chat-permission`, `chat-result`, `chat-notice`, `chat-raw` | the root, by kind |
  | `chat-streaming` | an assistant or thinking root while `streaming` |
  | `chat-tool-running` | a tool root while `result` is null |
  | `chat-tool-error` | a tool root whose result `isError` |
  | `chat-tool-body`, `chat-thinking-body`, `chat-raw-body` | the element each expander's `body` returns |
  | `chat-section-label` | the `Input` / `Result` / `Error` labels in a tool body |
  | `chat-tool-result` | the `<pre>` holding a tool's result text |
  | `chat-muted` | the `Running…` line, and the result root |
  | `chat-permission-head` | the permission's first line |
  | `chat-permission-answered` | a permission root once its `answer` is set |
  | `chat-notice-info`, `chat-notice-error` | a notice root, by `tone` |

Decisions:
- What each kind draws, and what its `update` does:
  - **user**: `div.chat-entry.chat-user` holding `kit.markdown(text)`. `update` replaces its children with
    `kit.markdown(text)`.
  - **assistant**: `div.chat-entry.chat-assistant` holding `kit.markdown(text)`, `chat-streaming` set from
    `streaming`. `update` replaces the markdown with the new text's and sets `chat-streaming` again: a streaming reply
    is redrawn in place, its element kept.
  - **thinking**: `div.chat-entry.chat-thinking` holding `kit.expander('Thinking', body)`, `chat-streaming` set from
    `streaming`; `body` returns one `div.chat-thinking-body` holding `kit.markdown(text)`, built on first open and
    kept. `update` stores the input, refills that body when it was built, and sets `chat-streaming`; the expander
    stays, open or closed.
  - **tool**: `div.chat-entry.chat-tool` holding `kit.expander(line, body)`, `line` = `` `${name} · ${summary}` ``,
    or `name` alone when `summary` is empty. `body` returns one `div.chat-tool-body`, built on first open and kept:
    `div.chat-section-label` `Input`, `kit.json(input)`, then while `result` is null `div.chat-muted` `Running…`,
    else `div.chat-section-label` `Result` (`Error` when `isError`) and `pre.chat-tool-result` with the result text
    as `textContent`. `chat-tool-running` and `chat-tool-error` follow `result`. `update` stores the input, refills
    the body when it was built, and sets both classes; the expander stays, so a call opened before its result shows
    the result in place.
  - **permission**: `div.chat-entry.chat-permission` holding `div.chat-permission-head` `` `Allow ${toolName}?` ``,
    `kit.json(input)`, and `kit.permissionActions()`; `chat-permission-answered` follows `answer !== null`. `update`
    sets that class only; the actions part draws the answer itself.
  - **result**: `div.chat-entry.chat-result.chat-muted`, one line: `stopReason`, then `` `$${costUsd.toFixed(4)}` ``
    when `costUsd` is non-null, then `` `${(durationMs / 1000).toFixed(1)} s` `` when `durationMs` is non-null,
    joined with ` · ` (`end_turn · $0.0123 · 4.2 s`). `update` sets the line again.
  - **notice**: `div.chat-entry.chat-notice.chat-notice-<tone>` with `text` as `textContent`. `update` sets the text
    and the tone class again.
  - **raw**: `div.chat-entry.chat-raw` holding `kit.expander('Raw event', body)`; `body` returns one
    `div.chat-raw-body` holding `kit.json(raw)`, built on first open and kept. `update` refills it when built.
- Text from the harness reaches the DOM only through `kit.markdown`, `kit.json` or `textContent`, never `innerHTML`.
- **How the default layout reaches each process**: the page imports `../layouts/default/layout.js` as a bundled
  module (task 09: the loader's `defaultLayout` and the fallback for an entry that throws), as forms' page does in
  `forms-view.ts` and `layout-cards.ts`; main imports `../layouts/default/layout.js?raw` and
  `../layouts/layout.d.ts?raw` as text for the registry's `copy` and its `layouts/layout.d.ts` write (task 07), as
  forms' `main/start.ts` does.
- The layout folder imports nothing, the test included apart from `vitest` and its own `./layout.js`.

GIVEN a user entry `hello` WHEN built THEN the root's classes are `chat-entry chat-user` and its one child is the kit's
markdown of `hello`; WHEN updated with `hello there` THEN the same root's one child is the markdown of `hello there`
GIVEN an assistant entry streaming `Hi` WHEN built THEN the root carries `chat-streaming`; WHEN updated with `Hi there`,
`streaming: false` THEN the same root holds the markdown of `Hi there` and `chat-streaming` is gone
GIVEN a thinking entry `step 1` WHEN built THEN `kit.expander` got `Thinking`; its body is a `chat-thinking-body` holding
the markdown of `step 1`; WHEN updated with `step 1 step 2` after the body was built THEN that same body element holds
the markdown of `step 1 step 2`, and the expander was made once
GIVEN a tool entry `Bash`, summary `ls -la`, input `{ command: 'ls -la' }`, result null WHEN built THEN the expander line
is `Bash · ls -la`, the root carries `chat-tool-running`, and the body holds labels and text `Input`, the json of the
input, `Running…`; GIVEN summary `` THEN the line is `Bash`
GIVEN that built tool body WHEN updated with result `{ text: 'denied', isError: true }` THEN the same body holds `Input`,
the json, `Error` and a `pre.chat-tool-result` with text `denied`, the root carries `chat-tool-error`, and
`chat-tool-running` is gone; with `isError: false` the label is `Result` and `chat-tool-error` is absent
GIVEN a permission entry `Bash`, input `{ command: 'rm x' }`, answer null WHEN built THEN the head reads `Allow Bash?`,
`kit.json` got the input, `kit.permissionActions` ran once, and the root lacks `chat-permission-answered`; WHEN updated
with `answer: { allowed: false, reason: null }` THEN the root carries `chat-permission-answered` and
`permissionActions` still ran once
GIVEN a result entry `end_turn`, cost `0.01234`, duration `4210` WHEN built THEN its text is `end_turn · $0.0123 · 4.2 s`;
GIVEN cost and duration null THEN `end_turn`
GIVEN a notice `rate limited`, tone `error` WHEN built THEN the root's classes are `chat-entry chat-notice
chat-notice-error` and its text `rate limited`
GIVEN a raw entry `[{ type: 'x' }]` WHEN built and its body opened THEN the expander line is `Raw event` and the body
holds the json of `[{ type: 'x' }]`

Tests:
- `layout.test.ts` — stubs `document` with `vi.stubGlobal` for a fake whose `createElement` returns fake elements
  (`tagName`, `className`, a `classList` over a set with `toggle(name, force)` and `contains`, `textContent`,
  `children`, `append`, `replaceChildren`), and hands each builder a fake kit whose parts return fake elements tagged
  with the part and its argument (`markdown:hello`, `json:{…}`) and record each call; the fake expander keeps its line
  and `body` so the test opens it by calling `body()`. Tests built from the values above:
  `user_drawsMarkdown_updateReplacesIt`, `assistant_streamingClass_updateInPlace`,
  `thinking_expanderBodyRefilledInPlace`, `tool_lineAndRunningBody`, `tool_lineWithoutSummary`,
  `tool_updateShowsTheResultInTheSameBody` (error and success cases), `permission_headJsonAndActions_updateMarksAnswered`,
  `result_lineFormats` (both cases), `notice_toneClass`, `raw_expanderShowsTheEvents`.
- The `// @ts-check` typing of `layout.js` against `layout.d.ts` is the typecheck's claim, not a test's.

Done when: the typecheck and `npm run lint` pass; the test gate runs `layout.test.ts`.
Commit:    one commit for the group

## Proof

