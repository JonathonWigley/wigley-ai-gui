import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type { PageServices } from '../../../contracts/plugin';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import {
  FocusFakeElement,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import { registerDemoSteps } from './demo-steps';
import type { StashTarget } from './note-dialog';

// The Stash step over fake deps: the session `s1` shows once `shown` is set to
// it, timers run by `tick`, and a note dialog whose `open` focuses a box, as
// the real one's does.
async function enterStashStep(hasRow: boolean) {
  const doc = installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  const registry = createDemoStepRegistry<DemoStep>();
  const due: (() => void)[] = [];
  const activated: string[] = [];
  const opened: StashTarget[] = [];
  const logged: string[] = [];
  let shown: string | null = 'other';
  let isDialogOpen = false;
  registerDemoSteps({ demoSteps: registry } as unknown as PageServices, {
    activate: (sessionId) => activated.push(sessionId),
    shownSessionId: () => shown,
    hasRow: () => hasRow,
    nameOf: (sessionId) => `Session ${sessionId}`,
    noteDialog: {
      open(target) {
        opened.push(target);
        isDialogOpen = true;
        new FocusFakeElement('textarea').focus();
      },
      cancel: () => {
        isDialogOpen = false;
      },
      isOpen: () => isDialogOpen,
    },
    runCommand: () => undefined,
    scope: { get: () => 'sessions.idle', on: () => ({ dispose() {} }) },
    timers: {
      set(run) {
        due.push(run);
        return due.length;
      },
      clear: () => undefined,
    },
    log: (line) => logged.push(line),
  });
  const [step] = registry.list();
  const stage = await step.enter({
    scratchDir: '/scratch',
    sessions: { session: 's1' },
  });
  return {
    doc,
    note: stage.beats[0],
    activated,
    opened,
    logged,
    show: (sessionId: string) => {
      shown = sessionId;
    },
    // Runs the timers set so far.
    tick: () => {
      for (const run of due.splice(0)) {
        run();
      }
    },
  };
}

describe('session-stash demo steps', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Breaks on a dialog the activation's base scope change cancels, or a
  // focused note box that takes the demo keys as text.
  it('note opens the dialog once the session shows, with no box focused', async () => {
    const test = await enterStashStep(true);

    const showing = test.note.show();
    expect(test.activated).toEqual(['s1']);
    test.tick();
    expect(test.opened).toEqual([]);

    test.show('s1');
    test.tick();
    await showing;

    expect(test.opened).toEqual([{ sessionId: 's1', name: 'Session s1' }]);
    expect(test.doc.activeElement).toBe(null);
  });

  it('note on a gone session logs and opens nothing', async () => {
    const test = await enterStashStep(false);

    await test.note.show();

    expect(test.logged).toEqual(['demo stash session gone']);
    expect(test.activated).toEqual([]);
    expect(test.opened).toEqual([]);
  });
});
