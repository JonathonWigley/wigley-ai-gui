---
name: audio-picker
description: "Letting the user choose between candidate sounds in the Auri app's audio picker: the `auri` server's `open_audio_picker` and `collect_last_audio_picker` tools, each moment's candidates and play modes, and the picks that come back. Use once a shortlist of sound effects or music exists for a feature's moments, before hooking up any sound."
---

**Contents**

- **Intent** — the user picks a sound by hearing it played the way the product will play it.
- **open_audio_picker** — moments, candidates, play modes, volume and pitch.
- **What comes back** — one pick per moment, and None of these.
- **Outcomes** — the form outcomes, with the picker's names.

## Intent

The **audio picker** is a popup over the session that plays each candidate sound the way the product will play it —
once, looped, or one variant at random — so the user picks by ear. One picker covers every moment of a feature. A
good picker holds 2 to 5 real candidates per moment, each set up as the released product will play it.

## open_audio_picker

The `auri` server's `open_audio_picker` tool opens the picker and waits for the user's picks.

- `heading` — one line naming what the picker settles; `overview` — optional.
- `moments` — 1 to 20. Each carries `title`, `reason` (what the sound is for), `recommend` (the 1-based candidate you
  would pick) and `candidates`.
- `candidates` — 1 to 5 per moment (aim for 2 to 5). Each carries:
  - `name` and `library` (the sound library the files come from)
  - `files` — absolute paths to files that exist now, each ending in `.wav`, `.mp3`, `.ogg`, `.flac` or `.m4a`: one
    for `one-shot` and `loop`, 2 to 8 for `variants`
  - `play` — `one-shot` plays its one file once, `loop` loops its one file seamlessly, `variants` plays one of its
    files at random each time
  - `volume` — the product's volume, 0 to 1
  - `pitch` — optional `{ min, max }` in semitones, -12 to 12: a random range each play picks from

## What comes back

The result holds one pick per moment. `choice` is the 1-based candidate the user chose. `0` means None of these:
search again with that pick's note, then open a new picker for those moments only.

## Outcomes

`outcome` takes the form outcome values (`forms` skill, Outcomes), with the picker's names:

- On `draft`, call the `auri` server's `collect_last_audio_picker` tool, which takes an optional `wait` boolean.
- `auto_answered` means no one chose: the session is headless, and each pick is your own recommendation.
- `no_audio_picker` means no picker is open and no finished picks wait: send the picker again with
  `open_audio_picker`, and the user's saved answers fill in.
- A result carrying `earlier_heading` holds an earlier picker's picks: read them, then send your picker again.
- On `needs_manual_open`, do what its `next` says.

Re-sending a picker is safe: the same picker re-attaches to the one still open, returns the picks of the picker just
finished, or opens pre-filled with the user's saved answers.
