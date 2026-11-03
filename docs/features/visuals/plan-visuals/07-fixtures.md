# 07 — Test fixtures: mockup and flowchart

Status: in progress
Type: Task
Wave: 5 · Depends on: 03, 06
Plan: [plan.md](plan.md)

Files:     create `src/shared/sample-visuals.ts` · modify `src/shared/fake-agent-harness.ts` ·
           modify `src/plugins/chat/main/preview/preview-session.ts` · modify `src/plugins/chat/main/selftest-script.ts` ·
           modify `src/plugins/chat/main/start.ts` (the drive `chat.start` description) ·
           modify `src/main/main.ts` (the fake harness's two construction sites pass `timers`) ·
           test `src/shared/fake-agent-harness.test.ts` ·
           modify (the fake harness's new `timers` argument) `src/plugins/chat/main/chat-sessions.test.ts`,
           `src/plugins/chat/main/accounts.test.ts`, `src/plugins/chat/main/folder-choices.test.ts`,
           `src/plugins/usage/main/drive-actions.test.ts`.
           Before editing `start.ts` or `main.ts`, run `git status --short` on the file and stage only this task's
           hunks: another session and task 03 may have edits there.
Consumes:  the `visual` plugin's `html` fence contribution and its log line
           `[visual] visual mounted: <title>` ← 05 (see Approach § Log line)
Consumes:  the visual frames service's log line `[visual] visual frame loaded: <the first 8 hex characters of the
           source's SHA-256>`, logged on each frame load ← 04
Consumes:  chat's entry list drawing an agent entry's visuals ← 06
Produces:  `export const FAKE_VISUAL_TEXT = 'fake: visual';` in `src/shared/fake-agent-harness.ts`
Produces:  `export const FAKE_VISUAL_HOLD_MS = 1500;` in `src/shared/fake-agent-harness.ts`
Produces:  `export const FAKE_MICROTASK_TIMERS: Timers;` in `src/shared/fake-agent-harness.ts`
Produces:  `createFakeAgentHarness(clock: Clock, files: Pick<Files, 'write' | 'trash'>, timers: Timers):
           FakeAgentHarness` in `src/shared/fake-agent-harness.ts` (gains the required `timers` argument)
Produces:  `export const SAMPLE_MOCKUP_VISUAL: string;` in `src/shared/sample-visuals.ts`
Produces:  `export const SAMPLE_FLOWCHART_VISUAL: string;` in `src/shared/sample-visuals.ts`
Produces:  `export const SAMPLE_VISUALS_TEXT: string;` in `src/shared/sample-visuals.ts`
Produces:  `export const SAMPLE_VISUALS_OPEN_TEXT: string;` in `src/shared/sample-visuals.ts`
Decisions: the test case is a `fake: visual` scripted reply in the fake harness and an assistant entry in the chat
           layout preview, each with one UI mockup visual and one SVG flowchart visual; the self-test screenshots them;
           a real-agent run is the user's check in the wrap-up (round 1).
           No library: the flowchart is hand-written SVG (round 1).
           While a block is open the visual shows the `drawing visual…` card, so the reply streams a partial whose
           second block is still open (round 2). The fake holds that partial for `FAKE_VISUAL_HOLD_MS` (1500 ms)
           before the final entry, so a live run sees the card (lead ruling). No fake reply had a delay before this,
           so the hold runs on a `Timers` (`src/contracts/ambient.ts`) passed to `createFakeAgentHarness` as a new
           required third argument: main passes its own `timers` (`src/main/main.ts`, the `const timers: Timers`
           over `node:timers`), and tests pass `FAKE_MICROTASK_TIMERS` or a timers double of their own.
           Both fixtures read one shared module, so the fake reply and the preview draw the same sources (brief).
           The `v` key's anchor sits on each visual's expand control in scope `chat.chat` (06), and the keys
           plugin's placement check fails a page load whose `chat.chat` scope never placed it
           (`src/plugins/keys/page/anchors.ts` `placedIn`, `unplaced-log.ts`). So the self-test group that sends
           `fake: visual` runs in the same page load as the run's placement check; confirm in `src/main/selftest.ts`
           when `checkSeen` runs, and place the group so a visual is drawn before it (lead ruling).
           The streaming preview entry (now `preview-15`) also holds an unclosed html block, so the layout preview
           shows the `drawing visual…` card beside the drawn visuals (lead ruling).
           The module lives in `src/shared/`: the fake harness is in that layer, the chat main layer may import it
           (`scripts/check-layers.mts` `LAYERS['src/plugins/chat/main']` lists `src/shared`), and the module imports
           nothing.
           The sources follow `wigley:visuals` (wigley-ai-marketplace `plugins/wigley/skills/visuals/SKILL.md`): a whole
           document per block, theme variables for every colour, no URL outside the document, and the SVG coloured
           through CSS classes in its `<style>`, as the skill requires. The mockup also reads `--wg-text-13`,
           `--wg-weight-semibold`, `--wg-radius-md` and `--wg-radius-sm`, which the skill's list does not name; each
           is a core token in `src/config/theme-tokens.ts`, and the frame receives the whole token set.
           The self-test group runs in the `chat-second` session, whose process calls the script does not check, so
           `EXPECTED_CALLS` stays as it is.
GIVEN a fake process WHEN `fake: visual` is sent THEN it emits the user entry and one streaming assistant entry with
      `SAMPLE_VISUALS_OPEN_TEXT`, sets one timer of `FAKE_VISUAL_HOLD_MS`, and emits nothing more until that timer
      runs; then it emits the final assistant entry with `SAMPLE_VISUALS_TEXT`, then the turn's end
GIVEN the visual turn's hold WHEN the process is interrupted THEN the timer is cleared, and the turn ends with the
      `Interrupted` notice as a held turn does, with no final entry
GIVEN the visual turn's hold WHEN the process ends or is killed THEN the timer is cleared and no entry follows `ended`
GIVEN `SAMPLE_VISUALS_OPEN_TEXT` THEN it holds two `` ```html `` fence lines and one closing `` ``` `` line, and
      `SAMPLE_VISUALS_TEXT` holds two of each and starts with `SAMPLE_VISUALS_OPEN_TEXT`
Tests:     `send_VisualText_StreamsAnOpenBlockThenBothVisuals` — new test in `describe('createFakeAgentHarness')`,
           beside `send_ToolText_EmitsToolWithResult`. Give `startedProcess` a second parameter
           `timers: Timers = FAKE_MICROTASK_TIMERS` that it passes to `createFakeAgentHarness`. Build a test-local
           timers double, `heldTimers()`, that records each `set` as `{ run, ms, handle }`, records each `clear`'s
           handle, and runs nothing itself. Call `startedProcess(createMemoryFiles(), timers.timers)`, then
           `agent.send({ text: FAKE_VISUAL_TEXT, images: [] })` and `await flush()`. Assert the recorded timers'
           `ms` equal `[FAKE_VISUAL_HOLD_MS]` and `heard.slice(2)` equals only:
           - `['entry', { kind: 'assistant', id: 'assistant-1', at: 1000, text: SAMPLE_VISUALS_OPEN_TEXT, streaming:
             true, raw: [{ fake: 'assistant', text: SAMPLE_VISUALS_OPEN_TEXT }] }]`
           Then call the recorded `run`, `await flush()`, and assert `heard.slice(3)` equals, in order:
           - `['entry', { kind: 'assistant', id: 'assistant-1', at: 1000, text: SAMPLE_VISUALS_TEXT, streaming: false,
             raw: [{ fake: 'assistant', text: SAMPLE_VISUALS_OPEN_TEXT }, { fake: 'assistant', text:
             SAMPLE_VISUALS_TEXT.slice(SAMPLE_VISUALS_OPEN_TEXT.length) }] }]`
           - the `result-1` entry, `['agentEvent', fakeUsageEvent(1, 1000)]`, `['planUsage', fakePlanRowUpdate(1,
             1000)]` and `['activity', 'idle']`, exactly as `send_PlainText_StreamsReplyThenResult` lists them.
           Then assert the fence shape. Count the lines of a text that equal `` ```html `` and the lines that equal
           `` ``` ``: `SAMPLE_VISUALS_OPEN_TEXT` gives 2 and 1, `SAMPLE_VISUALS_TEXT` gives 2 and 2, and
           `SAMPLE_VISUALS_TEXT.startsWith(SAMPLE_VISUALS_OPEN_TEXT)` is true.
           Breaks it catches: no streaming partial (the card path never runs), no hold (the final entry in the same
           burst), a partial that closes both blocks, a sample edit that drops a block, the send falling through to
           the echo turn.
Tests:     `visualHold_CutShort_ClearsTheTimer ($case)` — new `it.each` beside it, on the same `heldTimers()` double.
           Each row sends `FAKE_VISUAL_TEXT`, `await flush()`, runs the row's call, `await flush()`, then asserts the
           cleared handles equal `[<the one set handle>]`, and the last entry in `heard` is the row's last entry.
           | case | call | last entry |
           |---|---|---|
           | `interrupt` | `agent.interrupt()` | `{ kind: 'notice', id: 'notice-1', text: 'Interrupted', tone: 'info', … }` (match with `toMatchObject`) |
           | `end` | `await agent.end()` | the streaming `assistant-1` entry with `SAMPLE_VISUALS_OPEN_TEXT` |
           | `kill` | `agent.kill()` | the streaming `assistant-1` entry with `SAMPLE_VISUALS_OPEN_TEXT` |
           Breaks it catches: a hold that an interrupt cannot end (chat would show the turn working until the timer),
           a final entry emitted after `ended`.
           The look of both visuals, the card, and the mounts are live checks → 09 Final verification (and the
           self-test group below).
Approach:  **`src/shared/sample-visuals.ts`** — new. Write it with this content verbatim (each source is a template
           literal with no leading or trailing newline):

```ts
// The sample visuals the fake harness's `fake: visual` reply and the chat
// layout preview draw: one UI mockup and one systems flowchart, each a whole
// document written to the `wigley:visuals` skill.

export const SAMPLE_MOCKUP_VISUAL = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Settings panel</title>
<style>
  body { margin: 0; background: transparent; color: var(--wg-fg); font-family: var(--wg-font-ui); font-size: var(--wg-text-13); }
  .panel { max-width: 420px; border: 1px solid var(--wg-card-border); border-radius: var(--wg-radius-md); background: var(--wg-card-background); }
  .head { padding: 10px 14px; border-bottom: 1px solid var(--wg-border-subtle); font-weight: var(--wg-weight-semibold); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; }
  .row small { display: block; color: var(--wg-fg-secondary); }
  select { font: inherit; padding: 4px 8px; color: var(--wg-fg); background: var(--wg-input-background); border: 1px solid var(--wg-border-default); border-radius: var(--wg-radius-sm); }
  .switch { position: relative; flex: none; width: 34px; height: 18px; border-radius: 9px; border: 1px solid var(--wg-border-strong); background: var(--wg-block-background); cursor: pointer; }
  .switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--wg-fg-secondary); transition: left 0.15s; }
  .switch.on { background: var(--wg-accent); border-color: var(--wg-accent); }
  .switch.on::after { left: 18px; background: var(--wg-fg-on-accent); }
  .foot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--wg-border-subtle); }
  button { font: inherit; padding: 4px 12px; color: var(--wg-fg); background: transparent; border: 1px solid var(--wg-border-default); border-radius: var(--wg-radius-sm); }
  button.primary { color: var(--wg-fg-on-accent); background: var(--wg-accent); border-color: var(--wg-accent); }
</style>
</head>
<body>
<div class="panel">
  <div class="head">Chat settings</div>
  <div class="row">
    <label>Default profile<small>The profile a new session starts under.</small></label>
    <select><option>personal</option><option selected>work</option></select>
  </div>
  <div class="row">
    <label>Effort<small>How hard the agent thinks before it replies.</small></label>
    <select><option>Low</option><option selected>Medium</option><option>High</option></select>
  </div>
  <div class="row">
    <label>Show key hints<small>Draw each key beside the control it runs.</small></label>
    <div class="switch on" role="switch" aria-checked="true" tabindex="0"></div>
  </div>
  <div class="foot"><button>Cancel</button><button class="primary">Save</button></div>
</div>
<script>
  for (const toggle of document.querySelectorAll('.switch')) {
    toggle.addEventListener('click', () => {
      const isOn = toggle.classList.toggle('on');
      toggle.setAttribute('aria-checked', String(isOn));
    });
  }
</script>
</body>
</html>`;

export const SAMPLE_FLOWCHART_VISUAL = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Visual flow</title>
<style>
  body { margin: 0; background: transparent; color: var(--wg-fg); font-family: var(--wg-font-ui); }
  svg { display: block; width: 100%; max-width: 560px; height: auto; }
  .node rect { fill: var(--wg-card-background); stroke-width: 1.5; }
  .node text { fill: var(--wg-fg); font-size: 13px; text-anchor: middle; dominant-baseline: middle; }
  .agent rect { stroke: var(--wg-status-success); }
  .page rect { stroke: var(--wg-accent); }
  .main rect { stroke: var(--wg-status-info); }
  .edge { fill: none; stroke: var(--wg-border-strong); stroke-width: 1.5; marker-end: url(#arrow); }
  .label { fill: var(--wg-fg-secondary); font-size: 11px; }
  #arrow path { fill: var(--wg-border-strong); }
</style>
</head>
<body>
<svg viewBox="0 0 520 390" role="img" aria-label="How an html block in a reply becomes a visual">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 Z"/>
    </marker>
  </defs>
  <g class="node agent"><rect x="20" y="20" width="200" height="44" rx="8"/><text x="120" y="42">Agent reply</text></g>
  <g class="node page"><rect x="20" y="110" width="200" height="44" rx="8"/><text x="120" y="132">Markdown renderer</text></g>
  <g class="node page"><rect x="20" y="200" width="200" height="44" rx="8"/><text x="120" y="222">Markdown mount</text></g>
  <g class="node page"><rect x="300" y="200" width="200" height="44" rx="8"/><text x="400" y="222">Visual plugin</text></g>
  <g class="node page"><rect x="20" y="290" width="200" height="44" rx="8"/><text x="120" y="312">Visual frame</text></g>
  <g class="node main"><rect x="300" y="290" width="200" height="44" rx="8"/><text x="400" y="312">wigley-visual scheme</text></g>
  <path class="edge" d="M120 64 V108"/>
  <text class="label" x="130" y="90">html fence</text>
  <path class="edge" d="M120 154 V198"/>
  <text class="label" x="130" y="180">placeholder</text>
  <path class="edge" d="M220 222 H298"/>
  <text class="label" x="226" y="214">source, closed</text>
  <path class="edge" d="M400 244 V267 H120 V288"/>
  <text class="label" x="240" y="261">open(source)</text>
  <path class="edge" d="M220 312 H298"/>
  <text class="label" x="226" y="304">load by hash</text>
  <g class="node agent"><rect x="20" y="360" width="14" height="14" rx="3"/></g><text class="label" x="40" y="371">agent</text>
  <g class="node page"><rect x="100" y="360" width="14" height="14" rx="3"/></g><text class="label" x="120" y="371">page</text>
  <g class="node main"><rect x="180" y="360" width="14" height="14" rx="3"/></g><text class="label" x="200" y="371">main</text>
</svg>
</body>
</html>`;

const FENCE = '```';

// An agent reply holding both visuals, each in its own html block.
export const SAMPLE_VISUALS_TEXT = [
  'Here is the chat settings panel as it would draw in the app.',
  '',
  `${FENCE}html`,
  SAMPLE_MOCKUP_VISUAL,
  FENCE,
  '',
  'And the flow that draws it, top to bottom: the reply becomes a placeholder, the visual plugin opens a frame, and main serves its document.',
  '',
  `${FENCE}html`,
  SAMPLE_FLOWCHART_VISUAL,
  FENCE,
].join('\n');

// The reply as it streams before its last closing fence: the mockup's block
// closed, the flowchart's still open.
export const SAMPLE_VISUALS_OPEN_TEXT = SAMPLE_VISUALS_TEXT.slice(
  0,
  -`\n${FENCE}`.length,
);
```

           **`src/shared/fake-agent-harness.ts`** — add, after `FAKE_TOOL_TEXT`, with the comment "A send of this text
           streams a reply holding two visuals, holds it with the second block still open for `FAKE_VISUAL_HOLD_MS`,
           then sends the whole reply; an interrupt during the hold ends the turn as a held turn's does.":
           `export const FAKE_VISUAL_TEXT = 'fake: visual';` and `export const FAKE_VISUAL_HOLD_MS = 1500;`. Import
           `SAMPLE_VISUALS_OPEN_TEXT` and `SAMPLE_VISUALS_TEXT` from `./sample-visuals`, and `Timers` beside `Clock`
           from `../contracts/ambient`.
           - `createFakeAgentHarness(clock, files, timers: Timers)`: the new third argument is required. Extend the
             comment above `FakeAgentHarness` with: "`timers` runs the `fake: visual` hold."
           - Export, with the comment "Timers for tests that never look at a fake's hold: each `set` runs its `run` in
             a microtask, whatever its `ms`, unless `clear` took its handle first.", `FAKE_MICROTASK_TIMERS: Timers`:
             a counter gives each `set` a new handle; a `Set` holds the cleared handles; `set` queues a microtask that
             calls `run` when its handle is not in that set.
           - In `startProcess`, add `let visualHold: number | null = null;`. `emitVisualTurn` stays a closure there,
             since it needs `timers` and the hold: emit assistant `assistant-<turn>` with `SAMPLE_VISUALS_OPEN_TEXT`,
             `streaming: true`, raw `[first]` where `first = { fake: 'assistant', text: SAMPLE_VISUALS_OPEN_TEXT }`;
             then `visualHold = timers.set(run, FAKE_VISUAL_HOLD_MS)`. `run` sets `visualHold = null` and
             `isTurnOpen = false`, emits the same id with `SAMPLE_VISUALS_TEXT`, `streaming: false`, raw `[first,
             { fake: 'assistant', text: SAMPLE_VISUALS_TEXT.slice(SAMPLE_VISUALS_OPEN_TEXT.length) }]`, then
             `emitTurnEnd(events, emitEntry, clock, turn)`.
           - In `send`, set `isTurnOpen = isHold || isSteps || isAgents || isVisual` (`isVisual = text ===
             FAKE_VISUAL_TEXT`), so an interrupt during the hold runs the existing interrupt path. Dispatch
             `else if (isVisual)` → `emitVisualTurn(sentTurn)` beside the `FAKE_TOOL_TEXT` branch.
           - `interrupt`, `end` and `kill` each clear a pending hold first: `if (visualHold !== null) {
             timers.clear(visualHold); visualHold = null; }`. In `interrupt`, do this only when the turn is open, before
             the existing notice is queued.
           - Every `createFakeAgentHarness(clock, files)` call gains a third argument (21 calls, measured at plan time,
             re-verify with `grep -rn "createFakeAgentHarness(" src`): the two in `src/main/main.ts` pass main's
             `timers`; every test call passes `FAKE_MICROTASK_TIMERS`, except the two new tests above, which pass
             `heldTimers()`'s timers.

           **`src/plugins/chat/main/start.ts`** — in the drive `start` action's `description`, insert before
           `and anything else an echo` the clause `"fake: visual" a reply holding a UI mockup and a flowchart whose
           second html block stays open for 1.5 s, ` (keep the list's comma style).

           **`src/plugins/chat/main/preview/preview-session.ts`** — import `SAMPLE_VISUALS_TEXT` from
           `../../../../shared/sample-visuals`. In `previewEntries()`, insert before the streaming reply a new entry
           `{ kind: 'assistant', id: 'preview-14', at: previewAt(13), text: SAMPLE_VISUALS_TEXT, streaming: false,
           raw: [{ preview: 'visuals' }] }`. The streaming reply becomes `id: 'preview-15'`, `at: previewAt(14)`, and
           its text becomes the constant `STREAMING_TEXT`, which holds an unclosed html block so the preview draws the
           `drawing visual…` card:

```ts
// A reply still streaming, its html block not closed yet.
const STREAMING_TEXT = [
  'Still writing…',
  '',
  '```html',
  '<!doctype html>',
  '<html>',
].join('\n');
```

           Keep every other id: `start.test.ts` names `preview-7` (measured at plan time, re-verify). Change the
           function's comment to: "One entry of every kind, a tool and a permission in each of their states, both
           notice tones, a reply holding two visuals, and a streaming reply last, its visual still open."

           **`src/plugins/chat/main/selftest-script.ts`** — import `FAKE_VISUAL_TEXT`, `SAMPLE_MOCKUP_VISUAL`,
           `SAMPLE_FLOWCHART_VISUAL` and `createHash` from `node:crypto`. The frame-loaded lines carry each source's
           hash, so the script computes them:

```ts
// The line the visual frames service logs when the frame of `source`
// loads: the first eight hex characters of the source's SHA-256. The source
// a fence hands its contribution is the block's content, which ends with a
// newline.
const frameLoadedLine = (source: string) =>
  `[visual] visual frame loaded: ${createHash('sha256')
    .update(`${source}\n`)
    .digest('hex')
    .slice(0, 8)}`;

// Each sample visual mounted, then its frame loaded.
const VISUALS_DRAWN: RegExp[] = [
  /^\[visual\] visual mounted: Settings panel$/,
  /^\[visual\] visual mounted: Visual flow$/,
];
const FRAMES_LOADED = [SAMPLE_MOCKUP_VISUAL, SAMPLE_FLOWCHART_VISUAL].map(
  (source) => new RegExp(`^${escapeRegExp(frameLoadedLine(source))}$`),
);

// The fake's visual reply in the second session, whose calls the run does not
// check. The screenshot waits for both frames to load.
const VISUAL_STEPS: SelfTestStep[] = [
  { keys: ['<A-S-i>'], expect: '[chat] Chat tab shown in chat-second' },
  {
    keys: sendKeys(FAKE_VISUAL_TEXT),
    expect: '[chat] result entry added in chat-second',
    alsoExpect: [...VISUALS_DRAWN, ...FRAMES_LOADED],
    checksFit: true,
    screenshot: 'visuals',
    why: "The mockup's block closes while the reply streams, and the flowchart's closes with the final entry after the fake's hold; both frames load before the screenshot.",
  },
  { keys: ['<A-S-o>'], expect: '[chat] Chat tab shown in chat-selftest' },
];
```

           `escapeRegExp` is a local helper (`text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`); use an existing one
           when `grep -rn "escapeRegExp\|escapeRegex" src` finds one in `src/shared`. Before relying on the trailing
           newline, read task 01's landed mount: it hands `mount` the placeholder's `textContent`, which is
           markdown-it's `token.content`. If the landed code trims it, drop the `\n` and record that in Proof.

           Put its group in `GROUPS` right after the `clear` group:
           `{ name: 'visuals', why: "fake: visual draws the settings mockup and the flowchart in chat-second's transcript as live visuals, the second block first showing as the drawing card while the fake holds it open.", steps: VISUAL_STEPS }`.
           In `LAYOUT_PREVIEW_STEPS`, give the first step (`' ', 'z', 'l', 'c'`) `alsoExpect: [...VISUALS_DRAWN,
           ...FRAMES_LOADED]` and the `why` "The sample's visuals entry mounts both visuals and loads their frames
           before the screenshot; the streaming entry shows the drawing card." Leave `EXPECTED_CALLS` and
           `EXPECTED_RESUMED_CALLS` as they are.

           **Log lines** — the mount line is a requirement on task 05, which owns the `visual` plugin's log. The html
           fence contribution logs `[visual] visual mounted: <title>` each time its `mount(source, true)` opens a
           visual frame, through the page `services.log` with source `visual`. `<title>` is the trimmed text of the
           source's first `<title>` element, or `untitled` when it has none. A reused view (same language and source)
           calls no `mount`, so a streaming redraw logs nothing more. The frame-loaded line is task 04's. If 04 or 05
           landed another line, use the landed line in both step lists above and record the change in Proof.
Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs
           `src/shared/fake-agent-harness.test.ts`, `src/plugins/chat/main/preview/chat-preview.test.ts`,
           `src/plugins/chat/main/chat-sessions.test.ts`, `src/plugins/chat/main/accounts.test.ts`,
           `src/plugins/chat/main/folder-choices.test.ts`, `src/plugins/usage/main/drive-actions.test.ts` and
           `src/plugins/chat/main/start.test.ts`; the
           self-test's `chat` script passes with its `visuals` and `layout preview` groups, and
           `.selftest/screenshots/chat-visuals.png` and `chat-chat-preview.png` are read against `DESIGN.md`
Commit:    one commit for the group

## Proof

<empty — wigley:make writes it>
