import { describe, expect, it } from 'vitest';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type ScopedAgentSpec,
  type ScopedAgentsMainExports,
  scopedAgentsMainKey,
} from '../../scoped-agents/contract';
import type { DemoStepBrief } from '../contract';
import { demoMainPart } from './start';

const BRIEF: DemoStepBrief = {
  id: 'p.one',
  plugin: 'p',
  title: 'The first feature',
  caption: 'Shows the first feature.',
  files: ['src/plugins/p/page/view.ts'],
  beats: ['working'],
};

// The demo main part over fake `chat` and `scoped-agents` exports: `specs`
// holds each `addScopedAgent` spec, `closedFolders` each `closeSessionsIn`
// folder.
function startDemo(cloneDir: string | null = null) {
  const specs: ScopedAgentSpec[] = [];
  const closedFolders: string[] = [];
  const chat = fakeDependency(
    chatMainKey,
    () =>
      ({
        closeSessionsIn: async (folder: string) => {
          closedFolders.push(folder);
        },
      }) as unknown as ChatMainExports,
  );
  const scopedAgents = fakeDependency(
    scopedAgentsMainKey,
    (): ScopedAgentsMainExports => ({
      addScopedAgent: (spec) => {
        specs.push(spec);
        return {
          ask: async () => 'row-1',
          sessionOf: async () => null,
          scopeOf: async () => null,
          dispose: () => undefined,
        };
      },
    }),
  );
  const harness = startMainPart(demoMainPart, {
    dependencies: [chat, scopedAgents],
    services: { cloneDir },
  });
  const spec = specs[0];
  if (spec === undefined) {
    throw new Error('demo registered no step agent');
  }
  return { harness, spec, closedFolders };
}

describe('demoMainPart', () => {
  it('describeStep_ThenInstructions_HoldsTheBrief', async () => {
    const { harness, spec } = startDemo();

    harness.invoke('describeStep', BRIEF);

    expect(await spec.instructions('p.one')).toContain('The first feature');
    expect(await spec.title('p.one')).toBe('Demo · The first feature');
  });

  it.each([
    { cloneDir: '/clone', expected: '/clone' },
    { cloneDir: null, expected: '/home' },
  ])(
    'folder_ByCloneDir_FallsBackToHome ($cloneDir)',
    ({ cloneDir, expected }) => {
      const { spec } = startDemo(cloneDir);

      expect(spec.folder('p.one')).toBe(expected);
    },
  );

  it('dispose_LiveRun_StopsTheRun', async () => {
    const { harness, closedFolders } = startDemo();
    await harness.invoke('start');

    await harness.stop();

    expect(closedFolders).toEqual(['/data/demo/scratch']);
    expect(harness.logs.map(({ message }) => message)).toContain(
      'run stopped',
    );
  });
});
