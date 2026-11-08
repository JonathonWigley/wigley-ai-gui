# Session popups — settled design

**Contents**

- **Intent** — why a form is a popup over the session rather than a tab.
- **The popup surface** — what sessions owns, and what a plugin hands it.
- **Open, hidden and gone** — the three states, and what moves between them.
- **Keys and focus** — which surface holds the key scope, and the toggle key.
- **Look** — height, scrim, motion, the hidden bar.
- **Forms and the primer** — how the shared form helper uses popups.
- **The session Docs tab** — why it moved to a plugin that starts off.
- **Decisions** — what was settled and rejected.

## Intent

A round or a primer needs the user now, but the user often needs the chat to answer it: what the agent said,
what it changed. As a tab, the form replaced the chat, and reading the chat meant leaving the form. As a popup,
the form slides up over the session's tabs and can be put away for a moment and brought back, so the chat stays
one key away while the form waits.

## The popup surface

- **Sessions owns it.** `addPopup(sessionId, popup)` is a sessions page export beside `addTab`. A plugin hands a
  `SessionPopupView` (`id`, `title`, `icon`, `element`, `beforeClose`, `shown`) and gets a `SessionPopupHandle`
  (`setStatus`, `open`, `hide`, `isVisible`, `dispose`). No form plugin knows about chat, and any plugin can open a
  popup in a session.
- **One per id per session.** `addPopup` throws on a popup id the session already holds, as `addTab` does on a tab id.
- **A popup lives while its content does.** The plugin adds it when it has something for the user and disposes it
  when that is done: forms adds a session's popup when its first open round mounts and disposes it when the
  session's last round leaves. There is no idle popup.
- **A session's popups stack.** The open popup shown is the one opened last; the others wait behind it. The
  session keeps its popups as one list ordered by last open or hide, open and hidden alike.
- **It belongs to the session, not the pane.** The popup lives in the session's frame, so it moves with the session
  between panes as the tab bar does, and a frame no pane shows keeps its popups hidden in the holder.
- **Its status is a row status.** `setStatus` feeds the session row's second line, as a tab's does, and names the
  popup in the hidden bar. The row shows the last non-empty status in the session's popup list, so when two popups
  have a status, the one opened or hidden most recently wins.
- **Its close guard is a tab's.** `beforeClose` joins the tabs' guards when the user closes the session.

## Open, hidden and gone

```
            addPopup                 hide / <Leader>bp
  (none) ───────────────▶  open  ◀─────────────────────▶  hidden
                            │       open / <Leader>bp /     │
                            │       click on the bar        │
                            └────────── dispose ────────────┴──▶ gone
```

- **Open** on add: a new round slides up over whatever tab shows, even when an earlier popup of the session was
  hidden.
- **Hidden** by the toggle key or `hide()`: the popup slides down out of sight and the session's hidden bar names it.
  The tab under it is as the user left it.
- **Open again** by the toggle key, `open()`, or a click on the hidden bar.
- **A covered popup** is open but behind a newer one. `hide()` on it hides it into the bar; `open()` on it lifts it
  to the top. Only `open()` on the top open popup does nothing.
- **Gone** on dispose: submit or cancel ends the form, the plugin disposes the popup, and the tab under it shows with
  nothing to restore, since the popup never changed the selected tab.
- The close guard calls `open()` on the popup that refused the close, so its cancel prompt is on screen.

## Keys and focus

- **An open popup holds the keys.** While the focused pane's session has an open popup and Sessions mode shows, that
  popup is the visible surface: its `shown` runs and sets the base key scope, and `isVisible` reads true. No tab of
  that session is visible then. When the popup hides or goes, the selected tab becomes visible again and its `shown`
  runs, so the chat's keys come back.
- **`<Leader>bp` hides or shows the popup** (`sessions.togglePopup`, scope `any`), from the page and from a box in
  normal mode. On the focused session: an open popup hides; else the last hidden popup opens; with none it logs and
  does nothing. It sits in the `v` view group beside the other show and hide keys.
- **Focus leaves the tab under it.** When a popup becomes visible, a text box under it in the session's tabs loses
  focus, so typing never lands in a hidden chat box; a press on the pane while a popup is open focuses no chat box. A popup that becomes the top open one, by add or
  by `open()`, blurs the focused element first when it sits in that session's tabs, in whichever pane shows the
  session, so the popup's `shown` can take focus.
- **Tab keys still step tabs.** `Alt+o` / `Alt+i` change the selected tab under an open popup; the popup stays in front.

## Look

- The popup is an L2 content sheet raised over the session's tabs: solid `sheet-background`, `radius-lg` on its top
  corners, no shadow (`DESIGN.md` § Separation). Its top edge sits at the `sessions.popup-top` token (default `15%`)
  of the frame's body, and the band of the body above it shows the tab under it, dimmed by the core `scrim`.
- It slides up from the bottom on open, its first open on add included, and down on hide over `duration-slow` (sheets
  and panels), `ease-out` entering and `ease-in` leaving; under reduced motion it appears and goes at once, as
  `duration-instant` makes it. Moving its session between panes or showing the mode again does not slide it in again.
- **The hidden bar** is a slim row at the bottom of the session's frame, one entry per hidden popup, newest hidden
  first: its icon, its status (the round's title; the popup's title when the status is empty), and the toggle key. A
  click on an entry opens that popup and logs the line the toggle key logs when it opens one,
  `opened <popup title> popup in <session label>`. The bar is gone while no popup is hidden. In a pane with a pane
  below, the bar sits above the pane's down prompt, as the sheet does.
- Both draw through the sessions layout: the `popup` part (the frame around the plugin's element) and the
  `popupBar` part (the hidden bar), in the built-in `default` layout.
- **The scrim and the layer belong to the app.** The scrim is an app-drawn element under the popup, and the layer's
  clipping and the `inert` on every popup but the top one are app CSS and code; only the slide and the popup's
  look are the layout's. A user layout that drops the transition still gets inert and clipping.
- **The default `popup` part is a frame only.** It sets the title as an `aria-label` and draws the body; the title and
  icon show only in the hidden bar's entries.

## Forms and the primer

- The shared helper `src/shared/page/session-form-popups.ts` replaces `session-form-tabs.ts`: forms' rounds and the
  primer each build their per-session popup through it. It adds the popup with the session's first form, disposes it
  with the last, and keeps the status and the `needs you` activity it kept for the tab.
- Every session shows its forms this way, a terminal session with no Chat tab included: hidden there, the popup
  leaves the pane's empty text and the hidden bar, which names the toggle key.
- The tab take-over (`takeOver`, `tabsAfterTakeOver`, `tabsAfterRelease`) leaves sessions: forms were its only
  caller.

## The session Docs tab

The Docs tab each session carried moved out of `docs` into the `docs-session-tab` plugin, which `plugins.disabled`
lists by default, so it can come back with one setting. `docs` keeps Docs mode, the per-session index sources and
the `addView` export the tab draws through; the plugin holds only the tab. The self-test starts every plugin, so its
groups still run.

## Decisions

- **A popup is a sessions surface, not a chat part.** A chat part would leave terminal sessions on a tab and teach
  forms about chat. Rejected: chat's `addComposerPart`-style hook for forms.
- **The popup and the primer both move.** They share one form lifecycle; a primer left on a tab would keep the
  take-over alive for one caller.
- **A hidden popup leaves a bar.** A round hidden with no trace is easy to forget behind the chat; the row's
  `needs you` alone is off to the side.
- **A strip of the session shows above the popup.** It reads as something over the chat that can be put away, and
  the form gives up little room. Rejected: covering the whole frame below the tab bar.
- **The Docs tab is a disabled plugin, not deleted.** The user stopped using it "for now"; the repo's pattern for a
  view that can be switched off is its own plugin over a data plugin that stays on.
