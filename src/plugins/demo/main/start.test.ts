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
import type { SelfTestScript } from '../../../contracts/plugin';
import type { DemoRunReport, DemoStepBrief } from '../contract';
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
// folder. `scripts` holds each script handed to the self-test.
function startDemo(cloneDir: string | null = null) {
  const scripts: SelfTestScript[] = [];
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
    services: {
      cloneDir,
      selfTest: { run: (script) => void scripts.push(script) },
    },
  });
  const spec = specs[0];
  const script = scripts[0];
  if (spec === undefined || script === undefined) {
    throw new Error('demo registered no step agent or self-test script');
  }
  return { harness, spec, script, closedFolders };
}

const REPORT: DemoRunReport = { missing: ['c'], failed: [] };

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

  it('report_AfterOpen_ResolvesTheResult', async () => {
    const { harness, script } = startDemo();

    const { result } = script.open(2);
    harness.invoke('report', REPORT);

    expect({ sent: harness.sent, result: await result }).toEqual({
      sent: [{ message: 'selfTestOpened', data: 2 }],
      result: REPORT,
    });
  });

  it('report_NoWaiter_IsDropped', async () => {
    const { harness, script } = startDemo();
    const later: DemoRunReport = { missing: [], failed: ['p.one'] };

    harness.invoke('report', REPORT);
    const { result } = script.open(1);
    harness.invoke('report', later);

    expect(await result).toEqual(later);
  });

  it('dispose_LiveRun_StopsTheRun', async () => {
    const { harness, closedFolders } = startDemo();
    await harness.invoke('start');

    await harness.stop();

    expect(closedFolders).toEqual(['/data/demo/scratch']);
    expect(harness.logs.map(({ message }) => message)).toContain('run stopped');
  });
});
