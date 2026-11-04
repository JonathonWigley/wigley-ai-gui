# Session hub — plan

Feature: chat-bar · Implements: none · Ticket: none
Target: main · Written: 2026-11-03

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the user gets.
- **Architecture** — the systems this plan touches.
- **Preconditions** — the state this plan needs, with the commands that check it.
- **Docs written ahead** — the commit that holds them.
- **Mandatory Reads** — what each implementer reads first.
- **Design Overview** — the after-state, the decisions and what stays out.
- **File Structure** — new files, modified files, shared names and boundary rules.
- **Tasks** — the wave checklist.
- **Run log** — written by `wigley:make`.

## Goal

Every Chat tab gets a session hub: a column beside the transcript with four titled sections. Main agent shows the live activity dock. Plan shows the workflow side pane. Skills shows each skill an agent started. Session shows the session's facts. The composer gets smaller: shell tasks become one-line rows, the context bar moves above the box, and the dock leaves only one line, which shows only while the hub is not visible.

## Architecture

Systems touched:

- `chat` page plugin: the hub's section frame, its hide state, the Main agent and Session sections, the dock's move.
- `workflow` plugin: its side part becomes the Plan section.
- `agents` plugin: `Roster` gains `skills`.
- `agent-skills`: a new plugin that draws the Skills section.
- `agent-strip` plugin: task boxes become rows under the cards.
- `usage` plugin: its Chat status part splits into a composer part and a status part.
- `keymap`: one new bind.

## Preconditions

This plan runs after the side pane plan lands on `main` and closes. Both have happened, and the close deleted that plan's folder, `docs/features/workflow/plan-chat-side-pane/`. The first two rows now pass. `wigley:make` stops at preflight when a row fails.

| Claim | Command that checks it | At plan time |
|---|---|---|
| The side pane plan landed | `grep -n 'addSidePart' src/plugins/chat/contract.ts` prints a line | prints nothing |
| The side pane plan closed | `test ! -e docs/features/workflow/plan-chat-side-pane/plan.md` exits 0, or every box in it is ticked | 0 boxes ticked |
| `row-clock` merged | `git merge-base --is-ancestor row-clock main` exits 0 | exits 0 |
| `Space v s` is free | `grep -n '<Leader>vs' src/plugins/keymap.ts` prints nothing | prints nothing |
| No user layout overrides a changed part | `find ~/.config/wigley-ai-gui/layouts -maxdepth 3 -name layout.js` prints nothing | prints nothing |
| The doc commit is in the tree | `git merge-base --is-ancestor 68948b9f HEAD` exits 0 | exits 0 |

When the side pane plan lands with a name other than the names this plan quotes from it, the landed name wins. Report it as a contract change in the Run log.

## Docs written ahead

Commit `68948b9f` and the commit that adds this plan folder hold:

- `docs/features/chat-bar/design.md`
- `DESIGN.md`
- `AGENTS.md`
- `docs/features/agent-chat/design.md`
- `docs/features/layouts/design.md`
- `docs/features/usage/design.md`
- `docs/features/workflow/design.md`
- `docs/features/agent-tower/design.md`
- `docs/keymap.md`

These docs are hypotheses until task 08 re-reads them against the landed code.

## Mandatory Reads

- `AGENTS.md`: § Architecture for the plugin rules, layouts and parts; § Running and testing for the commands.
- `DESIGN.md`: the Chat bullet.
- `docs/features/chat-bar/design.md`: the whole file. It is the spec of this plan.

The repo has no `CLAUDE*.md`, `.claude/rules/` or `AGENTS.local.md` that touches this code.

## Design Overview

```
.chat-tab  (flex row, inline-size container named chat-tab)
├── .chat-main
│    ├── entries
│    └── composer
│         ├── workflow strip        composer part
│         ├── agent strip           composer part: cards, then task rows
│         ├── usage context line    composer part
│         ├── .chat-working-slot    workingLine; CSS hides it while the hub is visible
│         ├── attachments, box
│         └── status line           usage spend is its status part
└── .chat-side-parts  264 px; hidden under 640 px and on Space v s
     ├── Main agent   order 10   chat: .chat-dock-slot, the `working` part
     ├── Plan         order 20   workflow: its side pane
     ├── Skills       order 30   agent-skills: its list
     └── Session      order 40   chat: the `sessionFacts` part

createActivityDock (one per tab, in the composer surface)
  ├─► `working` draw in the dock slot
  ├─► `workingLine` draw in the working slot
  └─► onDockChanged listeners ─► Main agent's section summary
```

Decisions:

- A section is a side part with a frame. Chat draws the frame through a new `sideSection` layout part. The part draws the frame's body.
- `ChatSidePart` stops extending `ContributedPart`, because its `build` takes a third parameter. Chat adapts it to a `ContributedPart` for `placeContributedPart`.
- CSS alone chooses between the dock and the one line. No code measures the Chat tab.
- The surface moves one element, the dock slot, into the Main agent section. So a composer draw still redraws the dock on a layout change, and the part holds no draw of its own.
- `Space v s` and section collapse apply to every session and survive a relaunch, through `uiState`.
- A task row shows no owner until it is opened.

Out of scope:

- Live thinking text or a thinking token count.
- The 5h and Week limits in the hub. They stay in the usage details.
- Spend in the Session section. It stays in the status line.
- Keys or focus for the hub.
- What counts as a skill. A typed message that starts with `/` and is no control command already emits `skillStarted` (`typedSkill`). The list shows what the fold emits.
- Saving the skills across a resume.

## File Structure

New files:

- `src/plugins/chat/page/side-sections.ts`: the frame, order, collapse and hub hide state. The tests have a seam here that `chat-view.ts` does not give.
- `src/plugins/chat/page/main-agent-part.ts`: the Main agent side part.
- `src/plugins/chat/page/session-part.ts`: the Session side part and its pure input.
- `src/plugins/agent-skills/`: the new plugin, in the shape of `src/plugins/agent-lines/`. Skills is a view over a data plugin, and it can be disabled.

Shared names (more than one task uses each):

```ts
// src/plugins/chat/contract.ts ← 01
export interface ChatSideSection { setSummary(text: string | null): void; }
export interface ChatSidePart {
  id: string;
  title: string;
  order: number;
  build(parent: HTMLElement, sessionId: string, section: ChatSideSection): { dispose?(): void };
}

// src/plugins/agents/contract.ts ← 05
export interface RosterSkill { skill: string; agentId: string; ownerName: string; }
// Roster gains `skills: RosterSkill[]`
```

Section orders and titles: `chat.mainAgent` `Main agent` 10 · `workflow.sidePane` `Plan` 20 · `agent-skills.list` `Skills` 30 · `chat.session` `Session` 40.

CSS class names more than one task uses: `.is-side-hidden` on `.chat-tab` (01, read by 04) · `.chat-side-section-body` (01, read by 04 and 06).

Boundary rules:

- Chat names no workflow, agents or usage type. A section's plugin depends on chat.
- A plugin's own layout draws its section's body. Chat's layout draws only the frame.
- Layouts import no app code. The dock's time is formatted once in the layout for its own text and once in the page for the summary, because the summary is a string the part hands to chat.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Hub frame](01-hub-frame.md)
- [x] [Task rows](02-task-rows.md)
- [x] [Context line](03-context-line.md)

### Wave 2
- [x] [Activity move](04-activity-move.md) — after 01, 02, 03
- [x] [Skills section](05-skills-section.md) — after 01, 02
- [x] [Plan section](06-plan-section.md) — after 01

### Wave 3
- [x] [Session section](07-session-section.md) — after 01, 04

### Wave 4
- [x] [Doc re-read](08-doc-re-read.md) — after 01–07

### Wave 5
- [ ] [Final verification](09-final-verification.md) — after 08

## Run log

Review base: ad87d46f110e63f41f0a1d404e1c3db1d19d82fa

### Groups
- 03 · 13367469 · diff read: every Produces present; typecheck clean at the commit; worker: lint clean, usage tests 201 pass · concerns: start.ts wiring and the new self-test lines are unproved until task 09 and the filtered self-test; the context line has no vertical spacing of its own; AGENTS.md:262 and usage design.md:163 stale, left for 08
- 02 · fe66c847 · diff read: both Produces present; typecheck names nothing in agent-strip; worker: lint clean, agent-strip tests 92 pass, seven mutations each caught · concerns: self-test regex assumes the row head fits the logged 80 characters; a key prompt may make a selected row taller than the max-height calc assumes; both for task 09
- 01 · 11ecd75f · diff read: every Produces present; typecheck clean at the commit; worker: lint clean, 224 tests in the touched files pass · concerns: self-test row and hub look unseen until task 09; Plan section looks wrong until 06; command label capitalised while its neighbours are lowercase, for the review; one chatPartDraws serves all sections, so one update throw moves all to default until layouts change
- 06 · 9abd4356 · diff read: section summary and CSS move present; worker: typecheck and lint clean, workflow-view tests 65 pass; the tree compile waits on 04 and 05 in flight · concerns: .workflow-side-list keeps flex 1 inside a flex 0 1 auto pane and a scrolling section body, so whether the actions row stays in view rests on check 4 in task 09
- 04 · e063716c · diff read: every Produces present; worker: 226 tests in the touched files pass, lint clean but for 05's file; typecheck names only 05's in-flight Roster.skills · concerns: a throwing onDockChanged listener stops the dock's tick until the next set, and the only listener cannot realistically throw; a failed default working draw shows nothing at hub width until the next composer draw; self-test and composerOf wiring rest on task 09; agent-strip.css:5-6 still says beside the activity dock, for the review
- 05 · 4c790705 · diff read: every Produces present and check-layers holds only agent-skills entries; worker: typecheck and lint clean, 154 tests in the touched folders pass · concerns: the self-test has not run, and the fit check may need another selector at minimum width; a very long subagent name on a flex-none tag could scroll the section sideways; the log fires from a draw, so a never-opened tab logs late
- 07 · 6b720a24 · diff read: every Produces present; typecheck and lint clean over the whole tree at the commit; worker: 171 tests in the touched files pass · concerns: the subgrid label column and value ellipsis are unseen until task 09; facts listeners fire on every status line draw, box focus included, patching about five rows, unmeasured; session-part.ts and chat-view.ts import each other, type-only at one end
- 08 · 336c30c7 · every listed doc checked and all 54 grep hits read; lines changed: AGENTS.md:262-263, usage design.md:163-164, followups.md:226-233; keymap.ts and docs/keymap.md agree on Leader v s; oxfmt clean · concerns: the followups short-tab entry is unverified at the new layout and says to recheck first
### Contract changes
- WorkflowView.sidePart: ContributedPart wrapped in start.ts → ChatSidePart literal with title and order from 01 · why: the side pane plan landed it as ChatSidePart · consumers: 06 · group 01
- createSideSections: members left open → SideSections { openTab, toggleHidden }, SideTab { sync, rebuild, close } · why: lead's per-tab handle ruling · consumers: none directly; 04 and 07 add parts through the store · group 01
- ChatViewDeps: sideParts narrowed to onChanged, sideSections added · why: placement moved to side-sections.ts · consumers: 04, 07 · group 01
- createSideSections: members left open → SideSections { openTab, toggleHidden }, SideTab { sync, rebuild, close } · why: lead's per-tab handle ruling · consumers: none directly; 04 and 07 add parts through the store · group 01
- ChatViewDeps: sideParts narrowed to onChanged, sideSections added · why: placement moved to side-sections.ts · consumers: 04, 07 · group 01
### Rulings
- Task 01 does not wrap the workflow part in start.ts: it adds title and order to the sidePart literal in workflow-view.ts and start.ts passes view.sidePart, because the side pane plan landed sidePart as ChatSidePart, so the wrap alone cannot compile; 06 keeps the summary and CSS — if wrong, one literal moves · lead
- ChatSidePart already landed standalone, so 01's stops-extending line is met; 01 only adds title, order and the section parameter — no cost if wrong · lead
- Two usage comments name every host, not only the tab bar, because they describe every usage line — a comment rewording if wrong · group 03 · group 03
- SessionLineInput extends ContextLineInput and SpendLineInput, and sessionLineText reuses contextLineText — restore the flat copy if wrong · group 03 · group 03
- start.ts builds all five line parts through a local linePart helper, rewriting the row parts' wiring beyond the task's two — expand it back if wrong · group 03 · group 03
- .agent-strip-rows CSS sits in page/agent-strip.css because the app makes that element and it has no data-layout — only the rule moves if wrong · group 02 · group 02
- .agent-strip-command loses its padding and background so a row fits the plan's max-height calc, with flex none on rows and a space-1 margin under the cards — task 09's look check settles it · group 02 · group 02
- trackOf keeps its signature and finds the box's kind in holder.boxes; draw uses heldTrack and heldRows because its boxes are not pushed until drawn — a small signature change if wrong · group 02 · group 02
- A per-tab SideTab handle (sync, rebuild, close) in side-sections.ts replaces syncSideParts and disposeSideParts; the layout handler calls rebuild, which disposes once and builds again — three functions move back if wrong · lead · group 01
- Tests use installFakeDom, the repo's convention, not jsdom, so the :has hide rules are unseen by tests; task 09 sees them — none if wrong · lead · group 01
- Only a newly built wrapper moves to its sorted place, so a built section keeps its scroll; it moves after its part builds — a part reading its wrapper's position during build sees the holder's end · group 01 · group 01
- The layout-change GIVEN lives in chat-view.test.ts since the handler stays in mountChatView; rebuild runs after drawComposer in that loop — two lines swap if wrong · group 01 · group 01
- The summary is set in drawPart's sidePane case so every draw path sets it — a throwing layout leaves it on an emptied, hidden section · group 06 · group 06
- hold takes section: ChatSideSection | null, chip and strip passing null — one nullable field to reshape if wrong · group 06 · group 06
- Both slots share one private createDockPart in composer-kit.ts, because the decision asks for one draw, update and retry path — a local refactor if wrong · group 04 · group 04
- .chat-working-head gained min-width 0, so a compaction trigger ellipsizes in the one line — a clipped trigger if wrong · group 04 · group 04
- rosterChanged skips the draw when the skills match the last draw, compared as JSON, because every subagent tool call changes the roster and a redraw closes an open tooltip — drop the check and its test if wrong · group 05 · group 05
- isSameSkillRow is exported from agents/roster.ts so the fold and rowRoster share one row definition — one more export · group 05 · group 05
- The self-test's scrollsItself also lists the sibling Chat scripts' selectors, because the fit check reads the whole page — lets a little more clip than needed if wrong · group 05 · group 05
- drawStatusLine notifies once after the fallback, so both GIVENs hold from one line; a throw from the fallback's drawComposer skips it, as before · group 07 · group 07
- Session rows take text-12 and gap space-1 space-2 to match the section heads — one CSS line if wrong · group 07 · group 07
- The short-tab follow-up is rewritten rather than deleted, keeping its reverted-CSS history — a wrong keep costs one stale follow-up · group 08 · group 08
- The context line's meter has min-width 0 rather than the plan's floor, because the composer's least width does not hold the floor — the meter shrinks to nothing past about 32 px more text · lead
### Review rounds
- 1 · pin f2748613, commits 13367469 fe66c847 11ecd75f 9abd4356 e063716c 4c790705 6b720a24 336c30c7 c4bcaf4a · correctness x4, plan-and-design x3 · Verdict: NEEDS FIXES · 31 findings, report /tmp/claude-session-hub/review-f2748613.md · determined fixes 0d5afc70 84f97d47 4940c1a8 24ef24ec 118fd0a3 · AGENTS.md:705-709 dismissed: written ahead for the unmerged foundation-sweeps branch · redundant usage fit check dropped · user took every recommendation by the round's note, standing for this session
### Test gate
- npm test, whole suite, because task 09 names it and vitest takes 16 s: every changed plugin's tests plus its neighbours · 416 files, 7467 tests pass, typecheck and lint clean
- filtered self-test (chat, agent-strip, usage, workflow, agent-lines, agent-skills), named by task 09 · first run one failure: compacting-narrow, context line 342 px in 326 px; fixed in c4bcaf4a; usage self-test re-run passes, 20 PASS, usage tests 201 pass
