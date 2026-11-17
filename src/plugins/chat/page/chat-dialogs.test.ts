import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asFake, findAll, installFakeDom } from '../../../shared/page/test-dom';
import type { ChatLayout } from '../layouts/layout';
import defaultLayout from '../layouts/default/layout.js';
import {
  createCloseConfirm,
  createReasonBox,
  type DialogDeps,
} from './chat-dialogs';
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

// A layout whose frame marks its panel and puts its title in an `h2`.
const userLayout: ChatLayout = {
  dialogFrame(parent, input, kit) {
    const panel = kit.el(parent, 'div', 'user-frame');
    kit.el(panel, 'h2', 'user-title', input.title);
    const body = kit.el(panel, 'div', 'user-body');
    return { element: panel, body, actions: null };
  },
};

describe('createReasonBox', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reasonBox_OpenAfterALayoutChange_DrawsTheBodyInTheNewFrame', () => {
    const log = () => undefined;
    const noEvent = () => undefined;
    const layouts = createChatLayouts(log);
    let scrim: HTMLElement | null = null;
    const reasonBox = createReasonBox({
      layouts,
      markdown: {},
      keys: { anchor: () => ({ dispose: noEvent }), keysFor: () => null },
      commands: { exists: () => true, argShape: () => undefined, run: noEvent },
      platform: 'macos',
      log,
      overlay: {
        contribute: (element: HTMLElement) => {
          scrim = element;
          return { dispose: noEvent };
        },
      },
      run: noEvent,
      pushScope: () => ({
        pop: noEvent,
        dispose: noEvent,
        onBaseChanged: () => ({ dispose: noEvent }),
      }),
      editor: {
        create: () => ({
          text: () => '',
          setText: noEvent,
          focus: noEvent,
          blur: noEvent,
        }),
      },
    } as unknown as Parameters<typeof createReasonBox>[0]);
    layouts.set({
      layouts: new Map([
        ['default', defaultLayout],
        ['mine', userLayout],
      ]),
      user: 'mine',
    });

    reasonBox.open('Bash', noEvent);

    const root = asFake(scrim!);
    const [panel] = findAll(root, 'user-frame');
    const [body] = findAll(panel, 'user-body');
    const [part] = findAll(body, 'chat-dialog-part');
    expect(panel.dataset.layout).toBe('mine');
    expect(part).toBeDefined();
    expect(findAll(panel, 'user-title')[0].textContent).toBe('Deny Bash?');
  });
});

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
