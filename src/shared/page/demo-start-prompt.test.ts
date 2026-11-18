import { describe, expect, it } from 'vitest';
import type { ViewScope } from '../../contracts/keymap';
import {
  DEMO_PROMPT_WAIT_MS,
  type DemoStartPrompt,
  demoStartPrompt,
} from './demo-start-prompt';

const PROMPT = 'chat.picker';
const IDLE = 'sessions.idle';

// A prompt over a scope the test sets, timers it runs by hand, and commands it
// records; `chat.pickerCancel` moves the scope off the prompt, as chat's does.
function setUp(initialScope: ViewScope = IDLE) {
  let scope = initialScope;
  const listeners = new Set<(value: ViewScope | undefined) => void>();
  const setScope = (value: ViewScope) => {
    scope = value;
    for (const listener of [...listeners]) {
      listener(value);
    }
  };
  const due = new Map<number, { run: () => void; ms: number }>();
  let nextHandle = 1;
  const ran: string[] = [];
  const logged: string[] = [];
  const prompt: DemoStartPrompt = demoStartPrompt({
    runCommand(id) {
      ran.push(id);
      if (id === 'chat.pickerCancel') {
        setScope(IDLE);
      }
    },
    scope: {
      get: () => scope,
      on(listener) {
        listeners.add(listener);
        return { dispose: () => void listeners.delete(listener) };
      },
    },
    timers: {
      set(run, ms) {
        const handle = nextHandle++;
        due.set(handle, { run, ms });
        return handle;
      },
      clear: (handle) => void due.delete(handle),
    },
    log: (line) => logged.push(line),
  });
  return {
    prompt,
    ran,
    logged,
    setScope,
    // Runs every timer due by `ms`.
    elapse(ms: number) {
      for (const [handle, timer] of [...due]) {
        if (timer.ms <= ms) {
          due.delete(handle);
          timer.run();
        }
      }
    },
    // Whether the prompt still listens to the scope or holds a timer.
    holdsAnything: () => listeners.size > 0 || due.size > 0,
  };
}

describe('demoStartPrompt', () => {
  it.each([
    {
      name: 'the prompt shows',
      before: IDLE,
      show: true,
      result: true,
      logged: [],
    },
    {
      name: 'the scope already reads the prompt',
      before: PROMPT,
      show: false,
      result: true,
      logged: [],
    },
    {
      name: 'the prompt never shows',
      before: IDLE,
      show: false,
      result: false,
      logged: ['demo start prompt not shown'],
    },
  ])('open resolves $result when $name', async (row) => {
    const test = setUp(row.before);

    const opening = test.prompt.open();
    if (row.show) {
      test.setScope(PROMPT);
    } else {
      test.elapse(DEMO_PROMPT_WAIT_MS);
    }

    expect(await opening).toBe(row.result);
    expect(test.prompt.isOpen()).toBe(row.result);
    expect(test.ran).toEqual(['chat.newSession']);
    expect(test.logged).toEqual(row.logged);
    test.setScope(IDLE);
    expect(test.prompt.isOpen()).toBe(false);
    expect(test.holdsAnything()).toBe(false);
  });

  it('open runs newSession again once the prompt closed', async () => {
    const test = setUp();
    const first = test.prompt.open();
    test.setScope(PROMPT);
    await first;

    expect(await test.prompt.open()).toBe(true);
    expect(test.ran).toEqual(['chat.newSession']);

    test.setScope(IDLE);
    const again = test.prompt.open();
    test.setScope(PROMPT);

    expect(await again).toBe(true);
    expect(test.ran).toEqual(['chat.newSession', 'chat.newSession']);
    test.setScope(IDLE);
    expect(test.holdsAnything()).toBe(false);
  });

  it('cancel runs pickerCancel only while the prompt shows', async () => {
    const test = setUp();
    test.prompt.cancel();
    const opening = test.prompt.open();
    test.setScope(PROMPT);
    await opening;

    test.prompt.cancel();
    test.prompt.cancel();

    expect(test.ran).toEqual(['chat.newSession', 'chat.pickerCancel']);
    expect(test.prompt.isOpen()).toBe(false);
    expect(test.holdsAnything()).toBe(false);
  });

  it('a dispose during the wait cancels a prompt that shows later', async () => {
    const test = setUp();
    const opening = test.prompt.open();

    test.prompt.dispose();
    expect(test.ran).toEqual(['chat.newSession']);
    test.setScope(PROMPT);

    expect(test.ran).toEqual(['chat.newSession', 'chat.pickerCancel']);
    expect(await opening).toBe(false);
    expect(test.prompt.isOpen()).toBe(false);
    expect(test.holdsAnything()).toBe(false);
  });

  // Breaks: the stage's prompt left covering the next step once the keys moved
  // off `chat.picker`.
  it.each([
    {
      name: 'cancel after the scope moved to resume',
      moveTo: 'chat.resume',
      leave: 'cancel',
    },
    {
      name: 'dispose after the keys moved to the demo panel',
      moveTo: 'demo.panel',
      leave: 'dispose',
    },
  ] as const)('$name still runs pickerCancel', async ({ moveTo, leave }) => {
    const test = setUp();
    const opening = test.prompt.open();
    test.setScope(PROMPT);
    await opening;
    test.setScope(moveTo);

    test.prompt[leave]();

    expect(test.ran).toEqual(['chat.newSession', 'chat.pickerCancel']);
    expect(test.holdsAnything()).toBe(false);
  });
});
