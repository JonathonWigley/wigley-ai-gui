import type {
  AgentHarness,
  AgentProcess,
  AgentProcessEvents,
  AgentStart,
  SessionControl,
} from '../contracts/agent';

// A scripted harness behind `AgentHarness`, for the tests and the self-test.
// Every emission runs in a microtask the causing call queues, never inside the
// call, so a caller's state is in place before its events arrive.

// A send of this text opens a turn that stays open until `interrupt` or `end`.
export const FAKE_HOLD_TEXT = 'fake: hold';
// A send of this text runs one tool before the reply.
export const FAKE_TOOL_TEXT = 'fake: tool';

export type FakeAgentCall =
  | { method: 'send'; text: string }
  | { method: 'interrupt' }
  | { method: 'setControl'; id: string; value: string }
  | { method: 'end' };

// `request` and `events` are the very objects `start` received; `calls` lists
// every call on the process in call order, refused ones included.
export interface FakeAgentProcessRecord {
  request: AgentStart;
  events: AgentProcessEvents;
  calls: FakeAgentCall[];
  ended: boolean;
}

// `processes` holds one record per `start` that did not throw, in start order:
// the same array for the harness's life, each record changing in place.
// `failNextStart` makes the next `start` throw `message`. Every `end` on a
// process returns the promise its first `end` returned. Between `holdEnd` and
// `releaseEnd`, a first `end` marks its process ended and leaves that promise
// pending; `releaseEnd` emits `ended` for each held process in call order and
// resolves them.
export interface FakeAgentHarness extends AgentHarness {
  readonly processes: readonly FakeAgentProcessRecord[];
  failNextStart(message: string): void;
  holdEnd(): void;
  releaseEnd(): void;
}

const fakeHarnesses = new WeakSet<AgentHarness>();

export function isFakeAgentHarness(
  harness: AgentHarness,
): harness is FakeAgentHarness {
  return fakeHarnesses.has(harness);
}

function startingControls(): SessionControl[] {
  return [
    {
      id: 'mode',
      label: 'Mode',
      choices: [
        { value: 'auto', label: 'Auto' },
        { value: 'plan', label: 'Plan' },
      ],
      value: 'auto',
    },
    {
      id: 'effort',
      label: 'Effort',
      choices: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
      value: 'medium',
    },
  ];
}

// The entries and activity that close turn `turn`.
function emitTurnEnd(events: AgentProcessEvents, turn: number) {
  events.entry({
    kind: 'result',
    id: `result-${turn}`,
    stopReason: 'end_turn',
    costUsd: null,
    durationMs: null,
    raw: [{ fake: 'result' }],
  });
  events.activity('idle');
}

function emitToolTurn(events: AgentProcessEvents, turn: number) {
  const tool = {
    kind: 'tool' as const,
    id: `tool-${turn}`,
    toolUseId: `fake-tool-${turn}`,
    name: 'Bash',
    input: { command: 'echo fake' },
    summary: 'echo fake',
  };
  events.entry({ ...tool, result: null, raw: [{ fake: 'tool' }] });
  events.entry({
    ...tool,
    result: { text: 'fake', isError: false },
    raw: [{ fake: 'tool' }, { fake: 'tool-result' }],
  });
  const reply = 'fake agent ran a tool';
  events.entry({
    kind: 'assistant',
    id: `assistant-${turn}`,
    text: reply,
    streaming: false,
    raw: [{ fake: 'assistant', text: reply }],
  });
  emitTurnEnd(events, turn);
}

function emitEchoTurn(events: AgentProcessEvents, turn: number, text: string) {
  const prefix = 'fake agent heard: ';
  const first = { fake: 'assistant', text: prefix };
  events.entry({
    kind: 'assistant',
    id: `assistant-${turn}`,
    text: prefix,
    streaming: true,
    raw: [first],
  });
  events.entry({
    kind: 'assistant',
    id: `assistant-${turn}`,
    text: `${prefix}${text}`,
    streaming: false,
    raw: [first, { fake: 'assistant', text }],
  });
  emitTurnEnd(events, turn);
}

export function createFakeAgentHarness(): FakeAgentHarness {
  const processes: FakeAgentProcessRecord[] = [];
  let nextStartFailure: string | null = null;
  let isEndHeld = false;
  const heldEnds: (() => void)[] = [];

  function startProcess(record: FakeAgentProcessRecord): AgentProcess {
    const { events, calls } = record;
    let controls = startingControls();
    let turn = 0;
    let isTurnOpen = false;
    let endPromise: Promise<void> | null = null;
    const requireRunning = () => {
      if (record.ended) {
        throw new Error('fake agent process has ended');
      }
    };
    queueMicrotask(() => {
      events.controls(controls);
      events.commands(['fake-command']);
      events.activity('idle');
    });
    return {
      send(text) {
        calls.push({ method: 'send', text });
        requireRunning();
        turn += 1;
        const sentTurn = turn;
        const isHold = text === FAKE_HOLD_TEXT;
        isTurnOpen = isHold;
        queueMicrotask(() => {
          events.entry({
            kind: 'user',
            id: `user-${sentTurn}`,
            text,
            raw: [{ fake: 'user', text }],
          });
          events.activity('working');
          if (isHold) {
            return;
          }
          if (text === FAKE_TOOL_TEXT) {
            emitToolTurn(events, sentTurn);
          } else {
            emitEchoTurn(events, sentTurn, text);
          }
        });
      },
      interrupt() {
        calls.push({ method: 'interrupt' });
        requireRunning();
        if (!isTurnOpen) {
          return;
        }
        isTurnOpen = false;
        const interruptedTurn = turn;
        queueMicrotask(() => {
          events.entry({
            kind: 'notice',
            id: `notice-${interruptedTurn}`,
            text: 'Interrupted',
            tone: 'info',
            raw: [{ fake: 'interrupt' }],
          });
          events.activity('idle');
        });
      },
      setControl(id, value) {
        calls.push({ method: 'setControl', id, value });
        requireRunning();
        const control = controls.find((declared) => declared.id === id);
        if (!control) {
          throw new Error(`fake agent has no control ${id}`);
        }
        if (!control.choices.some((choice) => choice.value === value)) {
          throw new Error(`fake agent control ${id} has no choice ${value}`);
        }
        controls = controls.map((declared) =>
          declared.id === id ? { ...declared, value } : declared,
        );
        const reported = controls;
        queueMicrotask(() => events.controls(reported));
      },
      end() {
        calls.push({ method: 'end' });
        if (endPromise !== null) {
          return endPromise;
        }
        record.ended = true;
        isTurnOpen = false;
        const emitEnded = () => events.ended({ code: 0, error: null });
        const isHeld = isEndHeld;
        endPromise = new Promise<void>((resolve) => {
          const exit = () => {
            emitEnded();
            resolve();
          };
          if (isHeld) {
            heldEnds.push(exit);
          } else {
            queueMicrotask(exit);
          }
        });
        return endPromise;
      },
    };
  }

  const harness: FakeAgentHarness = {
    id: 'claude',
    processes,
    start(request, events) {
      if (nextStartFailure !== null) {
        const message = nextStartFailure;
        nextStartFailure = null;
        throw new Error(message);
      }
      const record: FakeAgentProcessRecord = {
        request,
        events,
        calls: [],
        ended: false,
      };
      processes.push(record);
      return startProcess(record);
    },
    failNextStart(message) {
      nextStartFailure = message;
    },
    holdEnd() {
      isEndHeld = true;
    },
    releaseEnd() {
      isEndHeld = false;
      const released = heldEnds.splice(0);
      queueMicrotask(() => {
        for (const release of released) {
          release();
        }
      });
    },
  };
  fakeHarnesses.add(harness);
  return harness;
}
