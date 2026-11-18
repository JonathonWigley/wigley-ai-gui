import type { AgentFormType } from '../../../contracts/agent-forms';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import { errorText } from '../../../shared/error-text';
import type {
  AgentSession,
  ContributeToolsOptions,
  SessionsMainExports,
  ToolDefinition,
  ToolSession,
} from '../../sessions/contract';
import type { FormsSession } from '../contract';

// Forms' tools contributed to every agent session, over one forms session per
// agent session id, each contribution made with `options`. The first
// contribution is made at once, and a throw from it propagates. `refresh`
// contributes `tools()` again, keeping every forms session and its open
// round; a refresh whose `tools()` or contribution throws logs it and
// contributes the last good list once more. Outside a refresh, a newer tool
// session of an id starts its own forms session and replaces the entry, and
// the older one's end leaves it. `session` returns the live forms session of
// an agent session id, or undefined once its tool session ended. `dispose`
// ends every forms session, and a `refresh` after it does nothing.
export function contributeFormsTools(deps: {
  sessions: Pick<SessionsMainExports, 'contributeTools'>;
  tools: () => ToolDefinition[];
  options: ContributeToolsOptions;
  startSession: (session: AgentSession) => FormsSession;
  type: Pick<
    AgentFormType<unknown, unknown, unknown>,
    'openTool' | 'collectTool' | 'argsErrorText'
  >;
  log: PluginLog;
}): {
  refresh(): void;
  session(sessionId: string): FormsSession | undefined;
} & Disposable {
  const formsSessions = new Map<string, FormsSession>();
  // True while a refresh swaps contributions: a tool session's end then
  // leaves its forms session open, and the new start takes it up.
  let keepsSessions = false;
  let isDisposed = false;

  const start = (session: AgentSession): ToolSession => {
    let forms = keepsSessions ? formsSessions.get(session.id) : undefined;
    if (forms === undefined) {
      forms = deps.startSession(session);
      formsSessions.set(session.id, forms);
    }
    const kept = forms;
    const toolSession = createAgentFormToolSession(kept, deps.type);
    return {
      call: (name, args, context) => toolSession.call(name, args, context),
      end: () => {
        if (keepsSessions) {
          return;
        }
        if (formsSessions.get(session.id) === kept) {
          formsSessions.delete(session.id);
        }
        toolSession.end();
      },
    };
  };

  let goodTools = deps.tools();
  let contribution: Disposable | null = deps.sessions.contributeTools(
    goodTools,
    start,
    deps.options,
  );

  const contributeLastGood = () => {
    try {
      contribution = deps.sessions.contributeTools(
        goodTools,
        start,
        deps.options,
      );
    } catch (error) {
      deps.log(`forms tools: ${errorText(error)}; forms has no tools`);
    }
  };

  return {
    session: (sessionId) => formsSessions.get(sessionId),
    refresh() {
      if (isDisposed) {
        return;
      }
      keepsSessions = true;
      try {
        contribution?.dispose();
        contribution = null;
        let tools: ToolDefinition[] | null = null;
        try {
          tools = deps.tools();
          contribution = deps.sessions.contributeTools(
            tools,
            start,
            deps.options,
          );
          goodTools = tools;
        } catch (error) {
          const names =
            tools === null
              ? ''
              : ` (tools ${tools.map((tool) => tool.name).join(', ')})`;
          deps.log(`forms tools: ${errorText(error)}${names}`);
          contributeLastGood();
        }
      } finally {
        keepsSessions = false;
      }
    },
    dispose() {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      contribution?.dispose();
      contribution = null;
      formsSessions.clear();
    },
  };
}
