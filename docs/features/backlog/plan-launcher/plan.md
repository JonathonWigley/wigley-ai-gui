# Backlog launcher and scoped agents — plan

Feature: backlog · Implements: none · Ticket: none
Target: main (the `ai` repo, folder `wigley-ai-gui`) · Written: 2026-11-12

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Backlog stops being a per-home browser and editor and becomes the place the user reviews follow-ups across every
repo, sees whether each is stale, groups them into one-session chunks, and starts those sessions. Edits to the
backlog go through one global assistant chat drawn beside the table. The assistant and Practice's interviewer become
two registrations of one new `scoped-agents` plugin, so a later tool gets a scoped agent by registering.

## Architecture

Systems touched, all in `wigley-ai-gui`:

- **New plugin `scoped-agents`** (main, page, layouts): owned chat sessions keyed by (owner, agent id, scope),
  launched on the first ask, resumed on reopen, and checked for tool calls; and the pane that shows an ask box until
  the first message, then the session's chat through chat's `mountChat`.
- **practice**: its interviewer moves onto `scoped-agents` with one change in behaviour (Architecture decisions, the
  ask race); `practice-sessions.ts` keeps only the import session, `interviewer-pane.ts` and the `askBox` layout part
  go.
- **backlog**: main gains staleness (git), the chunk store, chunk starts through chat's `launch`, the assistant
  registration and its two tools; the page becomes one table, a review pane, a chunk strip and the assistant pane.
  The page's editor, delete, tags, commit, homes side bar and plans and features views go. Main keeps `load`, `tags`
  and `fileNote` for notes.
- **core git**: `Git.firstAdded`.
- **chat**: `ChatMainExports.restored()` (06), so backlog retires no chunk before chat's restore ends.

## Preconditions

Verified on 2026-11-12 at `b5c719691` (main); `wigley:make` re-runs each before its first dispatch:

- `grep -n "launch(request: LaunchRequest): Promise<string>" wigley-ai-gui/src/plugins/chat/contract.ts` — chat's
  `launch` resolves to the new row's sessionId.
- `grep -n "mountChat(element: HTMLElement, sessionId: string): ChatMount" wigley-ai-gui/src/plugins/chat/contract.ts`
- `grep -n "log(root: string, paths: string\[\], limit: number)" wigley-ai-gui/src/contracts/git.ts`
- `grep -n "sessionClosed: {" wigley-ai-gui/src/plugins/chat/contract.ts` — the event a chunk's end hears.
- `grep -n "contributeTools(" wigley-ai-gui/src/plugins/practice/main/start.ts` — the tool route both plugins use.
- `ls ~/.config/wigley-ai-gui/layouts/backlog ~/.config/wigley-ai-gui/layouts/practice` lists only `layout.d.ts`:
  no user layout is orphaned by the contract changes.
- `python3 -c "import json;print(json.load(open('$HOME/.config/wigley-ai-gui/settings.json')).get('backlog'))"`
  prints `None`: no user setting names a removed backlog setting.

## Docs written ahead

Written in this worktree and committed before hand-off, each new behaviour marked "planned in
`backlog/plan-launcher`, not built yet" (the docs reach `main` before the code):

- `wigley-ai-gui/docs/features/backlog/design.md` — rewritten for the launcher
- `wigley-ai-gui/docs/features/scoped-agents/design.md` — new
- `wigley-ai-gui/docs/features/practice/design.md` § The interviewer — points at scoped agents
- `wigley-ai-gui/AGENTS.md` § Architecture — the `scoped-agents`, `backlog` and `practice` entries
- `wigley-ai-gui/docs/keymap.md` — the Backlog scopes and the new keys
- `wigley-ai-gui/DESIGN.md` § Surfaces — the Backlog table

Tasks 03, 04 and 08 edit `docs/features/layouts/design.md`'s owners table with their contract changes.

## Mandatory Reads

- `wigley-ai-gui/AGENTS.md` (§ Intent, § Architecture: A plugin, A registration, A slot, A command, An MCP tool, A
  layout, A key, A focus target, the layer check; § Running and testing) — long: read with `allow_large`
- `wigley-ai-gui/DESIGN.md` (§ Keys and focus, § Primitives, § Surfaces) for every page task
- `wigley-ai-gui/docs/keymap.md` for every task that adds a key
- `wigley-ai-gui/docs/features/layouts/design.md` for every task that changes a layout contract
- the docs written ahead, above
- `~/wigley-agents/AGENTS.md` § Hard gates (no install), § Git

## Design Overview

```
                     ┌──────────────── scoped-agents (new plugin) ────────────────┐
 practice main ──addScopedAgent(interviewer, store: progress.json)──▶ main service │
 backlog  main ──addScopedAgent(assistant,   store: plugin data)  ──▶  ask / sessionOf / scopeOf
                     │   hears chat.sessionOpened/Closed/Cleared once           │
 practice page ──addAgentPane(slot, focus hooks)──▶ page pane: ask box │ mountChat
 backlog  page ──addAgentPane(slot, focus hooks)──▶                                │
                     └─────────────────────────────────────────────────────────────┘

 backlog main:  load (homes) ─▶ staleness reader (Git.log, Git.firstAdded, Files) ─▶ cache (plugin data)
                chunk store (plugin data, one writer) ◀─ page channel · set_backlog_chunks tool
                startChunks ─▶ chunkMessage(brief, items) ─▶ chat.launch ─▶ chunk.sessionId
                chat.sessionClosed ─▶ chunk retired
                read_backlog_state ◀─ backlog.place slot (page) + homes + chunks + staleness
 backlog page:  [repo chips · Ready · Hide chunked · Stale first · /]
                [table: repo │ task │ ready │ staleness │ chunk] │ [review pane] │ [assistant pane]
                [chunk strip]
```

Decisions (from the interview):

- Backlog is read-and-start only; every edit to follow-ups goes through the assistant. Main's `fileNote` stays for
  notes.
- Rows across all repos show repo, task (title and one line), ready, staleness, chunk. The review pane always shows
  the cursor item's full text and staleness note; `gl` toggles the commits since the item was written in it.
- Staleness is git-only, computed by main: `writtenAt` from the commit that first added the item's heading (05 `itemAnchor`),
  `commitsSince` over the paths the body names, `gonePaths` the named paths missing. Level: any gone path →
  `stale`; else commits since → `moved`; else no history (home outside git) → `unknown`; else `fresh`. Cached in
  plugin data keyed by row key and HEAD sha.
- Chunks live in backlog's plugin data, one repo each, keyed by row key `<repo>\n<title>`. No file tag and no
  skill change.
- A chunk start launches one session through chat's `launch` in the repo's folder, under chat's default profile,
  headless off unless the chunk's toggle is on. The first message: the `launchBrief` setting, then each item's
  title, one line, body and file location. The default brief asks the session to confirm each item still applies,
  drop or rewrite stale ones, and then work the rest under its workflow; its text is pinned in 05.
- The repo's folder: the folder above an in-repo home's `docs/features`; else the `repoFolders` setting (an array of
  `{ repo, folder }`, like chat's `projects`: user settings reject keys a default `{}` does not hold); else the start
  is refused with a toast naming the setting.
- A started chunk's items dim, link to their session (Enter on the link activates the row), and cannot join another
  chunk. Chat's `sessionClosed` for that session retires the chunk; a started chunk whose session chat no longer
  holds (a quit fires no `sessionClosed`) retires at the next edit or start.
- One global assistant: a scoped agent with scope `global`, run from the home folder, default profile, ids in
  backlog's plugin data. Its tools: `read_backlog_state` (rows, staleness, cursor item, marked rows, chunks) and
  `set_backlog_chunks` (replace a repo's unstarted chunks). Both refuse any session but the assistant.
- `W` sends the staleness sweep for the filtered repo to the assistant as a message: fix the file (remove landed
  items, rewrite drifted ones, keep the rest), land per that repo's rules, report each change.
- Keys: `x` mark, `c` add marked (or cursor) rows to the strip's cursor chunk or a new one, `u` take out of a chunk,
  `r` rename the chunk, `s` start the cursor row's or strip cursor's chunk, `S` start every unstarted chunk the strip shows (only the filtered repo's while a repo filter is on), `H`
  toggle the chunk's headless flag, `gl` commits since written, `W` sweep, `Space v b` assistant pane, `Space v r`
  repo picker, `Space v a` ready only (kept), `Space v c` hide chunked, `Space v s` stale first, `Space v d` done
  (kept). The strip is a pane the core's focus keys reach (`Alt+j` from the table); `h`/`l` move in it.
- Removed from Backlog: the homes side bar (the mode registers no side bar), the plans and features views and their
  task rows, the follow-up editor, delete, tag toggles and picker, commit, and their layout parts, scopes and keys.

Out of scope: chunking at add time (a skill change), an agent-run staleness check per item, plans in Backlog.

Architecture decisions (design review):

- `scoped-agents` is a plugin with registrations, not a shared module: chat's session events are heard once, the
  ask box draws through the plugin's own layout, and a third use is one registration.
- `ScopedAgentStore` is a real seam with two adapters (Practice's `progress.json`, Backlog's plugin data).
- Backlog main is the one writer of chunks; the page and `set_backlog_chunks` go through it.
- Staleness's decisions are pure (`namedPaths`, `stalenessOf`) over an injected `Git`; the chunk message is a pure
  builder.
- The owner is a field (`owner: string`, the host's manifest id) on `ScopedAgentSpec` and `AgentPaneSpec`: the
  host's `exports(consumer)` hands over only `Registrations` (`track`), and giving it a plugin id would touch the
  plugin host and about 20 test call sites.
- The ask race (lead's ruling, the one behaviour change in Practice): when an ask finds the record gone between its
  two reads, the service re-runs `checkAsk` and launches for the scope's current state, where Practice refused
  `<slug> has no interviewer; ask again.` The generic store cannot say an attempt changed, and the race needs a
  problem reopened as due during an ask; the page already moves to the new attempt (`scopeOpened(null)` then
  `scopeOpened(slug)`). Likewise a launch whose scope changes between `checkAsk` and `store.write` stores its record
  on the scope's state at write time (Practice: the new attempt, which then resumes the launched conversation); no
  test pins it.
- Practice's Run (`Cmd+'`) and Submit (`Cmd+Enter`) move into `scoped-agents.ask` so the interviewer's box keeps
  them; they do nothing while Practice is hidden (04).
- During waves 3–4 the old Backlog page still compiles: 06 stops serving the removed invokes but keeps their
  contract members marked "Removed in 08", and 07 adds the new `BacklogPlace` fields as optional; 08 deletes the
  old members and makes the new fields required.

## File Structure

New plugin `src/plugins/scoped-agents/`:

- `manifest.ts` — id `scoped-agents`, `dependsOn: { main: ['sessions', 'chat'], page: ['chat'] }`; commands
  `askSend` (page, scope `ask`), `leaveBox` (page, scope `ask`); scope `ask`; setting `layout`.
- `contract.ts` — the shared names below.
- `main/scoped-agent-service.ts` — the service (moved and generalized from `practice-sessions.ts`'s interviewer
  half), `main/start.ts`.
- `page/agent-pane.ts` — the pane (moved and generalized from practice's `interviewer-pane.ts`), `page/start.ts`.
- `layouts/layout.d.ts`, `layouts/default/layout.js`, `layouts/default/layout.css` — the `askBox` part, moved from
  practice's layout.
- Joins `src/plugins/manifests.ts`, `main.ts`, `page.ts`; its keys join `src/plugins/keymap.ts`.

Shared names in `src/plugins/scoped-agents/contract.ts` (every task uses these word for word):

```ts
export interface ScopedAgentRecord { sessionId: string; hostSessionId: string }
// Where a registration keeps each scope's record. Practice: the current attempt's interviewer in progress.json;
// backlog: one JSON file in its plugin data.
export interface ScopedAgentStore {
  read(scope: string): Promise<ScopedAgentRecord | null>;
  // Writes to the scope's state as it is when the write runs.
  write(scope: string, record: ScopedAgentRecord | null): Promise<void>;
  // Every scope's record, for scopeOf and following /clear's new host id.
  // Never rejects for one scope's failure: it leaves that scope out.
  entries(): Promise<{ scope: string; record: ScopedAgentRecord }[]>;
  // The record a fresh launch for `scope` replaces, closed after the launch; null for none.
  superseded(scope: string): Promise<ScopedAgentRecord | null>;
  // Throws the reason an ask for `scope` may not launch now (Practice: no attempt); resolves otherwise.
  checkAsk(scope: string): Promise<void>;
}
export interface ScopedAgentSpec {
  owner: string;                                  // the host's manifest id: 'practice', 'backlog'
  agentId: string;                                // unique within its owner: 'interviewer', 'assistant'
  folder(scope: string): string;                 // chat gets it as projectDir, so sessionOpened names it
  instructions(scope: string): Promise<string>;
  title(scope: string): Promise<string>;          // the resumed row's title
  store: ScopedAgentStore;
}
export interface ScopedAgent extends Disposable {
  ask(scope: string, text: string): Promise<string>;    // sessionId; launches, or sends to the brought-back one
  sessionOf(scope: string): Promise<string | null>;     // resumes a row chat no longer holds
  scopeOf(session: AgentSession): Promise<string | null>;
}
export interface ScopedAgentsMainExports { addScopedAgent(spec: ScopedAgentSpec): ScopedAgent }
export const scopedAgentsMainKey: DependencyKey<ScopedAgentsMainExports, 'main', 'scoped-agents'>;

export interface AgentPaneSpec {
  owner: string;
  agentId: string;
  heading(): string;                              // the ask box's heading
  hint: string;                                   // the ask box's hint line
  setShown(shown: boolean): void;                 // the host shows or hides the slot holding `element`
  resizeTarget: ResizeTarget;                     // the slot's divider
  tookKeys(): void;                               // the pane took the keys: the host's focus is the pane
  leave(): void;                                  // Esc in the ask box / Alt+h: the host takes the keys back
}
export interface AgentPane extends Disposable {
  element: HTMLElement;
  isShown(): boolean;
  toggle(): void;
  scopeOpened(scope: string | null): void;        // Practice: `<slug>` (null then the slug on a new attempt);
                                                  // backlog: 'global' once
  refresh(): void;                                // re-reads sessionOf after a host-made ask (backlog's sweep)
  hostTookKeys(): void;
  modeHidden(): void;
  outerPanes: OuterPanes;
  redraw(): void;
}
export interface ScopedAgentsPageExports { addAgentPane(spec: AgentPaneSpec): AgentPane }
export const scopedAgentsPageKey: DependencyKey<ScopedAgentsPageExports, 'page', 'scoped-agents'>;
// Channel: invoke ask(owner, agentId, scope, text): Promise<string>; sessionOf(owner, agentId, scope):
// Promise<string | null>.
```

Backlog names (`src/plugins/backlog/contract.ts`), produced by 05–07 and consumed by 08:

```ts
export type RowKey = string;                       // `${repo}\n${title}`, built only by `rowKey(repo, title)`
                                                   // in `src/plugins/backlog/row-key.ts` (05)
export interface RepoFolderSetting { repo: string; folder: string }
// BacklogHome gains repoFolder: string | null (05).
export interface BacklogStaleness {
  writtenAt: string | null; commitsSince: number; lastCommit: GitCommit | null;
  namedPaths: string[]; gonePaths: string[]; level: 'fresh' | 'moved' | 'stale' | 'unknown';
}
export interface BacklogChunk {
  id: string; repo: string; name: string; titles: string[]; headless: boolean; sessionId: string | null;
}
export type ChunkEdit =
  | { type: 'add'; keys: RowKey[]; chunkId: string | null }   // null: a new chunk named after the first title
  | { type: 'remove'; keys: RowKey[] }
  | { type: 'rename'; chunkId: string; name: string }
  | { type: 'setHeadless'; chunkId: string; headless: boolean };
export type ChunkStart = { chunkId: string; sessionId: string } | { chunkId: string; refusal: string };
// BacklogChannel.invoke gains:
//   staleness(): Promise<Record<RowKey, BacklogStaleness>>      (cached entries; the rest arrive by message)
//   commitsSince(key: RowKey): Promise<GitCommit[]>
//   chunks(): Promise<BacklogChunk[]>
//   editChunks(edit: ChunkEdit): Promise<BacklogChunk[]>        (rejects with the refusal text)
//   startChunks(chunkIds: string[]): Promise<ChunkStart[]>
//   sweep(repo: string): Promise<string>                         (the assistant's sessionId)
// and loses applyEdit, commit, readDoc: 06 stops serving them, 08 deletes them from the contract.
// BacklogChannel.messages gains:
//   stalenessRead: { entries: Record<RowKey, BacklogStaleness> }
//   chunksChanged: { chunks: BacklogChunk[] }
// BacklogPlace becomes { selectedKey: RowKey | null; repo: string | null; filter: string; marked: RowKey[];
//   isReadyOnly: boolean; isChunkedHidden: boolean; isStaleFirst: boolean; isDoneShown: boolean;
//   isAssistantShown: boolean } and main reads it for read_backlog_state (07 adds the fields optional, 08 makes
//   them required).
```

`Git.firstAdded(root: string, path: string, text: string): Promise<GitCommit | null>` in `src/contracts/git.ts`:
the oldest non-merge commit whose diff added `text` to `path` (`git log -S`), `paths` holding `path`; null when none.

Backlog settings after the change: `tags` (kept for notes), `layout`, `launchBrief`, `repoFolders` (`[] as RepoFolderSetting[]`).

Boundary rules: backlog's manifest adds `chat`, `sessions` and `scoped-agents` to `dependsOn.main` and
`scoped-agents` to `dependsOn.page` and `sessions` to `reads.page` (the page runs `sessionsSelectRowCommand` by key;
`mountChat` comes through scoped-agents); practice's adds `scoped-agents` to both and its page drops `chat` (`mountChat`
was its only use). No plugin imports another's files
beyond its `contract.ts`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Git firstAdded](01-git-first-added.md)
- [x] [Scoped agents main](02-scoped-agents-main.md)

### Wave 2
- [x] [Scoped agents page and layout](03-scoped-agents-page.md) — after 02
- [x] [Backlog staleness](05-backlog-staleness.md) — after 01

### Wave 3
- [x] [Practice on scoped agents](04-practice-on-scoped-agents.md) — after 02, 03
- [x] [Backlog chunks and starts](06-backlog-chunks.md) — after 05

### Wave 4
- [x] [Backlog assistant and tools](07-backlog-assistant.md) — after 02, 06

### Wave 5
- [x] [Backlog page](08-backlog-page.md) — after 03, 04, 07

### Wave 6
- [x] [Doc re-read](09-doc-re-read.md) — after 08
- [ ] [Final verification](10-final-verification.md)

## Run log

Review base: d2cb6a97ef2eecfcc7f325b7021451bd2c4f4d95

### Groups
- 01 · hard · 2c7ae1554 · diff read: firstAdded on Git and createProcessGit as specified, both full fakes updated, six tests; wave 1 typecheck + lint pass after fix 8bd73679b (octal escape) · concerns: dash test's toContain('-S--x') repeats the helper
- 02 · deep · c76441063 · diff read: contract names word for word, manifest, service exports HOST_ID_WAIT_MS/ScopedAgentServiceDeps/ScopedAgentService/createScopedAgentService, main part, manifests/main/PLUGIN_EXTRAS; wave 1 typecheck + lint pass after fix 8bd73679b (LaunchRequest narrowing in a test, oxfmt) · concerns: oxfmt hand-formatting; timeout cases attach rejects after advancing timers (watch for unhandled rejection at the test gate); scope-collision test relies on vi.waitFor polling under fake timers; page commands/scope/layout setting declared with no handler until 03
- 03 · deep · e992d43bb · diff read: createAgentPane/AgentPaneView/AgentPaneDeps, scopedAgentsPagePart, layout.d.ts types, readScopedAgentsLayout, createScopedAgentsKit, scoped-agents.ask binds, layouts owners row, main layout registration; wave 2 typecheck + lint pass after oxfmt 9fb5e5f46 · concerns: remount test row also expects the setScope/setFocusTarget/setResizeTarget events its setup records
- 05 · deep · 5a5c5ccc8 · diff read: RowKey/rowKey, RepoFolderSetting, BacklogHome.repoFolder, BacklogStaleness, staleness/commitsSince invokes, stalenessRead message, namedPaths/itemAnchor/stalenessOf/createStalenessReader; wave 2 typecheck + lint pass after oxfmt 9fb5e5f46 · concerns: a path or repo folder spelled through a symlink while git reports the real path reads as unknown/no history (no realPath in the reader); a cached read still asks git for each clone's HEAD; homes.ts HomeShape and five test literals (backlog page x3, notes main x2) edited outside Files for the new repoFolder field
- 04 · deep · e135cbbfd · diff read: interviewer is a scoped-agents registration with a progress.json store, interviewer-pane gone, keymap binds moved to scoped-agents.ask; wave 3 typecheck + lint pass after e9b8f553d (oxfmt) · concerns: the 'planned, not built yet' doc text is left for 09; the page test compares the fake pane's whole call list
- 06 · deep · 1ac71bc2d · diff read: every Produces present (BacklogChunk, ChunkEdit, ChunkStart, channel chunks/editChunks/startChunks/chunksChanged, chunk-store/-message/-start exports, chat restored, NoteEdit); wave 3 typecheck + lint pass after e9b8f553d (Set<string> in a test, oxfmt) · concerns: AGENTS.md chat entry lacks backlog as a consumer of launch/defaultProfile/profileOf/restored (for 09); page and backlog self-test still call removed readDoc/applyEdit/commit until 08; exports_Restored test assumes invoke returns the handler's promise unwrapped; starter's extra started set has no test of its own
- 07 · deep · e5dbd279c · diff read: every Produces present (sweep invoke, optional BacklogPlace fields, assistant.ts consts/store/sweepMessage, backlog-tools tools/AssistantPlace/backlogStateText/startBacklogTools, ready.ts AGENT_READY/isReady); wave 4 typecheck + lint pass after 7614053dc (oxfmt) · concerns: start.test's fake api now needs drive: null (undefined read as a drive run); one documentary cast in assistant.ts; design docs and AGENTS.md still say planned (for 09)
- 08 · deep · 8557485fb · split across two deep workers (A+C, B+D+E); diff read: every Produces present (state exports, 11 layout parts in LAYOUT_PARTS, kit scopes, BacklogView/Deps/Command, backlogSelectChunkCommand); wave 5 typecheck + lint pass after a645c7b79 (space-token widths, oxfmt) · concerns: the strip's <CR> has no key-hint anchor in the strip pane; self-test's first Space k b assumes Backlog is not showing at start; followup 'A click into the Backlog detail…' needs re-checking against the view; view tests mock h-scroller and wrap createSplit via vi.mock and find nodes by layout.js class names; the 40rem container query assumes Mocha's 32px space-8; rows.test.ts edited outside the Files list (the one fixture that filled the dropped fields)
- 09 · standard · da94057db · diff read: every plan-launcher 'not built yet' marker cleared outside the plan folder (only audio-picker's own remain); AGENTS.md backlog/practice/chat entries updated; wave 6 typecheck + lint pass · concerns: deep main-side wording (staleness text, tool messages) spot-checked, not re-read line by line; followups.md edited outside the Files list (one stale Backlog detail item reworded)
### Contract changes
- scoped-agents contract.ts comments: trailing aligned comments → each on its own line above its member (oxfmt 80 columns); the block's '// Channel:' comment → the ScopedAgentsChannel interface · why: oxfmt --check · consumers: 03, 04, 07, 08 (no name or type changed) · group 02
### Rulings
- Git.firstAdded paths come from git's --name-only output (which is [path] under the one-path pathspec) rather than set literally — matches log's parsing — costs nothing unless git lists another path · group 01 · group 01
- A handle is live only while the registry holds that same registration object; a disposed handle's ask/sessionOf reject and its second dispose leaves a re-added pair alone — costs a stale handle silently failing if a host keeps one · group 02 · group 02
- A store.write(scope, null) rejection after a refused resume rejects sessionOf and ask (practice's behaviour unchanged) — the plan names no case — costs a store failure there surfacing as an ask error rather than a launch · group 02 · group 02
- Lead ran oxfmt --write (formatter only, no oxlint --fix) on three files the wave 1 lint flagged, docs/keymap.md among them (pre-existing from the docs-written-ahead commit) — tooling, behaviour-preserving — none · lead
- Hiding the pane while it holds the keys runs leave() then releases them, as modeHidden does — symmetric with mode hide — costs a host that wanted keys kept on hide · group 03 · group 03
- refresh() re-holds the keys only when the answer changed what shows, leaving the caret alone — avoids stealing focus on a sweep — costs a stale caret if the host expected focus · group 03 · group 03
- The page part's held-keys record is cleared only by the pane recorded, so one pane giving up keys cannot wipe another's — costs nothing known · group 03 · group 03
- A ~ in a repoFolders entry expands against the home folder with its links resolved — matches how home roots compare — costs a mismatch only if the user expects the unresolved path · group 05 · group 05
- repoFolders setting changes are detected with isSameJson, as chat does, and send changed with homeRoot null — costs nothing known · group 05 · group 05
- commitsSince counts by filtering the latest 100 commits on writtenAt rather than stopping at the first older one — robust to non-monotonic dates — costs reading the full 100 each time · group 05 · group 05
- groupHomes keeps a home with any features-source entry, followupFiles [] when it has no follow-up file, so notes' create targets see the same homes · group 06
- a refused edit or replace writes nothing, not even the retirement it computed · group 06
- a store call whose result equals the current list writes and sends nothing · group 06
- a rejected setSession in the starter propagates and startChunks rejects · group 06
- followup-writes' setTags and delete test rows were converted to create and edit rows rather than deleted · group 06
- Wave 3: lead ran oxfmt --write on the 8 files lint flagged (editor tooling), in e9b8f553d
- the assistant store queues reads as well as writes · group 07
- one bad record makes the whole assistant.json read as {} · group 07
- set_backlog_chunks counts done rows as the repo's titles, so a repo with only done rows can take chunks · group 07
- the sweep lists only rows whose staleness is already read and triggers no read · group 07
- Wave 4: lead ran oxfmt --write on the 3 files lint flagged (editor tooling), in 7614053dc
- the place subscription passes pane.isShown() || pendingOpen so a restore made while Backlog is hidden survives a reload · group 08
- assistantSplit still stacks below 640px with the shared .ui-split CSS; no override added · group 08
- page start holds the first setContext value until the mode is added · group 08
- layout.d.ts defines its own StalenessLevel and EmptyReason, since a layout.d.ts may import only the kit · group 08
- contract.ts removals of the Removed-in-08 members landed in the A+C half; BacklogWriteResult kept for fileNote · group 08
- followups.md also drops the side-bar/editor focus-area item, whose code is gone · group 08
- Wave 5: group 08 split across two deep workers by its A–E parts (A+C, B+D+E), files disjoint; lead ran oxfmt --write on the 4 files lint flagged, in a645c7b79
- Wave 6: lead ran oxfmt --write on docs/keymap.md (table realignment), in c700ed676; 09 landed before the lint result was read, the format fix follows it
- Review step 7: the lead applied no determined fix inline; every determined finding rides the 6.2 fix workers, one worker per file, with the open ones — the set spans 40 sites in code the lead has not read
- Narrow window (review finding 4): assistantSplit stacks as every split does (a row axis cannot hold 280+520 at the 420px minimum); the stacked Backlog area takes the larger track and the table split's 2fr/3fr extends to .is-stacked — replaces 08 C's 'keeps its row axis'
- Fix round 1 (finding 2) supersedes group 06's 'a rejected setSession makes startChunks reject': setSession resolves whether it stored, and a launched session not stored becomes its chunk's refusal naming the session; a failed setSession clears the starting mark, so the chunk reads unstarted while its session runs · fix-chunks
- Fix round 1: a chunk being started refuses a rename too, as the store's 'is starting' rule reads; s on one empty chunk still reaches main and toasts main's refusal, only S skips empty chunks · fix workers
- Fix round 1: lead ran oxfmt --write on 7 fix-range files lint flagged (editor tooling), in c057ce7d0
### Review rounds
- Round 1 (implementation review, 6 correctness + 3 plan-design lanes, pinned e71eb3878): NEEDS FIXES — 4 Important (symlink staleness, launch race in the chunk store, stale agent-pane mount, narrow-window stacking), 39 Minor, 2 pre-existing; report /tmp/claude-backlog-launcher/review-e71eb3878e6652522fe81c3e01639ecebafe02fe.md. Repo rule (AGENTS.md § Review): every open finding takes its recommended pick, no round.
### Test gate
