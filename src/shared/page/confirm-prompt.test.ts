import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../contracts/commands';
import type { ViewScope } from '../../contracts/keymap';
import { type ConfirmPromptDeps, createConfirmPrompt } from './confirm-prompt';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from './test-dom';
import type { DrawDialogFrame } from './ui/dialog';

const DISMISSED = 'cancel prompt dismissed: the view moved on';

// One frame the fake `drawFrame` drew: a panel holding a body and an actions
// row.
interface DrawnFrame {
  panel: HTMLElement;
  actions: HTMLElement;
}

// A `drawFrame` that appends a panel holding a body and an actions row to its
// parent, and records each frame it drew in `frames`.
function fakeFrames(): { drawFrame: DrawDialogFrame; frames: DrawnFrame[] } {
  const frames: DrawnFrame[] = [];
  const drawFrame: DrawDialogFrame = (parent) => {
    const panel = document.createElement('section');
    const body = document.createElement('div');
    const actions = document.createElement('div');
    panel.append(body, actions);
    parent.append(panel);
    frames.push({ panel, actions });
    return { element: panel, body, actions };
  };
  return { drawFrame, frames };
}

// A prompt over a caller whose state is `asked` and `sending`, as the test
// sets them; `dismiss` drops the prompt unless the form is sending, as the
// forms and primer reducers do. `calls` records the scope work in order, and
// `anchors` each anchor named, `disposed` each anchor's dispose; `frames`
// holds each frame the fake `drawFrame` drew. Without `hasOnBaseChanged` the
// deps leave out `onBaseChanged`; `drawBody` is handed on when given.
function promptSetup(
  hasOnBaseChanged = true,
  drawBody?: ConfirmPromptDeps['drawBody'],
) {
  const { drawFrame, frames } = fakeFrames();
  const caller = { asked: false, sending: false };
  const calls: string[] = [];
  const baseListeners: ((base: ViewScope) => void)[] = [];
  const keys: Record<CommandId, string> = {
    'test.keep': 'n',
    'test.confirm': 'y',
  };
  const anchors: [CommandId, { scope?: ViewScope } | undefined][] = [];
  const disposed: CommandId[] = [];
  const run = vi.fn();
  const log = vi.fn();
  const dismiss = vi.fn(() => {
    if (!caller.sending) {
      caller.asked = false;
    }
  });
  const prompt = createConfirmPrompt({
    title: 'Cancel this form?',
    body: 'The agent is told.',
    keep: { label: 'Keep', command: 'test.keep' },
    confirm: { label: 'Cancel form', command: 'test.confirm' },
    scope: 'test.confirm',
    keys: {
      anchor: (element, command, options) => {
        anchors.push([command, options]);
        element.textContent = keys[command];
        return { dispose: () => disposed.push(command) };
      },
    },
    run,
    pushScope: () => {
      calls.push('push');
      return {
        pop: () => calls.push('pop'),
        dispose: () => undefined,
        onBaseChanged: (listener) => {
          baseListeners.push(listener);
          return { dispose: () => undefined };
        },
      };
    },
    isAsked: () => caller.asked,
    isSending: () => caller.sending,
    dismiss,
    ...(hasOnBaseChanged
      ? { onBaseChanged: () => calls.push('base changed') }
      : {}),
    log,
    ...(drawBody === undefined ? {} : { drawBody }),
    drawFrame,
  });
  const scrim = asFake(prompt.element);
  return {
    caller,
    calls,
    anchors,
    disposed,
    frames,
    prompt,
    scrim,
    run,
    log,
    dismiss,
    // Another view sets the base scope under every scope pushed so far.
    changeBase: () => baseListeners.forEach((listener) => listener('other')),
    render: () =>
      prompt.settleOwedDismiss() &&
      prompt.setBaseScope(() => calls.push('set base')),
  };
}

function buttons(scrim: FakeElement): FakeElement[] {
  return findAll(scrim, 'ui-button');
}

describe('confirm prompt', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws the keep choice first and runs each choice command on click', () => {
    const { scrim, run } = promptSetup();
    const [keep, confirm] = buttons(scrim);

    confirm.click();
    keep.click();
    expect(run.mock.calls).toEqual([['test.confirm'], ['test.keep']]);
  });

  it('names an anchor for each choice in the prompt scope', () => {
    const { anchors } = promptSetup();

    expect(anchors).toEqual([
      ['test.keep', { scope: 'test.confirm' }],
      ['test.confirm', { scope: 'test.confirm' }],
    ]);
  });

  it('stays hidden and pushes nothing while not asked', () => {
    const { calls, scrim, render } = promptSetup();

    render();

    expect(calls).toEqual(['set base']);
    expect(scrim.hidden).toBe(true);
  });

  it('shows and pushes its scope after the base is set once asked', () => {
    const { caller, calls, scrim, render } = promptSetup();
    caller.asked = true;

    render();
    render();

    expect(calls).toEqual(['set base', 'push', 'set base']);
    expect(scrim.hidden).toBe(false);
  });

  it('hides and pops its scope before the base is set once not asked', () => {
    const { caller, calls, scrim, render } = promptSetup();
    caller.asked = true;
    render();
    caller.asked = false;

    render();

    expect(calls).toEqual(['set base', 'push', 'pop', 'set base']);
    expect(scrim.hidden).toBe(true);
  });

  it('is dismissed and logs when another view sets the base scope', () => {
    const { caller, calls, dismiss, log, render, changeBase } = promptSetup();
    caller.asked = true;
    render();

    changeBase();

    expect(calls.at(-1)).toBe('base changed');
    expect(dismiss).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(DISMISSED);
  });

  it('stays silent when the base scope changes after a choice closed the prompt', () => {
    const { caller, dismiss, log, render, changeBase } = promptSetup();
    caller.asked = true;
    render();
    caller.asked = false;

    changeBase();

    expect(dismiss).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('dismisses on a base change with no onBaseChanged given', () => {
    const { caller, dismiss, render, changeBase } = promptSetup(false);
    caller.asked = true;
    render();

    expect(() => changeBase()).not.toThrow();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('ignores a base change heard by a scope it already popped', () => {
    const { caller, dismiss, render, changeBase } = promptSetup();
    caller.asked = true;
    render();
    caller.asked = false;
    render();

    changeBase();

    expect(dismiss).not.toHaveBeenCalled();
  });

  it('owes a dismiss while sending and pays it once the send fails', () => {
    const { caller, dismiss, log, prompt, changeBase, render } = promptSetup();
    caller.asked = true;
    render();
    caller.sending = true;
    changeBase();
    expect(caller.asked).toBe(true);
    expect(log).not.toHaveBeenCalled();
    expect(prompt.settleOwedDismiss()).toBe(true);

    caller.sending = false;

    expect(prompt.settleOwedDismiss()).toBe(false);
    expect(dismiss).toHaveBeenCalledTimes(2);
    expect(caller.asked).toBe(false);
    expect(log).toHaveBeenCalledWith(DISMISSED);
    expect(prompt.settleOwedDismiss()).toBe(true);
  });

  it('drops an owed dismiss when the sent form closes the prompt', () => {
    const { caller, dismiss, log, prompt, changeBase, render } = promptSetup();
    caller.asked = true;
    render();
    caller.sending = true;
    changeBase();

    caller.asked = false;
    caller.sending = false;

    expect(prompt.settleOwedDismiss()).toBe(true);
    caller.asked = true;
    expect(prompt.settleOwedDismiss()).toBe(true);
    expect(dismiss).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    {
      row: 'left out',
      rollsBack: false,
      ownButtons: ['Keepn'],
      actionButtons: ['Cancel formy'],
    },
    {
      row: 'requested then rolled back',
      rollsBack: true,
      ownButtons: [],
      actionButtons: ['Keepn', 'Cancel formy'],
    },
  ])(
    'drawBody_ButtonNotInTheDialog_AppendedToActions: $row',
    ({ rollsBack, ownButtons, actionButtons }) => {
      const own = new FakeElement('section');
      const { frames, anchors } = promptSetup(true, (parent, parts) => {
        own.append(parts.body);
        parent.append(asHtml(own));
        parts.keepButton(asHtml(own));
        if (rollsBack) {
          own.remove();
        }
      });

      const actions = asFake(frames[0].actions);
      expect(own.childNodes[0].textContent).toBe('The agent is told.');
      expect(buttons(own).map((button) => button.textContent)).toEqual(
        ownButtons,
      );
      expect(buttons(actions).map((button) => button.textContent)).toEqual(
        actionButtons,
      );
      expect(anchors.map(([command]) => command)).toEqual([
        'test.keep',
        'test.confirm',
      ]);
    },
  );

  it('redraw_DisposesTheEarlierButtonsAnchors', () => {
    const { prompt, scrim, anchors, disposed } = promptSetup();

    prompt.redraw();

    expect(disposed).toEqual(['test.keep', 'test.confirm']);
    expect(anchors.map(([command]) => command)).toEqual([
      'test.keep',
      'test.confirm',
      'test.keep',
      'test.confirm',
    ]);
    expect(buttons(scrim)).toHaveLength(2);
  });

  it('redraw_DrawsTheFrameAndButtonsAgain', () => {
    const { prompt, scrim, frames } = promptSetup();

    prompt.redraw();

    expect(frames).toHaveLength(2);
    expect(scrim.childNodes).toHaveLength(1);
    expect(scrim.childNodes[0]).toBe(asFake(frames[1].panel));
    expect(
      buttons(asFake(frames[1].actions)).map((button) => button.textContent),
    ).toEqual(['Keepn', 'Cancel formy']);
  });
});
