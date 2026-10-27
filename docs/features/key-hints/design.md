# Key hints in place — settled design

**Contents**

- **Intent** — why keys moved off the bottom bar.
- **Decisions** — what the user settled, with the reason for each.
- **Rejected** — the alternatives weighed and why each lost.

The decisions from the 2026-10-27 interview, kept so a later change does not reopen them. How the
hints work is in AGENTS.md § Architecture (Key hints); how they look and where they sit is in
`DESIGN.md` § Keys and focus.

## Intent

The bottom bar listed three or four rows of keys for every scope, far from the things they act on.
The user wants each key shown on the thing it moves or presses, as a game puts LB/RB at the ends
of a tab bar and A/X beside the item under the cursor, so the bar can go and the screen reads at
a glance.

## Decisions

- **Four placement kinds** — edge prompt, cursor prompt, control hint, box hint — together give
  every bind a place on screen, so no key list is needed.
- **No bottom bar.** Each status moved to the surface it describes: a form's saved state to its
  rail header, a config problem to the title bar, the Keys button to the title bar. The vim mode
  item went, since each box draws its own mode. The `statusBar` area stays, so a plugin can still
  contribute to it.
- **Only the scope in force shows its hints,** plus the binds that work in every scope (tabs,
  sessions): the same filter the bar used, so the screen shows exactly the keys that fire now.
- **Vim's own keys show in help only.** They work the same everywhere and the user knows them
  from nvim, Rider and tmux, so a hint for them is noise. Being vim's own is a property of the key
  sequence, not the command (`forms.nextItem` is `j` and `⌃L`), so the keys plugin holds a list of
  key sequences rather than marking commands.
- **Views name anchors; the keys plugin draws.** One module owns how a hint looks, when it shows,
  the on/off setting, and the check that every bind has a place. A plugin from outside the repo
  gets the same hints by naming anchors.
- **Anchors are a `keys` plugin export,** beside `keysFor`. The core stays the key engine only, and
  the whole hint presentation is one plugin that can be replaced.

## Rejected

- Keys inside controls and edge prompts only, row actions in help: hid the Docs and Settings row
  actions, the keys the user most needs to see.
- A key list at the bottom of the focused pane: still a list away from the things it acts on.
- Every hint always shown, dimmed outside the focused pane: noisier for no gain.
- Chord hints revealed while their modifier is held: shows nothing for raw keys.
- A slim status bar kept for status items, or a fallback line for unplaced keys: every item had a
  home on its own surface, and the self-test's unplaced check replaces the fallback.
- Hints in the core keys API: moves presentation into the core, which supplies only the key engine.
