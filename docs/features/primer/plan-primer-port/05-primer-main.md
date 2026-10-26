# 05 — Primer main part, manifest and contract

Status: done
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Rules: every rule in [plan.md § Rules for every task](plan.md#rules-for-every-task) applies.

The `primer` plugin's manifest, contract and main part. Main ports the old `primer.py` rules into a `primerType`, runs
it on the shared agent form service from task 02, serves `open_primer` and `collect_last_primer` to every agent
session, saves primers in `~/.agents/wigley-primer/primers/`, and shows them on the `PrimerChannel`. No page part yet
(tasks 06 and 07), no self-test and no drive actions (task 08).

Source of the rules: wigley-ai-marketplace `plugins/wigley/scripts/primer/primer.py` (`parse_primer`,
`_parse_entry`, `data_from_body`, `_merge_entry`, `_extra_entry`, `_items_from`, `answers_payload`, `_NEXT`) and
`plugins/wigley/scripts/primer/server.py` (`TOOLS_LIST_RESULT`). Task 09 deletes them; read them before then, or
with `git show` from the marketplace's history.

Files:     create `src/plugins/primer/manifest.ts`, `src/plugins/primer/contract.ts` ·
           create `src/plugins/primer/main/primer-error.ts`, `primer.ts`, `primer-type.ts`, `tool-definitions.ts`,
           `start.ts`, `fixtures.ts` (each under `src/plugins/primer/main/`) ·
           test (create) `src/plugins/primer/main/primer.test.ts`, `primer-type.test.ts`, `tool-definitions.test.ts` ·
           modify `src/plugins/manifests.ts`, `src/plugins/main.ts`, `scripts/check-layers.mts`

Consumes:  from 02, in `src/contracts/agent-forms.ts`: `AgentFormType`, `AgentFormEndKind`, `PresentedAgentForm`,
           `AgentFormChannel` ·
           from 02, in `src/shared/agent-forms/`: `createAgentFormService`, `createFolderFormStore`,
           `createAgentFormChannelPresenter`, `createAgentFormToolSession`, `ScriptedFormPresenter`,
           `createMemoryFormStore` (tests) ·
           from 01: `Alerts.setOpenCount(source: string, count: number): void` (through the presenter) ·
           from the tree: `definePlugin` in `src/shared/define-plugin.ts`; `MainApi`, `MainPart`, `EventShape` in
           `src/contracts/plugin.ts`; `SessionsMainExports`, `ToolDefinition`, `ConnectedSession`, `Harness`,
           `ToolResult` in `src/plugins/sessions/contract.ts`; `isJsonObject` in `src/shared/json.ts`

Produces:

`src/plugins/primer/contract.ts` — every name in `plan.md` § Shared names under that file, word for word: `PrimerNeed`,
`PrimerGroup`, `PrimerItem`, `PrimerEntry`, `PrimerFeature`, `Primer`, `PrimerBody`, `PrimerOutcome`, `PrimerPayload`,
`PRIMER_ERROR_NAME`, `PRIMER_SLUG_PATTERN`, `MAX_PRIMER_ENTRIES`, `MAX_PRIMER_ITEMS`, `PresentedPrimer`,
`PrimerChannel`, `PrimerView`, `PrimerFinishOutcome`, `PrimerPageEvents`, `PrimerPageExports`. Plus one list the
parser and the page share:

```ts
// The needs in tally order of the old primer: yes, no, unclear.
export const PRIMER_NEEDS: readonly PrimerNeed[] = ['yes', 'no', 'unclear'];
```

`src/plugins/primer/manifest.ts`:

```ts
export const primerManifest = definePlugin({
  id: 'primer',
  dependsOn: ['sessions', 'keys'],
  commands: {},
  scopes: {},
  settings: { autosaveDelayMs: 400, deadlineSeconds: 240 },
  settingInfo: {
    autosaveDelayMs: {
      label: 'Autosave delay',
      description: "How long after a change a primer's draft is saved, in milliseconds.",
    },
    deadlineSeconds: {
      label: 'Primer deadline',
      description:
        'How long an agent waits on a primer before it gets a draft back, in seconds, when its session names no deadline.',
    },
  },
  themeTokens: {},
});
```

`src/plugins/primer/main/primer-error.ts`:

```ts
export class PrimerError extends Error { constructor(message: string) } // sets this.name = PRIMER_ERROR_NAME
```

`src/plugins/primer/main/primer.ts`:

```ts
export function parsePrimer(args: unknown): Primer;                        // throws PrimerError
export function readPrimerBody(primer: Primer, raw: unknown): PrimerBody;  // never throws
export function primerFingerprint(primer: Primer): string;
export function savedPrimerHeading(args: unknown): string | null;
export function primerPayload(primer: Primer, outcome: AgentFormEndKind | 'draft', body: PrimerBody): PrimerPayload;
export function primerHandedBackPayload(primer: Primer, outcome: AgentFormEndKind, body: PrimerBody): PrimerPayload;
export function noPrimerPayload(): PrimerPayload;
export function primerNotShownPayload(primer: Primer, blockingHeading: string | null): PrimerPayload;
```

`src/plugins/primer/main/primer-type.ts`:

```ts
export const primerType: AgentFormType<Primer, PrimerBody, PrimerPayload>;
```

`src/plugins/primer/main/tool-definitions.ts`:

```ts
export const PRIMER_TOOLS: ToolDefinition[]; // open_primer, collect_last_primer
```

`src/plugins/primer/main/fixtures.ts` (task 08 and the tests use it):

```ts
// A valid open_primer call: four entries, needs yes, unclear, no and yes.
export const SAMPLE_PRIMER_ARGS: { feature: Record<string, string>; entries: Record<string, unknown>[] };
export function connectFixtureSession(
  sessions: Pick<SessionsMainExports, 'connect'>,
  spec: { sessionId: string; projectDir: string | null; harness: Harness; deadlineSeconds: number | null },
): ConnectedSession;
// Calls open_primer in the session as an agent would, with no tool use id and a signal nothing aborts.
export function openFixturePrimer(session: ConnectedSession, args: unknown): Promise<ToolResult>;
```

`src/plugins/primer/main/start.ts`:

```ts
export const primerMainPart: MainPart<typeof primerManifest>;
```

Decisions:

- **Parse** (`parsePrimer`) ports `parse_primer` and `_parse_entry` rule for rule, in the same check order. Strings
  are trimmed; Python's `{x!r}` becomes `'x'` in single quotes; indices stay 1-based. Error texts, verbatim:
  - `"open_primer takes an object with 'feature' and 'entries'."` — args not an object
  - `"'feature' must be an object with name, slug, spec and summary."`
  - `` `${where}.${key} is required and must be a non-empty string.` `` — `where` is `feature` or `entries[<i>]`
  - `` `feature.slug '${slug}' must be lowercase letters, digits and dashes.` `` — tested with `PRIMER_SLUG_PATTERN`
  - `"'entries' must be a non-empty array: the eighteen primer rows, then the standing tasks."`
  - `` `'entries' holds ${n} entries; the limit is ${MAX_PRIMER_ENTRIES}.` ``
  - `` `entries[${i}] must be an object.` ``
  - `` `entries[${i}].group must be 'primer' or 'standing'.` `` — a missing `group` is `'primer'`
  - `` `entries[${i}].need must be 'yes', 'no' or 'unclear'.` ``
  - `` `entries[${i}].items must list the work items as strings, two to six of them.` `` — not an array, or empty
  - `` `entries[${i}].items holds ${n} items; the limit is ${MAX_PRIMER_ITEMS}.` ``
  - `` `entries[${i}].items[${j}] must be a non-empty string.` ``
  - `` `entries[${i}].id '${id}' repeats an earlier entry.` ``
  Within an entry the order is: object, group, need, items (array, limit, each string), `task`, `id`. `number` is
  kept when it is an integer (`Number.isInteger`), else `null`. `question` falls back to `task`. `area`, `evidence`,
  `probes`, `pointer` are `''` when absent. `comment` is `''`; each item is
  `{ text, include: true, comment: '', added: false }`. The feature is `{ name, slug, spec, summary, notes: '' }`,
  `spec` and `summary` `''` when absent. The entry's keys are in `PrimerEntry`'s order.
- **Read the body back** (`readPrimerBody`) ports `data_from_body` and its helpers, with one change: the page sends
  `PrimerBody` itself, so the fields sit at the top of `raw` (the old body wrapped them in `data`). Rules kept:
  - each feature field takes the sent string, else the primer's; the slug is trimmed and taken only when it
    matches `PRIMER_SLUG_PATTERN`, else the primer's slug stays
  - entries are matched by `id`; a matched entry takes the sent `need` when it is a `PrimerNeed`, the sent
    `comment` when a string, and the sent `items` when an array; every other field stays the primer's
  - sent items: the first `MAX_PRIMER_ITEMS` only; a non-object or a blank `text` is skipped; `text` trimmed;
    `include` is false only when sent `false`; `added` is true only when sent `true`; `comment` a string or `''`
  - a sent entry with `group: 'extra'`, a string `id` and an `id` not yet known is appended, once per `id`:
    `{ id, group: 'extra', number: null, area: '', question: task, task, need (sent, else 'yes'), evidence: '',
    probes: '', pointer: '', comment, items }`, `task` trimmed
  - it never throws: a missing or malformed field keeps the primer's value
- **Fingerprint.** `createHash('sha256')` hex of `JSON.stringify({ feature: { name, slug, spec, summary }, entries })`
  over the parsed primer, the entries in `PrimerEntry` key order. This is the forms README's rule ("a hash of the
  parsed `feature` (`name`, `slug`, `spec`, `summary`) and `entries`"). Old primer files are not migrated, so it
  need not match the Python hash. `notes` is left out.
- **Heading.** `primerType.heading` is `primer.feature.name`. `savedPrimerHeading(args)` returns `args.feature.name`
  trimmed when `args` is an object whose `feature` is an object whose `name` is a non-blank string, else `null`.
- **Payload** (`primerPayload`). Pinned from `answers_payload`:
  - `summary`: `` `${entries.length} entries: ${yes} yes, ${unclear} unclear, ${no} no; ${comments} comments.` ``,
    where `comments` counts every entry whose `comment` is not `''` plus every item whose `comment` is not `''`;
    on `draft` it gains `' The form is still open.'`
  - `next` on `draft`: `'The user has not submitted yet. Call collect_last_primer to keep waiting. Do not open a second primer.'`
  - `next` on `cancelled`: `'The user cancelled the primer. Write nothing, and ask the user how to proceed.'`
  - `next` on `submitted`: `''`
  - `feature` and `entries`: `readPrimerBody(primer, body)`'s
  - no `url` field: the old `needs_manual_open` "No browser opened …" text and the `url` belonged to the browser
    server; the relay now writes `needs_manual_open` (README § The feature primer), so the app never builds it
- **Hand-back** (`primerHandedBackPayload`): the payload, with `next`
  `` `These answers are for an earlier primer, '${name}', that you never received. Read them as that primer's answers. The primer you just sent was not opened: send it again with open_primer.` ``
  and `earlier_heading: name` (forms' text with `round` read as `primer`).
- **No primer** (`noPrimerPayload`): `{ outcome: 'no_primer', summary: 'No primer is open.', next }` with no
  `feature` and no `entries`, `next`:
  `"No primer is open for this session, and no finished answers are waiting for it. If you sent a primer whose answers you never received, send the same primer again with open_primer: the user's saved answers fill in. Do not move the questions into the reply."`
- **Not shown** (`primerNotShownPayload`): `primerPayload(primer, 'draft', readPrimerBody(primer, {}))` with `other`
  `'another primer'` when `blockingHeading` is null, else `` `the primer '${blockingHeading}'` ``, and:
  - `summary`: `` `This primer, '${name}', was not shown: ${other} is still open in the app.` ``
  - `next`: `` `The user has not finished ${other} in the app, so this primer was not opened and has no answers. Send this primer again with open_primer, and again after every draft like this one. Once the user finishes ${other}, a send may return that primer's answers instead, marked with earlier_heading: act on them, then send this primer again. If ${other} is no longer needed, ask the user to cancel it in the app. Do not call collect_last_primer for this primer: that returns the other primer's answers.` ``
- **`primerType` members:** `openTool: 'open_primer'`, `collectTool: 'collect_last_primer'`, `noun: 'primer'`,
  `argsErrorName: PRIMER_ERROR_NAME`, `parse: parsePrimer`, `fingerprint: primerFingerprint`,
  `heading: (primer) => primer.feature.name`, `savedHeading: savedPrimerHeading`, `readBody: readPrimerBody`,
  `prefill: (primer, saved) => saved` (a primer has no Don't-ask state to strip), `payload: primerPayload`,
  `handedBackPayload: primerHandedBackPayload`, `noFormPayload: noPrimerPayload`,
  `notShownPayload: primerNotShownPayload`. The service's own texts then read, for the primer:
  `'The session ended before this open_primer ran.'`, `'open_primer was cancelled before it ran.'`, and the
  unreadable text ending `send your primer again with open_primer.`
- **Tool definitions** (`PRIMER_TOOLS`). Task 09's `OPEN_PRIMER_INPUT_SCHEMA` (in `09-retire-primer-server.md`) is the
  source schema: each `inputSchema` here equals task 09's after every `description` and `default` key is removed (the
  slug `pattern`, `minItems`, `maxItems` and item `minLength` included). Beyond that, the schemas are `server.py`'s, with `maxItems: MAX_PRIMER_ENTRIES` on
  `entries` and `maxItems: MAX_PRIMER_ITEMS` on `items`, every `description` there kept, `additionalProperties: false`
  at each object, `required` as there (`['feature', 'entries']`; feature `['name', 'slug']`; entry
  `['id', 'task', 'need', 'items']`), `group` an enum `['primer', 'standing']` defaulting to `'primer'`, `need` the
  enum `PRIMER_NEEDS`. The descriptions name the app, not a browser:
  - `open_primer`: `"Open the feature-primer form in the wigley-ai-gui app's Primer tab, pre-filled with the agent's triage, and wait for the user's answers. Send the eighteen primer rows (group 'primer') and then the standing tasks (group 'standing') other than the edge-case sweep, which the agent writes straight into the feature folder; each entry carries its work items. The form lets the user set each task's need, tick items, comment, and add tasks and items; the result carries the edited feature and entries. Re-sending a primer is safe: the same primer re-attaches to the one still open, returns the answers of the primer just submitted, or opens pre-filled with the user's saved answers. When the result carries 'earlier_heading', those answers belong to an earlier primer you never received; read them, then send your primer again. On outcome 'draft', call collect_last_primer. Outcome 'needs_manual_open' means the relay could not start the app and no primer exists: send the same primer again with open_primer once, which tries the start again; if it comes back a second time, tell the user the reason in its 'summary'. collect_last_primer is never the answer to it. While the user is still answering another primer of this session, an open_primer for a different primer waits until the user submits or cancels that primer in the app; if its deadline passes first, it returns a 'draft' whose 'next' says the primer was not opened: send it again with open_primer, not collect_last_primer."`
  - `collect_last_primer`: `"Re-attach to the primer already open in the app and wait for the answers, or return the last finished primer's answers again. Takes no required arguments. Call this after open_primer returns outcome 'draft', and after any failure that lost the answers. Outcome 'no_primer' means no primer is open and no finished answers are waiting: send the primer again with open_primer, and the user's saved answers fill in."`
    Its schema is forms' `collect_last_round` schema: one optional `wait` boolean, `default: true`,
    `'false returns the current draft at once instead of waiting.'`
- **Main wiring** (`start.ts`), following forms' `createForms` (`src/plugins/forms/main/start.ts` lines 59–104,
  measured at plan time, re-verify) without the layouts and the preview:
  - `api` is `MainApi<typeof primerManifest, PrimerChannel, Record<never, never>, QualifiedEvents<'sessions', SessionsMainEvents>>`
    (the events type is there for task 08's `sessions.ended`)
  - store: `createFolderFormStore({ dir: path.join(services.homeDir, '.agents', 'wigley-primer', 'primers'), clock, randomHex, paths, log, logSource: 'primer' })`, then `store.prune()`
  - presenter: `createAgentFormChannelPresenter({ channel: api.channel, alerts: services.alerts, source: 'primer', announceTitle: 'Feature primer ready', window: services.window, log: services.log, sessions })`.
    The presenter adds the sessions close guard itself (as forms' does, task 02), so a session with an open primer
    asks before it closes; `start.ts` adds no guard of its own.
  - service: `createAgentFormService({ type: primerType, presenter, store, defaultDeadlineSeconds: () => api.settings().deadlineSeconds })`
  - tools: `sessions.contributeTools(PRIMER_TOOLS, (session) => createAgentFormToolSession(primer.startSession(session), { open: 'open_primer', collect: 'collect_last_primer' }, PRIMER_ERROR_NAME))`
  - returns `{ commands: {}, dispose: () => {} }`; task 08 adds the self-test and drive actions here
- **The manifest holds no channel.** `plan.md` says the manifest carries "the channel"; `definePlugin` has no channel
  field (`src/shared/define-plugin.ts`). The channel is `PrimerChannel` in `contract.ts`, the second type argument
  of the main part's `MainApi`, as `FormsChannel` is for forms.
- **`PRIMER_NEEDS`** is added beyond the Shared names: parse, read-back, the schema enum and task 06's need commands
  read one list. Its order is the old `NEEDS` (`yes`, `no`, `unclear`).
- **`fixtures.ts` copies forms' `connectFixtureSession`** (8 lines) rather than import it: a plugin imports no other
  plugin. `SAMPLE_PRIMER_ARGS`:

```ts
{
  feature: { name: 'Sample feature', slug: 'sample-feature', spec: 'docs/sample-spec.md', summary: 'A sample feature the primer tests and the self-test open.' },
  entries: [
    { id: '1', number: 1, area: 'Data', task: 'Data model', need: 'yes', items: ['Add the record type', 'Save it with the profile'] },
    { id: '2', number: 2, area: 'UI', task: 'Screen', need: 'unclear', items: ['Draw the screen', 'Wire its buttons'] },
    { id: '3', number: 3, area: 'Audio', task: 'Audio', need: 'no', items: ['Add the sound cues'] },
    { id: 'tests', group: 'standing', task: 'Tests', need: 'yes', items: ['Unit tests for the rules'] },
  ],
}
```

- **Registration.** `primerManifest` goes in `builtInManifests` after `formsManifest`; `primerMainPart` goes in
  `mainParts` after `formsMainPart`. No page part until task 07.
- **Layers** (`scripts/check-layers.mts`): add
  - `'src/plugins/primer': { layers: ['src/contracts', 'src/shared'], packages: [] }`
  - `'src/plugins/primer/main': { layers: ['src/contracts', 'src/shared', 'src/shared/paths', 'src/shared/agent-forms', 'src/plugins/primer', 'src/plugins/sessions/contract.ts'], packages: ['node:'] }`
  - `'src/plugins/primer'` to the `'src/plugins/manifests.ts'` entry's layers, and `'src/plugins/primer'` and
    `'src/plugins/primer/main'` to the `'src/plugins/main.ts'` entry's layers (lines 331–360, measured at plan time,
    re-verify)

GIVEN `SAMPLE_PRIMER_ARGS` WHEN `parsePrimer` runs THEN entry `3` has `number` 3, `question` `'Audio'`, and items
`[{ text: 'Add the sound cues', include: true, comment: '', added: false }]`
GIVEN a body with entry `2`'s second item `include: false`, a new item `{ text: 'Polish', added: true }` and an extra
entry `{ id: 'x1', group: 'extra', task: ' Docs ' }` WHEN `readPrimerBody` runs THEN entry 2 has three items with
that include and added, and the last entry is `{ id: 'x1', group: 'extra', task: 'Docs', need: 'yes', … }`
GIVEN a submitted body for `SAMPLE_PRIMER_ARGS` with one entry comment and one item comment WHEN `primerPayload`
runs THEN `summary` is `'4 entries: 2 yes, 1 unclear, 1 no; 2 comments.'` and `next` is `''`
GIVEN a primer open in a session WHEN `open_primer` runs with other entries THEN the call waits behind it, and at its
deadline returns a draft whose summary starts `"This primer, 'Sample feature', was not shown"`

Tests:

`src/plugins/primer/main/primer.test.ts` (new; ports `test_primer.py`'s parse, body and payload cases):
- `parses the sample into a primer with blank comments and every item included`
- one `it` per parse error above, each asserting its exact message: `rejects args that are not an object`,
  `rejects a missing feature`, `rejects a blank feature name`, `rejects a slug outside the slug rule`,
  `rejects empty entries`, `rejects more than 60 entries`, `rejects an entry that is not an object`,
  `rejects an unknown group`, `rejects an unknown need`, `rejects missing items`, `rejects more than 20 items`,
  `rejects a blank item`, `rejects a blank task`, `rejects a repeated id`
- `keeps an integer number and drops any other`, `falls back to the task for a missing question`
- `reads the user's need, comments and items back by id`
- `keeps the agent's question, evidence, probes and pointer whatever the body sends`
- `keeps the sent slug only when it matches the slug rule`
- `appends an extra entry once per id, needing yes by default`
- `skips blank and malformed items and keeps the first 20`
- `keeps the primer's values for a body that is not an object`
- `counts needs and comments in the summary`, `marks a draft's summary still open`
- `pins the draft and cancelled next texts`
- `gives the same fingerprint for a re-send and another for a changed item`
- `ignores feature notes in the fingerprint`
- `reads the heading of saved args, and null without a feature name`
- `builds no_primer with no feature and no entries`
- `pins the hand-back and not-shown texts`

`src/plugins/primer/main/primer-type.test.ts` (new; the type through the shared service, with
`ScriptedFormPresenter` and `createMemoryFormStore`):
- `returns the user's submitted primer as feature and entries`
- `returns a draft at the deadline and the submitted primer to collect_last_primer`
- `rejects a malformed open_primer with its PrimerError and shows nothing`
- `pre-fills a re-sent primer with the user's saved answers`
- `answers collect_last_primer with no_primer when nothing is open`
- `waits behind an open primer and returns a not-shown draft at its deadline` — summary starts
  `This primer, 'Sample feature', was not shown`

`src/plugins/primer/main/tool-definitions.test.ts` (new):
- `publishes open_primer and collect_last_primer`
- `requires feature and entries, name and slug, and id, task, need and items`
- `caps entries at 60 and items at 20`
- `offers group as primer or standing and need as yes, no or unclear`
- `names the app, never a browser` (no `browser` in either description)
- `sends needs_manual_open back to open_primer, never collect_last_primer`
- `gives collect_last_primer one optional wait flag defaulting to true`

Approach:  `primer.ts` is pure apart from `node:crypto`. Follow forms' `round.ts` for the payload helpers and
           forms' `tool-definitions.ts` for the definition layout.

Done when: `npm run typecheck` and `npm run lint` pass; the gate runs `npm test -- src/plugins/primer/main`. The tools
           reaching a live agent session and the "Feature primer ready" announcement are checked in task 14 (Final
           verification).
Commit:    one commit for the group in wigley-ai-gui

## Proof

Commit f241356 · proof: diff read: every contract.ts name plus PRIMER_NEEDS, primerManifest, primer.ts functions, primerType, PRIMER_TOOLS, fixtures, primerMainPart and registration present; typecheck clean outside task 03's in-flight forms page files (full compile re-checked when 03 lands); worker ran 44 primer main tests and the layer check · concerns: no test pins the TS open_primer schema against relay.py's copy, so they can drift; the pinned items error says 'two to six of them' while the limit is 20 (kept verbatim from primer.py)
