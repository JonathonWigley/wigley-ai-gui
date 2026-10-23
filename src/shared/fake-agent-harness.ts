import type {
  AccountStatus,
  AgentHarness,
  AgentProcess,
  AgentProcessEvents,
  AgentStart,
  ChatEntry,
  ChatImage,
  LogInEvents,
  LogInProcess,
  PastSession,
  ProjectFolder,
  SessionControl,
} from '../contracts/agent';

// A scripted harness behind `AgentHarness`, for the tests and the self-test.
// Every emission runs in a microtask the causing call queues, never inside the
// call, so a caller's state is in place before its events arrive.

// A send of this text opens a turn that stays open until `interrupt` or `end`.
export const FAKE_HOLD_TEXT = 'fake: hold';
// A send of this text runs one tool before the reply.
export const FAKE_TOOL_TEXT = 'fake: tool';
// A send of this text ends the process on its own, as a CLI that exits.
export const FAKE_END_TEXT = 'fake: end';
// The link every `logIn` reports, and the one code that finishes it.
export const FAKE_SIGN_IN_URL = 'https://example.invalid/fake-sign-in';
export const FAKE_SIGN_IN_CODE = 'fake-code';
// The account every profile is signed in as until `logOut`.
const FAKE_ACCOUNT = 'fake@example.invalid';
const SIGNED_OUT: AccountStatus = { signedIn: false, account: null };

export type FakeAgentCall =
  | { method: 'send'; text: string; imageCount: number }
  | { method: 'interrupt' }
  | { method: 'setControl'; id: string; value: string }
  | { method: 'end' }
  | { method: 'kill' };

// `request` and `events` are the very objects `start` received; `calls` lists
// every call on the process in call order, refused ones included.
export interface FakeAgentProcessRecord {
  request: AgentStart;
  events: AgentProcessEvents;
  calls: FakeAgentCall[];
  ended: boolean;
}

// The sessions `listSessions` returns for every folder and profile, newest
// first; `history` answers for these ids alone.
export const FAKE_PAST_SESSIONS: readonly PastSession[] = [
  {
    sessionId: '00000000-0000-4000-8000-000000000001',
    title: 'fake past session one',
    modified: 1767323045000,
  },
  {
    sessionId: '00000000-0000-4000-8000-000000000002',
    title: 'fake past session two',
    modified: 1767236645000,
  },
];

// One `listSessions` or `history` call; `sessionId` is null for
// `listSessions`.
export interface FakePastSessionCall {
  method: 'listSessions' | 'history';
  sessionId: string | null;
  projectDir: string;
  profileDir: string | null;
}

// `processes` holds one record per `start` that did not throw, in start order:
// the same array for the harness's life, each record changing in place.
// `failNextStart` makes the next `start` throw `message`. Every `end` on a
// process returns the promise its first `end` returned, or, once a
// `FAKE_END_TEXT` send ended it, the promise of that exit. Between `holdEnd`
// and `releaseEnd`, a first `end` marks its process ended and leaves that
// promise pending; `releaseEnd` emits `ended` for each held process in call
// order and resolves them. A `FAKE_END_TEXT` exit is never held. `pastSessionCalls` lists every `listSessions` and `history`
// call in call order, failed ones included; `failNextHistory` makes the next
// `history` reject `message`. Every profile starts signed in as
// `fake@example.invalid`; `logOut` signs it out and a `logIn` given
// `FAKE_SIGN_IN_CODE` signs it back in. `listProjects` lists the folders
// `start` ran under the profile, the last started first.
export interface FakeAgentHarness extends AgentHarness {
  readonly processes: readonly FakeAgentProcessRecord[];
  readonly pastSessionCalls: readonly FakePastSessionCall[];
  failNextStart(message: string): void;
  failNextHistory(message: string): void;
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

// The images on a fake past session's user message: a red and a blue 16×16
// PNG.
export const FAKE_HISTORY_IMAGES: readonly ChatImage[] = [
  {
    mediaType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO44OBAEmIY1TCqYfhqAAAxPVAQGiLq9QAAAABJRU5ErkJggg==',
  },
  {
    mediaType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mNwSLhAEmIY1TCqYfhqAAAUDXAQquIenAAAAABJRU5ErkJggg==',
  },
];

// The two entries a fake past session's history holds, the user message
// carrying `FAKE_HISTORY_IMAGES`.
function fakeHistory(sessionId: string): ChatEntry[] {
  return [
    {
      kind: 'user',
      id: `history:${sessionId}-user`,
      text: 'fake earlier message',
      images: FAKE_HISTORY_IMAGES.map((image) => ({ ...image })),
      raw: [{ fake: 'history-user' }],
    },
    {
      kind: 'assistant',
      id: `history:${sessionId}-assistant`,
      text: 'fake earlier reply',
      streaming: false,
      raw: [{ fake: 'history-assistant' }],
    },
  ];
}

export function createFakeAgentHarness(): FakeAgentHarness {
  const processes: FakeAgentProcessRecord[] = [];
  const pastSessionCalls: FakePastSessionCall[] = [];
  let nextStartFailure: string | null = null;
  let nextHistoryFailure: string | null = null;
  let isEndHeld = false;
  const heldEnds: (() => void)[] = [];
  // Profiles `logOut` signed out and no sign-in has signed in since.
  const signedOutProfiles = new Set<string | null>();
  // Each profile's started folders, by the count of `start` calls when each
  // last started: the fake's stand-in for a modified time.
  const startedFolders = new Map<string | null, Map<string, number>>();
  let startCount = 0;

  const statusOf = (profileDir: string | null): AccountStatus =>
    signedOutProfiles.has(profileDir)
      ? SIGNED_OUT
      : { signedIn: true, account: FAKE_ACCOUNT };

  function recordStart(request: AgentStart) {
    startCount += 1;
    const folders =
      startedFolders.get(request.profileDir) ?? new Map<string, number>();
    folders.set(request.projectDir, startCount);
    startedFolders.set(request.profileDir, folders);
  }

  // Emits `link` at once; `FAKE_SIGN_IN_CODE` signs the profile in, any other
  // code ends with `Wrong code` and the profile's status unchanged.
  function startLogIn(
    profileDir: string | null,
    events: LogInEvents,
  ): LogInProcess {
    let hasEnded = false;
    const end = (status: AccountStatus | null, error: string | null) => {
      hasEnded = true;
      queueMicrotask(() => events.ended({ status, error }));
    };
    queueMicrotask(() => events.link(FAKE_SIGN_IN_URL));
    return {
      sendCode(code) {
        if (hasEnded) {
          return;
        }
        if (code !== FAKE_SIGN_IN_CODE) {
          end(statusOf(profileDir), 'Wrong code');
          return;
        }
        signedOutProfiles.delete(profileDir);
        end(statusOf(profileDir), null);
      },
      cancel() {
        if (hasEnded) {
          return;
        }
        end(null, 'Sign-in cancelled');
      },
    };
  }

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
      send(message) {
        const { text, images } = message;
        calls.push({ method: 'send', text, imageCount: images.length });
        requireRunning();
        turn += 1;
        const sentTurn = turn;
        const emitUserEntry = () => {
          events.entry({
            kind: 'user',
            id: `user-${sentTurn}`,
            text,
            images,
            raw: [{ fake: 'user', text }],
          });
          events.activity('working');
        };
        if (text === FAKE_END_TEXT) {
          record.ended = true;
          isTurnOpen = false;
          endPromise = new Promise<void>((resolve) => {
            queueMicrotask(() => {
              emitUserEntry();
              events.ended({ code: 0, error: null });
              resolve();
            });
          });
          return;
        }
        const isHold = text === FAKE_HOLD_TEXT;
        isTurnOpen = isHold;
        queueMicrotask(() => {
          emitUserEntry();
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
      kill() {
        calls.push({ method: 'kill' });
        if (endPromise !== null) {
          return;
        }
        record.ended = true;
        isTurnOpen = false;
        endPromise = new Promise<void>((resolve) => {
          queueMicrotask(() => {
            events.ended({ code: null, error: null });
            resolve();
          });
        });
      },
    };
  }

  const harness: FakeAgentHarness = {
    id: 'claude',
    processes,
    pastSessionCalls,
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
      recordStart(request);
      return startProcess(record);
    },
    failNextStart(message) {
      nextStartFailure = message;
    },
    async listSessions(projectDir, profileDir) {
      pastSessionCalls.push({
        method: 'listSessions',
        sessionId: null,
        projectDir,
        profileDir,
      });
      return FAKE_PAST_SESSIONS.map((session) => ({ ...session }));
    },
    async history(sessionId, projectDir, profileDir) {
      pastSessionCalls.push({
        method: 'history',
        sessionId,
        projectDir,
        profileDir,
      });
      if (nextHistoryFailure !== null) {
        const message = nextHistoryFailure;
        nextHistoryFailure = null;
        throw new Error(message);
      }
      const isSaved = FAKE_PAST_SESSIONS.some(
        (session) => session.sessionId === sessionId,
      );
      if (!isSaved) {
        throw new Error(`fake agent has no saved session ${sessionId}`);
      }
      return fakeHistory(sessionId);
    },
    failNextHistory(message) {
      nextHistoryFailure = message;
    },
    async accountStatus(profileDir) {
      return statusOf(profileDir);
    },
    logIn: startLogIn,
    async logOut(profileDir) {
      signedOutProfiles.add(profileDir);
    },
    async listProjects(profileDir) {
      const folders = startedFolders.get(profileDir) ?? new Map();
      const projects: ProjectFolder[] = [...folders].map(
        ([projectDir, modified]) => ({ projectDir, modified }),
      );
      return projects.sort((a, b) => b.modified - a.modified);
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
