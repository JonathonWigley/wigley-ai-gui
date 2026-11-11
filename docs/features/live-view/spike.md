# Live view — spike

Gameplay reference only: the code on `spike/live-window-view` is throwaway. Rebuild the result this file
describes, not the code's structure.

Branch: `spike/live-window-view` · Started: 2026-11-10

## Settled
- Each session's hub has a Live section directly under Main agent, so the stream sits beside the chat
  with no tab switch. It has no buttons: it stays hidden until the agent shows it, and the section's
  summary names the window streamed.
- The agent drives it: during a playtest it calls `show_live_view` with the clone it plays in and the
  Game View rect (`WigleyCapture.cs`'s probe `window`), and Live streams that clone's editor window cut
  down to the Game View alone. `hide_live_view` hides it at the playtest's end.
- The whole frame fits with no scrollbar: a tall portrait Game View shrinks to the hub's free height.
  The spike's 60vh cap still left the hub scrolling; the rebuild sizes the video to the space the hub
  has left.
- The crop still shows a thin strip of the Game View's toolbar at the top; the rebuild trims it.
- The stream runs only while the section is on screen: a hidden Chat tab or a collapsed section stops
  the capture, and showing it again resumes the same window. Only what the user can see costs anything.

## Tuned values
| Value | Setting | Where |
|---|---|---|
| Most frames a second | 30 | `settings.json`, `"live-view": { "frameRate": … }` |

## Tried and rejected
- Pick window and Stop buttons for the user — the user wants the agent alone to start and stop Live.
- A Live tab beside the Chat tab — the user wants the stream beside the agent's work, not a tab away.
