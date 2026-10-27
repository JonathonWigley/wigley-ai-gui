# Primer port — plan

Feature: Feature primer in the app · Implements: none · Ticket: none
Target: `main` in wigley-ai-gui and `main` in wigley-ai-marketplace · Written: 2026-10-26

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the run delivers.
- **Architecture** — the systems the run touches in each repo.
- **Preconditions** — repository state the plan rests on, with the command that checks it.
- **Docs written ahead** — the docs already committed, and their commits.
- **Mandatory Reads** — the agent files every task reads first.
- **Design Overview** — the after-state flow, decisions, and out-of-scope items.
- **File Structure** — every file the run creates or changes, and every shared name and signature.
- **Rules for every task** — shell, third-party, git and test rules every task follows.
- **Tasks** — the wave checklist.
- **Run log** — written by `wigley:make`.

## Goal

Port the feature primer from the marketplace's Python MCP server (`scripts/primer/`, `wigley-primer`) into
wigley-ai-gui as the `primer` plugin. The primer runs on one agent form lifecycle that forms' rounds also use, and
its Primer tab follows `DESIGN.md` and the plugin structure. The marketplace retires the old server and its
dashboard, and its relay, wait guard and retro readers serve the primer through the `wigley-forms` server.

## Architecture

wigley-ai-gui:

- `src/contracts/alerts.ts` and its two adapters — the open count becomes per source.
- `src/contracts/agent-forms.ts` (new) — the generic agent form contract.
- `src/shared/agent-forms/` (new layer) — the service, stores and presenters lifted out of `src/plugins/forms/main/`.
- `src/shared/page/` — page modules lifted out of `src/plugins/forms/page/`, and the new `toggleMark` primitive in
  `src/shared/page/ui/`.
- `src/plugins/forms/` — adopts the shared lifecycle and the shared page modules. Behaviour does not change.
- `src/plugins/primer/` (new plugin) — manifest, contract, main part, page part.
- `src/plugins/gallery/` — shows the new primitive.
- `src/plugins/manifests.ts`, `main.ts`, `page.ts`, `keymap.ts`, `scripts/check-layers.mts` — registration.

wigley-ai-marketplace (`plugins/wigley/`):

- `scripts/primer/` and `scripts/dashboard/` — deleted.
- `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` — the `wigley-primer` server entry goes; version bump.
- `scripts/forms/relay.py` and its tests — the built-in tool list gains the primer tools.
- `scripts/forms/wait_guard.py` and its tests, `hooks/hooks.json` — the Stop hook waits on primers too.
- `scripts/retro/` readers and tests — read primer files in the saved-round format.

## Preconditions

`wigley:make` re-runs each command before the first dispatch. A different result is a Ruling before any task runs.

| Claim | Command | Result at plan time |
| --- | --- | --- |
| GUI `main` holds the docs commit and is ahead of origin | `git -C ~/Documents/ai-dev/wigley-ai-gui log --oneline origin/main..main` | lists `1722d1e`; a peer session's recency-stars commits sit beside it (5 at plan time, re-verify) |
| Marketplace `main` holds the docs commit | `git -C ~/Documents/ai-dev/wigley-ai-marketplace log --oneline origin/main..main` | lists `804cf0e`; peer docs-index commits sit beside it (4 at plan time, re-verify) |
| Marketplace version in both manifests | `grep -n '"version"' ~/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/.claude-plugin/plugin.json ~/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/.codex-plugin/plugin.json` | `1.10.3` twice (a peer's docs-index bump, commit `621ee51`; origin holds `1.10.2`); task 12 bumps to `1.11.0` |
| A peer session is running the recency-stars plan in the same tree; leave its files alone | `git -C ~/Documents/ai-dev/wigley-ai-gui status --short` | peer changes under `src/plugins/docs/` and `docs/features/docs-browser/plan-recency-stars/`; commit only this plan's paths |
| The old primer and dashboard are still in the tree | `command ls ~/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/scripts` | lists `dashboard` and `primer` |
| Forms' open count is one global number | `grep -rn "setOpenCount" ~/Documents/ai-dev/wigley-ai-gui/src --include='*.ts'` | `setOpenCount(count: number)` in `src/contracts/alerts.ts`; callers in `forms/main/channel-presenter.ts`, `main/alerts/electron-alerts.ts`, `main/alerts/silent-alerts.ts` (measured at plan time, re-verify) |
| Retro reads primer files in four modules | `grep -rln primer ~/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/scripts/retro --include='*.py'` | `answers.py`, `owners.py`, `digest.py` and tests `test_answers.py`, `test_owners.py`, `test_digest.py`, `test_record_fields.py`, `test_retention.py` (measured at plan time, re-verify) |

The peer plan `plan-recency-stars` may also bump the marketplace version. Task 12 bumps from whatever version the
tree holds then to the next minor version, and names the peer's bump in its report when it finds one.

## Docs written ahead

- wigley-ai-gui `1722d1e`, and the plan commit (which also carries a `design.md` fix: need `unclear`, and no box keys
  in the review): `AGENTS.md`, `DESIGN.md`, `docs/keymap.md`, `docs/features/primer/design.md`,
  `docs/features/followups.md`, `docs/features/master-plan.md`.
- wigley-ai-marketplace `804cf0e`: `AGENTS.md`, `README.md`, `plugins/wigley/scripts/forms/README.md`
  (§ The feature primer), `plugins/wigley/skills/feature-primer/SKILL.md`, `plugins/wigley/skills/retro/criteria.md`.

Task 13 re-reads each one against the landed code.

## Mandatory Reads

Every task reads these before it starts:

- `~/Documents/ai-dev/wigley-ai-gui/AGENTS.md` (GUI tasks)
- `~/Documents/ai-dev/wigley-ai-gui/DESIGN.md` and `docs/keymap.md` (page, key and CSS tasks: 03, 04, 06, 07)
- `~/Documents/ai-dev/wigley-ai-gui/docs/features/primer/design.md` (every GUI task)
- `~/Documents/ai-dev/wigley-ai-marketplace/AGENTS.md` (marketplace tasks)
- `~/Documents/ai-dev/wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md` § The feature primer (05, 08, 09,
  10, 11)

No `CLAUDE*.md`, `AGENTS.local.md` or `.claude/rules/*.md` exists in either repo (checked with
`find <repo> -maxdepth 3 -name 'CLAUDE*.md' -o -maxdepth 3 -name 'AGENTS*.md' -not -path '*/node_modules/*'` and
`command ls <repo>/.claude/rules` at plan time).

## Design Overview

```
 agent ──open_primer / collect_last_primer──▶ relay.py (wigley-forms) ──▶ sessions: tool routing
                                                                              │
                     ┌────────────────────────────────────────────────────────┤
          forms main: round tool session                        primer main: primer tool session
                     │                                                        │
       AgentFormService(roundType)                            AgentFormService(primerType)
                     └─────────────── src/shared/agent-forms ─────────────────┘
                       one open form per session · deadline → draft · re-attach
                       hand-back · pre-fill · unreadable reported once · end
                     ┌──────────────────────┴───────────────────────┐
          folder store per type                         channel presenter per type
   ~/.agents/wigley-forms/rounds/                 formShown / formClosed ──▶ page
   ~/.agents/wigley-primer/primers/               openForms / draft / finish ◀── page
                                                  alerts.setOpenCount(source, n) · close guard · sessions.mark
                                                                      │
                       forms page: Form tab ◀──────────┴──────────▶ primer page: Primer tab
                       (shared page modules: store, autosave, editor boxes, key hints,
                        confirm prompt, session form tab helper)
```

Decisions (all settled; the interview's round 1 took every recommendation, and the user asked the agent to settle
every remaining decision):

- One shared lifecycle, lifted from forms into `src/shared/agent-forms/`, generic over `AgentFormType`. Forms is the
  round type; the primer is the second type.
- Saved primers use the saved-round format in `~/.agents/wigley-primer/primers/`. Old primer files are not migrated.
- The Primer tab is a fixed rail-and-card view with a review pane before send, built from the primitives, with page
  events and exports. No user-editable layout.
- A session holds one open round and one open primer at once. A second primer waits behind the open one.
- `Alerts.setOpenCount(source, count)`; the adapter sums the sources.
- The generic channel names are `openForms`, `draft`, `finish`, `formShown`, `formClosed`. The forms page maps a
  presented form to its `PresentedRound` at the channel boundary in `page/start.ts`, so forms' page state keeps its
  `roundId` names.
- Forms' `FormsSession` methods become the generic `open` and `collect`; `FormsService` and `FormsSession` stay as
  type aliases of the generic types in the forms contract.
- `no_primer` and `needs_manual_open` payloads carry no `feature` and no `entries`.
- Primer texts (summary, next, not-shown, hand-back, unreadable, session-ended) are forms' texts with `round` read as
  `primer`, `ask_round` as `open_primer` and `collect_last_round` as `collect_last_primer`, except the texts pinned in
  task 05.
- Keys are the table in `docs/features/primer/design.md` § Keys.

Out of scope:

- A user-editable primer layout.
- Migrating old primer files.
- The other copies of the key-hint helper in forms' kinds (tracked follow-up).
- Forms' behaviour: every forms test passes unchanged in meaning; only names and imports move.

## File Structure

### Shared names (every part uses these word for word)

`src/contracts/alerts.ts` (task 01):

```ts
export interface Alerts {
  announce(title: string, body: string, onClick: () => void): void;
  // `source` names the caller (a plugin id); the badge shows the sum of every source's count.
  setOpenCount(source: string, count: number): void;
}
```

`src/contracts/agent-forms.ts` (task 02, new). The contracts layer imports nothing outside `src/contracts`, so the
owner and sessions types are structural; `AgentSession` and `SessionsMainExports` satisfy them.

```ts
export interface AgentFormOwnerInfo {
  sessionId: string | null;
  projectDir: string | null;
  deadlineSeconds: number | null;
}
export interface AgentFormOwner { id: string; info: AgentFormOwnerInfo }

export type AgentFormEndKind = 'submitted' | 'cancelled';
export interface AgentFormEnd<Body> { kind: AgentFormEndKind; body: Body }

export interface PresentedAgentForm<Form, Body> {
  formId: string;
  sessionId: string;
  // `project · heading`, or the heading alone without a project.
  label: string;
  form: Form;
  draft: Body | null;
}
export interface AgentFormListener<Body> {
  draft(body: Body): void;
  finish(end: AgentFormEnd<Body>): void;
}
export interface AgentFormPresenter<Form, Body> {
  show(form: PresentedAgentForm<Form, Body>, listener: AgentFormListener<Body>): void;
  close(formId: string): void;
}
export interface AgentFormClosed { formId: string; byFinish: boolean }

// Type aliases, not interfaces: ChannelShape needs index signatures an interface lacks.
export type AgentFormInvoke<Form, Body> = {
  openForms(): PresentedAgentForm<Form, Body>[];
  draft(formId: string, body: Body): void;
  finish(formId: string, end: AgentFormEnd<Body>): void;
};
export type AgentFormMessages<Form, Body> = {
  formShown: PresentedAgentForm<Form, Body>;
  formClosed: AgentFormClosed;
};
export interface AgentFormChannel<Form, Body> extends ChannelShape {
  invoke: AgentFormInvoke<Form, Body>;
  messages: AgentFormMessages<Form, Body>;
}

export interface AgentFormSession<Payload> {
  open(args: unknown, toolUseId: string | null, signal: AbortSignal): Promise<Payload>;
  collect(wait: boolean, signal: AbortSignal): Promise<Payload>;
  end(): void;
}
export interface AgentFormService<Payload> {
  startSession(owner: AgentFormOwner): AgentFormSession<Payload>;
}

// What one kind of agent form supplies to the shared service.
export interface AgentFormType<Form, Body, Payload> {
  // The tool names the service's texts name.
  openTool: string;
  collectTool: string;
  // The word for one form in texts and logs: 'round', 'primer'.
  noun: string;
  // The `name` of the Error `parse` throws for a malformed call; the tool session returns its message as the tool error.
  argsErrorName: string;
  parse(args: unknown): Form;
  fingerprint(form: Form): string;
  heading(form: Form): string;
  // The heading in a saved form's raw args, or null when they hold none.
  savedHeading(args: unknown): string | null;
  // Never throws: a missing or malformed field keeps the form's own value.
  readBody(form: Form, raw: unknown): Body;
  // A new form's draft from the newest saved body with its fingerprint; `finished` is true when that save finished.
  prefill(form: Form, saved: Body, finished: boolean): Body;
  payload(form: Form, outcome: AgentFormEndKind | 'draft', body: Body): Payload;
  handedBackPayload(form: Form, outcome: AgentFormEndKind, body: Body): Payload;
  noFormPayload(): Payload;
  notShownPayload(form: Form, blockingHeading: string | null): Payload;
}

// The parts of the sessions plugin's main exports a presenter uses.
export interface AgentFormSessions {
  mark(sessionId: string): void;
  activate(sessionId: string): void;
  addCloseGuard(mayClose: (sessionId: string) => boolean): void;
}
```

`src/shared/agent-forms/` (task 02, new layer, main side only):

```ts
// form-service.ts
export interface AgentFormServiceDeps<Form, Body, Payload> {
  type: AgentFormType<Form, Body, Payload>;
  presenter: AgentFormPresenter<Form, Body>;
  store: AgentFormStore;
  defaultDeadlineSeconds(): number;
}
export function createAgentFormService<Form, Body, Payload>(
  deps: AgentFormServiceDeps<Form, Body, Payload>,
): AgentFormService<Payload>;

// form-store.ts — the saved-round format, field for field as round-store.ts has it today
export const RETENTION_SECONDS: number; // 90 days
export type SavedOutcome = 'open' | AgentFormEndKind;
export type AgentFormOwnerRef = Pick<AgentFormOwnerInfo, 'sessionId' | 'projectDir'>;
export interface SavedAgentForm { id; fingerprint; args: unknown; body: unknown; outcome: SavedOutcome; returned;
  session_id; project_dir; tool_use_id; created; updated }
export type FinishedSavedAgentForm = SavedAgentForm & { outcome: AgentFormEndKind };
export interface AgentFormStore {
  create(owner: AgentFormOwnerRef, fingerprint: string, args: unknown, body: unknown | null, toolUseId: string | null): SavedAgentForm;
  saveBody(record: SavedAgentForm, body: unknown): void;
  finish(record: SavedAgentForm, outcome: AgentFormEndKind, body: unknown): void;
  markReturned(record: SavedAgentForm): void;
  newestFor(fingerprint: string): SavedAgentForm | null;
  newestUnreturnedFinished(owner: AgentFormOwnerRef, excluding: ReadonlySet<string>): FinishedSavedAgentForm | null;
  recentArgs(limit: number): unknown[];
  prune(): void;
}
export function createFolderFormStore(deps: {
  dir: string; clock: Clock; randomHex: RandomHex; paths: Paths; log: Log; logSource: string;
}): AgentFormStore;

// memory-form-store.ts — the store forms' layout preview uses today, moved and renamed
export function createMemoryFormStore(/* the deps memory-round-store.ts takes today */): AgentFormStore;

// channel-presenter.ts
export interface AgentFormChannelPresenter<Form, Body> extends AgentFormPresenter<Form, Body> {
  quiet: AgentFormPresenter<Form, Body>;
}
export function createAgentFormChannelPresenter<Form, Body>(deps: {
  channel: Pick<MainChannel<AgentFormChannel<Form, Body>>, 'handle' | 'send'>;
  alerts: Alerts;
  // The source id for setOpenCount, and the plugin id the log names.
  source: string;
  // The notification title for a new form: 'New review round', 'Feature primer ready'.
  announceTitle: string;
  window: { show(): void };
  log: Log;
  sessions: AgentFormSessions;
}): AgentFormChannelPresenter<Form, Body>;

// scripted-presenter.ts — the test adapter
export class ScriptedFormPresenter<Form, Body> implements AgentFormPresenter<Form, Body> { /* forms' ScriptedRoundPresenter, generic */ }

// tool-session.ts
export function createAgentFormToolSession<Payload extends object>(
  session: AgentFormSession<Payload>,
  tools: { open: string; collect: string },
  argsErrorName: string,
): AgentFormToolSession; // AgentFormToolSession and AgentFormToolResult restate the sessions ToolSession/ToolResult in agent-forms.ts
```

`src/plugins/primer/contract.ts` (task 05, new). The fields are the payload shape in the forms README § The feature
primer.

```ts
export type PrimerNeed = 'yes' | 'no' | 'unclear';
export type PrimerGroup = 'primer' | 'standing' | 'extra';
export interface PrimerItem { text: string; include: boolean; comment: string; added: boolean }
export interface PrimerEntry {
  id: string; group: PrimerGroup; number: number | null; area: string; question: string; task: string;
  need: PrimerNeed; evidence: string; probes: string; pointer: string; comment: string; items: PrimerItem[];
}
export interface PrimerFeature { name: string; slug: string; spec: string; summary: string; notes: string }
// The parsed open_primer call: the form the service shows.
export interface Primer { feature: PrimerFeature; entries: PrimerEntry[] }
// What the page sends back and the file's `body` holds.
export interface PrimerBody { feature: PrimerFeature; entries: PrimerEntry[] }
export type PrimerOutcome = 'submitted' | 'draft' | 'cancelled' | 'needs_manual_open' | 'no_primer';
export interface PrimerPayload {
  outcome: PrimerOutcome; summary: string; next: string;
  feature?: PrimerFeature; entries?: PrimerEntry[]; earlier_heading?: string;
}
export const PRIMER_ERROR_NAME = 'PrimerError';
export const PRIMER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const MAX_PRIMER_ENTRIES = 60;
export const MAX_PRIMER_ITEMS = 20;
export type PresentedPrimer = PresentedAgentForm<Primer, PrimerBody>;
export type PrimerChannel = AgentFormChannel<Primer, PrimerBody>;

// The page part's events and exports (written by task 05, used by tasks 06 and 07).
export type PrimerView = 'primer' | 'review' | 'confirm' | 'idle';
export type PrimerFinishOutcome = 'submitted' | 'cancelled' | 'closed';
export interface PrimerPageEvents extends EventShape {
  primerShown: PresentedPrimer;
  needChanged: { primerId: string; entryId: string; need: PrimerNeed };
  primerFinished: { primerId: string; outcome: PrimerFinishOutcome };
}
export interface PrimerPageExports { activePrimer(): PresentedPrimer | null }
```

`src/plugins/primer/manifest.ts` (task 05 creates it as `primerManifest` with `id: 'primer'`, `dependsOn: ['sessions', 'keys']`,
the settings `deadlineSeconds` (default 240) and `autosaveDelayMs` (default 400), and no commands; task 06
adds the commands and scopes). The channel is the `PrimerChannel` type argument of `MainApi`, as forms does.

### Files by task

| Task | Files |
| --- | --- |
| 01 | modify `src/contracts/alerts.ts`, `src/main/alerts/electron-alerts.ts`, `src/main/alerts/silent-alerts.ts`, `src/plugins/forms/main/channel-presenter.ts` (call site only) · test the electron-alerts sum if a test file exists beside it, else create `src/main/alerts/open-counts.ts` + test for the summing |
| 02 | create `src/contracts/agent-forms.ts`, `src/shared/agent-forms/{form-service,form-store,memory-form-store,channel-presenter,scripted-presenter,tool-session}.ts` + tests moved from forms · modify forms main (`contract.ts`, `start.ts`, `preview/*`, `selftest-script.ts`) and `src/plugins/chat/main/selftest-script.ts` (the presenter log line) and add `src/plugins/forms/main/round-type.ts`, `src/shared/agent-forms/test-form-type.ts` and `src/plugins/forms/page/presented-round.ts` + test; `forms/main/tool-session.ts` moves to shared · delete the moved forms files · modify `scripts/check-layers.mts` · modify `src/plugins/forms/page/start.ts` and any forms page file that names the old channel messages |
| 03 | create `src/shared/page/{reducer-store,autosave,editor-boxes,key-hint,confirm-prompt,session-form-tabs}.ts` + tests moved from forms · modify forms page files to use them · delete the moved forms page files, except a thin forms `autosave.ts` adapter |
| 04 | create `src/shared/page/ui/toggle-mark.ts` and its CSS · modify `src/plugins/gallery/page/*` |
| 05 | create `src/plugins/primer/{manifest,contract}.ts`, `src/plugins/primer/main/{primer,primer-error,primer-type,tool-definitions,start,fixtures}.ts` + tests · modify `src/plugins/manifests.ts`, `src/plugins/main.ts`, `scripts/check-layers.mts` |
| 06 | create `src/plugins/primer/page/{primer-state,primer-store,primer-commands,boxes,ids,test-primers}.ts` + tests · modify `src/plugins/primer/manifest.ts` (commands, scopes), `src/plugins/keymap.ts` |
| 07 | create `src/plugins/primer/page/{primer-view,primer-review,start,primer-events}.ts`, `primer.css` + tests · modify `src/plugins/page.ts`, `scripts/check-layers.mts` |
| 08 | create `src/plugins/primer/main/selftest-script.ts`; drive actions in `src/plugins/primer/main/start.ts` |
| 09 | marketplace: delete `plugins/wigley/scripts/primer/`, `plugins/wigley/scripts/dashboard/`; modify both `plugin.json`, `scripts/forms/relay.py`, `scripts/forms/tests/test_relay.py` |
| 10 | marketplace: modify `scripts/retro/{answers,owners,digest}.py` and their tests, `test_record_fields.py`; delete `test_retention.py` (its only subject, `primer/store.py`, goes in 09) |
| 11 | marketplace: modify `scripts/forms/wait_guard.py`, `scripts/forms/tests/test_wait_guard.py`, `plugins/wigley/hooks/hooks.json` |
| 12 | marketplace: modify both `plugin.json` versions |
| 13 | the docs written ahead, as listed above |
| 14 | none (verification) |

Each task document holds its own exact file list; this table is the map for wave checks.

Boundary rules:

- `src/shared/agent-forms/` takes `src/contracts`, `src/shared` and `node:` only. No plugin import.
- Forms main and primer main import `src/shared/agent-forms`; their page parts do not.
- `src/shared/page/` modules name no plugin: no `round`, `primer` or `forms` in a shared name.
- The primer reaches sessions and keys only through their contracts, as forms does.
- CSS uses tokens only (`scripts/check-styles.mts`).

## Rules for every task

Every dispatch prompt carries these:

- **Third-party code** reaches the machine only on the user's yes, asked per package. Run no `npm install`,
  `npm ci`, `pip install`, download or clone. A task that needs a package stops and reports the need.
- **Shell:** zsh with BSD utilities. Quote every glob. Use absolute paths. `awk`, `sleep`, `node`, `npx` and package
  installs are denied: use `npm run <script>`, `npm test`, `grep`, `sed` and `python3`. `ls` is
  eza: use `command ls`. Scratch files go in the session scratchpad the lead names.
- **Git:** commit on `main` in the repo the task names, one commit per group, a descriptive message, no
  `Co-Authored-By` trailer. Never push. A peer session works in the same tree: stage only the paths the task
  changed (`git add <path>`, never `git add -A` or `.`), and never commit, stash or revert a file the task did not
  change.
- **Browser:** launch no browser and no browser automation.
- **Tests:** the commands are `npm test -- <path or name>` (Vitest), `npm run typecheck`, `npm run lint` in
  wigley-ai-gui, and `python3 -m unittest discover -s <dir> -t <root>` in the marketplace as its `AGENTS.md` names.
  `wigley:make` owns when they run.
- **Blocked:** a fact in a task document that the code contradicts is a concern to report, not a silent change.
  A worker that needs another agent reports the need instead of spawning one.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Alerts open count per source](01-alerts-per-source.md)
- [x] [Toggle mark primitive](04-toggle-mark.md)
- [x] [Retro reads primer files in the saved-round format](10-retro-readers.md)
- [x] [Wait guard covers primers](11-wait-guard.md)

### Wave 2
- [x] [Shared agent form lifecycle; forms adopts it](02-agent-forms-lifecycle.md) — after 01
- [x] [Retire the primer server and dashboard; relay tools](09-retire-primer-server.md) — after 10

### Wave 3
- [x] [Shared page modules; forms adopts them](03-shared-page-modules.md) — after 02
- [x] [Primer main part, manifest and contract](05-primer-main.md) — after 02
- [x] [Marketplace version bump](12-marketplace-bump.md) — after 09, 10, 11

### Wave 4
- [x] [Primer page state, commands and keys](06-primer-page-state.md) — after 03, 05

### Wave 5
- [x] [Primer page view, review and start](07-primer-page-view.md) — after 04, 06

### Wave 6
- [x] [Primer self-test and drive actions](08-primer-selftest.md) — after 07

### Wave 7
- [x] [Doc re-read](13-doc-re-read.md) — after every code task

### Wave 8
- [x] [Final verification](14-final-verification.md) — after 13

## Run log

Review base: 87af8bb

### Groups
- 01 · 7b5daeb · diff read: Alerts and createOpenCounts present as planned; typecheck passes · concerns: none
- 04 · 9a512e3 · diff read: toggleMark, setToggleMark, ToggleMarkOptions and the gallery section present as planned; typecheck passes; worker ran lint clean; visual check is task 14 live check 5 · concerns: none
- 11 · 38df6cc (marketplace) · diff read: PRIMERS_DIR, PRIMER_CALL_SUFFIXES, PRIMER_STAND_DOWN_OUTCOMES, both pinned reasons, decide(hook_input, rounds_dir, primers_dir) and main present as planned; forms suite 86 OK · concerns: marketplace AGENTS.md's hooks.json tree line names only the round (task 13 owns it)
- 10 · e623def (marketplace) · diff read: primer_lines on args/body, owners key args.feature.slug, digest heading args.feature.name, PRIMER_KEYS and saved_round_fields present as planned; retro suite 166 OK; check_pointers passes · concerns: saved_round_fields returns every backticked name in the contract paragraph (tool and outcome names too), so its name promises slightly more; answers.py module docstring has one line past the wrap width
- 09 · 0f1370f (marketplace) · diff read: four BUILT_IN_TOOLS, OPEN_PRIMER_INPUT_SCHEMA as pinned, NOT_STARTED_NEXT and APP_GONE templates, not_started(reason, tool), _pending dict present as planned; both folders gone from git; forms suite OK, retro suite OK (wave check), check_manifests passes · concerns: marketplace AGENTS.md § Done (lines 101, 104) still lists the dashboard and primer unittest commands, now failing — the task's 'nothing to remove there' was wrong; task 13 removes them
- 12 · 3bf1f34 (marketplace) · diff read: only version lines changed, 1.11.0 in both; check_manifests passes with and without --against origin/main · concerns: none
- 02 · 8c2adbf · diff read: every agent-forms contract name, the six shared modules, roundType, withKnownLayouts, presentedRoundOf and the forms contract aliases present; layers entry added; typecheck passes; worker ran lint and 845 tests across shared/agent-forms, forms and chat main · concerns: stale doc lines name deleted files: AGENTS.md 259 (ANSWER_LISTS in forms-service.ts), followups.md 218 and 278, master-plan.md 181 (task 13); preview-round.ts sample text quotes FormsSession.askRound; form-store.test.ts keeps roundsDir/roundFiles helper names
- 05 · f241356 · diff read: every contract.ts name plus PRIMER_NEEDS, primerManifest, primer.ts functions, primerType, PRIMER_TOOLS, fixtures, primerMainPart and registration present; typecheck clean outside task 03's in-flight forms page files (full compile re-checked when 03 lands); worker ran 44 primer main tests and the layer check · concerns: no test pins the TS open_primer schema against relay.py's copy, so they can drift; the pinned items error says 'two to six of them' while the limit is 20 (kept verbatim from primer.py)
- 03 · 2e2a0e5 · diff read: all six shared modules' Produces and the forms-side FormsStore, FORMS_BOX_IDENTITY, startRoundAutosave present; no shared name holds round/forms/primer; full typecheck passes (also closes task 05's compile proof); worker ran lint and 702 tests over shared/page and forms · concerns: isSending as specified differs from the old render check in one state (view confirm with no active round now settles an owed dismiss) — looks unreachable; followups.md lines 39 and 78 name moved forms page modules (task 13)
- 06 · c439c93 · diff read: ids, primer-state, primer-store, boxes, primer-commands exports present as planned; 29 commands and five scopes in the manifest; keymap Primer section; typecheck passes; worker ran lint and 61 tests over primer page and keymap · concerns: add-item commit clears newItemTexts but the mounted editor keeps its text unless 07 reacts; addExtraTask focuses the new taskName box synchronously, so 07 must mount the new card's boxes in its store listener; boxText throws on a stale task or item; ids.ts sits in page/ (forms and chat keep theirs at the plugin root)
- 07 · 8d153fb · diff read: primerPagePart, primer-events, primer-review and mountPrimerTab exports present; registration and layer lines added; typecheck passes; worker ran lint and 71 primer page tests; the view, card and CSS first run in task 08's self-test · concerns: startPrimerEvents copies forms' startFormsEvents queue and primer.css copies forms' status-line and box rules (lift candidates); the rail's 'Press A to add one' text is fixed, not read from the keymap; view, re-entrant render and keepFocusedBox rebuild are untested until the self-test; primerPagePart is listed before keysPagePart it depends on, relying on dependency ordering
- 08 · 9e8b8f7 · diff read: primerSelfTestScript and addDriveActions present, wired in primerMainPart with dispose; worker ran typecheck, lint, 50 primer main tests and npm run selftest — all groups pass, primer result as expected (screenshots .selftest/screenshots/primer-{rail,card,review}.png) · concerns: addDriveActions copies forms' word for word (follow-up candidate: a shared drive helper); review lists included items before left-out ones while the payload keeps sent order; status bar shows Unsaved while the review is open; forms' answers toast overlaps the bottom of the primer screenshots
- 13 · 6ce6b3b (gui), 0617159 (marketplace) · diff read: GUI AGENTS.md, DESIGN.md, keymap.md, primer/design.md, master-plan.md, followups.md and marketplace AGENTS.md hooks line + forms README tool count match the code; stale-reference grep clean in code both repos; npm run lint, check_pointers and check_manifests pass; marketplace Done lines already dropped by peer commit 4f6bb42 · concerns: retro answers.py:24 and owners.py:21 docstrings say 'forms or primer' (primer folder gone); peer docs-browser plan folders (plan-recency-stars 03, plan-ownership 05) still run scripts/dashboard and scripts/primer suites; form-service.test.ts still uses the folder store (follow-up stays open); claude-stream.md keeps the wigley-primer name as a recorded capture
- 14 · none (verification only) · GUI: npm run typecheck 0, npm run lint 0, npm test 200 files / 3205 tests pass. Marketplace: check_manifests (plain and --against origin/main), check_pointers, claude plugin validate, and the scripts, docs-index, forms, plan, retro, unity-playtest, unity-ux-flow suites pass. npm run selftest: all passed (rerun after a peer edit reloaded the page mid-run in attempt 1; pre-reload pass was clean too). Drive run 20261026-182946-61e4 (.drive/20261026-182946-61e4/screenshots/): 1 primer submit PASS (c1-rail/card/review.png); 2 NOT RUN — forms.openRound and primer.openPrimer each connect their own session, so no drive action puts both in one session; primer cancel prompt alone reads well (c2-primer-prompt.png), moved to the user checks; 3 forms unchanged PASS (status chip Saved, answers read back); 4 bad slug PASS, submit refused, answers pending (c4-review.png); 5 gallery ToggleMark PASS (c5-gallery.png) · concerns: check 2 (two guards on one session) unverified live; forms log says 'finding 1 answered' for a note-only answer while the payload says untouched; the primer cancel dialog showed the review view behind it on a row whose review was never opened
### Contract changes
### Rulings
- Two repos, two review bases: wigley-ai-gui 87af8bb (the Review base line), wigley-ai-marketplace b3daa93. A peer session (ai-dev-05, recency-stars plan) shares the GUI tree, so every commit is pathspec-scoped and each review range is this run's explicit commit list — lead
- The presenter test's fake records [source, count] tuples in one array — one toEqual per assertion — only that test file changes if wrong · group 01 · group 01
- The pressed style applies to an off mark only (:not(.is-selected)); a pressed on mark keeps its accent-hover fill — an on mark shows no press feedback if the plan wanted some · group 04 · group 04
- _Kind holds a heading_path key tuple, not a callable — a kind whose heading is not a key path needs a function · group 11 · group 11
- _Transcript keeps the last outcome per tool_use_id (reply_outcomes) — a twice-answered call uses its last outcome · group 11 · group 11
- A round whose args.heading is a truthy non-string now reads untitled, per the both-kinds fallback · group 11 · group 11
- Sent items are a set of trimmed texts and _item_lines takes was_sent: bool — same meaning as the spec's sent-is-not-None form · group 10 · group 10
- Body-side entry ids are not trimmed (the app trims body) — a padded body id would read as [PRIMER-TASK] · group 10 · group 10
- saved_round_fields raises AssertionError when the contract paragraph is missing, so a README rewording fails loudly · group 10 · group 10
- Test helper is a new named_tool_call(request_id, name, arguments) beside tool_call, which delegates to it · group 09 · group 09
- _tool_name is read in _forward and in each _answer_alone branch, not once in handle_line · group 09 · group 09
- not_started gives the primer shape only for the primer words; any unknown tool name gets the round payload, as today · group 09 · group 09
- Bumped 1.10.3 → 1.11.0, past the peer's unpushed docs-index bump 621ee51; origin holds 1.10.2 · group 12 · group 12
- The unparseable-saved-round test lives in both round-type.test.ts (round texts) and form-service.test.ts (generic texts) — one redundant test if wrong · group 02 · group 02
- Moved test names keep askRound/collectLastRound/no_round wording while calling open/collect and asserting no_form · group 02 · group 02
- withKnownLayouts parses and checks layouts before the service's turn queue, so a malformed round rejects ahead of the queue (same RoundError, nothing saved or shown) · group 02 · group 02
- createFolderFormStore's private writeRecordOrLog and pruneOlderThan take logSource · group 02 · group 02
- A group sent as JSON null is rejected; only a missing group defaults to primer · group 05 · group 05
- readPrimerBody keeps the last sent entry per id and takes non-slug feature fields untrimmed, as the Python did · group 05 · group 05
- primer-type.test.ts runs on createMemoryFormStore, so no on-disk assertions · group 05 · group 05
- SessionFormTabs.takeOver throws on a session with no mounted tab instead of adding one, so a caller that skipped mount fails loudly · group 03 · group 03
- forms-view wraps the sessions and keys export methods in arrows when handing them to shared modules · group 03 · group 03
- The autosave loop's private saveRound is renamed saveDraft · group 03 · group 03
- The primer page layer entry in check-layers.mts landed with 06 (task 07's line, without the page.ts part) so 06's lint could pass; 07 adds only the page.ts lines · group 06 · group 06
- Every handler first dispatches the box's focusActionFor, scroll and leaveBox included (forms skips those) · group 06 · group 06
- showTarget applies only to the active primer; removeExtraTask resets itemCursor to 0 · group 06 · group 06
- Need, remove-extra, add-item and toggle handlers log only when the store changed, so a sending-blocked dispatch logs nothing · group 06 · group 06
- needTag and taskName are exported from primer-review.ts and imported by the view, avoiding a parts module · group 07 · group 07
- The view's render re-runs once when a dispatch lands during a render (keepFocusedBox refocus, settleOwedDismiss) · group 07 · group 07
- Card and review each scroll in their own container so leaving the review keeps the card's scroll · group 07 · group 07
- A toggle-mark click dispatches selectItem then toggleInclude on the store, not the command, so a click logs no 'included item' line — drive toggles by key · group 07 · group 07
- scrollsItself stays [] — .primer-card and .primer-review-pane scroll in their own boxes but all three checksFit steps pass · group 08 · group 08
- No forms or chat step needed a changed expectation · group 08 · group 08
### Review rounds
- Round 1 · implementation review, 10 lanes (K1–K5, D1–D5) · GUI 87af8bb→32bbbb3, marketplace b3daa93→0617159 (explicit commit lists) · 30 findings (8 important) + 4 pre-existing · Verdict: NEEDS FIXES · report scratchpad/review-32bbbb3.md
- Round 2 fixes: GUI 13c06e4 0f41232 72fbd88 b6bfa4d 2bfc68b, marketplace 3ca9a7b; #32 decided as contract kept (isAnswered/isResponded). Re-review cycle 1 (correctness K1/K2/K3, 32bbbb3..2bfc68b): NEEDS FIXES, 1 important + 7 minor (review-2bfc68b.md); every prior finding closed. Live check 2 PASS, drive run 20261026-230303-73b0.
### Test gate
- Gate: full npm test (3205 pass), npm run selftest (all groups pass), marketplace Done suites (all pass) — picked whole because tasks 02 and 03 move code under every forms path and 09 deletes two marketplace suites; drive run checks 1,3,4,5 pass, 2 not reachable by drive (user check)
