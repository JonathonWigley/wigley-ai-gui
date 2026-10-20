# wigley-ai-gui follow-ups

- Command palette.
- Move the feature primer into the app.
- Packaging and installers for macOS and Windows.
- A Latte (light) theme and OS light/dark following.
- A user config file for settings and the keymap.
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
