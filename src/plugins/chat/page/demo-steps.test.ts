import { describe, expect, it } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { ViewScope } from '../../../contracts/keymap';
import type { PageServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { registerDemoSteps } from './demo-steps';

// Chat's page steps over fakes: `pickModel` waits until `openPicker` runs and
// opens the model picker then; the start prompt shows once `setScope` sets
// `chat.picker`; `commands` holds each command run.
function chatSteps() {
  const registry = createDemoStepRegistry<DemoStep>();
  const commands: string[] = [];
  const scopeListeners: ((scope: ViewScope) => void)[] = [];
  let scope = 'sessions.idle' as ViewScope;
  let isPickerOpen = false;
  let openPicker: () => void = () => undefined;
  registerDemoSteps(
    { demoSteps: registry, log: () => undefined } as unknown as PageServices,
    {
      activate: () => undefined,
      fillComposer: () => undefined,
      setHeadless: async () => undefined,
      typeInto: () => undefined,
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
      pickModel: () =>
        new Promise<void>((resolve) => {
          openPicker = () => {
            isPickerOpen = true;
            resolve();
          };
        }),
      cancelPicker: () => {
        isPickerOpen = false;
      },
      isPickerOpen: () => isPickerOpen,
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
    openPicker: () => openPicker(),
    isPickerOpen: () => isPickerOpen,
    setScope(next: ViewScope) {
      scope = next;
      for (const listener of scopeListeners.slice()) {
        listener(next);
      }
    },
  };
}

describe('chat demo steps', () => {
  // Breaks on a stage left while its picker was still opening, which leaves
  // the picker or the start prompt over the next step.
  it.each([
    {
      name: 'model picker',
      stepId: 'chat.controls',
      beat: 1,
      opens: (test: ReturnType<typeof chatSteps>) => test.openPicker(),
      isClosed: (test: ReturnType<typeof chatSteps>) => !test.isPickerOpen(),
    },
    {
      name: 'start prompt',
      stepId: 'chat.startPrompt',
      beat: 0,
      opens: (test: ReturnType<typeof chatSteps>) =>
        test.setScope('chat.picker' as ViewScope),
      isClosed: (test: ReturnType<typeof chatSteps>) =>
        test.commands.includes('chat.pickerCancel'),
    },
  ])(
    'dispose_WhileOpening_ClosesWhatOpensAfter ($name)',
    async ({ stepId, beat, opens, isClosed }) => {
      const test = chatSteps();
      const stage = await test.enter(stepId);
      const shown = stage.beats[beat].show();

      stage.dispose();
      opens(test);
      await shown;

      expect(isClosed(test)).toBe(true);
    },
  );
});
