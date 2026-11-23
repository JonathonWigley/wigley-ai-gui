---
name: live-view
description: "Streaming a Unity editor's Game View into the session's Live section of the Auri app while an agent plays it: the `auri` server's `show_live_view` and `hide_live_view` tools, the command patterns a plugin's `auri.json` declares to open and close the view by itself, and the probe that crops it to the Game View. Use when playtesting in a Unity editor from a session the app started, or when the Live section does not open or shows the whole editor."
---

**Contents**

- **Intent** — the user watches the game while the agent plays it.
- **The tools** — `show_live_view` and `hide_live_view`.
- **Opening by itself** — the `liveView` command patterns.
- **The probe** — the script that finds the Game View's rect, and its reply.

## Intent

The **Live section** sits in the session hub beside the chat and streams one window of the machine. While an agent
plays a Unity game in the editor, the section shows the editor's Game View, so the user sees what the agent sees.

## The tools

- The `auri` server's `show_live_view` tool starts the stream. `projectPath` is the Unity project folder the editor
  has open. `gameRect` is optional: the Game View's render area in global screen points, top-left origin,
  `[x, y, width, height]`. Without it the whole editor window streams, unless the probe finds the rect (The probe).
  Call it again after the Game View moves or resizes.
- The `auri` server's `hide_live_view` tool stops the stream and hides the section. Call it after the playtest's last
  stop.

## Opening by itself

An agent plugin's `auri.json` may declare a `liveView` section (the `writing-auri-json` skill): command patterns
whose successful Bash call opens the view (`open`), and patterns whose successful call closes it (`close`). The app
watches every installed plugin's patterns together. A session whose playtest command matches an `open` pattern needs
no `show_live_view` call; the project folder comes from the pattern's `projectPathFlag` or `projectPathVariable`.

## The probe

A `liveView` section may name a `probe`: a file under the plugin's root, its C# `entry`, and the runner
`unityScript`. The first installed plugin with a probe wins. On open, the app crops the stream to the Game View:

- It runs the file with `unity command script run` (`run_script` below com.unity.pipeline 0.9), calling `entry` with
  one argument, the JSON string `{"action":"probe"}`.
- The script replies with JSON holding `ok`, `playing` and `window`: `[x, y, width, height]` in top-left global
  screen points, or `null`. The reply may sit nested under `result` keys, up to 6 levels deep.
- The app tries up to 3 times, 1 s apart, until a reply has a window from an editor that is playing. The last try
  takes a window whether or not the editor plays.
- A missing probe file, a missing `unity` program or a failed run reads as no probe, and the view streams the whole
  editor window.
