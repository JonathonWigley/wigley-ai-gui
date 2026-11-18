import { describe, expect, it } from 'vitest';
import type {
  AgentHarness,
  AgentHarnessRegistry,
} from '../../../contracts/agent';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type AgentSession,
  type ContributeToolsOptions,
  errorResult,
  type SessionsMainExports,
  sessionsMainKey,
  textResult,
  type ToolDefinition,
  type ToolSession,
} from '../../sessions/contract';
import { claudeCodeManifest, DEFAULT_PROFILES } from '../manifest';
import { NO_PROCESS_TEXT, PERMISSION_TOOLS } from './permission-route';
import { claudeCodeMainPart } from './start';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// A registry that records: `register` adds the harness and returns a handle
// whose `dispose` removes it, counts and logs `registration` to `stops`;
// `refresh` counts.
function recordingRegistry(stops: string[]) {
  const harnesses: AgentHarness[] = [];
  const counts = { disposes: 0, refreshes: 0 };
  const registry: AgentHarnessRegistry = {
    register(harness) {
      harnesses.push(harness);
      return {
        refresh: () => {
          counts.refreshes += 1;
        },
        dispose: () => {
          counts.disposes += 1;
          stops.push('registration');
          harnesses.splice(harnesses.indexOf(harness), 1);
        },
      };
    },
    list: () => [...harnesses],
    get: (id) => harnesses.find((harness) => harness.id === id) ?? null,
  };
  return { registry, harnesses, counts };
}

// A sessions provider whose `contributeTools` records each contribution and
// returns a handle, tracked on the consumer as the real one is, whose dispose
// counts, logs `tools` to `stops` and ends every tool session the
// contribution built.
function recordingSessions(stops: string[]) {
  const contributed: {
    tools: ToolDefinition[];
    start: (session: AgentSession) => ToolSession;
    options: ContributeToolsOptions | undefined;
  }[] = [];
  const built: ToolSession[] = [];
  const counts = { toolDisposes: 0, toolEnds: 0 };
  const dependency = fakeDependency(
    sessionsMainKey,
    (consumer) =>
      ({
        contributeTools(
          tools: ToolDefinition[],
          start: (session: AgentSession) => ToolSession,
          options?: ContributeToolsOptions,
        ) {
          contributed.push({
            tools,
            start: (session) => {
              const toolSession = start(session);
              built.push(toolSession);
              return toolSession;
            },
            options,
          });
          return consumer.track({
            dispose: () => {
              counts.toolDisposes += 1;
              stops.push('tools');
              for (const toolSession of built) {
                counts.toolEnds += 1;
                toolSession.end();
              }
            },
          });
        },
      }) as unknown as SessionsMainExports,
  );
  return { dependency, contributed, toolCounts: counts };
}

function started(
  overrides: {
    settings?: typeof claudeCodeManifest.settings;
    agentHomeDir?: string;
    agentEnvironment?: Readonly<Record<string, string>>;
  } = {},
) {
  const stops: string[] = [];
  const registry = recordingRegistry(stops);
  const sessions = recordingSessions(stops);
  const harness = startMainPart(claudeCodeMainPart, {
    settings: overrides.settings,
    dependencies: [sessions.dependency],
    services: {
      agentHarnesses: registry.registry,
      ...(overrides.agentHomeDir === undefined
        ? {}
        : { agentHomeDir: overrides.agentHomeDir }),
      ...(overrides.agentEnvironment === undefined
        ? {}
        : { agentEnvironment: overrides.agentEnvironment }),
    },
  });
  return {
    harness,
    stops,
    ...registry,
    contributed: sessions.contributed,
    toolCounts: sessions.toolCounts,
  };
}

describe('claudeCodeMainPart', () => {
  it('start_RegistersTheClaudeHarness', () => {
    const { harnesses } = started();

    expect(harnesses.map((harness) => harness.id)).toEqual(['claude']);
  });

  // Chat must detach the harness's processes before the permission tools
  // cancel their waiting calls.
  it('stop_DisposesTheRegistrationBeforeThePermissionTools', async () => {
    const { harness, harnesses, counts, stops } = started();

    await harness.stop();

    expect(harnesses).toEqual([]);
    expect(counts.disposes).toBe(1);
    expect(stops).toEqual(['registration', 'tools']);
  });

  // Breaks if a run started while the app is closed waits on, or allows, a
  // permission prompt instead of having it denied.
  it('start_PermissionTools_AnswerOfflineWithADeny', () => {
    const { contributed } = started();

    expect(contributed[0].options?.offline).toEqual({
      permission_prompt: {
        result: textResult(
          '{"behavior":"deny","message":"The app is closed: this run\'s permission mode does not allow this tool, so it was denied."}',
        ),
        replay: false,
      },
    });
  });

  it('start_ContributesPermissionTools_StopDisposesThem', async () => {
    const { harness, contributed, toolCounts } = started();
    expect(contributed.map(({ tools }) => tools)).toEqual([PERMISSION_TOOLS]);
    // No process routes row-1, so the built tool session answers the call at
    // once with the no-process error.
    const reply = await contributed[0]
      .start({
        id: 'row-1',
        info: {
          sessionId: 's-1',
          projectDir: '/p',
          harness: 'claude',
          rowId: null,
        },
      })
      .call(
        'permission_prompt',
        { tool_name: 'Bash', input: {} },
        { toolUseId: null, signal: new AbortController().signal },
      );
    expect(reply).toEqual(errorResult(NO_PROCESS_TEXT));

    await harness.stop();

    expect(toolCounts).toEqual({ toolDisposes: 1, toolEnds: 1 });
  });

  it('accountStatus_CommandSetting_SpawnsItInTheAgentHomeWithTheAgentEnvironment_EmptyLooksClaudeUp', async () => {
    const { harness, harnesses } = started({
      settings: { command: '~/bin/claude', profiles: DEFAULT_PROFILES },
      agentHomeDir: '/Users/u',
      agentEnvironment: { PATH: '/bin', WIGLEY_AI_GUI_ENDPOINT_DIR: '/e' },
    });
    const [registered] = harnesses;
    harness.processes.scriptProgram('claude', {
      command: '/found/claude',
      args: ['--found'],
    });

    void registered.accountStatus(null);
    await settle();
    harness.pushSettings({ command: '', profiles: DEFAULT_PROFILES });
    void registered.accountStatus(null);
    await settle();

    expect(harness.processes.spawns[0]).toMatchObject({
      command: '/Users/u/bin/claude',
      args: ['auth', 'status', '--json'],
      cwd: '/Users/u',
      env: { PATH: '/bin', WIGLEY_AI_GUI_ENDPOINT_DIR: '/e' },
    });
    expect(harness.processes.spawns[1]).toMatchObject({
      command: '/found/claude',
      args: ['--found', 'auth', 'status', '--json'],
    });
  });

  it('settingsChanged_Profiles_RefreshesTheRegistration', () => {
    const { harness, harnesses, counts } = started();
    const [registered] = harnesses;
    expect(registered.info().profiles).toEqual(DEFAULT_PROFILES);
    const lab = [{ name: 'lab', configDir: '~/.lab' }];

    harness.pushSettings({ command: '', profiles: lab });

    expect(counts.refreshes).toBe(1);
    expect(registered.info().profiles).toEqual(lab);
  });
});
