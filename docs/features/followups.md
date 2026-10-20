# wigley-ai-gui follow-ups

- Command palette.
- Move the feature primer into the app.
- Packaging and installers for macOS and Windows.
- A Latte (light) theme and OS light/dark following.
- A user config file for settings and the keymap. The editor's insert remaps merge only from the core keymap, which holds none since `jk` was dropped, so the keys help's "Remaps in a text box" section stays empty until this lands.
- A settings window, and settings that hot reload: a change applies to the open window without restarting main, which today owns the settings and serves them to the page only at load. Builds on the user config file above.
- Syntax-highlighting theme tokens.
- `npm run selftest` on Windows (`tee /dev/stderr` in the script).
- An active-line band in the editors (needs the `@codemirror/view` dependency).
- Editor key replay (a broken key sequence replayed into a box through `EditorHost.typeInto`) has three limits only a custom keymap reaches: focus moving mid-replay sends the rest to the old box, a replayed `:` does not open the vim command prompt, and Shift is lost on named keys.
- Rail notice entries are inert in the review: clicking one could jump to the notice's comment box, as question entries jump to their question.
- A notification click focusing its round is untested live: an unsigned dev build gets no macOS notification (the alerts adapter falls back to Dock bounce and badge), so check it on the first signed build from the packaging follow-up.
- Fuzzy finders: `Space f f` finds a file, `Space f s` searches text, built on a fast Neovim finder's matcher (fzf/fzy style) rather than a home-made one. Deferred from the docs browser (`docs-browser/design.md`).
- Keyboard link hints (vimium style) in rendered docs, if Tab between links is not enough.
- Images in rendered docs: loading local image files into the page needs a safe file protocol of its own; today they show their alt text.
- A Codex harness adapter behind `AgentHarness`, declaring Codex's own session controls (`agent-chat/design.md`).
- A wigley-harness adapter behind `AgentHarness`, so the app drives the C# harness as it drives Claude Code.
- A read-only Chat tab for sessions started in a terminal, following the session's transcript file.
- Images and files pasted or dropped into the chat's message box.
- "Always allow" on a chat permission card, writing the rule to the project's local Claude settings; Claude's
  permission-prompt tool path for it is undocumented, so it starts with a spike.
- Sessions mode's live checks have not been run: rows appearing on connect with `No session selected`, the dimmed `Claude` / `Codex` label (wigley 1.4.0's relay sends it), a round selecting its row and Form tab with the `heading 0/<total>` status line, a background round's accent dot, `Option+Shift+o` / `Option+Shift+i` / `Option+o` / `Space k s` from the real keyboard (macOS turns Option+Shift+o into `Ø`), `Cmd+W` closing a row and the row returning at the end with its next round, the `Cancel this round?` prompt over the sidebar, and the narrow window (below 680 px the sidebar hides and `Space k s` opens it over the form). Also decide whether a row click should close that overlay; today it stays open until `Space k s` or a wider window.
- When the docs editor lands: an editor key sequence bound only in other scopes is taken from vim in every editor, so a normal-mode Esc in a docs box runs nothing and logs `<Esc> has no bind in docs.…` while forms binds `<Esc>`; a new round selects its session's Form tab, switching away from a Docs tab mid-edit; and a row removed while its round stays open rebuilds that round's Form tab in a hidden body nothing drops after the round closes.
- A Codex process started from a shell Claude Code spawned inherits `CLAUDECODE=1`, so its row reads `Claude`.
- Forms layouts: run `npm run selftest` on the review fixes. The run closed before it could, while a dev
  `npm start` held the app's data folder; `1b86e3e` rewrote the preview steps (`Space z l o` waits on
  `[sessions] activated Layout preview`, then `<D-w>` and `n` prove the preview round is the selected session's
  and dismiss the prompt), so they have never run live.
- Forms layouts live checks, never run. Under `npm start`: `Space z l o` shows the sample with every card kind;
  `Space z l c` toasts the copy path, and saving a `layout.css` added to the copy redraws the open card keeping its
  answer; saving a relatively imported `parts.js` alone shows its change; a `layout.js` syntax error toasts and keeps
  the last look, and fixing it brings the layout back; `Space z l n` / `p` cycle and the choice survives a restart;
  `Space z l o` twice swaps in the newest saved round, whose submit removes the row and reaches no agent; an editor
  completes the kit's parts in a copied `layout.js` from `layouts/layout.d.ts`. In a packaged build
  (`npm run package`, dev instance closed): repeat the copy-and-css and cycle-and-restart checks, since the
  `wigley-data:` scheme, CORS and the CSP under `file://` are unproven.
- Chat raw events drop the streaming deltas (text, thinking and tool input) and `message_start` / `message_delta` / `message_stop`, while `agent-chat/design.md` says every entry carries the events it was built from. Chosen: rule the deltas covered by the start and final assistant events, and say so in design.md.
- The Claude harness counts one result per sent message (measured on 2.1.304, `agent-chat/claude-stream.md` § Queued messages); a message that gets no result would leave the session `working` and the turn alert unfired. Chosen: probe the cases that might give none (local slash commands, a rejected message) and record them in claude-stream.md before guarding.
- Two tabs' take-overs released out of order give the session back to the first taker's tab even though its take-over has ended (pinned by `sessions/page/tabs.test.ts`); only forms takes over today, so it matters once a second plugin does.
