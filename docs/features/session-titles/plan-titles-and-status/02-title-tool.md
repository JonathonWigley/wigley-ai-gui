# 02 — The set_session_title tool

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/plugins/sessions/main/title-tool.ts` · modify `src/plugins/sessions/main/start.ts` · test `src/plugins/sessions/main/title-tool.test.ts` · test `src/plugins/sessions/main/start.test.ts`
Consumes:  `SessionsMainExports.setTitle`, `SessionsMainExports.titles`, `titleProblem`, `normalizedTitle` ← 01; `contributeTools` (tree)
Produces:  in `src/plugins/sessions/main/title-tool.ts`: `export const SET_SESSION_TITLE_TOOL: ToolDefinition` and `export function startTitleTool(deps: { setTitle: SessionsMainExports['setTitle']; titles: SessionsMainExports['titles']; maxLength(): number }): (session: AgentSession) => ToolSession`
Decisions:
- Sessions' main part contributes the tool to itself during its start through the same `contributeTools` path other plugins use, so the MCP adapter still names no tool.
- Tool name `set_session_title`. Input schema: `{ type: 'object', properties: { title: { type: 'string', description: 'A short descriptive name for this session’s work.' } }, required: ['title'], additionalProperties: false }`.
- Tool description, pinned: `Name this session in the Auri side bar so the user can tell it apart from their other sessions. Give a short, specific title naming the work (for example "Session titles in the side bar"). Call it at the end of your first turn, and again only when the work's focus clearly changes. A title over the length limit is refused with the limit; send a shorter one.`
- The limit is read on each call, so a settings change applies to the next call: `maxLength()` returns `titleLimit(api.settings().titleMaxLength)` (task 01).
- A call whose `title` is missing or not a string, or for which `titleProblem` returns a problem, returns `isError: true` with that problem as its text (a missing title: `'title must be a string.'`), and stores nothing.
- A valid call stores it as the session's `agent` title and returns the text `Title set to "<normalized title>".` — or, when the session has a `user` title, `Saved "<normalized title>" as the agent title; the user's own title "<user title>" shows until they clear it.`, so the agent does not retry.
- The tool's session is the `AgentSession` the contribution's start receives; `session.id` is the row's id. A call whose session has ended (`titles(session.id) === null`) returns `isError: true` with `'This session has ended.'`.
GIVEN a session with no titles WHEN the tool is called with `"Session titles"` THEN the agent title is `Session titles` and the result is not an error
GIVEN the limit 40 WHEN the tool is called with 41 characters THEN the result is an error naming 41 and 40 and no title is stored
GIVEN a user title `Mine` WHEN the tool is called with `"Theirs"` THEN the agent title is `Theirs` and the result text names `Mine`
Tests:     `title-tool.test.ts` — one table, each row `{ args, isError, text, stored }` with the exact pinned texts: `{title:'Session titles'}` → false, `Title set to "Session titles".`, agent `Session titles`; `{title:'   '}` → true, `The title is empty.`, nothing; 41 characters at 40 → true, `The title is 41 characters; the limit is 40.`, nothing; `{}` → true, `title must be a string.`, nothing; `{title:'Theirs'}` under user `Mine` → false, `Saved "Theirs" as the agent title; the user's own title "Mine" shows until they clear it.`, agent `Theirs`; ended session → true, `This session has ended.`, nothing. One row changes `maxLength` between two calls. One assertion pins `SET_SESSION_TITLE_TOOL`'s name, description and schema to the pinned values. `start.test.ts` — after the main part starts, `tools()` holds `set_session_title` exactly once.
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof
