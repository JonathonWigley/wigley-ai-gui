# 06 — Notes contract and pure modules

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

**Contents**

- **Fields** — files, interfaces, decisions, the GIVEN/WHEN/THEN lines, tests.
- **The contract** — the draft record, the channel, the send results.
- **Pinned rules** — the one line, the session line, the note texts, the homes, the default target, the launch folder.
- **Layers** — the `LAYERS` entries this task adds.

This task lands the notes plugin's contract and every rule that the main and page parts share and a test can decide
from inputs and outputs. No part starts yet. Tasks 07 and 08 import these modules and add no rule of their own.

Files:     create `src/plugins/notes/contract.ts` · create `src/plugins/notes/draft.ts` + `draft.test.ts` · create
           `src/plugins/notes/session-ref.ts` + `session-ref.test.ts` · create `src/plugins/notes/note-targets.ts` +
           `note-targets.test.ts` · create `src/plugins/notes/main/note-text.ts` + `note-text.test.ts` · create
           `src/plugins/notes/main/note-homes.ts` + `note-homes.test.ts` · modify `scripts/check-layers.mts`
Consumes:  existing: `Harness`, `HARNESSES` (`src/plugins/sessions/contract.ts`) · `Paths` (`src/contracts/paths.ts`:
           `isInside`, `base`, `parent`, `samePath`, `tilde`) · `ChannelShape` (`src/contracts/plugin.ts`) ·
           `BacklogRead`, `BacklogHome` (`src/plugins/backlog/contract.ts`, the Backlog run's landed types; read at
           plan time: `repo`, `root`, `isCreateTarget`, `gitRoot`, `followupFiles: { path; items: FollowupItem[] }[]`)
           · `FollowupItem` (`src/shared/followups/followup-file.ts`: `title`, `done`)
Produces:  in `src/plugins/notes/contract.ts`: every type in § The contract, verbatim
           in `src/plugins/notes/draft.ts`:
           `export function emptyDraft(nextImageId: number): NoteDraft`
           `export function parseDraft(text: string): NoteDraft | null`
           `export function withFields(draft: NoteDraft, fields: NoteFields): NoteDraft`
           `export function withImageAdded(draft: NoteDraft): { draft: NoteDraft; id: number }`
           `export function withImageRemoved(draft: NoteDraft, id: number): NoteDraft`
           `export function withMarkup(draft: NoteDraft, id: number): NoteDraft`
           `export function fieldsOf(draft: NoteDraft): NoteFields`
           `export function sendRefusal(draft: NoteFields, kind: SendKind): string | null`
           in `src/plugins/notes/session-ref.ts`:
           `export const HARNESS_LABELS: Record<Harness, string>`
           `export function sessionLine(session: NoteSession, paths: Paths, homeDir: string): string`
           `export function sessionChipText(session: NoteSession, paths: Paths, homeDir: string): string`
           in `src/plugins/notes/note-targets.ts`:
           `export function defaultTarget(homes: readonly NoteHome[], projectDir: string | null, paths: Paths): NoteHome | null`
           `export function launchFolder(home: NoteHome, sessionFolders: readonly string[], paths: Paths): string | null`
           in `src/plugins/notes/main/note-text.ts`:
           `export function firstSentence(body: string): string`
           `export function followupText(draft: NoteFields, line: string | null, kind: 'create' | 'append'): string`
           `export function launchText(brief: string, draft: NoteFields, line: string | null): string`
           in `src/plugins/notes/main/note-homes.ts`:
           `export function noteHomes(read: BacklogRead, paths: Paths): NoteHomes`
Decisions: the shared rules sit in `src/plugins/notes/` beside the contract, as docs keeps `tree.ts` and `links.ts`
           beside its contract; text built only in main sits in `main/` (agent, plan time) · the draft record holds
           `fresh` and `targetPicked` flags, so the page attaches the selected session once per draft and keeps a
           target the user picked (agent, plan time) · image ids count up across drafts: a fresh draft carries on the
           old `nextImageId`, so an image file name never repeats in the data folder (agent, plan time) · a missing
           harness or folder drops its part of the session line, not the whole line: the host id alone still finds
           the transcript (agent, plan time) · the note's title leads an appended text and a launched message, so no
           typed text is dropped (agent, plan time) · the sentence rule is the plain rule below, with no abbreviation
           list: `Intl.Segmenter` output varies by ICU build, so a test could not pin it (agent, plan time)
Done when: `npm test -- src/plugins/notes` passes; `npm run lint` and `npm run typecheck` pass.
Commit:    one commit for the group

## The contract

`src/plugins/notes/contract.ts` imports only `src/contracts/plugin.ts` and `Harness` from the sessions contract.
Write it with these types, and a one-line comment on each field the name does not explain:

```ts
// The session a note names. `sessionId` is the sessions plugin's row id; `hostSessionId` the harness's own id.
export interface NoteSession {
  sessionId: string;
  harness: Harness | null;
  hostSessionId: string;
  projectDir: string | null;
}

// `id` names `images/<id>.png` and `images/<id>.markup.json` in notes' data folder.
export interface NoteImage { id: number; hasMarkup: boolean }

// What the page edits. `target` is a features home's root. `targetPicked`: the user chose the target in the
// Target picker. `fresh`: no popup has opened this draft yet.
export interface NoteFields {
  target: string | null;
  targetPicked: boolean;
  title: string;
  body: string;
  tags: string[];
  session: NoteSession | null;
  fresh: boolean;
}

// The kept draft, in strip order. `nextImageId` is the id the next image takes.
export interface NoteDraft extends NoteFields {
  images: NoteImage[];
  nextImageId: number;
}

export interface NoteFollowup { path: string; title: string }

// One repo's create-target home. `folder` is the clone the home sits in, null for a home outside its repo.
export interface NoteHome {
  repo: string;
  root: string;
  folder: string | null;
  followups: NoteFollowup[];
}

// `message`: the docs index load's line, null when none.
export interface NoteHomes { homes: NoteHome[]; message: string | null }

export type SendKind = 'followup' | 'append' | 'session';

export type FollowupRequest =
  | { type: 'create' }
  | { type: 'append'; path: string; title: string };

// `sent`: the draft was cleared, `draft` the fresh one, `toast` the line the page shows.
export type NoteSendResult =
  | { type: 'sent'; draft: NoteDraft; toast: string }
  | { type: 'refused'; reason: string };

// Every method rejects with main's own error text when its handler throws. `flattened` holds one entry per draft
// image, in strip order: the PNG with its markup drawn in, or null for an image with no markup.
export interface NotesChannel extends ChannelShape {
  invoke: {
    loadDraft(): Promise<NoteDraft>;
    saveDraft(fields: NoteFields): Promise<void>;
    image(id: number): Promise<Uint8Array>;
    addImage(png: Uint8Array): Promise<NoteDraft>;
    removeImage(id: number): Promise<NoteDraft>;
    // The image's markup JSON; null when it has none.
    markup(id: number): Promise<string | null>;
    saveMarkup(id: number, json: string): Promise<NoteDraft>;
    // Grabs the window and adds it as the draft's last image.
    capture(): Promise<NoteDraft>;
    discard(): Promise<NoteDraft>;
    homes(): Promise<NoteHomes>;
    // The tags Backlog's tag setting offers, in settings order.
    tags(): string[];
    sendToFollowup(request: FollowupRequest, flattened: readonly (Uint8Array | null)[]): Promise<NoteSendResult>;
    sendToSession(projectDir: string, flattened: readonly (Uint8Array | null)[]): Promise<NoteSendResult>;
  };
  messages: Record<never, never>;
}
```

`messages` holds nothing: main never pushes to the page. If `Record<never, never>` does not satisfy `ChannelShape`'s
`messages: Record<string, unknown>`, use `Record<string, never>` and say so in the commit message.

## Pinned rules

### Draft record (`draft.ts`)

- `emptyDraft(n)`: `target` null, `targetPicked` false, `title` '', `body` '', `tags` [], `session` null, `fresh`
  true, `images` [], `nextImageId` n.
- `parseDraft(text)`: the parsed record when the JSON holds every `NoteDraft` field with its type (each image an
  object with a whole-number `id` ≥ 1 and a boolean `hasMarkup`; `nextImageId` a whole number greater than every
  image id; `session` null or an object with string `sessionId` and `hostSessionId`, `harness` one of `HARNESSES` or
  null, `projectDir` string or null); null for any other text, bad JSON included. It keeps only the declared fields.
- `withFields` replaces the seven `NoteFields` fields and keeps `images` and `nextImageId`. `fieldsOf` reads them
  back.
- `withImageAdded` appends `{ id: nextImageId, hasMarkup: false }` and raises `nextImageId` by 1.
- `withImageRemoved` drops the image with that id; an unknown id throws `No image <id> in the draft`.
  `withMarkup` sets that image's `hasMarkup` true; an unknown id throws the same text.
- `sendRefusal(fields, kind)`, checked in this order:
  1. `target` null → `Pick a target first`
  2. `kind` `followup` and `title.trim()` is '' → `A follow-up needs a title`
  3. Else null. A note with an empty body still sends: the session line or the brief carries it.

### Session reference (`session-ref.ts`)

- `HARNESS_LABELS`: `claude` → `Claude Code`, `codex` → `Codex`. The `Record<Harness, string>` type makes a new
  harness fail to compile until it gets a label.
- `sessionLine`: `Source session: ` then the parts joined with one space: the harness label (left out when
  `harness` is null), the host session id, and `in <folder>` (left out when `projectDir` is null), the folder
  through `paths.tilde(projectDir, homeDir)`.
- `sessionChipText`: the label, the first 8 characters of the host id, and the tilde folder, joined with ` · `;
  the same parts drop out as in `sessionLine`.

GIVEN session `{ harness: 'claude', hostSessionId: 'a1b2c3d4-0000-4000-8000-000000000001', projectDir:
'/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui' }` and home `/Users/jonathonwigley` WHEN `sessionLine` runs
THEN it returns `Source session: Claude Code a1b2c3d4-0000-4000-8000-000000000001 in ~/Documents/ai-dev/wigley-ai-gui`,
and `sessionChipText` returns `Claude Code · a1b2c3d4 · ~/Documents/ai-dev/wigley-ai-gui`.
GIVEN the same session with `harness` null and `projectDir` null WHEN `sessionLine` runs THEN it returns
`Source session: a1b2c3d4-0000-4000-8000-000000000001`.

### The one line and the note texts (`main/note-text.ts`)

`firstSentence(body)`:

1. Trim the body. Take its first paragraph: the text before the first line that is blank or holds only whitespace.
2. Replace each run of whitespace (line breaks included) with one space.
3. Cut after the first `.`, `!` or `?` that is followed by a space or ends the text. Keep the mark.
4. No such mark: the whole paragraph from step 2. An empty body gives ''.

| Body | `firstSentence` |
|---|---|
| `The save button is misaligned. It sits 2px low.` | `The save button is misaligned.` |
| `Is this wrong? Yes.` | `Is this wrong?` |
| `Version 1.2 is out. Next` | `Version 1.2 is out.` |
| `Line one\nline two. More` | `Line one line two.` |
| `No full stop here` | `No full stop here` |
| `First para\n\nSecond para.` | `First para` |
| `  ` | `` |

`followupText(fields, line, kind)` joins these parts with `\n\n`, each trimmed, empty parts left out:

- `append` only: the title.
- the body.
- the session line (`line`, null when the note names no session).

`create` leaves the title out, since the item's heading holds it. Backlog adds the image links after this text.

`launchText(brief, fields, line)` joins with `\n\n`, each trimmed, empty parts left out: the brief, the title, the
body, the session line.

GIVEN brief `A nitpick to fix, noted while working. Make the change, then report.`, title `Save hint`, body `The
hint sits low.` and line `Source session: Claude Code abc in ~/r` WHEN `launchText` runs THEN it returns
`A nitpick to fix, noted while working. Make the change, then report.\n\nSave hint\n\nThe hint sits low.\n\nSource session: Claude Code abc in ~/r`.

### Homes (`main/note-homes.ts`)

`noteHomes(read, paths)`:

- Keep each home with `isCreateTarget` true: one per repo (Backlog's `markCreateTargets` guarantees it).
- `folder`: `gitRoot` when it is non-null and `paths.isInside(root, gitRoot)`; else null.
- `followups`: every item with `done` false across the home's `followupFiles`, in file order and then item order, as
  `{ path: <the file's path>, title: <the item's title> }`.
- Sort by `repo`, compared with `localeCompare`. `message` passes through.

### Default target and launch folder (`note-targets.ts`)

`defaultTarget(homes, projectDir, paths)`:

1. `projectDir` null → null.
2. Every home whose `folder` is non-null and `paths.isInside(projectDir, folder)`: the one with the longest `folder`
   wins.
3. Else walk `projectDir` and its parents, deepest first (stop at the root, where `parent` returns its input): the
   first folder whose `paths.base` equals a home's `repo` gives that home.
4. Else null.

`launchFolder(home, sessionFolders, paths)`: `home.folder` when non-null; else the first of `sessionFolders` (the
attached session's folder first, then each open row's) whose `defaultTarget` over `[home]` is `home`; else null.

Worked example, the test's data built in the test:

```
homes  A  repo wigley-ai-gui  root /Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui/docs/features
          folder /Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui
       B  repo wigley-agents  root /Users/jonathonwigley/wigley-features/wigley-agents   folder null

projectDir                                                        defaultTarget
/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui              A   (rule 2)
/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui/src/plugins  A   (rule 2, inside)
/Users/jonathonwigley/Documents/ai-dev/wigley-agents              B   (rule 3, folder name)
/Users/jonathonwigley/Documents/ai-dev/wigley-agents/skills       B   (rule 3, a parent's name)
/Users/jonathonwigley/Documents/dev/other                         null
```

`launchFolder(A, [], paths)` is A's folder. `launchFolder(B, ['/Users/jonathonwigley/Documents/dev/other',
'/Users/jonathonwigley/Documents/ai-dev/wigley-agents'], paths)` is `/Users/jonathonwigley/Documents/ai-dev/wigley-agents`;
`launchFolder(B, [], paths)` is null.

## Layers

Add to `LAYERS` in `scripts/check-layers.mts`, shaped as docs' entries are:

- `src/plugins/notes`: `src/contracts`, `src/shared`, `src/shared/paths`, `src/plugins/notes/contract.ts`,
  `src/plugins/sessions/contract.ts`; packages none.
- `src/plugins/notes/contract.ts`: `src/contracts`, `src/plugins/sessions/contract.ts`; packages none.
- `src/plugins/notes/main`: `src/contracts`, `src/shared`, `src/shared/paths`, `src/plugins/notes`,
  `src/plugins/notes/contract.ts`, `src/plugins/sessions/contract.ts`, `src/plugins/chat/contract.ts`,
  `src/plugins/backlog/contract.ts`, `src/shared/followups`; packages `node:`.
- `src/plugins/notes/page`: `src/contracts`, `src/shared`, `src/shared/paths`, `src/shared/page`,
  `src/shared/page/ui`, `src/plugins/notes`, `src/plugins/notes/contract.ts`, `src/plugins/sessions/contract.ts`,
  `src/plugins/keys/contract.ts`; packages none.
- the `src/plugins/manifests.ts` entry gains `src/plugins/notes`; `src/plugins/main.ts` gains `src/plugins/notes`
  and `src/plugins/notes/main`; `src/plugins/page.ts` gains `src/plugins/notes` and `src/plugins/notes/page`.

This task adds every notes entry, so tasks 07 and 08 edit no layer table. An entry for a folder that does not exist
yet passes the check.

## Tests

- `draft.test.ts`: `emptyDraft`; `parseDraft` round-trips a full draft and returns null for bad JSON, a missing
  field, a wrong type, an image id ≥ `nextImageId`, and an unknown harness; `withImageAdded` twice gives ids n and
  n + 1; `withImageRemoved` and `withMarkup` throw on an unknown id with the pinned text; `withFields` keeps the
  images; each `sendRefusal` row above, and a draft with a target, title and empty body returns null for all three
  kinds.
- `session-ref.test.ts`: the two GIVEN lines above, and a `codex` session's label.
- `note-text.test.ts`: every row of the `firstSentence` table; `followupText` for `create` and `append`, with and
  without a session line, and with an empty body; the `launchText` GIVEN line, and one with an empty title.
- `note-homes.test.ts`: two repos, one with two homes (only the create target kept); a done item left out; items of
  two files in file order; `folder` for an in-repo home and null for a home outside its `gitRoot`; repo sort.
- `note-targets.test.ts`: every row of the worked example and the three `launchFolder` calls, over the POSIX
  `Paths` adapter (`src/shared/paths/`).

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
