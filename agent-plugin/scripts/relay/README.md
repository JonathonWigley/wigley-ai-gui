# Interview forms

**Contents**

- **The two tools** — `ask_round` and `collect_last_round`: their arguments, the grouped finding card, the payload
  they return with its grouped finding answers, layouts, and what the caller does on each outcome; also the
  server's six form tools, the audio picker's two named there.
- **Saved forms** — the folder, the file format readers of the saved files read, replay, hand-back, restart, and pruning.
- **What the markdown fields render** — the markdown a caller may write in a form, and what shows as literal text.
- **Don't ask me this** — the per-item control, what a press does, and where it is kept.
- **The feature primer** — `open_primer` and `collect_last_primer`: their arguments, the payload, the outcomes, and
  the saved-primer files.
- **The relay** — what `relay.py`, `endpoint.py` and `start_app.py` do: finding, starting, restarting and reaching
  the app, the relay's answers when the app is away, and offline mode for runs the app's session host starts.
- **Registering the server** — the `auri` plugin's two manifests, the app's launch, the per-host deadline, and
  pre-approval.
- **Local commands** — starting and restarting the app by hand, and the test suite.
- **Boundary rules** — what the relay and the starter may and may not hold.

A local questionnaire for the questions an agent skill would otherwise ask one at a time
in chat. A skill sends a form of questions to one MCP tool, the user answers them
in the **wigley-ai-gui** desktop app (on macOS and Windows), and the answers come back as the tool result. Nothing is
hosted, no model session is created, and there is no API key and no second bill. The same
server carries the feature primer's two tools, which open the checklist pass of the skill that calls `open_primer`
in the app for the user to edit ([The feature primer](#the-feature-primer)), and the audio picker's two tools,
which open the user's pick between candidate sounds ([The two tools](#the-two-tools)).

The form, primer and audio picker logic — validation, re-send, hand-back, the deadline, the saved files —
is TypeScript in the app. This folder holds only `relay.py`, the process each session's host
starts as the `auri` MCP server, which forwards the session's MCP messages to the
app, `endpoint.py`, which finds the app's channel and connects to it, and `start_app.py`,
which starts the app. The relay and the
starter hold no forms logic ([Boundary rules](#boundary-rules)).

## The two tools

The server, `auri`, registers six form tools: the two tools for forms below, the
feature primer's two ([The feature primer](#the-feature-primer)) and the audio picker's two
(`open_audio_picker` and `collect_last_audio_picker`; their arguments and payload are in
the app's `docs/features/audio-picker/design.md` § Tool contract). The app's tool list also holds
tools that open no form. Among them are `list_commands`, `run_command` and `read_state`, which let an agent run any
app command and read any app state; a command marked risky asks the user Allow or Deny first
(the app's `docs/features/agent-commands/design.md`). Each host prefixes their names its
own way — Claude Code as `mcp__plugin_auri_auri__<tool>`, Codex as
`mcp__auri__<tool>` — so the skills name them by server and bare tool name.

- **`ask_round`** — takes `heading` (one line naming what the form settles), `overview`
  (one or two short, low-detail sentences: the work underway, then what this form
  focuses on), an optional `layout` (a layout name, see [Layouts](#layouts)), `questions`,
  `findings` and `notices` (lists of any length), opens the form in the app, and waits for the answers. The overview
  draws under the heading, through inline markdown only. A form needs at least one
  question, finding or notice, and may carry any mix of the three; the app shows findings
  first, then questions, then every notice together on one page. How each item's text is
  worded is the `auri` plugin's forms skill. Each question object carries six required fields —
  `title` (the item's name in the rail), `summary` (the card's headline: what the user is asked
  to decide and why), `context`, `choices` (2 to 9 strings, one per number key), `recommend`
  (the 1-based number of the recommended choice), and `rationale` — and two optional fields:
  `layout`, and `approves`, a list of `{ "choice": <1-based>, "action": "<exact action>" }`
  objects that tag a choice with the action auto mode gates that picking it approves. When the
  user submits a form with a tagged choice picked, in a session the app's chat owns, the app
  first writes one user message into the session's running turn, one
  `Approved in form: <action>` line per approved action, and returns the answers once the
  agent has queued it, or after a few seconds without that, so the agent takes the approval in as
  the user's own message before its next call. Each answered question with a tagged pick
  carries `approval_posted`: false when nothing reached the running turn (a headless form, a
  session the app did not start, a compaction, a form finished while no call waited, a failed
  or timed-out send, a Claude Code that reports no message lifecycle), and then the agent asks
  for the approval in chat. A message that cannot join the running turn is never written later, but
  a line the CLI already holds may still fold in after a timeout, or run as its own turn after
  an interrupt. A cancel sends none. An action must be one line, and a
  choice number outside the question's choices fails the call. Each tagged choice's card shows
  `Posts as you: Approved in form: <action>` under it. The card draws the summary, the context, then the choices with the rationale under the
  recommended one, and labels none of them. Each finding object — a review
  finding or deferred item that needs the user's decision — carries `origin`, which sets
  the card it draws as and the fields it takes:

  | `origin`       | Card     | Means                                                     |
  | -------------- | -------- | --------------------------------------------------------- |
  | `caused`       | Defect   | a defect the change under review introduced               |
  | `pre_existing` | Defect   | a real defect in code the change read but did not cause   |
  | `design`       | Decision | a design call: options to weigh, now or in a feature plan |
  | `nit`          | Nit      | nothing builds on it, and it cannot be shown happening    |

  Every finding carries `title`, `origin`, `impact` (one plain sentence: what goes wrong,
  and for whom), `finding` (what is wrong; for a Decision, what is to decide), `choices`
  and `recommend_action`, and may carry `recommend`, `action_reasons`, `proof` and
  `layout`. A Nit also carries `proof`: why it cannot happen, drawn under Why it's safe.
  Another origin accepts `proof`, and reads an empty or `null` one as none; the default
  layout does not draw it there. A Defect also carries `severity` (`critical`,
  `important` or `minor`), and no other origin accepts it. A finding missing a field its origin requires, or carrying one
  its origin forbids, fails the call with an error naming each.

  - **`choices`** — each an object of `text`, the `reason` for picking it (shown under
    it), and an optional `action`: the action the choice sits under on the card,
    `fix_now` when left out. A Defect's choices are its solutions (1 to 9), a Decision's
    the options a plan would weigh (2 to 9), a Nit's exactly one, the fix. At least one
    choice is a `fix_now` choice. The card numbers its choices and each action left
    without choices alike, one number key `1`–`9` each, so a finding takes at most 9
    such entries together, and the call fails past that: a Defect whose choices are all
    `fix_now` takes at most 7, beside its Follow-up and Leave it headers. A choice names a solution only: the app rejects a call
    whose choice text opens with an action's label.
  - **The actions** — the same three values on every card, each card labelling them its
    own way:

    | Value       | Defect    | Decision   | Nit        |
    | ----------- | --------- | ---------- | ---------- |
    | `fix_now`   | Fix now   | Decide now | Fix anyway |
    | `follow_up` | Follow-up | Plan it    | —          |
    | `leave_it`  | Leave it  | Drop it    | Leave it   |

    A Nit offers no `follow_up`. A choice's `action` and `recommend_action` each take an
    action the origin offers, and any other fails the call, such as `Finding 1:
    choices[1].action is follow_up, which a nit finding does not offer; it offers fix_now
    or leave_it.`

  - **`recommend`** — the 1-based number of the recommended choice in `choices` as sent;
    that choice's `action` equals `recommend_action`. Left out exactly when no choice
    carries `recommend_action`, as a recommended `leave_it` on a finding whose choices are
    all fixes; `null` reads as left out. The call fails when `recommend` is missing while a choice carries
    `recommend_action`, when it is present while none does, and when it names a choice of
    another action.
  - **`action_reasons`** — an object with a `follow_up` key, a `leave_it` key or both, each one plain
    sentence on why to take that deferral action. Only an action the origin offers takes
    an entry (a Nit takes no `follow_up`); any other key fails the call, and `null` reads
    as none. The card shows each entry under its action's header.

  The card opens on a verdict the app composes from the origin, the severity and
  `impact`, then shows `finding`, and on a Nit its `proof` under Why it's safe, then its
  entries, grouped: each action the origin offers,
  drawn once in the order `fix_now`, `follow_up`, `leave_it`, with every choice that
  carries it, and its reason, under its header. Numbers run down the card from `1`; an
  action with no choices takes one number on its own header. One pick, of a choice or of
  a bare header, sets the choice and the action together. The recommended entry — the
  `recommend` choice, or the `recommend_action` header when that action has no choices —
  is tagged Recommended; the user takes it with Accept, or picks any other entry.

  No field outside those named here is accepted on the form or on any item — the app
  draws the not-applicable control, the Notes box, the form note and a Don't ask me this
  control by itself, so a caller never describes them as questions or choices. A press
  comes back on the answer (see [Don't ask me this](#dont-ask-me-this)).
  Each notice object carries two required fields, `title` and `context` — no choices, no
  recommendation, nothing to decide — and two optional fields: `layout`, and `badge`,
  one of `"Applied"` (the default, a fix already done), `"Dispatched"` (a fix still in flight)
  or `"Decided"` (a decision the agent took alone, its `title` the decision and its
  `context` one line of what and why), no other value accepted. A notice is a finding already fixed or
  otherwise settled before the form opened. The form's notices share one page, after every
  finding and question: each is one line, its badge and title, that opens to its context and one
  optional comment box. Use `findings` for review
  findings still open, `questions` for any other open decision, and `notices` for what is
  already handled, a fix the agent made or a decision it took alone included.

- **`collect_last_round`** — takes no required arguments (an optional `wait` boolean;
  `false` returns the current draft at once instead of waiting) and re-attaches to the
  form already open, or returns the last finished form's answers again. When to call it
  is under [Outcomes](#outcomes).

One form is open per session at a time. While the user is still answering a form, an
`ask_round` for a different form — queued behind another call, a re-send, or a fresh
call — waits until the user submits or cancels the open form in the app, then opens. When
no call has returned the open form's answers yet, the woken call returns them instead,
with `earlier_heading`, and opens nothing; the caller sends its form again (see
[Saved forms](#saved-forms)). If its own deadline passes first, it returns a `draft` that
opened nothing (see [Outcomes](#outcomes)). A new form never closes an unfinished one: the user cancels a
form the agent left open after a draft. A call the host cancels closes its own form (see
[Saved forms](#saved-forms)), so the session's next form opens at once.

Both tools return the same payload shape: `outcome`, `summary`, `note`, `next`, an
`answers` array that is index-parallel with the questions sent, a `findings` array that
is index-parallel with the findings sent, and a `notices` array that is index-parallel
with the notices sent. Each answer, and each entry in `findings`, carries `index`, `title`,
`status`, `choice`, `choice_text`, and `took_recommendation`, plus `notes` when
the user wrote some, and `dont_ask` (`true`) when the user pressed Don't ask me this on
that item, with `dont_ask_reason` beside it when the reason box held text. `status`
holds exactly three values — `"answered"`, `"not_applicable"`, and `"untouched"` — and
`not_applicable` never collapses into `untouched`; a caller never infers one from a
blank. Each entry in `findings` also carries `action` (`fix_now`, `follow_up`,
`leave_it`, or `""` for none) and `took_action_recommendation`. A finding reads
`answered` once the user picked one of its card's entries; `action` is then the picked
entry's action, and `choice` the picked choice's 1-based position in `choices` as sent,
not its number on the card, or `0` with `choice_text` empty when the user picked a bare
action header. A finding with no pick reads `untouched` (or `not_applicable`), with
`choice` `0` and `action` `""`. `took_action_recommendation` is true when the picked
action is `recommend_action`, and `took_recommendation` when the pick is the recommended
entry: that action and the `recommend` choice, or the bare header when `recommend` was
left out. An `auto_answered` result marks every item `answered` with `took_recommendation`
true, and a finding also gets `took_action_recommendation` true. Each notice carries `index`, `title`, `badge`
(echoing what the caller sent or the default), and `comment` when the user wrote one — nothing else, since a notice has no
decision to report. A notice never appears in `answers`, never counts toward `summary`'s
counts, and never blocks or delays any outcome. A handed-back result (see
[Saved forms](#saved-forms)) also carries `earlier_heading`.

The free-text keys — an answer's `notes` and `dont_ask_reason`, a notice's
`comment`, and the form's `note` — are omitted when empty, so an absent key means the
box was left blank; every other key is always present, except `dont_ask`, which appears
only on a pressed answer. `notes` is the user's own free text and is **never
required**: the app refuses no submit over an empty box. It holds the user's own answer,
the reasoning behind a choice, or both. It is the escape hatch for an item none of the
listed choices covers: a user can type an answer there without picking a number at all,
and it comes back as `status: "untouched"` carrying that text — which is an answer, not a
blank. An item left blank throughout is the caller's to re-ask in a follow-up form.

### Layouts

A layout is the look the app draws a form in. Forms layouts live in the app's user config
folder, `~/.config/wigley-ai-gui/layouts/forms/` on macOS and Windows alike, shared by the
stable and dev apps. A layout is a folder
`<name>/` holding `layout.js` and an optional `layout.css`, and defines only the cards and
panes it changes; the app writes their contract, `forms/layout.d.ts`, and the shared kit types it
imports, `kit.d.ts` one folder up, at each start. `default` is the app's built-in layout and always a valid name; a `default`
folder there is ignored.

A card comes from the first layout that defines its kind among the item's `layout`, the
form's `layout`, the user's `forms.layout` setting and `default`; the head, rail, review
and notices panes come the same way without the item. A name with no folder holding
`layout.js` fails the call, and the error lists the names the folder holds:
`Finding 2: layout 'compact' is not in the layouts folder, which holds 'default' and
'wide'. Write compact/layout.js there first, or leave layout out.`

- Name a layout only when the form's look matters; a form with no `layout` draws in
  the user's own layout.
- For a look no layout has, write a new layout folder before the call (an unknown name
  fails it), name it in the form or the item, and list each layout written or changed in
  a notice on that form: the notice's `title` names the layout, its `context` the file
  path. The user then sees the file while its look is on screen.
- A re-send keeps the layouts the form opened with, since layout names stay out of the
  fingerprint ([Saved forms](#saved-forms)).

### Outcomes

`outcome` holds one of six values, and each tells the caller what to do next:

| `outcome`           | Means                                                                                                                                                                    | The caller                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submitted`         | The user sent the form.                                                                                                                                                  | Reads the answers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `draft`             | The user is still answering; the deadline handed back the answers so far.                                                                                                | Calls `collect_last_round`, again after every `draft`, however many come back in a row. The deadline hands back a draft every few minutes by design: a wait is the user still writing, so the caller never stops the call, and a caller that stops leaves the user to announce the submission by hand. A `draft` whose `next` says this round was not opened (another form is still open) has no answers: the caller sends the same form again with `ask_round`, never `collect_last_round`, which would return the other form's answers. |
| `cancelled`         | The user stopped the form on purpose.                                                                                                                                    | Leaves the form closed and reports what it settled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `needs_manual_open` | The relay could not start the app, so no form exists; `summary` gives the reason.                                                                                        | Sends the same form again with `ask_round` once — the relay tries the start again. On a second `needs_manual_open`, tells the user the reason in `summary` and asks the form's questions and findings in the reply. Never calls `collect_last_round` for it.                                                                                                                                                                                                                                                                              |
| `auto_answered`     | The session is headless: the app showed no form and answered every question and finding with its recommendation.                                                         | Reads the answers as its own picks, lists each as a Decided notice in the reply, and sends no more forms while the session stays headless (the `auri` plugin's forms skill § Headless). `collect_last_round` returns the same result again.                                                                                                                                                                                                                                                                                               |
| `no_round`          | No form is open for this session and no finished answers wait for it: the form was never sent, a restart lost it, or its call was cancelled. A draft may still be saved. | Sends the same form again with `ask_round`; the user's saved answers fill in. Never calls `collect_last_round` for it, which holds nothing to return, and never tells the user a form is open that was not sent.                                                                                                                                                                                                                                                                                                                          |

No hook holds the `draft` rule: the prose does, for forms and primers alike
([The feature primer](#the-feature-primer) gives the primer's names). The user may end a session
while a form is open, and a re-sent form re-attaches to the same form file.

**The wake.** In a session the wigley-ai-gui app started from its chat, a submit or cancel that no
call is waiting for — the agent ended its turn after a `draft` — sends the session a message:
`The user submitted the round "<heading>" in the forms app. Call collect_last_round for its answers.`
(`cancelled` in place of `submitted` after a cancel; a primer says `primer` and names
`collect_last_primer`). The caller calls the named tool, which returns the finished answers, and
when it already holds them the call replays them and nothing changes. A wake naming a form the
caller already read, after a newer form opened, is ignored: calling the tool then would return the
newer form. A session whose conversation was cleared after the form opened gets no wake. The wake is a safety net:
the `draft` rule above still holds, and a session the app did not start, such as a terminal
session, gets no message.

`needs_manual_open` and `no_round` carry empty `answers`, `findings` and `notices`.

A result carrying `earlier_heading` holds the answers to that earlier form, not to the
form just sent: the caller reads them as the earlier form's answers, then sends its
form again.

A call that fails, or a form whose reply was lost, is not an absent tool. The caller
calls `collect_last_round` first and reads its outcome by this table: the lost reply may
have handed back an earlier form with `earlier_heading`, and re-sending the current form
first would open it over those answers unseen. A second failure in a row is read the same
way again. The caller asks the form in its reply only when the tool is absent or
`needs_manual_open` came back twice.

A `collect_last_round` or `ask_round` can instead return an error result, not an outcome,
when an earlier finished form's saved answers no longer parse (see [Saved
forms](#saved-forms)). The caller tells the user those answers were not returned and
sends its form again with `ask_round`. A call waiting on an unanswered form also returns
an error result when its session ends while the app keeps running, as when its relay
disconnects: the form has closed, and sending it again with `ask_round` opens it
pre-filled. An app quit answers no waiting call and leaves its form open, so the relay
sends the call again to the next app run (App gone mid-call, under [The relay](#the-relay)).

## Saved forms

The app keeps one JSON file per form in `~/.agents/wigley-forms/rounds/`, written whole
through a temp file and a rename on every save. It saves each draft as the user answers,
and the submit or cancel marks the file finished; a draft arriving after that is dropped,
so the file keeps the body it finished with. A form counts as returned once a tool reply
carries its finished answers. A disk failure is logged and never fails the form. Files
older than 90 days are deleted when the app starts: readers of the saved files, such as a retro tool, read these
files as the record of the user's answers, reaching back at most 90 days.

The file is the contract with retro's readers (readers of the saved files, such as a retro tool),
which read it as plain JSON. Each file holds `id` (`<epoch>-<8 hex>`),
`fingerprint`, `outcome` (`open`, `submitted` or `cancelled`), `returned`, `auto_answered`, `session_id`,
`project_dir`, `tool_use_id`, `created` and `updated` (epoch seconds), `args` (the
`ask_round` arguments as sent: `heading`, `overview`, `questions`, `notices`, and
`findings` and `layout` when the call carried them) and `body`.
`session_id` is the relay hello's ([The relay](#the-relay)): the Claude Code session id, or for a Codex
session the app did not start, the relay's own per-process id, `codex-<32 hex>` (`null` on a Codex
form saved before the relay made one). A new Codex process makes a new id, so its forms do not
match an earlier process's. A Codex session the app started, and a Claude session with no
`CLAUDE_CODE_SESSION_ID`, save `null`.
`auto_answered` is `true` on a form the app answered itself in a headless session, whose `outcome` reads `submitted` and `returned` true, and `false` on every other file, or absent on a file saved before the field existed. Readers of the saved files skip a file with it `true`, since its picks are not the user's.
A change to any of these names changes those readers in the same change; the app's
saved-form tests pin the names.

`body` holds the user's answers as last saved:

- `note` — the form note, as a string.
- `answers` — one entry per question: `index` (1-based), `choice` (1-based, `0` for
  none), `not_applicable`, `notes`, `dont_ask`, `dont_ask_reason`. A
  not-applicable answer keeps the choice it had, so a reopened form restores it;
  `not_applicable` wins, and a reader treats that answer as not applicable whatever
  `choice` holds.
- `finding_answers` — one entry per finding, in the same shape as `answers` plus
  `action` (`fix_now`, `follow_up`, `leave_it`, or `""` for none): the picked card entry.
  `choice` is the picked choice's position in the finding's `choices`, `0` on a bare
  header pick, and `action` the entry's action; no pick saves `choice` `0` and `action`
  `""`. `action_label` is the word the card showed for the picked entry's action (`Plan
  it` on a Decision's `follow_up`), `""` when the pick is none of the card's entries; it
  is set whatever `not_applicable` holds. `recommend_action_label` is the card's word for
  the finding's `recommend_action`, on every entry. A file saved before the field existed
  has none, and a reader labels the action with its Defect word. A reader counts a pick only when its `choice` and `action` form one of the card's
  entries ([The two tools](#the-two-tools)). A file saved before finding answers carried
  an `action` has none: a reader treats it as none, and that file's choice labels carry
  the action they paired with a solution.
- `notice_comments` — one entry per notice: `index` (1-based) and `comment`.

A file saved before questions carried a `summary` holds `question` in its place in `args`, and
the app reads it as the summary.

A file saved before the Notes box holds `what` and `why` in place of `notes`, and no
`finding_answers`. A reader joins `what` and `why` as that answer's notes, so no older
answer loses its text.

`tool_use_id` is the tool-use id of the `ask_round` call that created the file, read from
the request's `_meta["claudecode/toolUseId"]`, or `null` when the host sends none. A
re-send that re-attaches, replays or hands back an earlier form adds no id: the file
keeps its creating call's, and a reader of the saved files places the answers under that call.

A form is matched by its fingerprint: a hash of its questions, notices and findings,
every field but `layout`, and never the heading, the overview or the form's `layout`. A
choice's `action` is hashed only when it is not `fix_now`, so an omitted `action` and
`fix_now` hash alike; `action_reasons` is hashed only when it holds an entry, a
question's `approves` only when it holds an entry, and `recommend` only when sent. `proof` is hashed only when sent and not blank; every file
saved while the tool required `proof` carries it, so its hash stays. A finding using none of them hashes as it did before they
existed, and a form with no findings as it did before findings existed, so older files
still match. A file saved before the `summary` rename loads, its `question` read as the
summary, but the fingerprint keys a question's headline as `summary`, so it matches a re-send
only when the form holds no questions.

- **Re-send of the open form** — re-attaches to it in the app.
- **Re-send of the form just submitted** — returns its answers again, as
  `collect_last_round` does, until a new form opens. A re-send of the form just
  cancelled opens a fresh form pre-filled from it; `collect_last_round` still replays it.
- **A new form while a finished one was never returned** — the call returns that
  finished form (submitted or cancelled) with `earlier_heading` and a `next` line, and
  opens nothing; the caller sends its form again. A draft left open after its call
  returned stays open, and the new form waits for the user to finish it.
- **Any other form** — opens pre-filled from the newest file with its fingerprint, open
  or finished. A finished file's Don't ask me this presses are left out: a press belongs
  to the form it was made in.
- **After a restart** — `collect_last_round`, or the next `ask_round` (plainly when it
  re-sends that form, handed back with `earlier_heading` otherwise), returns the newest
  finished, unreturned form of this session (the hello's `session_id`: `CLAUDE_CODE_SESSION_ID`,
  or for a Codex session the app did not start the relay's per-process `codex-` id, so such a session gets the
  hand-back while its relay process lives); with no session id, of this project folder
  (`CLAUDE_PROJECT_DIR`), and with neither, none. With no such form, a `collect_last_round` that holds
  no form of its own connection reopens the session's newest form when an earlier
  connection left it open and no live session holds it, pre-filled from its file, and
  waits on it as on the open form: the relay's re-sent call after an app quit ends up here.
  An open form that no longer parses gets the error result below, naming it left open.
- **A finished, unreturned form the app can no longer parse** — its `args` fail the app's
  current parser (saved in an older shape): the form is not returned and not marked
  returned, and its file stays as it was. The first `collect_last_round`, or `ask_round`
  that would hand back an earlier form, to reach it in the session gets an error result
  (`isError`, text starting `Error:`) naming the form's heading, its file and the
  parser's reason, and opens nothing. Later calls in that session pass over it and reach
  any older unreturned form behind it; after an app restart or a relay reconnect it is
  reported once more.
- **A session that disconnects** — its open form closes in the app at once; the answers
  stay in its file, and re-sending the form opens it pre-filled.
- **A call the host cancels** — when no other call of the session waits on that form, its
  form closes in the app at once, as on a disconnect; the answers stay in its file,
  `collect_last_round` from that connection returns `no_round`, and re-sending the form
  opens it pre-filled.

## What the markdown fields render

`context` and `rationale`, a finding's `finding`, `proof` and each choice's
`reason`, and a notice's `context` render as markdown in the app; a question's `summary`, a
choice's text and the overview render inline markdown only. A caller may write:

- paragraphs, with `**bold**`, `*italic*` and inline `` `code` ``
- fenced code blocks; inside a ` ```diff ` fence a line starting `+` is coloured added,
  `-` removed and `~` changed; a ` ```html ` fence draws a live visual (the `auri` plugin's visuals skill)
- unordered and ordered lists, headings, blockquotes
- pipe tables, with the alignment row (`:---`, `:---:`, `---:`)
- three `:::` blocks, each closed by a line holding only `:::`:
  - `:::changes` — a coloured change list, one line per change. A line starting `+`,
    `~` or `x` and a space gets an added, changed or removed pill; a line with no marker
    is plain text, and a leading `- ` or `* ` bullet is dropped.
  - `:::tree` — the same lines nested by indentation, two spaces per level, so changes
    group by place. A line with no marker is a plain node, the place itself.
  - `:::details Summary` — a collapsed section holding its own markdown (the summary
    falls back to `Details`). Nested `:::details` blocks close innermost first, and a
    `:::` line inside a code fence is code, never a closer.

An image named by an absolute path to a png, jpg, jpeg, gif, webp or svg file,
`![alt](/abs/path.png)`, draws that file in place (the `auri` plugin's visuals skill § Images). Links and raw
HTML outside an `html` fence show as the literal text the caller sent.

## Don't ask me this

Each question and finding carries a **Don't ask me this** control with a "why not ask
this" box. It says the agent should have settled the item alone, and it changes nothing about the
choice: the choice still counts. A press comes back in the answers payload as `dont_ask`
(`true`) on that answer, with `dont_ask_reason` beside it when the box held text, and is
kept in the form's [saved file](#saved-forms), where readers of the saved files read it.

## The feature primer

The skill that calls `open_primer` shows its checklist pass over a feature spec in the app's primer popup: the
user ticks the tasks the feature needs and edits the work items, and the edited checklist comes
back as the tool result. The primer shares the forms' lifecycle: the deadline, re-send,
hand-back, restart and the saved files behave as [Outcomes](#outcomes) and
[Saved forms](#saved-forms) say, with the primer's names in place of the form's. A
session holds one open primer and one open form at the same time, each in its own popup.

- **`open_primer`** — takes `feature` (`name` and `slug` required; `spec` and `summary`
  optional; `slug` is lowercase letters, digits and dashes) and `entries` (1 to 60
  objects), opens the primer in the app, and waits for the user. Each entry carries `id`
  (the row number as a string, or a standing task's slug, unique in the call), `task`,
  `need` (`yes`, `no` or `unclear`) and `items` (1 to 20 non-empty strings, the work
  items), and may carry `group` (`primer`, the default, or `standing`), `number`, `area`,
  `question`, `evidence`, `probes` and `pointer`. A malformed call fails with an error that
  names the field and what it must hold.
- **`collect_last_primer`** — takes an optional `wait` boolean (`false` returns the current
  draft at once) and re-attaches to the open primer, or returns the last finished primer
  again.

Both tools return `outcome`, `summary`, `next`, `feature` and `entries`, and
`earlier_heading` on a handed-back primer. `feature` holds `name`, `slug`, `spec`,
`summary` and `notes` (the user's notes on the whole feature). Each entry holds the fields
sent, `group` (`primer`, `standing`, or `extra` for a task the user added), the user's
`need` and `comment`, and `items`: one object per work item, `text`, `include`, `comment`
and `added` (true for an item the user added). An entry sent with `need` `no` opens with
every item's `include` false, and one sent `yes` or `unclear` with every item's true; the
user's later need change leaves `include` as it is. The user edits only `need`, the
comments, the items (an added item's `text` too, never a sent item's), the feature's
fields, and the extra tasks; every other field comes back as sent.

`outcome` takes the values of [Outcomes](#outcomes) but `auto_answered`: a primer is never
auto-answered, and a headless session's primer waits on the user like any other. `no_primer`
takes the place of `no_round`, and the caller acts as that table says, calling
`collect_last_primer` and `open_primer` where it names `collect_last_round` and `ask_round`. A
`needs_manual_open` reply comes from the relay and carries no `feature` or `entries`.

The app saves each primer in `~/.agents/wigley-primer/primers/`, in the file format of
[Saved forms](#saved-forms): `args` holds the `open_primer` arguments as sent, and `body`
holds `feature` and `entries` as last saved, in the payload's shape. The fingerprint is a
hash of the parsed `feature` (`name`, `slug`, `spec`, `summary`) and `entries`. Readers of
the saved files, such as a retro tool, read these files as they read the form files.

## The relay

`relay.py` is the `auri` MCP server a host starts per session. It speaks MCP on
its stdin and stdout and forwards every message, unchanged, to the app over a local
channel, and adds one of its own; the app runs the tools. That one is
`notifications/tools/list_changed`, sent to a host that has initialized once when the app's
channel drops, a call waiting or not, and once after it opens one, so the host refetches
`tools/list` (the relay's own list while the app is away). The endpoint lookup and the channel
open live in `endpoint.py`, which `relay.py` and `hook_client.py` (the hook scripts' client) import.

- **Finding the app.** The app writes `endpoint.json` to `~/.agents/<instance id>/` each
  time it starts — `~/.agents/wigley-ai-gui/` for the installed stable app,
  `~/.agents/wigley-ai-gui-dev/` for the dev app (`npm start`): the channel's path (a Unix
  socket on macOS, a named pipe on Windows) and the command that starts it, with its
  working folder, and `pid`, the app's main process id. The relay reads
  `~/.agents/wigley-ai-gui/` unless `WIGLEY_AI_GUI_ENDPOINT_DIR`, when set, names another
  folder (a full path; `~` is not expanded). The app sets it on every Claude session it
  starts, to its own endpoint folder, so a dev app's sessions reach the dev app and a
  drive run's reach the drive run, not the user's own app.
- **Hello.** On connecting, the relay sends one JSON line before any MCP message:
  `protocol`, `session_id` (`CLAUDE_CODE_SESSION_ID`, or for a Codex session with no
  `WIGLEY_SESSION_ROW` the relay's own id, `codex-<32 hex>`, made once per relay process, so
  every reconnect of that process carries it), `project_dir`
  (`CLAUDE_PROJECT_DIR`), `deadline_seconds` (`WIGLEY_FORMS_DEADLINE_SECONDS`) and
  `config_dir` (`CLAUDE_CONFIG_DIR`, where the app reads the session's name) and `row_id`
  (`WIGLEY_SESSION_ROW`, the app's row id for a session the app started, by which the
  app joins the relay to that row), each `null` when unset, and `harness`: `claude` when
  `CLAUDECODE` is `1`, else `codex`. It waits up to 10 s for the app's reply line.
  `harness`, `config_dir` and `row_id` are optional to the app, which reads an older relay
  that leaves them out as no harness, the default config folder and no row. The app keeps one
  open form, one open primer and one open audio picker per connection.
- **Hook calls.** A hello with a `hook` field (the hook's name) and protocol 2 (`endpoint.py`'s `HOOK_PROTOCOL`) is
  one request, not an MCP session; the relay's own hello keeps protocol 1. An app that predates hook calls knows only
  protocol 1, so it refuses a hook hello at once rather than opening a session for it; this app also refuses a hello
  whose protocol and `hook` disagree. The client sends one JSON line after the hello and reads one reply line,
  `{"ok": true, "reply": …}` or `{"ok": false, "error": …}`; then the app closes the
  channel. The app opens no session, adds no row, and does not hold the hello. It answers `ok: false` when no handler
  holds the hook's name, when no live session matches the hello, when the handler fails, when the request line is not
  complete 5 s after the hello (bytes without a newline do not extend that), and when the handler takes over 5 s.
  Every hook client goes through `hook_client.py`: `app_channel` finds the channel from the endpoint file,
  `session_hello` builds the hello with the hook's name, and `ask_app_reply` sends the hello and one request and
  returns the reply object, or None when the app refuses, the channel fails, or the line is not complete within
  `HOOK_DEADLINE_SECONDS` (3 s); the hook then prints nothing. The clients:
  - the chatroom hook (`scripts/chatroom/hook.py`, `chatroom.pre` and `chatroom.post`), which prints the reply's
    `text`. It reads the endpoint file before any git call, so an absent app costs it no git reads, and its 3 s cover
    its git reads too.
  - the checklist hook (`scripts/checklist/hook.py edit|stop|compact`, hook `workflow.checklist` for all three, request
    `{"mode": "<mode>"}`), which reads the reply `{ "reported": bool, "open": int, "items": [{ "text", "done",
    "running"? }], "step": str | null }` (`step` is the stage's `set_workflow_step` name, null on the Checklist flow or a stage with none) and asks only for an app session's main agent (`WIGLEY_SESSION_ROW` set, no `agent_id`).
    `docs/features/feature-contributions/design.md` § The Checklist flow gives the fields' meaning.
  - any later hook, through the same three calls.
- **Starting the app.** On a tool call with no app reachable and no channel dropped in the
  last 30 s (a call inside those 30 s waits, under App gone mid-call), the relay runs
  `start_app.py`'s `start_app` (in offline mode it answers from the app's table instead, under
  Offline mode), which an agent can also run by hand. It reuses an app
  whose channel accepts (it connects and closes without a hello, which the app ignores).
  Otherwise it starts the app, detached: with the command the endpoint file records (when
  that command cannot be spawned, say because a dev app recorded an nvm Node path an upgrade
  removed, it falls back to the installed app below, and a failure names both reasons), or,
  with no endpoint file, the installed stable app wigley-ai-gui's `npm run install-app` puts
  in place. On Windows, for the default endpoint folder, a recorded command under
  `%LOCALAPPDATA%\Programs\wigley-ai-gui\` gives way to the installed app, so a kept older
  folder is not started over the newest; the recorded command is then the fallback, which a
  flat install with no `app-*` folder takes. The installed app is on Windows
  `wigley-ai-gui.exe` in the newest-modified `app-*` folder under
  `%LOCALAPPDATA%\Programs\wigley-ai-gui\` (each build installs into its own folder there),
  `/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui` on macOS. It never starts a
  dev app (`npm start`) that no endpoint file records. The installed app starts, first or as
  the fallback, only when the endpoint folder is the default `~/.agents/wigley-ai-gui`, since
  it never answers on another: another folder (a dev app's, or one
  `WIGLEY_AI_GUI_ENDPOINT_DIR` names) with no endpoint file fails at once, and one whose
  recorded command cannot be spawned fails naming both reasons, the installed app's being
  `the installed app starts only for <default folder>, not <folder>; start the app that serves <folder> first`.
  It then waits up to 45 s for the channel to accept.
  The started command's stderr goes to `start.log` in the endpoint folder, emptied on each
  launch, so it holds the last started app's errors for that app's whole life. A command
  that exits non-zero before the channel opens fails the start at once, with what it wrote
  there and the command it ran,
  and with no fallback. An ended wigley-ai-gui drive run records such a command,
  whose home it names: on macOS and Linux a shell that prints that the run has ended and exits 1, so the
  reason leads with that line; on Windows a `cmd.exe` line that exits 1 and names the run only
  in a `rem` comment, printing nothing, so the reason names the run through the command.
  A command that exits 0, a second instance yielding to the first, is waited out. No installed
  app (it names the path it looked for, or the platform when it has no installed app, and
  `npm run install-app`), an unset `LOCALAPPDATA` on Windows, a failed spawn, an early
  exit, or a channel that never opens is a failed start, with its reason. The app takes a
  single-instance lock, so a second start is harmless.
- **Restarting the app.** `start_app.py --restart` puts the running app on its current
  build. When the endpoint file's channel accepts, it asks the process the file's `pid`
  names to quit: SIGTERM on macOS and Linux, which Electron turns into its normal quit,
  and on Windows a close of its main window, as wigley-ai-gui's `npm run install-app`
  does. It waits up to 15 s for that process to exit and never force-kills it: a quit
  still running at 15 s fails the restart, naming the process, and starts nothing. On
  macOS and Linux a zombie counts as exited (`ps` state `Z`), as an app the relay started
  stays one after its quit, since the relay never reaps it. It then starts the app as
  Starting the app describes. With no app answering, it is a plain start.
  A dev app's forge process exits when its Electron process does, so the quit ends the
  whole `npm start`. `--dev` targets `~/.agents/wigley-ai-gui-dev`
  in place of the default folder or the one `WIGLEY_AI_GUI_ENDPOINT_DIR` names.
  `--from <folder>` restarts the dev app from that checkout and implies `--restart` and
  `--dev`: it runs the dev endpoint's recorded command with `<folder>` as its working folder.
  Before it quits anything it checks that the folder exists and that the recorded command is an
  npm start; with no recorded command it fails, since only a recorded start names the Node and
  npm to run. A `pid` that is not a positive integer reads as none, and a running app with none
  fails the restart, which then quits nothing.
- **Late connection.** The relay remembers the host's `initialize` request and
  `notifications/initialized`. After it connects to the app, or reconnects to a restarted
  one, it sends both again, so the app serves the host as if it had been there from the
  start; the app's answer to the replayed `initialize` never reaches the host.
- **No app.** While no app is reachable, the relay answers the MCP handshake and
  `tools/list` itself, from `tools.json` in the endpoint folder (the tool list the app
  writes on every start) or, when that file is missing, a built-in list of the six form
  tools: there `ask_round`, `open_primer` and `open_audio_picker` take any object, since their real schemas
  are the app's, and the collect tools take a `wait` flag. The handshake answer advertises
  `tools.listChanged`. A tool call whose start failed
  returns outcome `needs_manual_open`, its `summary` carrying the start's reason, and a
  `permission_prompt` call a deny carrying the same reason (see Boundary rules); the next
  call tries the start again. A tool that opens no form carries no `answers`, `findings` or
  `notices`, and its `next` names that tool: call it again once the app is back, or tell
  the user it did not run.
- **App refuses the hello.** When the app answers `ok: false` — the first line is not a
  JSON hello, a hello field has the wrong type, its relay protocol differs from the
  relay's, or it could not start the session — a tool call returns a tool error
  naming the app's reason and saying to send the form again with `ask_round`, or the
  primer again with `open_primer`, the audio picker again with `open_audio_picker`, or any other tool's call again,
  to tell the user the reason if it repeats, and, for a protocol mismatch, to update the app, which carries the
  `auri` plugin. A `permission_prompt` call
  gets a deny naming the app's reason instead (see Boundary rules). The relay does not
  start the app, and the next tool call says hello again.
- **App gone mid-call.** When the channel drops while a call waits — the app quit,
  restarted or is being updated while the agent's session keeps running in the app's
  session host — the relay keeps the call waiting. A call that arrives within 30 s of a drop
  waits the same way, whether or not a call was waiting at the drop, as does one that finds
  the channel gone just after connecting. The relay polls the channel until 30 s after the
  drop, since a restart or `install-app` brings the app back on its own and a start in
  between would race the install; past that it starts the app as on a tool call. Once
  connected it says hello, replays the late-connection messages, and sends the waiting call
  again, so a permission prompt shows again and a form, primer or audio picker opens pre-filled. When the
  app does not come back (the start fails), the relay answers the call with a tool error
  saying the app closed and to send the form again with `ask_round`, the primer again
  with `open_primer`, the audio picker again with `open_audio_picker`, or any other tool's call again
  once the app is back or tell the user it failed; a `permission_prompt` call gets a deny saying the app closed (see
  Boundary rules), so the tool it asked about does not run. A hello the app refuses after
  the drop ends the wait at once, and the call gets that refusal, as under App refuses the
  hello. Only a call waits: any other request the app has not answered when its channel
  drops gets the answers under No app at once, so the host never waits on it. A line the app
  sent on a channel the relay has left never reaches the host, so a call sent again gets one
  answer. In offline mode the relay starts no app at the end of the 30 s: it answers the
  waiting call from the app's table (Offline mode).

### Offline mode

A run that the app's session host starts while the app is quit (a wigley-ai-gui scheduled task) has nobody to start
the app for, and must not start it. Offline mode lets such a run carry on with answers the app wrote ahead.

- **Switch.** `WIGLEY_FORMS_OFFLINE` holds the absolute path of the calls folder, `<endpoint dir>/offline-calls`.
  The app sets it only on the runs its session host fires. Unset or empty, the relay behaves as above: a tool call
  with no app reachable starts the app.
- **Answers.** With the variable set and no app reachable, the relay never starts the app. Where it would start one —
  a call with no channel and no drop in the last 30 s, or a call still waiting 30 s after a drop — it answers the
  `tools/call` from `offline.json` in the endpoint folder, which the app writes beside `tools.json` each time it
  writes its endpoint files. A tool the table leaves out gets a tool error: `The app is closed: <tool> did not run.`
  A `permission_prompt` the table leaves out gets the relay's own deny instead, one text block holding
  `{"behavior":"deny","message":"The app is closed. The user was not asked, so this tool call did not run."}`
  (Boundary rules). A call that names no tool gets the tool error `The app is closed: this call named no tool, so it
  did not run.` A hello the app refuses is answered as under App refuses the hello, in offline mode too. The handshake
  and `tools/list` are answered as under No app.
- **A missing or unreadable table** is an empty one, so every tool answers as left out of it. Unreadable means not
  JSON, a top level that is not an object, or `tools` that is not an object. One entry reads as left out when it is
  not an object, its `result` is not an object or has no `content` list, or its `replay` is not a boolean.
- **`offline.json`** maps each tool name to its result, a `ToolResult` as the app returns it (`content`, optional
  `structuredContent`, optional `isError`), and whether the call replays onto its row when the app opens:

  ```json
  {
    "tools": {
      "<tool name>": {
        "result": { "content": [{ "type": "text", "text": "…" }] },
        "replay": true
      }
    }
  }
  ```

- **Calls file.** The relay appends one JSON line per `tools/call` it answered alone in offline mode to
  `<calls folder>/<hello session_id>.jsonl`:

  ```
  {"tool": "<name>", "arguments": {…}, "toolUseId": "<id>" | null, "at": <epoch ms>, "replay": <bool>}
  ```

  `toolUseId` is the call's `params._meta["claudecode/toolUseId"]`. `replay` is the table entry's, `false` for a tool
  the table leaves out. A call that names no tool and a call the app's refusal answers write no line. A line the
  relay cannot write is logged on stderr, and the call still gets its answer. Each line is one append that opens the
  file by name, so a line written after the app renamed
  the file starts a new one. When the app adopts the run as a row, it claims the file by renaming it, applies the
  replayable calls in file order, and deletes it.

- **No session id.** With a null hello `session_id` (`CLAUDE_CODE_SESSION_ID` unset; a run the app's host fires
  always sets it), each call still gets its offline answer, but the relay writes no calls-file line and logs one
  line on stderr for each such call. Nothing of that run replays.
- **The app comes up.** The relay's reconnect moves the session onto the app as today (Late connection): it says
  hello, replays the handshake, and forwards every later call.

## Registering the server

The `auri` plugin registers the server itself, with an inline entry in each of its two manifests:
`.claude-plugin/plugin.json` for Claude Code, whose `args` name `${CLAUDE_PLUGIN_ROOT}/scripts/relay/relay.py`, and
`.codex-plugin/plugin.json` for Codex, which expands no variable and joins `"cwd": "."` onto the plugin root, so its
`args` name `./scripts/relay/relay.py`. The app passes the plugin to every Claude Code session it starts with
`--plugin-dir <app>/agent-plugin`, so those sessions start `relay.py` with no install or `claude mcp add` step. A
terminal Claude Code or Codex session installs `auri@auri` from the app repo's marketplace,
`.claude-plugin/marketplace.json`.

The soft deadline — how long a call waits before it hands back a draft — is set per host
and reaches the app in the hello line, so each host waits as long as it can without the
call being killed:

- **Claude Code** — the entry sets `WIGLEY_FORMS_DEADLINE_SECONDS` to `300`. Claude Code
  aborts a stdio tool call that sends nothing for 30 min, so any value under that is
  safe. A short one hands back a draft every 5 min: at 1770 s a call sat silent for up to
  29 min, and agents stopped it as hung. Each draft wakes one short turn that calls
  `collect_last_round` again. Claude Code moves the call to the background after 2 min,
  so the session stays free between drafts.
- **Codex** — the variable is unset, so the deadline is the app's 240 s default. The
  entry sets `"tool_timeout_sec": 330`, which covers a drop at the call's start: the
  relay's 30 s hold, the app's 45 s start and that deadline. A re-sent call gets a fresh
  deadline, so a form open for a while before a drop can still pass 330 s;
  `collect_last_round` recovers it. Codex's 60 s default would cut `ask_round` off before
  the deadline hands back a draft.

To pre-approve every tool of the server in Claude Code, add `"mcp__plugin_auri_auri__*"`
under `permissions.allow` in `~/.claude/settings.json`. That entry also approves
`start_session`, which starts a real agent session spending the user's plan, so the calling
session's permission mode is the only gate on it. It also approves `run_command`, where the app's own Allow or
Deny form on a risky command is the gate. Even with that entry in place, Claude Code
still prompts on the first invocation in each new session — a known defect
(issue #5140, still open when checked on 2026-10-18) — so expect to approve once per
session until that is fixed.

## Local commands

Run from `agent-plugin/scripts/relay`:

- `python3 start_app.py` — starts the app, or finds it running. Exit 0 prints that it is
  ready; exit 1 prints why the start failed.
- `python3 start_app.py --restart [--dev]` and `python3 start_app.py --from <folder>` — quit
  the running app and start it again (Restarting the app), with the same exit codes.
- `python3 -m unittest discover` — the test suite: the relay's hello line, forwarding,
  starting the app, the replayed handshake, the no-app answers, a call held across an app
  restart and sent again, the app-gone answers, the relay's tool-list notice, a refused
  hello, and offline mode's table answers and calls file, against a fake app on a local channel,
  `endpoint.py`'s channels and endpoint lookup, `start_app.py` with an
  injected spawn and channel probe. Stdlib `unittest` only: the plugin takes no
  third-party dependency. The form logic's own tests live in the app's `src/` (`npm test`).

## Boundary rules

- `relay.py`, `endpoint.py` and `start_app.py` hold no forms logic: they never validate, store or
  render a form. A change to what a tool does is a change in the app. Offline mode holds
  none either: every offline answer comes from the app's `offline.json`, and the relay only
  serves and logs it.
- One exception: when the relay cannot deliver a `permission_prompt` call and answers it
  alone, it knows that tool's name and answer shape. Claude Code takes its decision from
  the text of a result whose content opens with a text block, and a form-style answer
  is no decision it can read. On a failed start, a refused hello or an app gone, that
  call gets one text block holding
  `{"behavior":"deny","message":<reason>}`, with no `structuredContent` or `isError`.
  With no app reachable in offline mode, the deny a closed app gives `permission_prompt` is the app's entry in
  `offline.json`. The relay builds its own deny, in the same shape, only when the table leaves `permission_prompt`
  out, a missing or unreadable table included.
- It imports nothing from any other folder.
- No third-party Python. Standard library only, so the relay runs with no install step on
  macOS and Windows.
