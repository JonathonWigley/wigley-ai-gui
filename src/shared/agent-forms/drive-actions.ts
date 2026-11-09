import type {
  AgentFormToolResult,
  AgentFormToolSession,
} from '../../contracts/agent-forms';
import type { DriveHost } from '../../contracts/plugin';
import {
  argsObject,
  nullableStringOr,
  optionalOneOf,
  optionalString,
  requiredString,
} from '../drive-args';

// The sessions plugin's ConnectedSession and its main exports' `connect`,
// restated structurally: `src/shared` imports no plugin contract.
export interface AgentFormDriveSession extends AgentFormToolSession {
  session: { id: string };
}

export interface AgentFormDriveSessions<Harness extends string> {
  // Connects a session for the host session id, with no row until a form
  // shows, or joins the owned session holding it.
  connect(info: {
    sessionId: string;
    projectDir: string | null;
    harness: Harness;
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

// The harnesses a drive session may name, and what a session is connected
// with when the caller leaves a field out.
export interface AgentFormDriveSessionDefaults<Harness extends string> {
  harnesses: readonly Harness[];
  projectDir: string;
  harness: Harness;
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

function sessionArgsText(harnesses: readonly string[]): string {
  const harnessUnion = harnesses.map((harness) => `"${harness}"`).join(' | ');
  return `sessionId?: string, projectDir?: string | null, harness?: ${harnessUnion}`;
}

// Adds a form type's two drive actions: `words.openAction` opens a form
// without waiting for its answers, and `answers` reads the latest form's tool
// result. The open action reuses the live session it connected before under
// `sessionId`; otherwise it connects that id, which joins an owned session
// holding it (one `sessions.open` opened, so a round and a primer share one
// row) or connects a session with no row, which the form's showing adds.
// A session's id is `drive-<pluginId>-<n>` unless the
// caller names one. `onSessionEnded` hears each session that ends, by its row
// id. The plugin's stop removes the actions and ends every session connected.
export function addAgentFormDriveActions<Harness extends string>(deps: {
  host: DriveHost;
  sessions: AgentFormDriveSessions<Harness>;
  sessionDefaults: AgentFormDriveSessionDefaults<Harness>;
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
    harness: Harness;
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
    args: `{ ${sessionArgsText(sessionDefaults.harnesses)}, ${words.formArg}?: object }`,
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
        optionalOneOf(args, 'harness', sessionDefaults.harnesses) ??
        sessionDefaults.harness;
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
