# UI design — live checks

Steps for the user in a visible `npm start`, each tagged; a low-confidence tag names why. Plan C landed every
surface these check; the self-test and screenshots passed, and none of these has been run live yet. Delete a row
once it passes; a failure becomes a fix or a follow-up.

## Chrome (01)

| # | Steps | Expect | Tag |
|---|---|---|---|
| C1 | Look at the window, then set transparency `reduced` in the settings and look again | title bar, activity bar, side bar and status bar show the ambient wash through soft glass, the side bar denser; under `reduced` all four are opaque mantle | expected |
| C2 | Look at the chrome's edges | one hairline separates each chrome surface from the content; no other chrome border shows | expected |
| C3 | `Space` on a page; then open chat's reason dialog (`n` on a permission card) and press the leader in its box in normal mode | which-key docked above the status bar as floating glass with a soft shadow, rows of label left and key right in `fg-tertiary`, `+group` prefixes in secondary text; it shows over the open dialog | expected |
| C4 | `Space ?` | help over the scrim as a rounded dialog, sections under sentence-case headers, each key right-aligned; Close shows `Esc` | expected |
| C5 | Look at the key bar; click the keyboard icon at its end | each hint a Kbd chord (⌥O on macOS) beside its label in the UI font; the icon opens help | expected |
| C6 | `Space ?` on a wide window, then a narrow one | help about 896px wide; on a narrow window it fills the width minus the scrim padding | low-confidence: a `:has()` width rule on a primitive's class |
| C7 | Narrow the window to its minimum width; press `Space` | the key bar wraps without cutting off a hint; which-key still sits just above the status bar | low-confidence: the status bar now has a min-height and wraps |

## Floating (02)

| # | Steps | Expect | Tag |
|---|---|---|---|
| P1 | In a Chat tab outside the box, `m`; then a filtered picker (the start prompt's folder list) and type | the picker opens as floating glass near the top, centred, with no scrim; the cursor row tinted with the focus ring; typing keeps the panel's top still | expected |
| P2 | Open a picker and click outside its panel; open it again and click a row | the click outside closes it and runs its cancel (the chat log shows the cancel's line where the picker has one); the row click chooses it | low-confidence: new behaviour, no test |
| P3 | Raise a success, an error and an info toast; narrow the window until the status bar wraps | success a green dot, error a red dot, info none, each on floating glass above the status bar; a toast still clears the wrapped status bar | expected |

## Sessions mode (03; S1–S9 pulled in from `followups.md`)

Needs a Claude Code or Codex session started in a terminal with the wigley 1.4.0 (or later) relay.

| # | Steps | Expect | Tag |
|---|---|---|---|
| S1 | `npm start` with no session running, then start a session in a terminal | first the sheet reads `No sessions yet: one shows here when its agent's relay connects`, with no gap above the sheet beyond the gutter; then the row appears in the side bar on dense chrome glass and the sheet reads `Pick a session in the side bar ⌥⇧O` as one empty-state line | expected |
| S2 | Look at the row | the harness label `Claude` or `Codex` sits dimmed after the name, in `fg-tertiary` (the relay sends it) | expected |
| S3 | Have the session send a round | its row is selected (`list-active-background`, no ring), the round's title on a second, smaller line; its tabs sit on the sheet's top edge, the Form tab active, sheet-coloured with a 2px accent top mark, the others transparent in secondary text; the sheet a gutter in from the side bar and the window edges, rounded; the status bar shows `heading 0/<total>` | expected |
| S4 | Select another row, then have the first session send a round | the first row ends in a dot marking the open round in `status-attention` (peach), the attention colour DESIGN.md § Colour gives "needs you"; an accent dot is a defect | expected |
| S5 | From the real keyboard: `Option+Shift+o`, `Option+Shift+i`, `Option+o`, `Space k s` | next and previous session, next tab, side bar hidden then shown; nothing types `Ø` or `ø` into a box (macOS turns Option+Shift+o into `Ø`) | low-confidence: chords match the physical key, which only a real keyboard proves |
| S6 | `Cmd+W` on a row with no open round, then have that session send its next round | the row closes; it returns at the end of the list with the round | expected |
| S7 | `Cmd+W` on a row with an open round | the `Cancel this round?` dialog floats over the scrim, covering the side bar as well as the sheet | low-confidence: the dialog moved onto `createDialog` in the overlay area |
| S8 | Narrow the window below 680 px | the side bar hides; `Space k s` opens it over the form; widening lays it beside again | expected |
| S9 | With the narrow overlay open, click a row | the overlay stays open until `Space k s` or a wider window; `followups.md` holds the recommended change (close on click) — drop that entry to keep today's behaviour | expected |
| S10 | Give a session a long label and a long status, at the window's minimum width | both end in an ellipsis; the harness sits right after the label and the dot at the first line's end | low-confidence: the session row's grid over the row primitive, judged only live |

## Form tab and forms keys (04, 05)

| # | Steps | Expect | Tag |
|---|---|---|---|
| F1 | With a round open: drag the rail's handle, then `Space z l n` and restart | the Form tab fills the session's sheet under the tab strip; the rail is the left pane with a drag handle; dragging resizes, and the width survives the layout swap and the restart | expected |
| F2 | Narrow the window below 800px, then below 640px | below 800px the card column's padding tightens; below 640px the rail stacks above the cards | expected |
| F3 | Look at a finding | origin and severity tags in their forms colours (text and border); Accept primary (accent); the recommended action and choice carry the accent `Recommended` tag; a picked action and the selected choice in the accent tint; Not applicable and Don't ask me this as ghost toggles that show on | expected |
| F4 | Look at the hints | every hint beside a control is a Kbd in the platform's glyphs; the rail shows no jump hints | expected |
| F5 | `C` in the review, then `n` | `Cancel this round?` over the scrim with Keep answering then Cancel round (safe first, danger last) and their keys; `n` closes it; the rail keeps its colours under the scrim | expected |
| F6 | Type in a box, then save | the status bar shows the vim mode and save state in the bar's text, no accent pill; unsaved in warning | expected |
| F7 | A session with no round | the Form tab reads `No round open. The agent's next round opens here.` | expected |
| F8 | Focus a text box, type a long note | the box draws its input frame, focused with the focus ring and the vim cursor visible; a long note scrolls inside the box | low-confidence: the frame (04) and the CodeMirror theme (09) meet here |
| F9 | A wide window | `.round-main` content at `prose-measure` width reads well | low-confidence: the width changed from `60rem` |
| F10 | A round with not-applicable and notice items | their rail rows read apart from untouched ones (idle dots, the `N` prefix, the dimmed label) | low-confidence: the dot colours changed |
| F11 | On a focused finding: `f`, `u`, `s`, `c`; in a box `Space a f` (and `au`, `as`, `ac`) | Fix now, Follow-up, Leave it, clear; the box's leader routes still work | expected |
| F12 | `⌥n` / `⌥p` from the page and from a box | move to the next and previous unanswered item | expected |
| F13 | `⌥n` and `⌥p` in a box in INSERT on macOS | no `˜` or `π` left behind and no composition underline | low-confidence: Option+n is a dead key; the self-test's synthetic keys never compose |
| F14 | `⌘↵` from the review and from inside the round note box | the round is sent; the review's button shows `Send answers ⌘↵` | expected |
| F15 | `Space` in the form; `Space ?`; the key bar | which-key shows no `a`, `e` or digit entries; help lists `c f u s`, `⌥n ⌥p` under the form and `⌘↵` under the review; the key bar shows the raw keys | expected |
| F16 | `Space 1` in a box in normal mode | no jump; the box is as it was (vim takes the leader, then a count) | low-confidence: vim's leader-then-count handling shows only live |

## Forms layouts (05; pulled in from the follow-ups, never run live)

| # | Steps | Expect | Tag |
|---|---|---|---|
| L1 | `Space z l o` | the sample with every card kind on cards, tags and a primary Accept | expected |
| L2 | `Space z l c`; save a `layout.css` added to the copy; save a relatively imported `parts.js` alone | the copy path toasts; the open card redraws keeping its answer; the `parts.js` change shows | expected |
| L3 | Save a `layout.js` syntax error, then fix it | an error toast and the last look kept; the fix brings the layout back | expected |
| L4 | `Space z l n` / `p`, then restart | the layouts cycle, and the choice survives the restart | expected |
| L5 | `Space z l o` twice, then `⌘↵` | the newest saved round swaps in; sending removes the row and reaches no agent | expected |
| L6 | Open a copied `layout.js` in an editor beside `layouts/layout.d.ts` | completion offers the kit's parts, `card`, `tag`, `kbd`, `button` and `sectionHeader` among them | expected |
| L7 | In a packaged build (`npm run package`, dev instance closed): L2 and L4 again | as L2 and L4 | expected |
| L8 | `npm run selftest` | the preview steps pass (`Space z l o` waiting on `[sessions] activated Layout preview`, then `<D-w>` and `n`) | expected |

## Chat (06, 07)

| # | Steps | Expect | Tag |
|---|---|---|---|
| T1 | A Chat tab with a long transcript; scroll | the composer floats over the transcript, inset 12px, radius 14, glass, and entries scroll beneath it | expected |
| T2 | With the list following, type several lines into the box | the last entry sits clear above the composer and stays clear while the composer grows | low-confidence: ResizeObserver wiring, no test |
| T3 | Read a user turn and an assistant reply | user turns are tinted card blocks; assistant prose is 14px at the prose measure | expected |
| T4 | Have the agent run a tool; focus its card and press Enter | a closed card with a mono head and a running dot, turning success or error when done, staying closed; Enter opens it | expected |
| T5 | Have the agent ask a permission; answer one with `y`, another with `n` | the card has the peach edge with **Allow once** (accent, `y`) and **Deny** (`n`); answered, the edge goes and it reads `Allowed once` or `Denied` | expected |
| T6 | Click the Effort chip and pick a value; end the session | the Effort picker opens and the chip shows the new value; an ended session's chips and send are disabled | low-confidence: chip wiring and the ended redraw are judged only live |
| T7 | `n` on a permission card; on a running session, end it | the reason box and the end-session confirmation sit on the scrim with hinted buttons, the safe one first and the danger one last: Back then Deny, Keep it running then End the session (same order as F5's Keep answering then Cancel round) | expected |
| T8 | Set transparency `reduced` | the composer turns opaque | expected |
| T9 | In a Chat tab outside the box: the key bar; `Space ?` | the key bar lists `m`, `e`, `o`, `c` with their labels; help lists them and `g g` under "In the chat" | expected |
| T10 | `gg`, then `G` | `gg` scrolls the transcript to its top with the first entry ringed; `G` returns to the latest | expected |
| T11 | In the box (normal mode) `Space c`; outside the box `Space` | in the box which-key shows `m e o c`; outside, `Space` offers no `c` group | low-confidence: the box's leader binds and the page's binds now differ, judged only in which-key |

## Docs (08)

| # | Steps | Expect | Tag |
|---|---|---|---|
| D1 | `Space k d` | Docs mode: the tree in the side bar on dense chrome glass, the doc on a solid sheet with a gutter and `radius-lg`; the activity bar marks Docs; the title bar shows the open doc's `~` path | expected |
| D2 | `Space k d`, `j`, `Space k d`; then `Space k d`, `Alt+h` | the side bar hides and `j` scrolls the doc; the side bar returns; hidden again, `Alt+h` brings it back with the tree focused | expected |
| D3 | In the tree: `G`, then `gg` | the last row, then the first, is selected and scrolled into view | expected |
| D4 | Narrow the window below 680 px in Docs mode, `Space k d`, widen it | the side bar hides; `Space k d` opens it over the doc; widening lays it beside | low-confidence: Docs' side bar is new wiring on plan A's narrow rule |
| D4b | Narrow the window below 680 px while the tree pane has focus, then press `j` | the side bar hides; the doc pane takes focus and scrolls; no invisible tree row moves | low-confidence: plan A's narrow rule gives the mode no callback, so Docs checks `sideBarShown()` on each tree key |
| D5 | Hover tree rows; `Alt+l` then `Alt+h` | hover fills with `list-hover-background`; the selected row keeps `list-active-background`, with the focus ring only while the tree holds focus; chevrons turn on expand; nested rows indent by depth | expected |
| D6 | `Space k s` to a session's Docs tab; drag the split's line past both ends | the tree sits in the split's start pane; it stops at 160 px and 480 px; the line turns `focus-border` while dragging | expected |
| D7 | Leave the split at a new width, open another session's Docs tab, then quit and `npm start` again | the other tab opens at the same width; after the restart the width holds | low-confidence: one `sessionTree` key shared by every tab, written through the Bridge to main's ui-state file |
| D8 | Narrow the window below 640 px on a session's Docs tab | the tree stacks above the doc, the handle gone | expected |
| D9 | Open a long doc in Docs mode and in a session's Docs tab: `j` / `k`, `Tab` to a link, `i` | the doc pane scrolls, not the sheet around it; `i` opens the editor at the line in view | low-confidence: the `height: 100%` chain inside the sheet and the split pane is judged only live |
| D9b | Docs mode at a normal size and a short window | the sheet's bottom gutter and rounded corners sit above the status bar, with no overflow past the main cell | low-confidence: `.shell-main > .docs-sheet` height calc, judged only live |
| D10 | `a` (kind picker), `A` then type `~/.c` and `Tab` (path box), `d` on a doc (Trash confirm) | the kind picker floats with no scrim; the path box and the Trash confirm sit over the scrim; each covers the side bar too, with its title in sentence case; completions in mono; `Esc` closes each and focus returns to the tree | low-confidence: dialogs moved into the overlay area out of the view |
| D11 | Open an entry with load states | the Claude and Codex tags: `launch` green, `on-demand` accent, `shadowed` and `pending` yellow, `listed` and `not-loaded` neutral; hovering a tag shows its reason | expected |
| D12 | Edit an open doc (`i`), change its file on disk, then `:w` | a warning-tinted banner with a warning edge; then the changed-on-disk prompt, attention-tinted with an attention edge | expected |
| D13 | A session's Docs tab before `R`; then rebind `docs.focusTree` in `keymap.json` | the doc pane says `Open a doc from the tree` centred, with `⌥H`; the tree's status line says `Not read yet`; after the rebind the hint shows the new key | expected |

## Editors and prose (09)

| # | Steps | Expect | Tag |
|---|---|---|---|
| E1 | `Space k d`, open a doc, `i` to edit; then leave the editor; then focus a text box | while the document editor has focus, the cursor's line carries a faint band and its number turns lavender; leaving removes both; no text box shows a band | expected |
| E2 | In the document editor, a visual selection spanning the cursor's line | the selection colour still shows on that line | low-confidence: layer order between the band and CodeMirror's selection layer, untested |
| E3 | Focus the document editor, then a text box | the editor shows the 1px inside focus ring; the box shows only its frame's ring, never two | expected |
| E4 | Read a rendered doc | prose at 14px with looser leading, no wider than about 76 characters; code blocks solid mantle, rounded, no border; inline code a small rounded tint; links blue | expected |
| E5 | `/` in chat's box, under full and then reduced transparency | the completion list floats as glass (blurred, the code under it not legible), soft shadow, `radius-lg` corners; opaque under reduced | low-confidence: the popup's material class meets CodeMirror's base tooltip theme |
| E6 | A forms card with long context text, at the window's minimum width | the 14px context text still fits its card without cutting off | low-confidence: shared stylesheet, forms cards grew from 13px |

## Key hints after a rebind

| # | Steps | Expect | Tag |
|---|---|---|---|
| K1 | Rebind chat's send, `nextSession` and chat's deny/end commands in `keymap.json`, with a Chat tab, a session-less sheet and the end-session dialog open | the composer's Send hint, the `Pick a session` hint and the dialog's button hints each show the new key without reopening anything | expected |
