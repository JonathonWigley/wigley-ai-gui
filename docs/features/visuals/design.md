# Visuals

**Contents**

- **Intent** — what a visual is and what a good one does.
- **Flow** — from an agent's html block to a live frame.
- **Decisions** — each settled choice and its reason.
- **Rejected** — approaches tried on paper and why they lost.

## Intent

A **visual** is a live HTML document an agent writes into its reply as an ```` ```html ```` code block: a UI
mockup, a systems flowchart, any picture that explains better than prose. The app draws it in place, sandboxed and
offline, styled by the user's theme. A good visual reads as part of the conversation: it loads once, sizes itself to
its content, and never reaches the app, the user's files or the network.

The word is the user's. It shares a name with vim's visual mode; that mode lives only inside text boxes, so the
context always tells them apart.

## Flow

```
agent reply ── ```html … ``` ──► markdown adapter (MarkdownRenderer)
                                   emits a placeholder for every fence with a registered contribution
                                          │
                                          ▼
                                 markdown mount (core page)
                                   innerHTML, then hydrates each placeholder through its fence contribution;
                                   reuses a mounted view when a later draw holds the same language, closed flag and source
                                          │
                       visual plugin's html fence contribution
                         open block  → "drawing visual…" card
                         closed block→ visual frames service.open(source)
                                          │
                                          ▼
                     core page: visual frames ── Bridge.serveVisual(source) ──► core main: wigley-visual scheme
                       <iframe sandbox="allow-scripts"                         keeps the source in memory by hash,
                               src="wigley-visual://…/<hash>">                 serves it with a bootstrap script and
                       posts the theme in, takes height and Esc out            a no-network CSP header
```

Agents learn about visuals from a session note: the visual plugin contributes it through chat's `addInstructions`,
chat passes it to the harness on every start, and the Claude Code adapter appends it to the system prompt. The note
points at the `wigley:visuals` skill in wigley-ai-marketplace, which holds the how-to.

## Decisions

- **An html code block, not a tool.** A fence works with any agent harness and reads as code in a terminal. A tool
  would tie visuals to an MCP server every harness must load.
- **Scripts run; the network does not.** The frame's sandbox has `allow-scripts` and no `allow-same-origin`, so it
  has an opaque origin: no Bridge, no parent DOM. Its CSP allows inline script, inline style and `data:` images and fonts
  and nothing else, and main refuses any frame navigation off the scheme, since CSP does not cover navigation.
  WebRTC is the one route CSP and the sandbox leave open; it stays open because a frame holds nothing but the
  source the agent already wrote.
- **A served document, not `srcdoc`.** A `srcdoc`, `data:` or `blob:` frame inherits the page's CSP, which forbids
  inline script. A document served on its own scheme carries its own CSP header.
- **Kept by content hash, in memory.** The same source always gets the same URL, so a redraw or a page reload
  serves it again with no state to sync. Nothing is written to disk.
- **Everywhere markdown renders, except the user's own messages.** Agent replies, forms rounds, the primer and the
  docs browser all render visuals, since an agent may put a mockup in any of them. A user message and a
  non-markdown file in the docs browser keep their html block as code (`liveFences: false`), so pasting a snippet into
  chat or opening an `.html` file does not run it.
- **One fence registry in the core.** `addFence` on the markdown service is the extension point; html is a live
  contribution (it runs its source) and the built-in `diff` a non-live one (it only formats), so one fence rule
  serves chat-style and document rendering. A draw with `liveFences: false` skips only the live contributions.
- **The adapter stays strings; the mount owns the DOM.** `MarkdownRenderer` stays the markdown-it adapter and
  returns HTML text. One page module draws markdown into an element and owns the live parts: hydrating fences,
  reusing them across redraws, disposing them.
- **Loaded once per source.** Replies stream, and the default chat layout redraws the whole entry on each chunk. A
  mounted view is reused while its language, closed flag and source are unchanged, and an open block shows a "drawing visual…" card, so the
  frame loads exactly once, when its source is complete.
- **No height cap.** The frame takes its content's full height, reported from inside, and the transcript stays
  pinned to the bottom as it grows. The frame document hides its vertical overflow, so no scrollbar narrows a
  visual whose height follows its width. A visual wider than the column scrolls sideways inline, the frame adding
  the horizontal scrollbar's thickness to the reported height so the bar covers none of it, and reads whole in the
  full-size overlay. One pure function, `decideHeightReport` in `src/main/data-protocol/visual-height.ts`, decides
  each report; the bootstrap carries its source text. It compares each measurement against a baseline: the root and
  viewport of the last report, moved to the latest measurement whenever one comes in at the reported height. A
  root whose height follows the viewport (`min-height: 100vh`) grows with each frame resize, so a measurement whose
  root grew by exactly what the viewport grew since the baseline is dropped, keeping the baseline, instead of
  growing the frame without end. Known limit: such a visual that is wider than the column settles with its root one
  bar taller than its content once its content grows past the frame (300 settled at 315, grown to 400, settles at
  430 where 415 fits), and content that grows or shrinks inside its `100vh` root is never reported.
- **The theme reaches in live.** The frame host posts the whole token set, then reduced transparency, then the font
  settings (the order `src/renderer/theme.ts` applies them) on load and on every theme change. Tokens reference each
  other, so a subset would break.
  The theme arrives after the frame's own scripts ran, so the frame stays hidden until the first theme message and
  never paints unthemed.
- **Reading width by default, wide on the agent's mark or the user's flip.** A visual's frame takes its
  block's width, and prose keeps the reading width (`prose-measure`) block by block, so a visual that fits its
  panes to its width drew squeezed. The app cannot tell such a visual is wide from inside it, so the agent says so:
  `<meta name="visual-width" content="wide">` in the document opens it at the column's whole width. Each visual's
  widen control and `w` on the focused chat entry flip any visual either way, at the same visual `v` opens at. The
  width lives on the visual's host for the view's life: a redraw keeps it, a page reload goes back to the mark.
  Letting the whole column take the pane's width was tried and dropped: every line of prose ran the full pane.
- **Focus.** A click gives the visual the user's clicks and typing; `Esc` inside it hands focus back to the page.
- **Overlay.** `v` on the focused chat entry opens its visuals full size, at the first one in the cursor's block when it holds one; `h`/`l` move between them and `Esc` closes.
  Each visual also carries an expand control, which is the route outside chat.
- **No library.** Agents draw flowcharts as SVG by hand. A Mermaid or chart renderer is one more fence contribution
  later, and any package is the user's per-package ask.

## Rejected

- **Turning on markdown-it's raw HTML.** The HTML would run in the app's own page, beside the Bridge, and the page's
  CSP would block its scripts anyway.
- **A chat-only renderer.** It would leave forms, the primer and docs without visuals and add a second fence path
  beside the core one.
- **Serving from chat's held entries by id.** It would tie visuals to chat and make main parse markdown again to find
  the fence; the hash route serves any markdown owner.
