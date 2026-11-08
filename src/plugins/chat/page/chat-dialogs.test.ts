import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import { createCloseConfirm, type DialogDeps } from './chat-dialogs';
import { createChatLayouts } from './chat-layouts';

// The end-session confirm over fake page services, whose pushed scope counts
// its pops and runs its base-change listener on `baseChanged`, and whose log
// records each line.
function confirmSetup() {
  const logs: string[] = [];
  let pops = 0;
  let onBaseChanged: (base: string) => void = () => undefined;
  const log = (line: string) => logs.push(line);
  const noEvent = () => undefined;
  const confirm = createCloseConfirm({
    layouts: createChatLayouts(log),
    markdown: {},
    keys: { anchor: () => ({ dispose: noEvent }), keysFor: () => null },
    commands: { exists: () => true, argShape: () => undefined, run: noEvent },
    platform: 'macos',
    log,
    overlay: { contribute: () => ({ dispose: noEvent }) },
    run: noEvent,
    pushScope: () => ({
      pop: () => {
        pops += 1;
      },
      dispose: () => {
        pops += 1;
      },
      onBaseChanged: (listener: (base: string) => void) => {
        onBaseChanged = listener;
        return { dispose: noEvent };
      },
    }),
  } as unknown as DialogDeps);
  return {
    confirm,
    logs,
    pops: () => pops,
    baseChanged: () => onBaseChanged('idle'),
  };
}

describe('createCloseConfirm', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      case: 'end',
      answer: (setup: ReturnType<typeof confirmSetup>) => setup.confirm.end(),
      ended: true,
    },
    {
      case: 'keep',
      answer: (setup: ReturnType<typeof confirmSetup>) => setup.confirm.keep(),
      ended: false,
    },
    {
      case: 'base scope changed',
      answer: (setup: ReturnType<typeof confirmSetup>) => setup.baseChanged(),
      ended: false,
    },
  ])('open_EachAnswer_ResolvesItAndPopsTheScope ($case)', async (test) => {
    const setup = confirmSetup();
    const ended = setup.confirm.open('gamma');

    test.answer(setup);

    expect(await ended).toBe(test.ended);
    expect(setup.pops()).toBe(1);
  });

  it('open_WhileOpen_AnswersTheFirstFalseAndAsksAgain', async () => {
    const setup = confirmSetup();
    const first = setup.confirm.open('gamma');

    const second = setup.confirm.open('delta');
    setup.confirm.end();

    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(setup.pops()).toBe(2);
  });

  it('endAndKeep_WhileHidden_DoNothing', () => {
    const setup = confirmSetup();

    setup.confirm.end();
    setup.confirm.keep();

    expect(setup.pops()).toBe(0);
    expect(setup.logs.filter((line) => line.startsWith('kept'))).toEqual([]);
  });
});
