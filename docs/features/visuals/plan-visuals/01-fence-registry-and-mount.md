# 01 — Fence registry and markdown mount

Status: done
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/markdown.ts` · modify `src/renderer/markdown-it/markdown-it-renderer.ts` ·
           modify `src/shared/page/dom.ts` · modify `src/shared/page/test-dom.ts` ·
           modify `src/shared/page/layout-host/base-kit.ts` · modify `src/shared/page/layout-host/kit.d.ts` ·
           modify `src/plugins/forms/page/layout/card-kit.ts` · modify `src/plugins/forms/page/kinds/card-parts.ts` ·
           modify `src/plugins/forms/page/layout/layout-panes.ts` · modify `src/plugins/forms/page/layout/layout-cards.ts` ·
           modify `src/plugins/forms/page/round-view.ts` · modify `src/plugins/forms/page/kinds/item-format.ts` ·
           test `src/plugins/forms/page/round-view.test.ts` · modify `src/plugins/backlog/page/backlog-view.ts` ·
           modify `src/plugins/docs/page/doc-view.ts` · test `src/plugins/docs/page/doc-view.test.ts` ·
           modify `src/shared/page/markdown.css` · modify `src/renderer/shell/shell-chrome.ts` ·
           create `src/shared/page/markdown-mount.ts` · create `src/shared/page/markdown-mount.test-support.ts` ·
           test `src/shared/page/markdown-mount.test.ts` (new) · test `src/renderer/markdown-it/markdown-it-renderer.test.ts` ·
           test `src/shared/page/layout-host/base-kit.test.ts` ·
           modify (fakes only, see Approach § Fakes) the 22 files that build a `MarkdownRenderer`
           literal: `src/plugins/agents/page/subagent-lines.test.ts`, `src/plugins/backlog/page/backlog-view.test.ts`,
           `src/plugins/chat/page/chat-kit.test.ts`, `src/plugins/chat/page/entry-list.test.ts`,
           `src/plugins/docs/page/doc-view.test.ts`, `src/plugins/docs/page/docs-page-fakes.ts`,
           `src/plugins/forms/page/forms-view.test.ts`, `src/plugins/forms/page/layout/card-kit.test.ts`,
           `src/plugins/forms/page/layout/layout-cards.test.ts`, `src/plugins/forms/page/layout/layout-panes.test.ts`,
           `src/plugins/forms/page/round-view.test.ts`, `src/plugins/gallery/page/layout/gallery-parts.test.ts`,
           `src/plugins/keys/page/layout/keys-parts.test.ts`, `src/plugins/notes/page/notes-page-fakes.ts`,
           `src/plugins/notes/page/popup.test.ts`, `src/plugins/primer/page/primer-view.test.ts`,
           `src/plugins/sessions/page/sessions-view-fakes.ts`, `src/plugins/settings/page/settings-view.test.ts`,
           `src/plugins/usage/page/session-lines.test.ts`, `src/plugins/workflow/page/workflow-view.test.ts`,
           `src/renderer/shell/shell-chrome.test.ts`, `src/shared/page/layout-host/base-kit.test.ts`
           (measured at plan time with `grep -rln "document: async\|document: (text)\|document: () =>" src`, re-verify)
Consumes:  none
Produces:  `interface FenceView { readonly element: HTMLElement; dispose(): void }` in `src/contracts/markdown.ts`
           `interface FenceContribution { language: string; live: boolean; mount(source: string, closed: boolean): FenceView }` in `src/contracts/markdown.ts`
           — `live` is true when the view runs the fence's source (the visual plugin's `html`), false when it only
           formats it (`diff`)
           `MarkdownRenderer.addFence(fence: FenceContribution): Disposable` — throws on a language already registered — in `src/contracts/markdown.ts`
           `MarkdownRenderer.fence(language: string): FenceContribution | undefined` in `src/contracts/markdown.ts`
           `interface MarkdownDrawOptions { liveFences?: boolean }` — `liveFences` defaults to true — in `src/shared/page/markdown-mount.ts`
           `interface MarkdownMount extends Disposable { draw(target: HTMLElement, html: string, options?: MarkdownDrawOptions): void }` in `src/shared/page/markdown-mount.ts`
           `function createMarkdownMount(fences: Pick<MarkdownRenderer, 'fence'>, log: Log): MarkdownMount` in `src/shared/page/markdown-mount.ts`
           — `Log` from `src/contracts/log.ts`; the mount logs under source `markdown`
           `BaseKit.markdown(parent: HTMLElement, text: string, className?: string, options?: { liveFences?: boolean }): HTMLElement` in `src/shared/page/layout-host/kit.d.ts`
           `const NO_FENCES: Pick<MarkdownRenderer, 'addFence' | 'fence'>` in `src/shared/page/markdown-mount.test-support.ts`
           `function installMarkdownDom(stubGlobal: (name: string, value: unknown) => void): { moves: { element: unknown; to: unknown }[] }` and
           `function fencePlaceholder(language: string, closed: boolean, source: string): string` in `src/shared/page/markdown-mount.test-support.ts`
           `FakeElement.querySelectorAll(selector: string): FakeElement[]` in `src/shared/page/test-dom.ts` — takes one
           class selector (`.md-fence`), returns every match under the element, depth first; task 06 consumes it
           `BaseKitDeps.recordMount?(mount: MarkdownMount): void` and `BaseKitDeps.log?: Log` in `src/shared/page/layout-host/base-kit.ts`
           `OwnerKitServices.log?: Log` in `src/shared/page/layout-host/base-kit.ts`
           `recordMount(mount: MarkdownMount): void` added to `CardDeps` (`src/plugins/forms/page/kinds/item-format.ts`),
           `PaneDeps` (`src/plugins/forms/page/layout/layout-panes.ts`) and `MountingDeps`
           (`src/plugins/forms/page/layout/layout-cards.ts`)
           The placeholder markup (pinned below) that `block` and `document` emit for a contributed fence
Decisions: MarkdownRenderer stays the string adapter and gains `addFence` and `fence`; the mount owns DOM, hydration,
           reuse and disposal; `diff` moves onto `addFence` so one fence rule serves `block` and `document` (design
           review, round 3).
           The reuse key is language + closed + source: a block whose closing fence arrives with no other source change
           mounts again, so the "drawing visual…" card turns into the frame (round 2; lead ruling for task 05).
           Unregistering a fence leaves drawn views until their markdown next draws (round 3).
           User chat messages draw with live fences off, so an html block stays code (round 2); task 06 passes the
           option, this task adds it.
           Decided here: one mount per base kit, made on the kit's first markdown draw and handed to
           `deps.recordMount`, which `ownerBaseKitDeps` points at the part's rollback, so the part's rollback and
           dispose dispose it; one mount per doc view, disposed in the view's `dispose`; one mount per backlog
           doc-detail draw, recorded through that draw's rollback.
           Lead ruling R2: forms mounts are disposed. Each forms card (`CardContext`), each review-pane draw and each
           forms base kit (rail, review, head) records its mount through `recordMount`, which round-view points at
           the same arrays its recording `keys` fills (`anchors`, `headAnchors`), so `RoundParts.dispose` and a head
           redraw dispose them as they dispose the anchors.
           Decided here: a non-markdown file in the docs browser draws with `liveFences: false`, since its text is the
           file's source shown as code: a `.html` file never runs; a `.diff` file keeps its colours.
           Lead ruling (cold read, gap 1): a draw takes a view outright only from its own target's earlier draws or
           from a target that has left its parent. A view in a sibling target that is still in the parent is only
           borrowed: the sweep gives it back when the sibling is still there, and keeps it when the sibling was removed
           (the layout's draw-new-then-remove-old redraw). A live sibling never ends up without its view.
           Lead ruling (cold read, gaps 4–5): a `mount` that throws is logged and leaves the placeholder as code; a
           view `dispose` that throws is logged and the sweep or `dispose` goes on with the rest.
           Lead ruling (cold read, gap 9): a fence language matches trimmed and lowercased, so ```` ```HTML ```` is an
           `html` fence.
           Decided here (cold read, gap 3): the shell kit records its mount too, through its own rollback.
           Lead ruling R1: `liveFences: false` skips only contributions with `live: true`; a `live: false`
           contribution still hydrates. The built-in `diff` contribution has `live: false`, so a diff block keeps its
           colours in a user's own chat message and in a non-markdown file, while an html block there stays code.
GIVEN a contribution for `html` WHEN `block` or `document` renders a fence of `html` THEN it emits the placeholder,
      with `data-fence-closed` true only when the closing fence is present
GIVEN no contribution for a language WHEN a fence of it renders THEN the output is today's (`block`: markdown-it's
      `<pre><code class="language-…">`; `document`: highlighted or plain), and `document` asks the highlighter for no
      fence a contribution owns
GIVEN a contribution is registered WHEN `addFence` gets the same language again THEN it throws; WHEN its Disposable
      is disposed THEN `fence(language)` is undefined and the fence renders as plain code again
GIVEN the adapter is new WHEN `fence('diff')` is read THEN it returns the built-in diff contribution, whose view is
      `pre.md-diff` with today's line colours and escaping
GIVEN a mount WHEN it draws html holding placeholders THEN each placeholder whose language has a contribution holds
      that contribution's view, mounted with the fence's source and closed flag; a placeholder of an unregistered
      language keeps its code
GIVEN `liveFences: false` WHEN the mount draws THEN no contribution with `live: true` is mounted and its placeholder
      keeps its code, and each contribution with `live: false` is mounted as with live fences on
GIVEN a forms round view WHEN it is disposed THEN every fence view its cards and panes drew is disposed
GIVEN a view drawn by a mount WHEN a later draw by the same mount, into the same target, or into a target in the same
      parent whose old target is removed in the same task, holds a fence with the same language, closed flag and
      source THEN that draw holds the same view and mounts none; a view no later draw took is disposed once the
      current task's microtasks run
GIVEN two targets in one parent WHEN a draw into a new target in that parent holds a fence equal to one in a target
      that stays THEN, once the task's microtasks run, the staying target holds its own view again and the new target
      holds a new view
GIVEN a contribution whose `mount` throws WHEN the mount draws its fence THEN the placeholder keeps its code and one
      line `fence <language> not mounted: <error>` is logged under `markdown`; GIVEN a view whose `dispose` throws WHEN
      the sweep or `dispose` reaches it THEN `fence <language> view dispose failed: <error>` is logged and every other
      view is still disposed
GIVEN a fence info string `HTML` or ` Html ` WHEN it renders THEN it matches the `html` contribution
GIVEN the docs browser WHEN it shows a `.html` file THEN its text stays code; a `.md` file with the same html fence
      draws it live
GIVEN a view drawn into a target in another parent WHEN a draw in this parent runs THEN that view is not taken and
      not disposed
GIVEN a mount WHEN it is disposed THEN every view it holds is disposed once, and a later draw mounts nothing
Tests:     see § Tests
Approach:  see § Approach
Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Placeholder markup (pinned)

`block` and `document` emit, for a fence whose language (the info string's first word, as `fenceLanguage` reads it)
has a contribution:

```
<div class="md-fence" data-fence-language="LANG" data-fence-closed="CLOSED"ATTRS><pre><code class="language-LANG">SOURCE</code></pre></div>\n
```

- `LANG` is the language through `escapeHtml`. `language-` is `options.langPrefix`.
- `CLOSED` is `true` or `false`.
- `ATTRS` is `self.renderAttrs(token)`: empty in `block`, ` data-source-line="N"` in `document`.
- `SOURCE` is `token.content` through `escapeHtml`. The fallback is plain code, so a placeholder left unhydrated reads as
  a code block.
- `LANG` is the matched language: trimmed and lowercased.
- The mount reads the language from `dataset.fenceLanguage`, the flag from `dataset.fenceClosed === 'true'`, and the
  source from the placeholder's `textContent`.

## Approach

### Contract (`src/contracts/markdown.ts`)

- Add `FenceView` and `FenceContribution` exactly as the Produces lines state, with plan.md's comment on `closed`.
- `MarkdownRenderer` gains `addFence` and `fence`. Import `Disposable` from `./disposable`.
- Rewrite the header comment: `block` and `document` emit a placeholder for each fence whose language has a
  contribution; the markdown mount (`src/shared/page/markdown-mount.ts`) hydrates it.

### Adapter (`src/renderer/markdown-it/markdown-it-renderer.ts`)

- Keep a `Map<string, FenceContribution>` per renderer, keyed by `language.trim().toLowerCase()`. `addFence` and
  `fence` normalize their argument the same way, and the fence rule looks up `fenceLanguage(token).toLowerCase()`.
  A fence with no contribution keeps its info string's own case in its `language-` class, as today. `addFence` throws `fence <language> is already registered`
  for a language in the map. Its Disposable deletes the entry only while the map still holds that same contribution;
  a second `dispose` does nothing.
- Register the built-in diff contribution through `addFence` when the renderer is created, so a plugin's `diff` throws.
  It has `live: false`. Its `mount(source)` creates `pre` with `document.createElement` (the adapter's layer allows no import of
  `src/shared/page`), sets `className = 'md-diff'` and `innerHTML = diffCode(source, md.utils.escapeHtml)`. Its view's
  `dispose` does nothing. It ignores `closed`.
- Remove the `highlight` option (`md.set({ highlight })`) and `highlightFence`.
- **Closed flag.** Both markdown-it instances wrap markdown-it's `fence` block rule. Take the stock rule through
  `md.block.ruler.__rules__[md.block.ruler.__find__('fence')].fn` (declared in markdown-it 15.0.3's
  `dist/markdown-it.d.mts`), and install the wrapper with
  `md.block.ruler.at('fence', wrapper, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })`: `at` resets `alt`,
  and that list is the stock rule's. After the stock rule returns true and `silent` is false, the wrapper sets the
  pushed fence token's `meta = { closed }`. `closed` is true when `state.line - 1 > startLine`, line `state.line - 1`
  has `state.sCount[line] - state.blkIndent < 4`, and `closesFence(token.markup, mark, text)` holds for that line's
  `lineText` and its `FENCE_MARK` match. The block state's line marks skip a container's `>` prefix, so a fence in a
  blockquote reads correctly.
- **One fence rule.** Install one `rules.fence` on both instances. For a language with a contribution it returns the
  placeholder. Otherwise `block` returns markdown-it's stock fence render (save `md.renderer.rules.fence` before
  replacing it) and `document` keeps today's highlighted-or-plain path. Remove the `DIFF_LANGUAGE` branch.
- `highlightFences` skips a language the map holds, in place of `language !== DIFF_LANGUAGE`.
- Update the comment above `createWigleyMarkdown`: the `diff` fence is now the built-in contribution.

### Mount (`src/shared/page/markdown-mount.ts`)

The mount holds one record per live view: its key (language, closed, source), the view, the target it sits in, and
the target's parent at that draw (`host`, null when the target had none). `draw(target, html, options)`:

1. Candidates, in this order, each group in draw order:
   - **own**: the records whose target is `target`;
   - **left**: the records whose `host` is not null, equals `target.parentNode`, and is no longer their target's
     `parentNode` (the old target was removed before this draw);
   - **sibling**: the records whose `host` is not null, equals `target.parentNode`, and is still their target's
     `parentNode`. A sibling candidate is only borrowed (step 5).
2. When the mount is disposed or there is no candidate, set `target.innerHTML = html`. When the mount is not
   disposed, mount a new view into each placeholder (step 4).
3. Otherwise, draw staged, so an adopted view stays connected (a detached iframe reloads):
   - Parse `html` into a detached `div` with `innerHTML`.
   - For each placeholder in it (`querySelectorAll('.md-fence')`, document order) that step 4 would mount, take the
     first candidate with an equal key not taken by this draw. Mount a new view into each placeholder no candidate matched (step 4).
   - Note the target's current child nodes. Append the staged children to `target`.
   - Move each taken view's element into its new placeholder. Use `placeholder.moveBefore(element, null)` when
     `moveBefore` exists and the element and the placeholder are both connected (`isConnected`); else use
     `placeholder.replaceChildren(element)`. `moveBefore` keeps an iframe loaded (MDN, Element.moveBefore).
   - Remove the noted child nodes.
4. Mounting a view: `fences.fence(language)`; for undefined, leave the placeholder's code. When `liveFences` is false
   and the contribution has `live: true`, leave the placeholder's code. Else call
   `mount(source, closed)` and `placeholder.replaceChildren(view.element)`. When `mount` throws, leave the code.
   The placeholder `div` stays, so `data-source-line` stays for the docs view's source sync.
   When `mount` throws, log `fence <language> not mounted: <errorText(error)>` through `log('markdown', …)`.
5. An own or left record that this draw took moves to `target` and this draw's `host`. A sibling record that this draw
   took is marked borrowed, keeping its old target, its old placeholder and the new placeholder. Each new view gets a
   record. Every earlier record of `target` that this draw did not take is marked superseded.
6. Queue one sweep per task with `queueMicrotask`. The sweep:
   - settles each borrowed record: when its old target is no longer its `host`'s child, the record moves to the new
     target and host; when it still is, move its view's element back into its old placeholder (the step 3 move rule),
     mount a new view into the new placeholder (step 4), and keep the record on its old target;
   - then disposes and drops each record that is superseded and not taken since, and each record whose `host` is not
     null and is no longer its target's `parentNode`.

`dispose` disposes every record's view and drops them; a second `dispose` does nothing. A view `dispose` that throws,
in the sweep or in `dispose`, is logged as `fence <language> view dispose failed: <errorText(error)>` and the rest go
on.

A view's key holds the closed flag: an open block's card and the closed block's frame are different views of the same
source.

### Base kit (`base-kit.ts`, `kit.d.ts`)

- `BaseKitDeps` gains `recordMount?(mount: MarkdownMount): void`. A separate member, not `recordAnchor`: forms
  records its key anchors through a recording `keys`, and a forms `recordAnchor` would record each anchor twice.
- `BaseKitDeps` and `OwnerKitServices` gain `log?: Log`. `ownerBaseKitDeps` sets
  `recordMount: (mount) => rollback.recordAnchor(mount)` and passes `services.log` on as `log`. An owner whose
  services carry no `log` gets a mount whose log does nothing.
- `createBaseKit` holds one mount, made by `createMarkdownMount(deps.markdown, deps.log ?? (() => {}))` on the first `markdown`,
  `inlineMarkdown` or `section` call and handed to `deps.recordMount?.(mount)` then.
- `markdown(parent, text, className = '', options = {})` appends `element('div', className)` to `parent` first, then
  draws `deps.markdown.block(text)` into it with `{ liveFences: options.liveFences ?? true }`, and returns it.
- `inlineMarkdown` appends `element('span', className)`, then draws `deps.markdown.inline(text)`.
- `section` appends the `section` to `parent`, then its header and the `div.context-body.md`, then draws into the body.
  Its blank-text case is unchanged.
- Add to `BaseKitDeps`' comment: `recordMount` takes the kit's markdown mount; left out, nothing disposes it.
  Rewrite `createBaseKit`'s comment: the kit holds one markdown mount, made on its first markdown draw.
- `kit.d.ts`: `markdown` gets the Produces signature and a comment: `div` (with `className`) holding `text` as block
  markdown, each registered fence drawn live; `liveFences: false` keeps every fence that runs its source (an html visual) as code, and still draws one that only
  formats it (`diff`). A later `markdown` call
  by the same kit, into the same parent, keeps a fence's view when its language, source and closed flag are
  unchanged. To keep a visual loaded across a redraw, draw the new markdown before removing the old one.

### Sites

- `shell-chrome.ts`: `createShellKit` passes `recordMount: (mount) => rollback.recordAnchor(mount)` beside its
  `recordAnchor`, and the shell's `log` (`deps.log` in `createShellChrome`'s scope) on to `createBaseKit` as `log`.
  A shell layout's `kit.markdown` then has its mount disposed with the part.
- `markdown.css`: the wrapper takes the block's margin, so `.md > :first-child` and `.md > :last-child` still zero
  the outer margin of a reply or doc that starts or ends with a fence. After the `.md pre` margin rule, add:

  ```css
  .md-fence {
    margin: var(--wg-space-2) 0;
  }

  .md-fence > pre {
    margin: 0;
  }
  ```

  The second rule has `.md pre`'s specificity and comes later, so it wins. A hydrated view's own margin is its
  plugin's.
- `dom.ts`: remove `markdownElement` and its comment. After this task no file inserts markdown HTML except the mount.
- `item-format.ts`: `CardDeps` gains `recordMount(mount: MarkdownMount): void`.
- `card-kit.ts`: `CardContext` gains `mount: MarkdownMount`, made in `createCardKit` with
  `createMarkdownMount(deps.markdown, deps.log)` and handed to `deps.recordMount(mount)`. `baseKitDepsFor` takes
  `Pick<CardDeps, 'markdown' | 'platform' | 'commands' | 'keys' | 'recordMount' | 'log'>` and passes `recordMount` and `log` into the
  `BaseKitDeps` it returns. `appendGroupReason` and `buildVerdict` append their `div` first, then draw
  through `card.mount`. `appendChoiceReason` passes `{ markdown, mount }` to `buildChoiceReason`, and both
  `buildChoiceList` calls pass `mount: card.mount`.
- `card-parts.ts`: `buildChoiceReason(label, text, deps: { markdown: MarkdownRenderer; mount: MarkdownMount })` appends
  the body to `reason`, then draws `deps.markdown.block(text)`. `buildChoiceList`'s deps gain `mount: MarkdownMount`,
  and the `span.choice-text` draws `deps.markdown.inline(text)` through it.
- `layout-panes.ts`: `PaneDeps` gains `recordMount(mount: MarkdownMount): void`. `drawReview` makes one mount per
  pane draw (`createMarkdownMount(deps.markdown, deps.log)`), hands it to `deps.recordMount`, and hands it to `drawReviewRow`, whose `span.choice-text` draws
  `deps.markdown.inline(row.choiceText)` through it. The rail and review base kits get `recordMount` through
  `baseKitDepsFor`.
- `layout-cards.ts`: `MountingDeps` gains `recordMount(mount: MarkdownMount): void`. `recordingDeps` wraps it as it
  wraps `keys.anchor`: it calls `deps.recordMount(mount)`, then `rollback.recordAnchor(mount)`, so a card or pane
  attempt that throws disposes its mount too. `MarkdownMount.dispose` runs once, so the second record is safe.
- `round-view.ts`, in `buildRoundParts`: `paneDeps` and `cardDeps` get `recordMount: (mount) => anchors.push(mount)`.
  `headDeps` passes `recordMount: (mount) => headAnchors.push(mount)` into `baseKitDepsFor` beside its recording
  `keys`. `RoundParts.dispose` and `redrawLayoutHead` then dispose the mounts with the anchors, with no other change.
- `backlog-view.ts`: in `drawDocDetail`'s build, make a mount (`createMarkdownMount(deps.markdown, deps.log)`) and record it with `rollback.recordAnchor(mount)`.
  `document(parent)` appends `element('div', 'md')`, then draws `html` through the mount.
- `doc-view.ts`: `createDocView` makes one mount (`createMarkdownMount(deps.markdown, deps.log)`). `body` becomes `element('div', 'md docs-body')`. `drawBody` draws
  `rendered.html` into `body` through the mount, with `liveFences: rendered.liveFences`. `Rendered` gains
  `liveFences: boolean`: true for a `.md` file and for `detailRendered`, false for any other file. The view's
  `dispose` disposes the mount.

### Fakes

- `markdown-mount.test-support.ts` exports:
  - `NO_FENCES`: `addFence` returns a Disposable whose `dispose` does nothing; `fence` returns undefined.
  - `fencePlaceholder(language, closed, source)`: the pinned placeholder markup with empty `ATTRS`. The source is
    written unescaped; tests use sources without `<`, `>` or `&`.
  - `installMarkdownDom(stubGlobal)`: `installFakeDom`, then a `document.createElement` whose elements' `innerHTML`
    setter builds, for each `fencePlaceholder` string in the html, a `div.md-fence` with `dataset.fenceLanguage` and
    `dataset.fenceClosed`, holding `pre > code` with the source as its text, and a text node for the text between.
    The getter returns the string set. Define the accessor in the constructor (`Object.defineProperty`): a subclass
    accessor over `FakeElement`'s `innerHTML` field does not compile. Its elements also get
    `moveBefore(node, reference)`, which throws a `HierarchyRequestError`-named `Error` unless `this` and `node` are
    both connected, else moves `node` as `insertBefore` does and pushes `{ element: node, to: this }` onto the
    returned `moves`, so a test sees which move rule ran.
- `test-dom.ts`: `FakeElement` gains `querySelectorAll(selector)`, which takes one class selector (`.md-fence`) and
  returns every match under the element, depth first. Without it every fake-DOM test that draws markdown throws.
- Each of the 22 fakes spreads `...NO_FENCES` into its `MarkdownRenderer` literal. A fake that builds a `CardDeps`,
  `PaneDeps` or `MountingDeps` literal (`card-kit.test.ts`, `layout-cards.test.ts`, `layout-panes.test.ts`,
  `round-view.test.ts` at plan time, re-verify with the compiler) gains `recordMount: () => {}`. Change nothing else
  in them.

## Tests

`markdown-it-renderer.test.ts`, new `describe('fence contributions')`, the renderer built with a fake `html`
contribution (`live: true`):

- `it.each` `'emits a placeholder for $name'` — rows, expected output literal:
  - block, closed: `` '```html\n<b>x</b>\n```' `` → `<div class="md-fence" data-fence-language="html" data-fence-closed="true"><pre><code class="language-html">&lt;b&gt;x&lt;/b&gt;\n</code></pre></div>\n`
  - block, no closing fence: `` '```html\n<b>x</b>\n' `` → the same with `data-fence-closed="false"`
  - block, closer indented four spaces: `` '```html\nx\n    ```\n' `` → `data-fence-closed="false"`, code `x\n    ```\n`
  - block, in a blockquote: `` '> ```html\n> x\n> ```' `` → `<blockquote>\n<div class="md-fence" data-fence-language="html" data-fence-closed="true"><pre><code class="language-html">x\n</code></pre></div>\n</blockquote>\n`
  - block, opener alone: `` '```html' `` → `data-fence-closed="false"`, empty code
  - block, empty and closed: `` '```html\n```' `` → `data-fence-closed="true"`, empty code
  - block, tilde fence: `` '~~~html\nx\n~~~' `` → `data-fence-closed="true"`, code `x\n`
  - block, closer longer than the opener: `` '```html\nx\n`````' `` → `data-fence-closed="true"`, code `x\n`
  - block, upper-case info string: `` '```HTML\nx\n```' `` → `data-fence-language="html"`, class `language-html`, closed
  - document, closed: `` '```html\nx\n```' `` → `<div class="md-fence" data-fence-language="html" data-fence-closed="true" data-source-line="1"><pre><code class="language-html">x\n</code></pre></div>\n`

  Breaks caught: the closed flag inverted or read off the raw line (blockquote row), the indent check dropped, the
  `state.line - 1 > startLine` check dropped (opener-alone row), the tilde marker or a longer closer refused, a
  case-sensitive lookup, the placeholder missing from one path, the source line attribute dropped.
- `'registers, refuses a second and unregisters a fence'` — `fence('html')` is the contribution; a second
  `addFence({ language: 'html', … })` throws; `addFence({ language: 'diff', … })` throws; after `dispose`,
  `fence('html')` is undefined and `block` returns `<pre><code class="language-html">x\n</code></pre>\n`; a dispose of
  an old registration after a new `html` one leaves the new one registered; `fence(' HTML ')` returns the `html`
  contribution and `addFence({ language: 'Html', … })` throws while `html` is registered.
- Replace `'keeps the diff fence'` (document) with `'asks the highlighter for no contributed fence'`: render
  `` '```html\nx\n```\n\n```diff\n+ a\n```' `` and assert `highlightCalls` is `[]`.
- Replace `'colours a diff fence’s added, removed and changed lines'` and `'escapes a diff fence’s lines'` with one
  `it.each` over `fence('diff')!.mount(source, true)`, `document` stubbed with `vi.stubGlobal` to
  `{ createElement: (tag) => ({ tagName: tag.toUpperCase(), className: '', innerHTML: '' }) }`. Assert
  `className === 'md-diff'` and `innerHTML` equal to today's `<code>…</code>` strings from those two tests:
  `'+ a\n- b\n~ c\n same\n'` → `<code><span class="md-diff-add">+ a</span>\n<span class="md-diff-del">- b</span>\n<span class="md-diff-mod">~ c</span>\n same</code>`,
  and `'+ <b>&\n'` → `<code><span class="md-diff-add">+ &lt;b&gt;&amp;</span></code>`.
- `'keeps markdown-it’s language class on other fences'` stays as it is.

`markdown-mount.test.ts` (new), over `installMarkdownDom` with a fake `fences` holding an `html` contribution with
`live: true` and a `fmt` contribution with `live: false`, each recording its `mount(source, closed)` calls and each
view's `dispose`:

- `'hydrates registered placeholders and leaves the rest as code'` — one draw of an `html` closed placeholder, an
  `html` open placeholder and a `zzz` placeholder: mount calls `[{ source: 'a', closed: true }, { source: 'b', closed: false }]`;
  the first two placeholders hold their views; the `zzz` placeholder still holds its `pre`.
- `it.each` `'with live fences $liveFences, a $language fence is $result'` — one draw of one placeholder per row:
  - `html` (`live: true`), `liveFences: true` → mounted
  - `html` (`live: true`), `liveFences: false` → code: no mount call, the placeholder still holds its `pre`
  - `fmt` (`live: false`), `liveFences: false` → mounted

  Breaks caught: `liveFences: false` skipping every contribution (the diff regression), or skipping none.
- `it.each` `'$name'` for reuse, each row a first draw, a second draw, then `await Promise.resolve()`:
  - redraw of the same target, same fence → the same view, one mount call, no dispose
  - redraw of the same target, changed source → a new view; the old one disposed once
  - same source, closed false then true → the old view disposed, a new view mounted with `closed: true`
  - a new target appended to the same parent, then the old target removed → the same view, no dispose
  - `parent.replaceChildren()`, then a new target in the same parent → the same view, no dispose
  - two identical fences, drawn twice into the same target → two views both kept, two mount calls in all
  - a new target appended to the same parent and a staying sibling holding the same fence → after the sweep the
    sibling's placeholder holds its own view (not disposed) and the new target holds a second, new view

  Breaks caught: a key missing the closed flag, a view disposed though taken, a stale view left undisposed, one view
  taken by two placeholders, a live sibling left with an empty placeholder.
- `it.each` `'moves a kept view with $rule when $case'` — one reuse redraw into a new target per row, reading
  `installMarkdownDom`'s `moves`:
  - old and new targets both under a connected parent (`isPageRoot`) → `moveBefore`: one entry in `moves`
  - the new target's parent not connected → `replaceChildren`: `moves` empty, the view's element in the new placeholder

  Break caught: a detached move that reloads every frame on each streaming delta, or a dropped `isConnected` check.
- `it.each` `'logs and goes on when $part throws'`, with a recording `log`:
  - a contribution's `mount` throws `boom` → the placeholder keeps its `pre`; one line `('markdown', 'fence html not mounted: boom')`
  - one of two views' `dispose` throws `boom` during `dispose` → the other view's dispose ran; one line
    `('markdown', 'fence html view dispose failed: boom')`
  - the same during the sweep → the other stale view's dispose ran; the same line

- `'leaves a view in another parent alone'` — draws into targets under parents A and B, then a draw under A with no
  fence: B's view is not disposed and still sits in B's target.
- `'disposes every view once and mounts nothing after dispose'` — two views; `dispose` twice: each view's dispose runs
  once; a later draw makes no mount call.

`base-kit.test.ts`, one wiring test over `installMarkdownDom`:

- `'draws markdown through one recorded mount'` — a kit whose `markdown.block` returns a `fencePlaceholder` of a
  `live: true` contribution: `markdown` twice into one parent (the second after `replaceChildren`) gives one mount
  call; `recordMount` received one mount, and disposing it disposes the view; `markdown(…, { liveFences: false })`
  on a second kit makes no mount call.
- `'disposes the mount through the rollback ownerBaseKitDeps takes'` — a kit over
  `ownerBaseKitDeps(manifest, services, null, rollback)` with a recording `rollback`: after one `markdown` draw with
  a fence, disposing what `rollback.recordAnchor` took disposes the view. Break caught: the chat and owner kits'
  frames never released.

`doc-view.test.ts`, over `installMarkdownDom`:

- `it.each` `'draws a $file file\'s html fence $result'` — the test's `markdown.document` returns a `fencePlaceholder`
  of a `live: true` `html` contribution for both rows:
  - `a.md` → live: one mount call
  - `a.html` → code: no mount call

  Break caught: an opened `.html` file running as a visual.
- `'dispose disposes its fence views'` — after showing `a.md`, the view's `dispose` runs the fence view's dispose once.

`round-view.test.ts`, one wiring test over `installMarkdownDom`:

- `'dispose disposes the fence views its cards drew'` — a round whose card text renders (through the test's
  `markdown.block`) a `fencePlaceholder` of a `live: true` contribution: after the view's `dispose`, that view's
  `dispose` ran once. Break caught: a forms mount left out of `anchors`.

→ 09 Final verification: a visual stays loaded (no reload) across streaming redraws once task 06 draws the new markdown
before removing the old; the docs view keeps its scroll sync on a doc holding a visual; a diff block still shows its
colours in an agent reply, in a user's own chat message and in the docs browser.

## Proof

Commit 2a9c0ef · proof: diff read: every Produces present, markdownElement gone; typecheck + lint clean; filtered tests 2779 pass · concerns: AGENTS.md says the mount reuses by language and source, but the key also holds the closed flag (for 08); a target redrawn without a view it lent out costs one extra mount
