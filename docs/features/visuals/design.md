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
  pinned to the bottom as it grows. The full-size overlay is for visuals wider than the column.
- **The theme reaches in live.** The frame host posts the whole token set, then reduced transparency, then the font
  settings (the order `src/renderer/theme.ts` applies them) on load and on every theme change. Tokens reference each
  other, so a subset would break.
  The theme arrives after the frame's own scripts ran, so the frame stays hidden until the first theme message and
  never paints unthemed.
- **Focus.** A click gives the visual the user's clicks and typing; `Esc` inside it hands focus back to the page.
- **Overlay.** `v` on the focused chat entry opens its visuals full size; `h`/`l` move between them and `Esc` closes.
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
