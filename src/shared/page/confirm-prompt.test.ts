import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../contracts/commands';
import type { ViewScope } from '../../contracts/keymap';
import { createConfirmPrompt } from './confirm-prompt';
import { asFake, type FakeElement, findAll, installFakeDom } from './test-dom';

const DISMISSED = 'cancel prompt dismissed: the view moved on';

// A prompt over a caller whose state is `asked` and `sending`, as the test
// sets them; `dismiss` drops the prompt unless the form is sending, as the
// forms and primer reducers do. `calls` records the scope work in order.
function promptSetup() {
  const caller = { asked: false, sending: false };
  const calls: string[] = [];
  const baseListeners: ((base: ViewScope) => void)[] = [];
  let keys: Record<CommandId, string | null> = {
    'test.keep': 'n',
    'test.confirm': 'y',
  };
  const keyListeners: (() => void)[] = [];
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
      keysFor: (command) => keys[command] ?? null,
      onChanged: (listener) => {
        keyListeners.push(listener);
        return { dispose: () => undefined };
      },
    },
    run,
    platform: 'macos',
    pushScope: () => {
      calls.push('push');
      return {
        pop: () => calls.push('pop'),
        onBaseChanged: (listener) => baseListeners.push(listener),
      };
    },
    isAsked: () => caller.asked,
    isSending: () => caller.sending,
    dismiss,
    onBaseChanged: () => calls.push('base changed'),
    log,
    logSource: 'test',
  });
  const scrim = asFake(prompt.element);
  return {
    caller,
    calls,
    prompt,
    scrim,
    run,
    log,
    dismiss,
    // Another view sets the base scope under every scope pushed so far.
    changeBase: () => baseListeners.forEach((listener) => listener('other')),
    setKeys: (next: Record<CommandId, string | null>) => {
      keys = next;
      keyListeners.forEach((listener) => listener());
    },
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

    expect(keep.textContent).toBe('Keepn');
    expect(confirm.textContent).toBe('Cancel formy');
    confirm.click();
    keep.click();
    expect(run.mock.calls).toEqual([['test.confirm'], ['test.keep']]);
  });

  it('draws each hint again with the keys after a keymap change', () => {
    const { scrim, setKeys } = promptSetup();

    setKeys({ 'test.keep': 'q', 'test.confirm': null });

    const [keep, confirm] = buttons(scrim);
    expect(keep.textContent).toBe('Keepq');
    expect(confirm.textContent).toBe('Cancel form');
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
    expect(log).toHaveBeenCalledWith('test', DISMISSED);
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
    expect(log).toHaveBeenCalledWith('test', DISMISSED);
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
});
