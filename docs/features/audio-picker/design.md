# Audio picker in the app

**Contents**

- **Intent** — what the picker is for, who opens it, and what a good outcome looks like.
- **Tool contract** — the two tools, the arguments, the outcomes and the picks.
- **Path and size rules** — which files the picker reads, and why only those.
- **How bytes reach the page** — the channel, the decode, the cache, and why Web Audio.
- **Play formats** — one-shot, loop and variants, and how each plays.
- **Look** — the list, the rows, the None of these row and the notes box.
- **Keys** — the binds and the playback rules.
- **Headless** — the auto-answer.
- **Settings and files** — the three settings and the two data folders.
- **Out of scope** — what the picker leaves alone.

## Intent

The `audio-sourcing` skill ends its shortlist with candidates the agent cannot hear. The picker lets the user hear
them. The agent opens one popup in the app over its session. The popup lists every moment of the feature that needs
a sound, each with its candidates. The user plays each candidate the way the agent plans to play it in the game,
chooses one per moment (or None of these, with a note) and sends. The agent waits on the picker as it waits on a
forms round, and wires only what the user chose.

A good outcome: the user picks by ear, in one sitting, for the whole feature, and the agent wires nothing the user
did not choose. A session with no app keeps the skill's chat list.

The audio picker is the third agent form type, after forms' round and the feature primer. It runs on the shared
form stack in `src/shared/agent-forms/` (one open form per session, deadline, re-attach, hand-back), so it behaves
like a round in every lifecycle respect. A session can hold a round and a picker at once.

## Tool contract

Two MCP tools, contributed through sessions' `contributeTools`:

- `open_audio_picker` opens the picker and waits for the user.
- `collect_last_audio_picker` returns the last picker's payload, as `collect_last_round` does for a round.

Arguments are snake_case (`loudness_lufs`, `drive_url`). Main's parse turns them into the camelCase form the
contract names.

| Level | Field | Holds |
|---|---|---|
| picker | `heading`, `overview` | a title, and an optional line on the feature |
| moment | `title`, `reason`, `recommend` | the moment the sound marks, the agent's one-line reason, the 1-based recommended candidate |
| moment | `candidates` | 1 to `MAX_CANDIDATES` (5) candidates in parse; the skill asks the agent for 2 to 5 |
| candidate | `name`, `library`, `files` | the sound's name, its library, its absolute file paths |
| candidate | `play`, `volume`, `pitch` | `one-shot`, `loop` or `variants`; the game's volume 0..1; an optional semitone range `{ min, max }` |
| candidate | `loudness_lufs`, `drive_url` | both optional, the agent's own |

The payload holds an `outcome` and the user's `picks`, one per moment: the chosen candidate (1-based) or `0` for
None of these, and the moment's note. The `outcome` is one of:

- `submitted`, `draft` and `cancelled`, as a forms round returns them
- `auto_answered`, for a headless session
- `no_audio_picker`, from `collect_last_audio_picker` when no picker is open and no finished picks wait
- `needs_manual_open`, from the `wigley-forms` relay only, when it cannot start the app

A result may carry `earlier_heading`: its picks belong to an earlier picker the agent never received.

The agent supplies the play format, volume and pitch because only the agent knows how the game will play the sound.
The picker plays what the agent describes, so the user approves the sound as it will run.

## Path and size rules

- Main reads only files the agent named. A path is absolute, ends in an audio extension (`.wav .mp3 .ogg .flac
  .m4a`) and exists as a file when the picker opens. The read refuses a file over 200 MB.
- A rejected argument names the path and the rule, so the agent fixes the call at once.
- The page asks for a file by its position in the open picker (moment, candidate, file), never by path. Main serves
  a read only for a position in the session's open picker. The reason: the page is a renderer, and a path argument
  would turn the channel into a read of any file on disk.

## How bytes reach the page

- Main reads a file with `readBytes` and returns it over the plugin's own channel as a `Uint8Array`. Electron's
  structured clone carries it.
- The page decodes the bytes with Web Audio (`AudioContext.decodeAudioData`). The page's CSP has no `media-src`, so an
  `<audio>` element or a `blob:` media URL is blocked. Web Audio needs no CSP change, so the app's security stays as
  it is.
- Web Audio also fits the playback: an `AudioBufferSourceNode` loops the decoded buffer with no gap of its own. A
  compressed file (`.mp3`, `.m4a`, `.ogg`) carries encoder padding, so its loop can still gap at the seam; a
  seamless loop needs an uncompressed or gapless-trimmed file.
- On open, the page reads and decodes every candidate file, two at a time, so each row shows its waveform. A row
  shows a loading state until its decode lands, and an error line when the read or the decode fails (a Drive file
  that will not download, a format Chromium cannot decode).
- Decoded buffers stay in a per-session LRU capped at 512 MB of PCM. A row whose buffer was evicted reads again on its
  next play.
- Waveform and length come from the decoded sound, so they are always true to the file. Loudness and the Drive link
  are the agent's.
- Playback sits behind a plugin-local `AudioOutput` seam, with the Web Audio adapter in production and a fake in the
  tests. The play plan (which file, rate, gain, loop) is a pure function over an injected random source, so every
  rule is testable with no audio device.

## Play formats

The picker plays each candidate the way the agent plans to use it. It has no playback controls for changing how a
sound plays: the picker is for approving and choosing, and a control would let the user approve a sound the game
never plays.

- **one-shot** plays the file once.
- **loop** plays one file in a loop until the user stops it. The loop is gapless for an uncompressed file; a compressed
  file can gap at the seam (How bytes reach the page).
- **variants** is a set of two or more files. Each play picks one at random, as the game will.
- **pitch** is an optional semitone range. Each play picks a uniform value in it and sets
  `playbackRate = 2^(semitones/12)`.
- **volume** is the game's volume for the sound, so the user hears the level the game will use.

One sound plays at a time: a new play stops the one playing.

## Look

The popup follows `DESIGN.md` § Surfaces (Audio picker) and draws through its own layout contract and built-in
`default` layout (`docs/features/layouts/design.md`).

- **One list.** Each moment is a section: its title, and the agent's reason under it. Candidate rows sit under the
  section.
- **A candidate row** shows a play button, a small waveform, the name, the library, the length, the loudness and a
  Tag for the play format. A variant set is one row (the candidate's name, Tag `Variants ×4`), with the first
  file's waveform.
- **The recommended row** carries the accent, and each moment opens on it, so Cmd+Enter alone sends the agent's
  picks. The reason: the user then edits only the moments where the ear disagrees.
- **The None of these row** ends each moment, with a notes box under it. Choosing it makes the agent search again with
  the note and open a new picker for those moments only.
- Nothing plays when the cursor moves. A sound plays on `p` or a click on the row's play button, so scrolling the list
  makes no noise.
- Draft answers (choices and notes) autosave like the primer's and return after a page reload.

## Keys

Scopes and binds follow `docs/keymap.md`; the preview is `Space z l m`.

| Keys | Action |
|---|---|
| `j` / `k`, `gg` / `G` | next or previous row, first or last row |
| `Enter` | choose the cursor row |
| `1`–`6` | choose the cursor moment's nth row (at most 5 candidates); None of these takes the number after the last candidate |
| `Ctrl+h` / `Ctrl+l` | previous or next moment |
| `p` | play or stop the cursor row's sound |
| `a`, `i` | the cursor moment's notes box |
| `Tab`, `Shift+Tab` | next or previous box |
| `Cmd+Enter` | send |
| `Ctrl+j` / `Ctrl+k` | scroll |
| `Ctrl+n` | as in every main view |

Leader routes from a box follow forms' `<Leader>a…` group, with `<Leader>a1`…`a6` choosing the cursor moment's nth
row. `C` asks to cancel, as in forms, and the confirm takes `y` to cancel and `n` or `Esc` to keep the picker. `Esc` in
a notes box leaves the box.

A loop keeps playing when the cursor moves, so the user can hear it against another row's start. Playback stops when
the picker stops being the visible surface (hidden, covered by another popup, Sessions mode left, another session
shown in the focused pane), and on send, cancel and the session closing.

## Headless

A headless session has no user to play the sounds. The shared service auto-answers it at once with each moment's
recommended candidate and an empty note, outcome `auto_answered`, the way forms answers a headless round with its
recommendations. The agent wires the recommended picks and carries on.

## Settings and files

- Settings: `autosaveDelayMs` (400), `deadlineSeconds` (240) and `layout` (`default`).
- `~/.agents/wigley-audio-picker/pickers` holds each picker's saved form and draft.
- The plugin's own data folder, in its `sample-sounds` subfolder, holds the sounds the layout preview plays, so the
  preview never writes into the user's `~/.agents`. Main writes them through `api.data`; the files a picker lists are
  their full paths under `api.dataFolder`.

## Out of scope

- Playing sounds anywhere else in the app (chat, docs).
- Changing how a sound plays from inside the picker.
- Forms rounds with audio items.
- Codex and terminal sessions: they have no app, so the skill's chat list stays.
