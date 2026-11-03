import type {
  AgentSession,
  SessionsMainExports,
  ToolDefinition,
  ToolResult,
  ToolSession,
} from '../contract';
import { normalizedTitle, titleProblem } from '../session-title';

export const SET_SESSION_TITLE_TOOL: ToolDefinition = {
  name: 'set_session_title',
  description:
    'Name this session in the Auri side bar so the user can tell it apart from their other sessions. Give a title of 2 to 4 words, at most 30 characters, that names the topic of the work like a heading ("Agent Status Line", "Forms Crash on Resume"), not a sentence describing the request. Call it at the end of your first turn, and again only when the work\'s focus clearly changes. A title over the length limit is refused with the limit; send a shorter one.',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'A 2 to 4 word heading naming this session’s topic, at most 30 characters.',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
};

export interface TitleToolDeps {
  setTitle: SessionsMainExports['setTitle'];
  titles: SessionsMainExports['titles'];
  // Read on each call, so a settings change applies to the next call.
  maxLength(): number;
}

function textResult(text: string, isError: boolean): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

// The text an agent reads after its title is stored: over a user title, that
// the user's title still shows, so the agent does not retry.
function storedText(title: string, userTitle: string | null): string {
  return userTitle === null
    ? `Title set to "${title}".`
    : `Saved "${title}" as the agent title; the user's own title "${userTitle}" shows until they clear it.`;
}

// Stores a valid `title` as the session's agent title; a missing, empty or
// over-long one, or a call after the session ended, is an error result that
// stores nothing.
function setSessionTitle(
  deps: TitleToolDeps,
  sessionId: string,
  args: unknown,
): ToolResult {
  const titles = deps.titles(sessionId);
  if (titles === null) {
    return textResult('This session has ended.', true);
  }
  const title = (args as { title?: unknown } | null | undefined)?.title;
  if (typeof title !== 'string') {
    return textResult('title must be a string.', true);
  }
  const problem = titleProblem(title, deps.maxLength());
  if (problem !== null) {
    return textResult(problem, true);
  }
  deps.setTitle(sessionId, 'agent', title);
  return textResult(storedText(normalizedTitle(title), titles.user), false);
}

// The `start` sessions hands its own `contributeTools` with
// SET_SESSION_TITLE_TOOL: each session's calls title that session.
export function startTitleTool(
  deps: TitleToolDeps,
): (session: AgentSession) => ToolSession {
  return (session) => ({
    call(name, args) {
      if (name !== SET_SESSION_TITLE_TOOL.name) {
        return Promise.reject(new Error(`no sessions tool "${name}"`));
      }
      return Promise.resolve(setSessionTitle(deps, session.id, args));
    },
    end: () => undefined,
  });
}
