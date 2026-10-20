# 10 — Start prompt and new session

Status: done
Type: Task
Wave: 5 · Depends on: 07, 09
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/page/start-prompt.ts` · create `src/plugins/chat/page/start-prompt-items.ts` ·
           modify `src/plugins/chat/manifest.ts` · modify `src/plugins/chat/contract.ts` ·
           modify `src/plugins/chat/main/start.ts` · modify `src/plugins/chat/page/start.ts` ·
           test `src/plugins/chat/page/start-prompt-items.test.ts`

Consumes:
- `createPicker`, `Picker`, `PickerRequest<T>` in `src/plugins/chat/page/picker.ts` ← 09
- `ChatView.reveal(sessionId)` in `src/plugins/chat/page/chat-view.ts` ← 09
- `chatCommand` in `src/plugins/chat/ids.ts` ← 09
- `ChatChannel.recentFolders(): Promise<RecentFolder[]>`, `.chooseFolder(): Promise<string | null>`,
  `.start(request: StartRequest): string`, `RecentFolder`, `ChatProfile`, `StartRequest` in
  `src/plugins/chat/contract.ts` ← 07; chat's `profiles` setting (`api.settings.profiles`) ← 07
- `MainServices.homeDir` in `src/contracts/plugin.ts` (tree); `errorText` (`src/shared/error-text.ts`, tree)

Produces:
- `src/plugins/chat/contract.ts`: `ChatChannel.invoke` gains `homeDir(): string;` (comment: `` The home folder, which
  the start prompt shows as `~`. ``); `src/plugins/chat/main/start.ts` handles it with `() => api.services.homeDir`.
- `src/plugins/chat/page/start-prompt-items.ts`:
  ```ts
  export type FolderItem = { kind: 'recent'; folder: RecentFolder; label: string } | { kind: 'choose'; label: string };
  export const CHOOSE_FOLDER_LABEL = 'Choose folder…';
  export function displayPath(projectDir: string, homeDir: string): string;
  export function folderItems(recent: readonly RecentFolder[], homeDir: string): FolderItem[];
  // The index in `profiles` to pre-select for `projectDir`; 0 when no recent folder names a profile in `profiles`.
  export function preselectedProfile(profiles: readonly ChatProfile[], recent: readonly RecentFolder[],
    projectDir: string): number;
  export function profileLabel(profile: ChatProfile): string;
  ```
- `src/plugins/chat/page/start-prompt.ts`:
  ```ts
  export interface StartPromptDeps {
    picker: Picker;
    channel: Pick<PageChannel<ChatChannel>, 'invoke'>;
    profiles(): readonly ChatProfile[];
    reveal(sessionId: string): void;
    log: Log;
    toast(text: string, tone: ToastTone): void;
  }
  export function openStartPrompt(deps: StartPromptDeps): void;
  ```
- `src/plugins/chat/manifest.ts`: command `newSession: { label: 'new session', group: 'sessions', runsIn: 'page' }`;
  page bind `{ keys: [' ', 'k', 'n'], scope: 'any', command: 'newSession' }`; editor bind `{ keys: '<Leader>kn',
  scope: 'any', command: 'newSession' }`. `src/plugins/chat/page/start.ts` adds the `newSession` handler,
  `() => openStartPrompt(deps)`.

Decisions:
- **Key clash check** (as task 09 names it): `' ' k n` and `<Leader>kn` in scope `any` sit beside sessions' `' ' k s`
  and `<Leader>ks`; no bind is `' ' k` or `<Leader>k` alone, and nothing begins with `' ' k n`
  (`grep -rn "'k', 'n'\|<Leader>kn" src/plugins` → empty before this task, measured at plan time, re-verify).
- **Flow**, every log line under source `chat`:
  1. `newSession` invokes `recentFolders()` and `homeDir()` together; a rejection of either logs `start prompt not
     opened: <errorText>` and toasts `Start prompt not opened: <errorText>` (`error`). With `profiles()` empty it
     logs `no profiles in the chat settings`, toasts `Add a profile to chat's profiles setting first` (`error`)
     and opens nothing.
  2. **Folder step**: the picker opens with `title: 'Folder'`, items `folderItems(recent, home)`, label each item's
     `label`, `selected: 0`. The picker logs `picker shown: Folder` (task 09).
  3. Picking `Choose folder…` invokes `chooseFolder()` (the picker has already closed). `null` logs `no folder
     chosen` and opens the folder step again, as in 2, with the same recent list; a folder string goes to step 4 with
     no recent entry. A rejection logs `folder dialog failed: <errorText>` and toasts it (`error`).
  4. **Profile step**: with one profile, step 5 runs with it at once. With more, the picker opens with
     `title: 'Profile'`, items `profiles()`, label `profileLabel`, `selected: preselectedProfile(profiles, recent,
     projectDir)`.
  5. **Start**: logs `starting a session in <displayPath> with <profile name>` and invokes `start({ projectDir,
     profile: name })`. On the returned id it calls `reveal(id)`: the session is activated (Sessions mode shows), its
     Chat tab selected, and its box focused in insert mode at the end once the tab shows (task 09's `reveal` waits
     for a tab added after the answer). A rejection logs `session not started: <errorText>` and toasts `Session not
     started: <errorText>` (`error`).
- Esc closes the picker at either step and nothing starts (task 09's `picker closed: Folder` / `picker closed:
  Profile`).
- **`displayPath(projectDir, home)`**: `~` when `projectDir` equals `home`; `~/<rest>` when it starts with `home` and
  a `/`; else unchanged. A `home` ending in `/` is read without it.
- **`folderItems(recent, home)`**: one `recent` item per folder in the order given (main keeps them newest first,
  at most 20, one per folder), label `displayPath(projectDir, home)`; then the `choose` item, label
  `CHOOSE_FOLDER_LABEL`. With no recent folders it is the `choose` item alone.
- **`preselectedProfile`**: the first `recent` entry whose `projectDir` equals `projectDir`; the index of the
  profile whose `name` equals its `profile`; 0 when there is no such entry or its profile is no longer in
  `profiles`.
- **`profileLabel`**: `` `${name} · ${configDir}` `` (`work · ~/.claude`).
- `homeDir()` is synchronous in the contract (as `start` is): `MainChannel.handle` takes a handler of the declared
  type, and the home folder is known at start.

GIVEN home `/Users/u` WHEN `displayPath` gets `/Users/u` THEN `~`; `/Users/u/dev/app` THEN `~/dev/app`; `/Users/uz/app`
THEN `/Users/uz/app`; `/opt/app` THEN `/opt/app`; GIVEN home `/Users/u/` and `/Users/u/dev` THEN `~/dev`
GIVEN recent `[/Users/u/dev/app (personal), /opt/tool (work)]` and home `/Users/u` WHEN `folderItems` runs THEN labels
`['~/dev/app', '/opt/tool', 'Choose folder…']`, kinds `recent, recent, choose`, the recent items carrying their
folders; GIVEN no recent THEN `[{ kind: 'choose', label: 'Choose folder…' }]`
GIVEN profiles `[work, personal]` and that recent list WHEN `preselectedProfile` gets `/Users/u/dev/app` THEN 1;
`/opt/tool` THEN 0; `/elsewhere` THEN 0; GIVEN a recent entry naming profile `old` THEN 0
GIVEN profile `{ name: 'work', configDir: '~/.claude' }` WHEN `profileLabel` runs THEN `work · ~/.claude`
GIVEN the self-test WHEN `Space k n` then Esc run THEN `picker shown: Folder` then `picker closed: Folder` are logged
(task 11)

Tests:
- `start-prompt-items.test.ts` — `displayPath_HomeItself_Tilde`, `displayPath_InsideHome_TildePrefix`,
  `displayPath_SiblingPrefix_Unchanged`, `displayPath_OutsideHome_Unchanged`, `displayPath_HomeWithTrailingSlash`,
  `folderItems_RecentThenChoose`, `folderItems_NoRecent_ChooseOnly`, `preselectedProfile_LastUsedInFolder`,
  `preselectedProfile_UnknownFolder_First`, `preselectedProfile_RemovedProfile_First`, `profileLabel_NameAndFolder`
  — every value above, the folders and profiles built in the test.
- The flow over the overlay and the channel runs in task 11's `Space k n` / Esc step; starting a real session through
  the prompt is the final verification's check 1.

Done when: the typecheck and `npm run lint` pass; the test gate runs `start-prompt-items.test.ts`.
Commit:    one commit for the group

## Proof

9fba269 · diff read: `homeDir` is in the contract and handled in main; `start-prompt.ts` and `start-prompt-items.ts` export the planned members; `newSession` is bound to `Space k n` and `<Leader>kn`; typecheck and lint pass. Concern: `chatCommandHandlers`' return type became `Omit<…, 'newSession'>` (a type-only edit to 09's file).
