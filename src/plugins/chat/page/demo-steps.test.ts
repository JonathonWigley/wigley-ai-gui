import { describe, expect, it } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { ViewScope } from '../../../contracts/keymap';
import type { PageServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { registerDemoSteps } from './demo-steps';

// Chat's page steps over fakes: the start prompt shows once `setScope` sets
// `chat.picker`; `commands` holds each command run.
function chatSteps() {
  const registry = createDemoStepRegistry<DemoStep>();
  const commands: string[] = [];
  const scopeListeners: ((scope: ViewScope) => void)[] = [];
  let scope = 'sessions.idle' as ViewScope;
  registerDemoSteps(
    { demoSteps: registry, log: () => undefined } as unknown as PageServices,
    {
      activate: () => undefined,
      setHeadless: async () => undefined,
      startPrompt: {
        runCommand: (id) => commands.push(id),
        scope: {
          get: () => scope,
          on(listener) {
            scopeListeners.push(listener);
            return {
              dispose() {
                scopeListeners.splice(scopeListeners.indexOf(listener), 1);
              },
            };
          },
        },
        timers: { set: () => 0, clear: () => undefined },
        log: () => undefined,
      },
    },
  );
  const enter = (id: string) => {
    const step = registry.list().find((each) => each.id === id);
    if (step === undefined) {
      throw new Error(`no step ${id}`);
    }
    return step.enter({ scratchDir: '/scratch', sessions: { session: 's1' } });
  };
  return {
    enter,
    commands,
    setScope(next: ViewScope) {
      scope = next;
      for (const listener of scopeListeners.slice()) {
        listener(next);
      }
    },
  };
}

describe('chat demo steps', () => {
  // Breaks on a stage left while its start prompt was still opening, which
  // leaves the prompt over the next step.
  it('dispose_WhileOpening_ClosesTheStartPromptThatOpensAfter', async () => {
    const test = chatSteps();
    const stage = await test.enter('chat.startPrompt');
    const shown = stage.beats[0].show();

    stage.dispose();
    test.setScope('chat.picker' as ViewScope);
    await shown;

    expect(test.commands).toContain('chat.pickerCancel');
  });
});
