import { describe, expect, it } from 'vitest';
import type {
  SessionFlow,
  WorkflowMainExports,
  WorkflowSignal,
} from '../../workflow/contract';
import { LARGE_WORKFLOW_ID, largeSignal } from '../contract';
import { largePlanReporter } from './plan-report';

const PLAN_DIR = '/w/p/plan-a';

describe('largePlanReporter', () => {
  it.each([
    {
      name: 'a Large flow',
      workflow: LARGE_WORKFLOW_ID,
      loadsLate: false,
      resolves: true,
    },
    {
      name: 'a Large flow loaded only once ready settles',
      workflow: LARGE_WORKFLOW_ID,
      loadsLate: true,
      resolves: true,
    },
    {
      name: 'another workflow',
      workflow: 'workflow-small',
      loadsLate: false,
      resolves: false,
    },
  ])(
    'in $name resolves $resolves',
    async ({ workflow, loadsLate, resolves }) => {
      const ready = Promise.withResolvers<void>();
      let loaded = !loadsLate;
      const signalled: [string, WorkflowSignal, string][] = [];
      const engine: Pick<WorkflowMainExports, 'ready' | 'flowOf' | 'signal'> = {
        ready: ready.promise,
        flowOf: (sessionId) =>
          loaded && sessionId === 's1' ? ({ workflow } as SessionFlow) : null,
        signal: (sessionId, signal, origin) => {
          signalled.push([sessionId, signal, origin]);
        },
      };

      const applying = largePlanReporter(engine)('s1', PLAN_DIR);
      loaded = true;
      ready.resolve();
      const applied = await applying;

      expect(applied).toBe(resolves);
      expect(signalled).toEqual(
        resolves
          ? [
              [
                's1',
                largeSignal({ type: 'planReported', planDir: PLAN_DIR }),
                'live',
              ],
            ]
          : [],
      );
    },
  );
});
