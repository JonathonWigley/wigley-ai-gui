# 09 — Retire the primer server and dashboard; relay tools

Status: not started
Type: Task
Wave: 2 · Depends on: 10
Plan: [plan.md](plan.md)
Rules: [plan.md § Rules for every task](plan.md#rules-for-every-task)

Repo: `~/Documents/ai-dev/wigley-ai-marketplace`. Every path below is under `plugins/wigley/` unless it starts with
`~`.

Files:     delete `scripts/primer/` (the whole folder: `server.py`, `primer.py`, `presenter.py`, `store.py`,
           `README.md`, `static/`, `tests/`) · delete `scripts/dashboard/` (the whole folder: `hub.py`, `notify.py`,
           `README.md`, `static/`, `tests/`) · modify `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` ·
           modify `scripts/forms/relay.py` · test `scripts/forms/tests/test_relay.py`
Consumes:  `relay.not_started(reason: str) -> dict[str, Any]`, `relay.NOT_STARTED_NEXT`, `relay.APP_GONE`,
           `relay.BUILT_IN_TOOLS`, `Relay._pending`, `Relay._answer_alone`, `Relay._drop` (all in the tree today)
           · the primer tool names and payload shape in `scripts/forms/README.md` § The feature primer (docs commit
           `804cf0e`)
Produces:  in `scripts/forms/relay.py`:
           `BUILT_IN_TOOLS` with four tools: `ask_round`, `collect_last_round`, `open_primer`, `collect_last_primer`
           `OPEN_PRIMER_INPUT_SCHEMA: dict[str, Any]` (the schema pinned below)
           `NOT_STARTED_NEXT: str` — a template with the fields `{noun}`, `{open_tool}`, `{collect_tool}`,
           `{fallback}`
           `APP_GONE: str` — a template with the fields `{noun}`, `{open_tool}`
           `def not_started(reason: str, tool: str | None) -> dict[str, Any]`
           `Relay._pending: dict` — each waiting call's request id mapped to its tool name (`str | None`)
Decisions: see below.

## Decisions

- **What the deletions reach.** `git grep -n -i -l 'dashboard\|scripts/primer\|wigley-primer'` outside the two folders
  found, at plan time: both `plugin.json` files (the server entry this task removes), `scripts/forms/README.md` (the
  store folder `~/.agents/wigley-primer/primers/` only, which stays), and `scripts/retro/answers.py`, `digest.py`,
  `tests/test_digest.py` (task 10 owns them). No Python module outside the two folders imports from them. Re-run the
  grep before deleting. A new hit outside those files is a concern to report, not a silent edit.
- **The retro suite reads `scripts/primer/store.py`.** `scripts/retro/tests/test_record_fields.py` and
  `test_retention.py` read that file's source. Task 10 removes those reads in the same wave. Until task 10 lands, the
  retro suite fails on this task's deletion. This task's gate is the forms suite only; the wave check runs the retro
  suite once both tasks are committed.
- **Generated files.** After `git rm -r` of the two folders, delete any untracked `__pycache__/` folder left under
  `scripts/primer/` or `scripts/dashboard/`, then delete the empty folders. Touch nothing else that is untracked.
- **AGENTS.md § Done.** It lists no primer or dashboard test command (checked at plan time: it lists `docs-index`,
  `forms`, `plan`, `retro`, `unity-playtest`, `unity-ux-flow`). Nothing to remove there.
- **The manifests.** Remove the `"wigley-primer"` key and its object from `mcpServers` in both files. Leave
  `"wigley-forms"` and every other field as it is. Do not change `version`: task 12 bumps it once for the run.
- **The relay holds no forms logic** (`scripts/forms/README.md` § Boundary rules). "One open round and one open primer
  per connection" is the app's rule; the relay already forwards several waiting calls at once (`_pending` holds every
  waiting id). The only new relay state is the tool name of each waiting call, so the app-gone text names the right
  tool. Add no other state.
- **The texts are tool-neutral templates**, filled from one table keyed by the tool name of the call. Add a private
  table (for example a `NamedTuple` `_FormWords(noun, open_tool, collect_tool, fallback)` and a dict from tool name to
  it). The round words fill `ask_round` and `collect_last_round` and every other tool name, `None` included (the
  behaviour today). The primer words fill `open_primer` and `collect_last_primer`.

  | Field | Round words | Primer words |
  | --- | --- | --- |
  | `noun` | `round` | `primer` |
  | `open_tool` | `ask_round` | `open_primer` |
  | `collect_tool` | `collect_last_round` | `collect_last_primer` |
  | `fallback` | `ask the round's questions and findings in the reply` | `run the feature-primer skill's triage in chat` |

  Pinned templates (the round words give the texts the relay sends today, character for character):

  ```python
  APP_GONE = ("The wigley-ai-gui app closed while this call waited; send the {noun} again with {open_tool} "
              "— it opens pre-filled.")
  NOT_STARTED_NEXT = ("No {noun} exists. Send the same {noun} again with {open_tool} once: the relay tries the start "
                      "again. If needs_manual_open comes back a second time, tell the user the reason in summary and "
                      "{fallback}. {collect_tool} is never the answer to this outcome.")
  ```

  The refusal text in `_answer_alone` becomes the same kind of template. Pinned:

  ```python
  f"The wigley-ai-gui app refused this relay: {self._refusal}. Send the {noun} again with {open_tool}: "
  "the relay says hello again on each call. If the refusal comes back, tell the user the app's reason. "
  "When the reason is a protocol mismatch, the user updates the wigley plugin and the app's repo "
  "so both speak one relay protocol."
  ```

- **`not_started(reason, tool)`.** The tool is `message["params"]["name"]` when `params` is a dict and `name` is a
  string, else `None`. Read it once in `handle_line` (or `_answer_alone`) with that rule. The payload:
  - round words: `{"outcome": "needs_manual_open", "summary": <summary>, "next": <next>, "answers": [], "findings": [],
    "notices": []}` (unchanged)
  - primer words: `{"outcome": "needs_manual_open", "summary": <summary>, "next": <next>}` — no `feature` and no
    `entries` keys (README § The feature primer; `plan.md` § Design Overview)
  - `summary` stays `f"The wigley-ai-gui app could not be started: {reason}"` for both.
- **`_pending` becomes a dict.** `_forward` stores `request id → tool name` for a `tools/call` with an `id`.
  `_remember` (on `notifications/cancelled`) and `_from_app` remove the id with `pop(id, None)`. `_drop` sends each
  waiting call `APP_GONE` filled with that call's words. `close` clears it.
- **`BUILT_IN_TOOLS`** gains two tools after the round tools, in this order:

  ```python
  {"name": "open_primer",
   "description": ("Open a feature primer in the wigley-ai-gui app and wait for the user's edits. The app is not "
                   "running, so this is a stand-in for its full description."),
   "inputSchema": OPEN_PRIMER_INPUT_SCHEMA},
  {"name": "collect_last_primer",
   "description": ("Re-attach to the primer open in the wigley-ai-gui app, or return the last finished primer's "
                   "edits again."),
   "inputSchema": {"type": "object", "additionalProperties": False,
                   "properties": {"wait": {"type": "boolean"}}}},
  ```

  The round entries stay as they are.
- **`OPEN_PRIMER_INPUT_SCHEMA`** is the `open_primer` contract of README § The feature primer. Task 05's
  `src/plugins/primer/main/tool-definitions.ts` must give `open_primer` and `collect_last_primer` the same schemas:
  equal after every `description` and `default` key is removed (the app's schema may add those; this one carries
  none). Pinned:

  ```python
  OPEN_PRIMER_INPUT_SCHEMA = {
      "type": "object",
      "additionalProperties": False,
      "required": ["feature", "entries"],
      "properties": {
          "feature": {
              "type": "object",
              "additionalProperties": False,
              "required": ["name", "slug"],
              "properties": {
                  "name": {"type": "string"},
                  "slug": {"type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$"},
                  "spec": {"type": "string"},
                  "summary": {"type": "string"},
              },
          },
          "entries": {
              "type": "array",
              "minItems": 1,
              "maxItems": 60,
              "items": {
                  "type": "object",
                  "additionalProperties": False,
                  "required": ["id", "task", "need", "items"],
                  "properties": {
                      "id": {"type": "string"},
                      "group": {"type": "string", "enum": ["primer", "standing"]},
                      "number": {"type": "integer"},
                      "area": {"type": "string"},
                      "question": {"type": "string"},
                      "task": {"type": "string"},
                      "need": {"type": "string", "enum": ["yes", "no", "unclear"]},
                      "evidence": {"type": "string"},
                      "probes": {"type": "string"},
                      "pointer": {"type": "string"},
                      "items": {"type": "array", "minItems": 1, "maxItems": 20,
                                "items": {"type": "string", "minLength": 1}},
                  },
              },
          },
      },
  }
  ```

- Update the module docstring only where it names a round alone for the tool texts; README § The relay stays its spec.

## Behaviour

GIVEN no app and a start that fails with reason R WHEN the host sends a `tools/call` for `open_primer` THEN the reply's
`structuredContent` is exactly `{"outcome": "needs_manual_open", "summary": "The wigley-ai-gui app could not be
started: R", "next": <NOT_STARTED_NEXT with the primer words>}`, and the text content parses to the same object.

GIVEN no app and a failed start WHEN the host sends a `tools/call` for `ask_round` THEN the payload is the one the relay
sends today, `next` reading "No round exists. Send the same round again with ask_round once: …".

GIVEN a round call and a primer call both waiting on the app WHEN the app's channel drops THEN the round call gets the
tool error "The wigley-ai-gui app closed while this call waited; send the round again with ask_round — it opens
pre-filled." and the primer call gets "… send the primer again with open_primer — it opens pre-filled.".

GIVEN no `tools.json` WHEN the host sends `tools/list` THEN the names are `ask_round`, `collect_last_round`,
`open_primer`, `collect_last_primer`.

GIVEN an app that refuses the hello WHEN the host sends a `tools/call` for `collect_last_primer` THEN the tool error
text holds "Send the primer again with open_primer".

## Tests

In `scripts/forms/tests/test_relay.py`. Add a helper beside `tool_call` that builds a call for a named tool, for
example `tool_call(request_id, name="ask_round", arguments=...)`; keep the existing round calls as they are.

- `NoAppTests.test_tools_list_falls_back_to_a_built_in_list_with_the_same_names` — the name set becomes
  `{"ask_round", "collect_last_round", "open_primer", "collect_last_primer"}`.
- `NoAppTests.test_a_failed_start_returns_needs_manual_open_carrying_its_reason` — compare against
  `relay.not_started(<reason>, "ask_round")`, and assert `payload["next"]` equals the round text written out in full
  in the test (the text the relay sends today), not the template constant.
- New `NoAppTests.test_a_failed_primer_start_returns_needs_manual_open_with_no_feature_or_entries` — a failed start,
  an `open_primer` call; the payload equals the three-key object above with the primer `next` written out in full:
  "No primer exists. Send the same primer again with open_primer once: the relay tries the start again. If
  needs_manual_open comes back a second time, tell the user the reason in summary and run the feature-primer skill's
  triage in chat. collect_last_primer is never the answer to this outcome."
- `AppGoneTests.test_a_call_waiting_when_the_app_goes_gets_the_app_gone_error` — assert the round text written out in
  full.
- New `AppGoneTests.test_each_waiting_call_gets_the_app_gone_text_of_its_own_tool` — `hold_calls=True`, send an
  `ask_round` call (id 7) and an `open_primer` call (id 8), read both from the app, `app.drop()`; collect the two host
  messages by id; id 7 carries the round text, id 8 the primer text, each `isError: True`.
- New `RefusedTests.test_a_refused_primer_call_names_open_primer` — a refusing app, a `collect_last_primer` call; the
  text holds "Send the primer again with open_primer".
- The existing `test_a_call_the_host_cancelled_gets_no_app_gone_error` keeps passing with `_pending` as a dict.

Done when: `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)` passes; `python3 scripts/check_manifests.py`
and `python3 scripts/check_pointers.py` pass from the repo root; `claude plugin validate .` passes; `git ls-files
plugins/wigley/scripts/primer plugins/wigley/scripts/dashboard` prints nothing; `grep -n wigley-primer
plugins/wigley/.claude-plugin/plugin.json plugins/wigley/.codex-plugin/plugin.json` prints nothing. The retro suite is
the wave check's, after task 10.
Commit:    one commit for the group in wigley-ai-marketplace, for example "Retire the wigley-primer server and the
           dashboard; the relay serves the primer tools while the app is away"

## Proof
