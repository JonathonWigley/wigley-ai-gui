import {
  type AgentSession,
  errorResult,
  type OfflineAnswer,
  textResult,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import { HEADLESS_NOTE, HEADLESS_OFF_NOTE } from '../contract';

export const SET_HEADLESS_TOOL: ToolDefinition = {
  name: 'set_headless',
  description:
    'Turn this session\'s headless mode on or off in the Auri app. While the session is headless the app shows no form: every ask_round comes back answered with its recommendations. Every open_audio_picker comes back auto_answered with each moment\'s recommended candidate. Turn it on only when the user hands you the rest of the run ("continue with your own suggestions", "run headless", "stop asking me, finish it"); a reply that takes your recommendations for one form answers that form only. Turn it off when the user asks to be asked again. Only a session the Auri app started can be headless. Returns the line that says whether the session is now headless.',
  inputSchema: {
    type: 'object',
    properties: {
      headless: {
        type: 'boolean',
        description: 'true turns headless on, false turns it off.',
      },
    },
    required: ['headless'],
    additionalProperties: false,
  },
};

// set_headless's answer while the app is closed: the run stays headless, and
// the call does not replay.
export const SET_HEADLESS_OFFLINE: OfflineAnswer = {
  result: textResult('The app is closed: the session stays headless.'),
  replay: false,
};

export interface SetHeadlessToolDeps {
  // Whether chat holds the session, so it has a headless flag.
  owns(sessionId: string): boolean;
  setHeadless(sessionId: string, headless: boolean): void;
  log(line: string): void;
}

function setHeadless(
  deps: SetHeadlessToolDeps,
  session: AgentSession,
  args: unknown,
): ToolResult {
  const headless = (args as { headless?: unknown } | null)?.headless;
  if (typeof headless !== 'boolean') {
    return errorResult('headless must be true or false.');
  }
  if (!deps.owns(session.id)) {
    return errorResult(
      'Only a session the Auri app started can be headless; this session was not started by the app.',
    );
  }
  deps.setHeadless(session.id, headless);
  deps.log(`set_headless ${headless ? 'on' : 'off'} for ${session.id}`);
  return textResult(headless ? HEADLESS_NOTE : HEADLESS_OFF_NOTE);
}

// The `start` chat hands sessions' `contributeTools` with SET_HEADLESS_TOOL:
// each session's calls set that session's own flag.
export function setHeadlessToolSession(
  deps: SetHeadlessToolDeps,
): (session: AgentSession) => ToolSession {
  return (session) => ({
    call(name, args) {
      if (name !== SET_HEADLESS_TOOL.name) {
        return Promise.reject(new Error(`no chat tool "${name}"`));
      }
      return Promise.resolve(setHeadless(deps, session, args));
    },
    end: () => undefined,
  });
}
