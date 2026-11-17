import { describe, expect, it } from 'vitest';
import type { AgentHarness, AgentHarnessRegistry } from '../../../contracts/agent';
import { startMainPart } from '../../../shared/plugin-part-harness.test-support';
import { claudeCodeMainPart, claudeCommand } from './start';

// A registry that records: `register` adds the harness and returns a handle
// whose `dispose` removes it and counts; `refresh` counts.
function recordingRegistry() {
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
          harnesses.splice(harnesses.indexOf(harness), 1);
        },
      };
    },
    list: () => [...harnesses],
    get: (id) => harnesses.find((harness) => harness.id === id) ?? null,
  };
  return { registry, harnesses, counts };
}

function started(
  overrides: {
    settings?: { command: string };
    agentHomeDir?: string;
    agentEnvironment?: Readonly<Record<string, string>>;
  } = {},
) {
  const registry = recordingRegistry();
  const harness = startMainPart(claudeCodeMainPart, {
    settings: overrides.settings,
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
  return { harness, ...registry };
}

describe('claudeCodeMainPart', () => {
  it.each([
    { setting: '', expected: '~/.local/bin/claude' },
    { setting: '/opt/claude', expected: '/opt/claude' },
  ])(
    'claudeCommand_EmptyOrSet_PicksThePlatformProgramOrTheSetting ($setting)',
    ({ setting, expected }) => {
      expect(claudeCommand(setting, { claude: '~/.local/bin/claude' })).toBe(
        expected,
      );
    },
  );

  it('start_RegistersTheClaudeHarness', () => {
    const { harnesses } = started();

    expect(harnesses.map((harness) => harness.id)).toEqual(['claude']);
  });

  it('stop_DisposesTheRegistration', async () => {
    const { harness, harnesses, counts } = started();

    await harness.stop();

    expect(harnesses).toEqual([]);
    expect(counts.disposes).toBe(1);
  });

  it('accountStatus_CommandSetting_SpawnsItInTheAgentHomeWithTheAgentEnvironment', () => {
    const { harness, harnesses } = started({
      settings: { command: '~/bin/claude' },
      agentHomeDir: '/Users/u',
      agentEnvironment: { PATH: '/bin', WIGLEY_AI_GUI_ENDPOINT_DIR: '/e' },
    });
    const [registered] = harnesses;

    void registered.accountStatus(null);
    harness.pushSettings({ command: '' });
    void registered.accountStatus(null);

    expect(harness.processes.spawns[0]).toMatchObject({
      command: '/Users/u/bin/claude',
      args: ['auth', 'status', '--json'],
      cwd: '/Users/u',
      env: { PATH: '/bin', WIGLEY_AI_GUI_ENDPOINT_DIR: '/e' },
    });
    expect(harness.processes.spawns[1].command).toBe(
      '/Users/u/.local/bin/claude',
    );
  });
});
