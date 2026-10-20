import { describe, expect, it } from 'vitest';
import type { SessionControl } from '../../../contracts/agent';
import type { TextEditor } from '../../../contracts/editor';
import type { ChatSessionState } from '../contract';
import type { CloseConfirm, ReasonBox } from './chat-dialogs';
import { type ChatCommandDeps, chatCommandHandlers } from './chat-commands';
import type { ChatSession, ChatTabs, PermissionActions } from './chat-view';
import type { Picker, PickerRequest } from './picker';

const mode: SessionControl = {
  id: 'mode',
  label: 'Mode',
  choices: [
    { value: 'auto', label: 'Auto' },
    { value: 'plan', label: 'Plan' },
  ],
  value: 'auto',
};

function session(ended: boolean): ChatSession {
  const state: ChatSessionState = {
    sessionId: 'row-1',
    projectDir: '/Users/u/dev/app',
    profile: 'work',
    entries: [],
    controls: [mode],
    activity: 'working',
  };
  return {
    sessionId: 'row-1',
    name: 'app',
    state,
    ended,
    box: {} as TextEditor,
    entries: {} as ChatSession['entries'],
  };
}

// Lets a settled invoke's handlers run.
async function flush() {
  for (let turn = 0; turn < 5; turn++) {
    await Promise.resolve();
  }
}

// The handlers over one shown session; `invoked` records each call to chat
// main, `opened` each picker request and `toasts` each toast. Every invoke
// resolves, or rejects with `refusal` when one is given.
function setUp(shown: ChatSession, refusal?: Error) {
  const invoked: unknown[][] = [];
  const opened: PickerRequest<unknown>[] = [];
  const logs: string[] = [];
  const toasts: string[] = [];
  const tabs = {
    visibleSessionId: () => shown.sessionId,
    session: (sessionId: string) =>
      sessionId === shown.sessionId ? shown : undefined,
    sessionOfEditor: () => undefined,
  } as unknown as ChatTabs;
  const picker = {
    open<T>(request: PickerRequest<T>) {
      opened.push(request as PickerRequest<unknown>);
    },
  } as Picker;
  const deps: ChatCommandDeps = {
    tabs,
    channel: {
      invoke: (...args: unknown[]) => {
        invoked.push(args);
        return refusal === undefined
          ? Promise.resolve()
          : Promise.reject(refusal);
      },
    } as unknown as ChatCommandDeps['channel'],
    permissions: {} as PermissionActions,
    reasonBox: {} as ReasonBox,
    confirm: {} as CloseConfirm,
    picker,
    toast: (text) => toasts.push(text),
    log: (source, message) => logs.push(`[${source}] ${message}`),
  };
  return {
    handlers: chatCommandHandlers(deps),
    invoked,
    opened,
    logs,
    toasts,
  };
}

describe('chat commands', () => {
  it('interrupt_endedSessionShown_reachesNoProcess', () => {
    const run = setUp(session(true));

    run.handlers.interrupt({});

    expect(run.invoked).toEqual([]);
    expect(run.logs).toEqual(['[chat] app has ended']);
  });

  it('interrupt_liveWorkingSession_interruptsIt', () => {
    const run = setUp(session(false));

    run.handlers.interrupt({});

    expect(run.invoked).toEqual([['interrupt', 'row-1']]);
  });

  it('pickMode_endedSessionShown_opensNoPickerAndSetsNothing', () => {
    const run = setUp(session(true));

    run.handlers.pickMode({});

    expect(run.opened).toEqual([]);
    expect(run.invoked).toEqual([]);
  });

  it('pickControl_endedSessionShown_opensNoPicker', () => {
    const run = setUp(session(true));

    run.handlers.pickControl({});

    expect(run.opened).toEqual([]);
  });

  it('pickMode_liveSession_sessionBoundPickerSetsTheChoice', () => {
    const run = setUp(session(false));

    run.handlers.pickMode({});
    const [request] = run.opened;
    request.picked(mode.choices[1]);

    expect(request.sessionBound).toBe(true);
    expect(run.invoked).toEqual([['setControl', 'row-1', 'mode', 'plan']]);
  });

  it('pickMode_mainApplies_logsTheChangeOnceMainAnswers', async () => {
    const run = setUp(session(false));

    run.handlers.pickMode({});
    run.opened[0].picked(mode.choices[1]);
    const beforeAnswer = [...run.logs];
    await flush();

    expect(beforeAnswer).toEqual([]);
    expect(run.logs).toEqual(['[chat] set mode to plan in app']);
  });

  it('pickMode_mainRefuses_logsAndToastsTheFailureOnly', async () => {
    const run = setUp(session(false), new Error('session row-1 has ended'));

    run.handlers.pickMode({});
    run.opened[0].picked(mode.choices[1]);
    await flush();

    expect(run.logs).toEqual([
      '[chat] setControl failed: session row-1 has ended',
    ]);
    expect(run.toasts).toEqual(['session row-1 has ended']);
  });

  it('pickControl_liveSession_sessionBoundPickerOpensChoices', () => {
    const run = setUp(session(false));

    run.handlers.pickControl({});
    const [controls] = run.opened;
    controls.picked(mode);
    const [, choices] = run.opened;

    expect(controls.sessionBound).toBe(true);
    expect(choices.sessionBound).toBe(true);
    expect(choices.title).toBe('Mode');
  });
});
