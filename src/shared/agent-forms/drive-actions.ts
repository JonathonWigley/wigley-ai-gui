import type {
  AgentFormToolResult,
  AgentFormToolSession,
} from '../../contracts/agent-forms';
import type { DriveHost } from '../../contracts/plugin';
import {
  argsObject,
  nullableStringOr,
  optionalString,
  requiredString,
} from '../drive-args';

// The sessions plugin's ConnectedSession and its main exports' `connect`,
// restated structurally: `src/shared` imports no plugin contract.
export interface AgentFormDriveSession extends AgentFormToolSession {
  session: { id: string };
}

export interface AgentFormDriveSessions {
  // Connects a session for the host session id, with no row until a form
  // shows, or joins the owned session holding it.
  connect(info: {
    sessionId: string;
    projectDir: string | null;
    harness: string;
  }): AgentFormDriveSession;
}

// What one form type's drive actions are called and what they open.
// `pluginId` qualifies the actions (`forms.openRound`) and names the sessions
// they connect (`drive-forms-<n>`); `formArg` is the open action's arg holding
// the tool input, `defaultForm` the input when the caller leaves it out, and
// `openTool` the tool the open action calls.
export interface AgentFormDriveWords {
  pluginId: string;
  openAction: string;
  formArg: string;
  defaultForm: unknown;
  openTool: string;
  openDescription: string;
  answersDescription: string;
}

// What a drive session is connected with when the caller leaves a field out.
export interface AgentFormDriveSessionDefaults {
  projectDir: string;
  harness: string;
}

// A session the drive actions connected, whether it has since ended, and
// where its latest form stands.
interface DriveFormSession {
  connected: AgentFormDriveSession;
  ended: boolean;
  latest:
    | { state: 'pending' }
    | { state: 'resolved'; result: AgentFormToolResult }
    | { state: 'failed'; error: unknown };
}

// Calls the form type's open tool in the session as an agent would, with no
// tool use id and a signal nothing aborts.
export function openFixtureForm(
  session: AgentFormToolSession,
  openTool: string,
  args: unknown,
): Promise<AgentFormToolResult> {
  return session.call(openTool, args, {
    toolUseId: null,
    signal: new AbortController().signal,
  });
}

const SESSION_ARGS_TEXT =
  'sessionId?: string, projectDir?: string | null, harness?: string';

// Adds a form type's two drive actions: `words.openAction` opens a form
// without waiting for its answers, and `answers` reads the latest form's tool
// result. The open action reuses the live session it connected before under
// `sessionId`; otherwise it connects that id, which joins an owned session
// holding it (one `sessions.open` opened, so a round and a primer share one
// row) or connects a session with no row, which the form's showing adds.
// A session's id is `drive-<pluginId>-<n>` unless the
// caller names one. `onSessionEnded` hears each session that ends, by its row
// id. The plugin's stop removes the actions and ends every session connected.
export function addAgentFormDriveActions(deps: {
  host: DriveHost;
  sessions: AgentFormDriveSessions;
  sessionDefaults: AgentFormDriveSessionDefaults;
  onSessionEnded: (listener: (rowId: string) => void) => void;
  words: AgentFormDriveWords;
}): void {
  const { host, sessions, sessionDefaults, words } = deps;
  const opened = new Map<string, DriveFormSession>();
  let defaultIds = 0;
  deps.onSessionEnded((rowId) => {
    for (const session of opened.values()) {
      if (session.connected.session.id === rowId) {
        session.ended = true;
      }
    }
  });
  const sessionFor = (spec: {
    sessionId: string;
    projectDir: string | null;
    harness: string;
  }): DriveFormSession => {
    const known = opened.get(spec.sessionId);
    if (known !== undefined && !known.ended) {
      return known;
    }
    const session: DriveFormSession = {
      connected: sessions.connect(spec),
      ended: false,
      latest: { state: 'pending' },
    };
    opened.set(spec.sessionId, session);
    return session;
  };
  host.add(words.openAction, {
    description: words.openDescription,
    args: `{ ${SESSION_ARGS_TEXT}, ${words.formArg}?: object }`,
    async run(rawArgs) {
      const args = argsObject(rawArgs);
      const sessionId =
        optionalString(args, 'sessionId') ??
        `drive-${words.pluginId}-${++defaultIds}`;
      const projectDir = nullableStringOr(
        args,
        'projectDir',
        sessionDefaults.projectDir,
      );
      const harness =
        optionalString(args, 'harness') ?? sessionDefaults.harness;
      const form =
        args[words.formArg] === undefined
          ? words.defaultForm
          : args[words.formArg];
      const session = sessionFor({ sessionId, projectDir, harness });
      const pending: DriveFormSession['latest'] = { state: 'pending' };
      session.latest = pending;
      // A form opened after this one stays the latest when this one settles.
      const settle = (latest: DriveFormSession['latest']) => {
        if (session.latest === pending) {
          session.latest = latest;
        }
      };
      openFixtureForm(session.connected, words.openTool, form).then(
        (result) => settle({ state: 'resolved', result }),
        (error: unknown) => settle({ state: 'failed', error }),
      );
      return { sessionId, rowId: session.connected.session.id };
    },
  });
  host.add('answers', {
    description: words.answersDescription,
    args: '{ sessionId: string }',
    async run(rawArgs) {
      const sessionId = requiredString(argsObject(rawArgs), 'sessionId');
      const session = opened.get(sessionId);
      if (session === undefined) {
        throw new Error(
          `no session ${sessionId} from ${words.pluginId}.${words.openAction}`,
        );
      }
      const { latest } = session;
      if (latest.state === 'failed') {
        throw latest.error;
      }
      return latest.state === 'resolved' ? latest.result : { pending: true };
    },
  });
}
