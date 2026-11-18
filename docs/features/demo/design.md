# Demo

**Contents**

- **What it is** — the demo run, its panel, its caption and its keys.
- **Steps** — what a step is, who registers it, and the coverage rule every plugin meets.
- **Demo sessions** — the scripted demo harness, its sessions, and what they never write.
- **Real state stays untouched** — what each step shows instead of the user's data.
- **The step agent** — one real Claude conversation per step, for iterating on that feature.
- **Starting and stopping** — what a run sets up and what Stop removes.
- **Rejected** — approaches turned down in the interview.

## What it is

The `demo` plugin walks through every user-facing feature of the app, one **step** per feature,
for showing the app to a team and for trying one feature without building a real case from
scratch. It runs inside the everyday app, over whatever mode is shown:

- **The Demo panel** sits at the top of the right bar, in every mode: the step list, grouped by
  section, above the current step's agent chat (the step agent below).
- **The caption** runs along the bottom of the window in the status bar: one high-level line per
  step, naming the feature on screen. It points at nothing; the feature fills main.
- **The keys** are the leader `d` group, bound in every scope:

  | Keys | Does |
  |---|---|
  | `Space d d` | show or hide the Demo panel; the first show starts the demo at its first step |
  | `Space d n` / `Space d p` | next or previous beat, then step |
  | `Space d a` | autoplay on or off |
  | `Space d r` | reset the current step's sample data |
  | `Space d h` | show the user's real sessions again, or hide them |
  | `Space d x` | stop the demo and remove everything it set up |

  Inside the focused panel, `j`/`k` move through the step list and `Enter` goes to the step.

**Autoplay** shows each beat for `demo.autoplaySeconds` (default 5), or for a beat's own longer
dwell, then moves on. It stops after the last step before the real-session step, which only a
key or a jump enters, since it starts a real Claude session.

## Steps

A step is one feature, shown through its **beats**: the states worth seeing, in order. The
session-card step's beats are the card's activities (working, waiting on you, finished, …); the
forms step's beats are a question, a finding, a notice, a review and a cancel. A step carries one
high-level caption for all its beats.

A step stays set up until the demo leaves it. Entering a step builds its sample data and opens
what it shows; leaving it, resetting it or stopping the demo removes them. Going back a beat
shows the earlier beat again.

**Each plugin registers its own steps.** A step has a page half, registered through the core
`services.demoSteps` registry, and an optional main half under the same id, for sample data that
lives in main (fake sessions, stores, slots). Both halves live in the plugin's own folder
(`page/demo-steps.ts`, `main/demo-steps.ts`), next to the code they show, so a plugin's step
changes with the plugin. The registry is core, as the agent-harness registry is, so no plugin
depends on `demo`: the demo plugin reads the registry, and turning it off turns off nothing else.

**Coverage.** Every built-in plugin registers at least one step or declares why it has none, in
its manifest's `demoSkip` (`demoSkip: 'the global summon shortcut acts outside the window'`).
The demo's self-test script (`npm run selftest -- --plugin demo`) starts the demo and fails on
each plugin that does neither. A new plugin lands with its step or its skip reason.

Sections, in order: Shell, Sessions and chat, Agent forms, Workflows, Modes, Bars, Live. The Live
section ends on the demo's own **real-session step**.

## Demo sessions

Steps that show sessions launch **demo sessions**: chat sessions on a scripted demo harness, the
app's fake agent harness under its own identity (harness `demo`, profile `demo`). The demo plugin
registers it when the demo starts and disposes it at Stop, in the live app as in a drive run.

- The demo harness is **unlisted**: the start prompt, usage polling and scheduling never offer
  or poll its profile.
- Demo sessions launch **ephemeral**: chat never saves them to `open-sessions.json` or records
  their folder among recent folders.
- They run in the demo's scratch folder, in the demo plugin's data, and Stop closes every one
  through chat's `closeSessionsIn`.
- They draw in their own **Demo** section at the top of the side bar. While the demo runs the
  side bar shows only that section; `Space d h` shows the real sessions again.
- A step drives its sessions through the fake's triggers (`fake: tool`, `fake: permission`,
  `fake: workflow feature`, …) and, for anything else, by emitting entries on the session's fake
  process from its main half.

## Real state stays untouched

No step reads or writes the user's real state. Each plugin's step shows sample data, and its
actions do nothing on that data:

- **Unity pool**: the badge and panel show sample clones; Hold, Release and Open do nothing on
  them.
- **Schedules**: demo schedules never fire and never reach the schedule store.
- **Auto-retro**: ignores demo sessions (harness `demo`); it never launches a retro for one.
- **Chatroom**: the demo room lives in memory.
- **Forms**: the forms step shows sample rounds only, never the user's saved rounds.
- **App update**: the button shows a sample status; pressing it installs nothing.
- **Notes**: the popup shows a sample note; its follow-up actions write nothing.
- **Docs**: sample pages from the scratch folder; the user's docs index is never rebuilt.

**Off-by-default plugins** (agent lines, the usage tab line, the docs session tab, and any later
one) start in memory for the demo's run, through the plugin switch's `runForNow`, so their steps
can show; `settings.json` is never written, and Stop restores the user's list.

The **Live view** step streams a real window — the Unity editor when one is running, else the
app's own — through the existing Screen Recording grant, and stops the stream when the step is
left.

## The step agent

Under the step list, the Demo panel holds the current step's **step agent**: a real Claude
session, one conversation per step (scoped-agents, scope = the step id), working in the clone the
app was built from (the dev app's own repo in the dev app). Each message carries the step's id,
plugin, files, caption and current beat, so the user can ask for a change to the feature on
screen. Through agent-commands' `run_command` the agent can jump the demo (`demo.goTo`), step it,
reset the step or stop the demo. The conversations persist across demo runs, as Backlog's
assistant does; Stop leaves them.

## Starting and stopping

The first `Space d d` starts the demo: it registers the demo harness, starts the off-by-default
plugins in memory, hides the real sessions behind the Demo section, shows the panel and the
caption, and enters the first step.

The **real-session step** launches a real Claude session in the scratch folder, on the default
profile, with the fixed prompt `Say hello to the team in one short sentence.`, and shows it.

`Space d x` stops the demo: it leaves the current step (removing its setup), closes every demo
session and the real-session step's session, disposes the demo harness, restores the plugin
list and the side bar, and removes the panel and the caption. Hiding the panel alone keeps the
demo running, with the current step still set up.

## Rejected

- **A separate demo window or a mode of its own**: the user chose the everyday app, with the
  panel in the right bar on screen in every mode.
- **A highlight ring or per-element callouts**: the caption stays high level; what it points at
  is obvious on screen.
- **Real agents for every step**: steps use the scripted harness, and one optional last step
  starts a real session.
- **Writing `plugins.disabled` to show off-by-default plugins**: the plugin switch starts them in
  memory instead, so a crash mid-demo leaves the user's settings as they were.
- **A demo registry exported by the demo plugin**: every plugin would depend on `demo`, and
  turning it off would stop them all; the registry is core instead.
- **Reusing the layout previews' commands for steps**: forms' preview cycles the user's saved
  rounds, and the previews have no uniform close; each step builds its own sample.
