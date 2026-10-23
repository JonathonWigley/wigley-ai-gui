# 05 — App slash commands and sign-in in the page

Status: in progress
Type: Batch
Wave: 3 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · create `src/plugins/chat/page/slash-commands.ts` ·
           create `src/plugins/chat/page/account-commands.ts` · create `src/plugins/chat/page/sign-in-dialog.ts` ·
           modify `src/plugins/chat/page/chat-commands.ts` · modify `src/plugins/chat/page/chat-view.ts` ·
           modify `src/plugins/chat/page/start-prompt.ts` · modify `src/plugins/chat/page/start.ts` ·
           modify `src/plugins/chat/manifest.ts` · modify `src/plugins/keymap.ts` · modify `src/plugins/chat/page/chat.css` ·
           test `src/plugins/chat/page/slash-commands.test.ts` · test `src/plugins/chat/page/chat-commands.test.ts` ·
           test `src/plugins/chat/page/start-prompt.test.ts`
Consumes:  `accountStatus`, `logIn`, `logInCode`, `cancelLogIn`, `logOut`, `notice` invokes and the `logInLink`,
           `logInEnded` messages on `ChatChannel` ← 04 · `AccountStatus` ← 01 · `Disposable` (tree) ·
           the reason box in `chat-dialogs.ts` as the pattern for a dialog with a vim box (tree)
Produces:  in `src/plugins/chat/contract.ts`:
           `export interface SlashCommandContext { sessionId: string; profile: string; args: string; ended: boolean }`
           `export interface AppSlashCommand { name: string; description: string; run(context: SlashCommandContext): Promise<void> | void }`
           `export interface ChatPageExports { addSlashCommand(command: AppSlashCommand): Disposable }`
           in `src/plugins/chat/page/slash-commands.ts`:
           `export interface SlashCommands { add(command: AppSlashCommand): Disposable; match(text: string): { command: AppSlashCommand; args: string } | null; names(): string[] }`
           `export function createSlashCommands(): SlashCommands`
           `export function completionWords(appNames: readonly string[], agentNames: readonly string[]): string[]`
           in `src/plugins/chat/page/sign-in-dialog.ts`:
           `export interface SignInDialog { open(profile: string, finished?: (signedIn: boolean) => void): void; submitCode(): void; cancel(): void }`
           `export function createSignInDialog(deps: …): SignInDialog` (deps as the reason box takes them, plus `channel` and `toast`)
           in `src/plugins/chat/page/account-commands.ts`:
           `export function addAccountCommands(deps: { commands: SlashCommands; signIn: SignInDialog; channel: Pick<PageChannel<ChatChannel>, 'invoke'> }): Disposable[]`
           manifest commands `submitCode`, `cancelSignIn` (page) and scope `signIn: 'In the sign-in dialog'`
Decisions: app slash commands as a registry chat's page exports (round 2) · a registered name wins over the agent's
           (design) · a second add of a registered name throws (design review) · the start prompt checks the profile
           and offers sign-in (round 2) · the dialog shows the link with Copy and a code box, closes itself, Esc
           cancels (round 1)
Done when: compiles; lint passes (layer and style checks included); the test gate runs the tests below
Commit:    one commit for the group

## Items

**Registry** (`slash-commands.ts`). `match(text)`: the trimmed text must be `/` then a name with no whitespace,
then nothing or whitespace and the args; the args are trimmed (`''` when none); a name not registered gives null.
`add` throws `App slash command /<name> is already registered` for a registered name; the returned `Disposable`
removes it. `names()` in registration order. `completionWords`: the app names, then each agent name not among them.

**Exports.** `page/start.ts` builds one registry and returns `exports: { addSlashCommand: (command) => commands.add(command) }`
typed as `ChatPageExports` (check how `PagePart` returns exports in `src/contracts/plugin.ts`; keys' page part is an
example).

**Send.** `send` in `chat-commands.ts`: when `match(text)` finds a command, run it with the session's `sessionId`,
`state.profile` and the args, clear the box, and send nothing to main; a run that throws or rejects toasts
`/<name> failed: <error>` and logs it. This happens before the ended-session check, so `/login` and `/status` work in
an ended session's box. Otherwise the send path is unchanged.

**Completion.** `chat-view.ts` completion `words()` returns `completionWords(commands.names(), tab.state.commands)`;
pass the registry (or a `names` function) in `ChatViewDeps`.

**Account commands** (`account-commands.ts`):

- `/login` (`Sign in to this session's profile`): `signIn.open(profile)`.
- `/logout` (`Sign out of this session's profile`): `logOut(profile)`, then notice `Signed out of <profile>` (info).
- `/status` (`Show this session's account`): `accountStatus(profile)`, then notice `<profile>: signed in as <account>`
  or `<profile>: not signed in` (info); `<account>` falls back to `an unnamed account` when null.
- In an ended session main holds no entries, so a notice would show nowhere: `SlashCommandContext` gains
  `ended: boolean`, and for an ended session the same texts show as info toasts instead of notices.

**Sign-in dialog** (`sign-in-dialog.ts`, the reason box's shape): in the overlay layer, scope `chat.signIn`. Title
`Sign in to <profile>`; text `Finish sign-in in your browser.`; the link as selectable mono text, `Waiting for the
sign-in link…` until `logInLink` for this profile arrives, with a `Copy` text button
(`navigator.clipboard.writeText`); the line `If the page shows a code, paste it here.` over a one-line vim box. Buttons: `Cancel` (secondary, `cancelSignIn`) and
`Send code` (primary, `submitCode`), hints through `keyHint`; Copy toasts nothing and logs `sign-in link copied`.
Cmd+Enter (`submitCode`) sends the box's trimmed text through `logInCode` when not empty. Esc (`cancelSignIn`) calls
`cancelLogIn`, closes the dialog at once and calls `finished(false)`; a `logInEnded` arriving for a closed dialog is
logged and shows nothing. On `logInEnded` for the open profile the dialog closes, calls `finished(signedIn)` where
`signedIn` is `status?.signedIn === true`, and toasts `Signed in to <profile> as <account>` (success tone) or
`Sign-in failed: <error>` (error tone). The dialog belongs to a profile, not a session: another session's Chat tab
showing leaves it open (it stays out of `otherSessionShown`), and it registers no cancel on the scope's base
change. `open` while the dialog is open
focuses its box and starts nothing; `open` whose `logIn` rejects closes the dialog and toasts the error. Key hints
draw through `keyHint` as the reason box's do. CSS in `chat.css`, tokens only (`DESIGN.md` § Tokens and themes).

**Start prompt.** After the profile is known (picked, or the single one), `accountStatus(profile.name)`: signed in →
`listSessions` as today; signed out → `signIn.open(profile.name, (signedIn) => …)`, going on to `listSessions` when
signed in and starting nothing otherwise; a rejected read is logged and goes on to `listSessions`. Add `signIn` to
`StartPromptDeps`.

**Keys** (`src/plugins/keymap.ts`, the chat section), mirroring all four of `chat.reason`'s binds: on the page
`<D-Enter>` → `chat.submitCode` and `<Esc>` → `chat.cancelSignIn` in `chat.signIn`; in the box (`where: 'box'`, the
same mode settings as the reason box's) `<CR>` → `chat.submitCode` and `<Esc>` → `chat.cancelSignIn`.

**Manifest labels**: `submitCode` `send the sign-in code`, `cancelSignIn` `cancel the sign-in`, both in group
`signIn`.

## Tests

GIVEN `/login` registered WHEN the box holds `  /login  ` and send runs THEN the command runs with args `''` and nothing is invoked on `send`
GIVEN a signed-out profile WHEN the start prompt's profile is picked THEN the sign-in dialog opens and no session step opens until it finishes signed in

- `match_RegisteredWithArgs_TrimsArgs` — `/status  now ` → args `now`
- `match_Unregistered_Null`; `match_TextBeforeSlash_Null` — `hi /login`
- `add_Twice_Throws`; `dispose_RemovesCommand`
- `completionWords_AppFirstNoRepeats` — app `['login','status']`, agent `['status','model']` → `['login','status','model']`
- `send_AppCommand_RunsAndClearsBox` and `send_AppCommandRejects_Toasts` in `chat-commands.test.ts`
- `status_EndedSession_Toasts` — a recording toast gets `<profile>: not signed in`; no `notice` invoke
- `startPrompt_SignedOut_OpensSignIn`, `startPrompt_SignInFinished_OpensSessionStep`,
  `startPrompt_StatusReadFails_GoesOn` in `start-prompt.test.ts`, with a recording sign-in fake

## Proof
