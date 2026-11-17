import { describe, expect, it, vi } from 'vitest';
import type {
  AgentSession,
  ToolDefinition,
  ToolSession,
} from '../../sessions/contract';
import type { FormsSession } from '../contract';
import { contributeFormsTools } from './tool-contribution';

function tool(name: string): ToolDefinition {
  return { name, description: name, inputSchema: { type: 'object' } };
}

function agentSession(id: string): AgentSession {
  return {
    id,
    info: { sessionId: id, projectDir: null, harness: null, rowId: null },
  };
}

interface Contribution {
  tools: ToolDefinition[];
  started: ToolSession[];
}

// A contributeTools that starts each contribution's tool session in every
// live session and records it; its dispose ends them, as sessions' does.
// `failNext` makes the next call throw before it starts any.
function recordingSessions(live: AgentSession[]) {
  const contributions: Contribution[] = [];
  let failsNext = false;
  return {
    contributions,
    failNext: () => {
      failsNext = true;
    },
    sessions: {
      contributeTools: vi.fn(
        (tools: ToolDefinition[], start: (s: AgentSession) => ToolSession) => {
          if (failsNext) {
            failsNext = false;
            throw new Error('bad tools');
          }
          const contribution = {
            tools,
            started: live.map((session) => start(session)),
          };
          contributions.push(contribution);
          let isDisposed = false;
          return {
            dispose() {
              if (isDisposed) {
                return;
              }
              isDisposed = true;
              for (const started of contribution.started) {
                started.end();
              }
            },
          };
        },
      ),
    },
  };
}

function fakeFormsSession(): FormsSession {
  return {
    open: vi.fn(),
    collect: vi.fn(),
    end: vi.fn(),
  };
}

// The contribution over one live session `a`, its tool list read from
// `toolList`, recording each forms session it starts.
function setup(toolList: () => ToolDefinition[] = () => [tool('ask_round')]) {
  const recorded = recordingSessions([agentSession('a')]);
  const formsSessions: FormsSession[] = [];
  const logLines: string[] = [];
  const handle = contributeFormsTools({
    sessions: recorded.sessions,
    tools: toolList,
    startSession: () => {
      const forms = fakeFormsSession();
      formsSessions.push(forms);
      return forms;
    },
    type: {
      openTool: 'ask_round',
      collectTool: 'collect_last_round',
      argsErrorText: () => null,
    },
    log: (message) => logLines.push(message),
  });
  return { ...recorded, formsSessions, logLines, handle };
}

describe('contributeFormsTools', () => {
  it('refresh disposes the old contribution and contributes the tools again', () => {
    let names = ['ask_round'];
    const { handle, contributions } = setup(() => names.map(tool));

    names = ['ask_round', 'collect_last_round'];
    handle.refresh();

    expect(contributions.map((each) => each.tools.map((t) => t.name))).toEqual([
      ['ask_round'],
      ['ask_round', 'collect_last_round'],
    ]);
  });

  it('keeps the forms session of each agent session across a refresh', () => {
    const { handle, formsSessions } = setup();

    handle.refresh();

    expect(formsSessions).toHaveLength(1);
    expect(formsSessions[0].end).not.toHaveBeenCalled();
  });

  it("ends the forms session when the agent session's tool session ends", () => {
    const { handle, contributions, formsSessions } = setup();

    contributions[0].started[0].end();
    handle.refresh();

    expect(formsSessions[0].end).toHaveBeenCalledTimes(1);
    expect(formsSessions).toHaveLength(2);
  });

  it("ends every forms session on the handle's dispose", () => {
    const { handle, formsSessions } = setup();

    handle.dispose();

    expect(formsSessions[0].end).toHaveBeenCalledTimes(1);
  });

  it('keeps the forms sessions and contributes the last good list when a refresh fails', () => {
    let names = ['ask_round'];
    const { handle, contributions, formsSessions, failNext, logLines } = setup(
      () => names.map(tool),
    );

    names = ['ask_round', 'bad'];
    failNext();
    handle.refresh();

    expect(contributions.at(-1)?.tools.map((t) => t.name)).toEqual([
      'ask_round',
    ]);
    expect(formsSessions).toHaveLength(1);
    expect(formsSessions[0].end).not.toHaveBeenCalled();
    expect(logLines).toEqual(['forms tools: bad tools (tools ask_round, bad)']);
  });

  it('contributes nothing more on a refresh after dispose', () => {
    const { handle, sessions } = setup();

    handle.dispose();
    handle.refresh();

    expect(sessions.contributeTools).toHaveBeenCalledTimes(1);
  });
});
