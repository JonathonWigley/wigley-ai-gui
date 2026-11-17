import { describe, expect, it } from 'vitest';
import type { ActiveTime } from '../../../contracts/active-time';
import type { SlotChange } from '../../../contracts/state';
import { NO_ACTIVE_TIME } from '../../../shared/active-time';
import { harnessRegistryOf } from '../../../shared/agent-harness-registry.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type AgentCommand,
  type AgentEvent,
  type AgentProcessEvents,
  type ChatEntry,
  type CompactionTrigger,
  type HarnessProfile,
  MAIN_AGENT_ID,
  type PermissionDecision,
  type ProcessActivity,
  type SessionControl,
  type UserMessage,
} from '../../../contracts/agent';
import type { GitWorktree } from '../../../contracts/git';
import type { HostedProcessInfo } from '../../../contracts/session-host';
import {
  createFakeAgentHarness,
  FAKE_AGENT_PID,
  FAKE_CANCELLED_REASON,
  FAKE_END_TEXT,
  FAKE_HARNESS_ID,
  FAKE_HOLD_TEXT,
  FAKE_MICROTASK_TIMERS,
  FAKE_PAST_SESSIONS,
  type FakeAgentCall,
  type FakeAgentHarness,
  type FakePermissionCall,
  fakePlanRowUpdate,
  fakeUsageEvent,
} from '../../../shared/fake-agent-harness';
import { createFakeSessionHost } from '../../../shared/fake-session-host';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  AgentSession,
  MarkOptions,
  OpenOptions,
  SessionInfo,
  SessionTitles,
  TitleSource,
} from '../../sessions/contract';
import {
  chatCommandsSlot,
  chatControlsSlot,
  chatEntriesSlot,
  type ChatMainEvents,
  type ChatProject,
  chatQueuedSlot,
  chatReturnedSlot,
  type ChatSessionInfo,
  type ChatSessionState,
  chatSessionSlot,
  HEADLESS_NOTE,
  type PoolProvider,
  type QueuedMessage,
  type ReturnedMessage,
  type SendGate,
  type SendGateInput,
  type SessionCompaction,
} from '../contract';
import {
  ARCHIVED_SESSIONS_FILE,
  createArchivedSessions,
} from './archived-sessions';
import {
  type ChatSessions,
  type ChatSessionsDeps,
  createChatSessions,
  PERMISSION_CANCELLED_REASON,
  UNATTENDED_REASON,
} from './chat-sessions';
import type {
  OpenSessions,
  SavedSession,
  SavedSessions,
} from './open-sessions';
import { chatHarnessesOfRegistry } from './lookups.test-support';
import { createRecentFolders, RECENT_FOLDERS_FILE } from './recent-folders';
import { createChatSlots } from './chat-slots';

const PROFILES: HarnessProfile[] = [
  { name: 'work', configDir: '~/.claude' },
  { name: 'personal', configDir: '~/.claude-personal' },
];

// What one recorded slot change, or `sessionRested`, told the page: named by the
// value it changed in the slot, each `chat.session` write by the fields that
// differ from its last value, and a session's writes up to its key together as
// `sessionStarted`. `returned` holds only the ids the list did not hold before.
interface MessageData {
  sessionStarted: ChatSessionState;
  entry: { sessionId: string; entry: ChatEntry };
  entries: { sessionId: string; entries: ChatEntry[] };
  controls: { sessionId: string; controls: SessionControl[] };
  commands: { sessionId: string; commands: AgentCommand[] };
  queued: { sessionId: string; queued: QueuedMessage[] };
  returned: { sessionId: string; messages: ReturnedMessage[] };
  activity: { sessionId: string; activity: ProcessActivity };
  background: { sessionId: string; background: number };
  activeTime: { sessionId: string; activeTime: ActiveTime };
  compaction: { sessionId: string; compaction: SessionCompaction | null };
  branch: { sessionId: string; repo: string; branch: string | null };
  sessionRunning: { sessionId: string };
  sessionRested: { sessionId: string; error: string | null };
}

type Message = {
  [K in keyof MessageData]: { message: K; data: MessageData[K] };
}[keyof MessageData];

type TimelineItem = SlotChange | { rested: MessageData['sessionRested'] };

// The messages a session's `chat.session` write comes to, against its last value.
function infoMessages(
  before: ChatSessionInfo,
  next: ChatSessionInfo,
): Message[] {
  const { sessionId } = next;
  const messages: Message[] = [];
  if (next.activity !== before.activity) {
    const { activity } = next;
    messages.push({ message: 'activity', data: { sessionId, activity } });
  }
  if (next.background !== before.background) {
    const { background } = next;
    messages.push({ message: 'background', data: { sessionId, background } });
  }
  if (next.activeTime !== before.activeTime) {
    const { activeTime } = next;
    messages.push({ message: 'activeTime', data: { sessionId, activeTime } });
  }
  if (next.compaction !== before.compaction) {
    const { compaction } = next;
    messages.push({ message: 'compaction', data: { sessionId, compaction } });
  }
  if (next.repo !== before.repo || next.branch !== before.branch) {
    const { repo, branch } = next;
    messages.push({ message: 'branch', data: { sessionId, repo, branch } });
  }
  if (next.running && !before.running) {
    messages.push({ message: 'sessionRunning', data: { sessionId } });
  }
  return messages;
}

function messagesFrom(timeline: readonly TimelineItem[]): Message[] {
  const messages: Message[] = [];
  const infos = new Map<string, ChatSessionInfo>();
  const values = new Map<string, unknown>();
  const valueOf = <V>(slot: string, key: string) =>
    values.get(`${slot} ${key}`) as V;
  for (const item of timeline) {
    if ('rested' in item) {
      messages.push({ message: 'sessionRested', data: item.rested });
      continue;
    }
    if (item.kind === 'value' || item.kind === 'cleared') {
      continue;
    }
    const { id, key: sessionId } = item;
    const isOpen = infos.has(sessionId);
    if (item.kind === 'list') {
      const { change } = item;
      if (change.kind === 'put') {
        const entry = change.item as ChatEntry;
        messages.push({ message: 'entry', data: { sessionId, entry } });
      } else if (change.kind === 'replace') {
        const entries = [...change.items] as ChatEntry[];
        values.set(`${id} ${sessionId}`, entries);
        if (isOpen) {
          messages.push({ message: 'entries', data: { sessionId, entries } });
        }
      }
      continue;
    }
    if (item.value === undefined) {
      if (id === chatSessionSlot.id) {
        infos.delete(sessionId);
      }
      continue;
    }
    if (id === chatSessionSlot.id) {
      const next = item.value as ChatSessionInfo;
      const before = infos.get(sessionId);
      infos.set(sessionId, next);
      if (before !== undefined) {
        messages.push(...infoMessages(before, next));
        continue;
      }
      messages.push({
        message: 'sessionStarted',
        data: {
          ...next,
          entries: valueOf(chatEntriesSlot.id, sessionId),
          controls: valueOf(chatControlsSlot.id, sessionId),
          commands: valueOf(chatCommandsSlot.id, sessionId),
          queued: valueOf(chatQueuedSlot.id, sessionId),
          returned: valueOf(chatReturnedSlot.id, sessionId),
        },
      });
      continue;
    }
    const previous = valueOf<ReturnedMessage[] | undefined>(id, sessionId);
    values.set(`${id} ${sessionId}`, item.value);
    if (!isOpen) {
      continue;
    }
    if (id === chatControlsSlot.id) {
      const controls = item.value as SessionControl[];
      messages.push({ message: 'controls', data: { sessionId, controls } });
    } else if (id === chatCommandsSlot.id) {
      const commands = item.value as AgentCommand[];
      messages.push({ message: 'commands', data: { sessionId, commands } });
    } else if (id === chatQueuedSlot.id) {
      const queued = item.value as QueuedMessage[];
      messages.push({ message: 'queued', data: { sessionId, queued } });
    } else {
      const held = previous ?? [];
      const fresh = (item.value as ReturnedMessage[]).filter(
        (message) => !held.some((placed) => placed.id === message.id),
      );
      if (fresh.length > 0) {
        messages.push({
          message: 'returned',
          data: { sessionId, messages: fresh },
        });
      }
    }
  }
  return messages;
}

type Emitted = {
  [K in keyof ChatMainEvents]: { event: K; data: ChatMainEvents[K] };
}[keyof ChatMainEvents];

const ROW_ID = 'row-1';
const PROJECT_DIR = '/work/app';
const PAST_ONE = FAKE_PAST_SESSIONS[0];
const PAST_TWO = FAKE_PAST_SESSIONS[1];
// A process of `PAST_ONE` running in the current host.
const HOSTED_PAST_ONE: HostedProcessInfo = {
  id: `${PAST_ONE.sessionId}-1-900`,
  startedAt: 900,
  running: true,
  current: true,
};

const BASH_CALL: FakePermissionCall = {
  toolName: 'Bash',
  input: { command: 'ls' },
  toolUseId: 'tu-1',
};

const NO_TITLES: SessionTitles = {
  user: null,
  agent: null,
  firstMessage: null,
};

// The usage `agentEvent`s chat emitted, as sent.
function usageEmitted(
  emitted: readonly Emitted[],
): ChatMainEvents['agentEvent'][] {
  return emitted.flatMap((each) =>
    each.event === 'agentEvent' && each.data.event.type === 'usage'
      ? [each.data]
      : [],
  );
}

// The `compactionEnded` `agentEvent`s chat emitted, as sent.
function compactionEndsEmitted(emitted: readonly Emitted[]) {
  return emitted.flatMap((each) => {
    if (each.event !== 'agentEvent') {
      return [];
    }
    const { event } = each.data;
    return event.type === 'compactionEnded' ? [{ ...each.data, event }] : [];
  });
}

const NOTHING_SAVED: SavedSessions = {
  sessions: [],
  selectedHostSessionId: null,
};

// A saved record of a session in `/w/app` under `work`, no message sent, no
// turn running and no titles, unless `fields` say otherwise.
function record(
  hostSessionId: string,
  fields: Partial<SavedSession> = {},
): SavedSession {
  return {
    hostSessionId,
    projectDir: '/w/app',
    harness: FAKE_HARNESS_ID,
    profile: 'work',
    sent: false,
    busy: false,
    titles: NO_TITLES,
    processId: null,
    launchControls: {},
    launchResume: false,
    launchHeadless: false,
    queued: [],
    returned: [],
    controls: [],
    confirmedPicks: {},
    returnedDrops: [],
    activeMs: 0,
    rowId: null,
    unattended: false,
    headless: false,
    instructions: [],
    owner: null,
    ...fields,
  };
}

// A session-slot value an earlier run of chat left under `rowId`.
function keptSessionInfo(rowId: string): ChatSessionInfo {
  return {
    sessionId: rowId,
    projectDir: '/w/app',
    harness: FAKE_HARNESS_ID,
    profile: 'work',
    activity: 'idle',
    background: 0,
    activeTime: NO_ACTIVE_TIME,
    running: false,
    pid: null,
    compaction: null,
    repo: 'app',
    branch: null,
    worktrees: [],
    headless: false,
  };
}

// An open-sessions store holding the last snapshot saved and the save count.
function fakeOpenSessions() {
  let last: SavedSessions | null = null;
  let saves = 0;
  const store: OpenSessions = {
    load: () => Promise.resolve(NOTHING_SAVED),
    save: (snapshot) => {
      saves++;
      last = structuredClone(snapshot);
      return Promise.resolve();
    },
  };
  return { store, last: () => last, saves: () => saves };
}

// Lets the fake harness's queued emissions and the recent-folders write run.
async function flush() {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

// A folder in no clone, unless a test passes its own `git`.
const NO_CLONE: ChatSessionsDeps['git'] = {
  topLevel: () => Promise.resolve(null),
  currentBranch: () => Promise.resolve(null),
  worktrees: () => Promise.resolve([]),
};

const FIX_ROOT = '/repos/.worktrees/fix';

// The checkouts of the clone at `/repos/clone`: its main tree, then a linked
// worktree at each of `linked`.
function checkoutsOf(linked: readonly string[]): GitWorktree[] {
  return [
    { path: '/repos/clone', branch: 'main', isMain: true },
    ...linked.map((root) => ({
      path: root,
      branch: null,
      isMain: false,
    })),
  ];
}

// The clone at `/repos/clone` on `main`, whose linked worktrees the test
// changes through `linked`.
function worktreesGit(linked: string[]): ChatSessionsDeps['git'] {
  return {
    topLevel: () => Promise.resolve('/repos/clone'),
    currentBranch: () => Promise.resolve('main'),
    worktrees: () => Promise.resolve(checkoutsOf(linked)),
  };
}

function toolEntry(
  id: string,
  name: string,
  input: unknown,
  result: { text: string; isError: boolean } | null = null,
): ChatEntry {
  return {
    kind: 'tool',
    id,
    at: 1000,
    agentId: MAIN_AGENT_ID,
    toolUseId: `tu-${id}`,
    name,
    input,
    summary: '',
    result,
    raw: [],
  };
}

function setUp(
  options: {
    harnesses?: FakeAgentHarness[];
    clockNow?: number;
    git?: ChatSessionsDeps['git'];
    files?: ChatSessionsDeps['files'];
    sessionHost?: ChatSessionsDeps['sessionHost'];
    // Row ids an earlier run of chat left in the session slot.
    keptRowIds?: string[];
    projects?: ChatProject[];
    poolProvider?: PoolProvider | null;
  } = {},
) {
  let clockNow = options.clockNow ?? 1000;
  let onEmit: (emitted: Emitted) => void = () => undefined;
  const clock = { now: () => clockNow };
  const harness = createFakeAgentHarness(
    clock,
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
  const harnesses = options.harnesses ?? [harness];
  const sessionHost = createFakeSessionHost(clock);
  const data = createMemoryFiles();
  const logged: string[] = [];
  const log = (message: string) => logged.push(message);
  const opened: SessionInfo[] = [];
  const openOptions: (OpenOptions | undefined)[] = [];
  const marked: string[] = [];
  // Each mark's toast options, and the side-bar label of each row given one.
  const markOptions: MarkOptions[] = [];
  const rowLabels = new Map<string, string>();
  const activated: string[] = [];
  // Each slot change and `sessionRested`, in the order they left main.
  const timeline: TimelineItem[] = [];
  const store = createSlotStore(() => undefined);
  const earlierRun = store.publish(chatSessionSlot);
  for (const rowId of options.keptRowIds ?? []) {
    earlierRun.set(rowId, keptSessionInfo(rowId));
  }
  earlierRun.dispose();
  store.onWrite((change) => timeline.push(change));
  const emitted: Emitted[] = [];
  // Each `noteToolStarted` call and each emit, in the order chat made them.
  const notesAndEmits: (
    | { noted: [string, string, string] }
    | { emitted: Emitted }
  )[] = [];
  let ownedEnds = 0;
  // The row id of each owned session kept, in order.
  const keptRows: string[] = [];
  let isFocused = true;
  let selectedSessionId: string | null = ROW_ID;
  const hostIdChanges: string[] = [];
  // Host ids whose `open` throws, row ids another session holds, host ids
  // `setHostSessionId` refuses, and what each owned `end` also does.
  const refusedOpens = new Set<string>();
  const refusedHostIds = new Set<string>();
  const heldRowIds = new Set<string>();
  let onOwnedEnd = () => {};
  let profiles: readonly HarnessProfile[] = PROFILES;
  // `setProfiles` changes the profiles the default harness declares.
  const fakeInfo = harness.info;
  harness.info = () => ({ ...fakeInfo(), profiles });
  const archived = createArchivedSessions(data);
  const saved = fakeOpenSessions();
  // Every `setTitle` call, and the titles of each row opened.
  const titleCalls: [string, TitleSource, string | null][] = [];
  const titles = new Map<string, SessionTitles>();
  // Rows are numbered in open order: the first is ROW_ID.
  const sessions: ChatSessionsDeps['sessions'] = {
    open: (info, options) => {
      if (info.sessionId !== null && refusedOpens.has(info.sessionId)) {
        throw new Error(`open of ${info.sessionId} refused`);
      }
      if (options?.rowId !== undefined && heldRowIds.has(options.rowId)) {
        throw new Error(`Session ${options.rowId} is already open`);
      }
      opened.push(info);
      openOptions.push(options);
      const id = options?.rowId ?? `row-${opened.length}`;
      titles.set(id, { ...NO_TITLES });
      return {
        session: { id, info },
        end: () => {
          ownedEnds++;
          onOwnedEnd();
        },
        setHostSessionId: (hostSessionId) => {
          if (refusedHostIds.has(hostSessionId)) {
            throw new Error(`host ${hostSessionId} is held by another row`);
          }
          hostIdChanges.push(hostSessionId);
        },
        keep: () => {
          keptRows.push(id);
        },
      };
    },
    mark: (sessionId, options) => {
      marked.push(sessionId);
      markOptions.push(options);
    },
    label: (sessionId) => rowLabels.get(sessionId) ?? null,
    activate: (sessionId) => activated.push(sessionId),
    setTitle: (sessionId, source, title) => {
      titleCalls.push([sessionId, source, title]);
      const held = titles.get(sessionId);
      if (held !== undefined) {
        held[source] = title;
      }
    },
    titles: (sessionId) => {
      const held = titles.get(sessionId);
      return held === undefined ? null : { ...held };
    },
  };
  // Each harness registers under its own handle, so a test can let one leave
  // and register it again; `labels` holds the label of each id registered so
  // far, which `harnessLabelOf` reads as `start.ts`'s follower does.
  const registry = harnessRegistryOf([]);
  const registrations = new Map<string, () => void>();
  const labels = new Map<string, string>();
  const register = (each: FakeAgentHarness) => {
    const registration = registry.register(each);
    registrations.set(each.id, () => registration.dispose());
    labels.set(each.id, each.info().label);
  };
  for (const each of harnesses) {
    register(each);
  }
  const chat = createChatSessions({
    harnesses: chatHarnessesOfRegistry(registry),
    harnessLabelOf: (harnessId) => labels.get(harnessId) ?? harnessId,
    sessions,
    selectedSessionId: () => selectedSessionId,
    recent: createRecentFolders({
      data,
      clock,
      paths: posixPaths,
      log,
    }),
    archived,
    saved: saved.store,
    slots: createChatSlots({
      session: store.publish(chatSessionSlot),
      entries: store.publish(chatEntriesSlot),
      controls: store.publish(chatControlsSlot),
      commands: store.publish(chatCommandsSlot),
      queued: store.publish(chatQueuedSlot),
      returned: store.publish(chatReturnedSlot),
    }),
    send: (message, data) => {
      if (message === 'sessionRested') {
        timeline.push({ rested: data as MessageData['sessionRested'] });
      }
    },
    emit: (event, data) => {
      const each = { event, data } as Emitted;
      emitted.push(each);
      notesAndEmits.push({ emitted: each });
      onEmit(each);
    },
    window: {
      isFocused: () => isFocused,
    },
    git: options.git ?? NO_CLONE,
    files: options.files ?? { realPath: (file) => Promise.resolve(file) },
    toolCallers: {
      noteToolStarted: (sessionId, toolUseId, agentId) =>
        notesAndEmits.push({ noted: [sessionId, toolUseId, agentId] }),
    },
    log,
    clock,
    sessionHost: options.sessionHost ?? sessionHost,
    projects: () => options.projects ?? [],
    poolProvider: () => options.poolProvider ?? null,
    homeDir: '/home/me',
    paths: posixPaths,
  });
  return {
    chat,
    harness,
    sessionHost,
    data,
    logged,
    opened,
    openOptions,
    marked,
    markOptions,
    rowLabels,
    activated,
    store,
    timeline,
    messages: () => messagesFrom(timeline),
    emitted,
    notesAndEmits,
    archived,
    saved,
    titleCalls,
    titlesOf: (sessionId: string) => titles.get(sessionId),
    // Changes a row's titles as sessions would, recording no call.
    setRowTitles: (sessionId: string, next: SessionTitles) =>
      titles.set(sessionId, next),
    setNow: (now: number) => {
      clockNow = now;
    },
    hostIdChanges,
    ownedEnds: () => ownedEnds,
    keptRows,
    setFocused: (focused: boolean) => {
      isFocused = focused;
    },
    setSelected: (sessionId: string | null) => {
      selectedSessionId = sessionId;
    },
    refuseOpen: (hostId: string) => refusedOpens.add(hostId),
    refuseHostId: (hostId: string) => refusedHostIds.add(hostId),
    holdRowId: (rowId: string) => heldRowIds.add(rowId),
    // Runs as each event is emitted, while chat's emit is on the stack.
    setOnEmit: (listen: (emitted: Emitted) => void) => {
      onEmit = listen;
    },
    setOnOwnedEnd: (act: () => void) => {
      onOwnedEnd = act;
    },
    setProfiles: (next: readonly HarnessProfile[]) => {
      profiles = next;
    },
    registry,
    register,
    // Drops `harnessId` from the registry, then tells chat it left, as the
    // registry and `start.ts`'s follower do when its key is deleted.
    leave: (harnessId: string) => {
      registrations.get(harnessId)?.();
      registrations.delete(harnessId);
      chat.harnessLeft(harnessId);
    },
    sent: <K extends Message['message']>(message: K) =>
      messagesFrom(timeline)
        .filter((sent) => sent.message === message)
        .map((sent) => sent.data as MessageData[K]),
    // Each `returned` change, with its messages' ids left out.
    sentReturned: () =>
      messagesFrom(timeline)
        .filter((sent) => sent.message === 'returned')
        .map((sent) => {
          const data = sent.data as MessageData['returned'];
          return {
            sessionId: data.sessionId,
            messages: data.messages.map(({ text, images }) => ({
              text,
              images,
            })),
          };
        }),
  };
}

async function started(options?: Parameters<typeof setUp>[0]) {
  const test = setUp(options);
  test.chat.start({
    harness: FAKE_HARNESS_ID,
    projectDir: PROJECT_DIR,
    profile: 'personal',
  });
  await flush();
  const process = test.harness.processes[0];
  const activity = (value: ProcessActivity) => process.events.activity(value);
  return { ...test, process, activity };
}

// A session the sessions plugin reports connected with host id `hostId`.
function connected(id: string, hostId: string): AgentSession {
  return {
    id,
    info: {
      sessionId: hostId,
      projectDir: '/w/app',
      harness: 'claude',
      rowId: null,
    },
  };
}

function assistant(id: string, text: string): ChatEntry {
  return {
    kind: 'assistant',
    id,
    at: 1000,
    agentId: MAIN_AGENT_ID,
    text,
    streaming: false,
    raw: [],
  };
}

const IDLE_SEND: UserMessage = { text: 'idle send', images: [] };
const PENDING: UserMessage = { text: 'pending', images: [] };

// Two messages sent while the session's harness reports `working`.
function queueTwo(
  test: Awaited<ReturnType<typeof started>>,
): [UserMessage, UserMessage] {
  const first: UserMessage = { text: 'first', images: [] };
  const second: UserMessage = {
    text: 'second',
    images: [{ mediaType: 'image/png', data: 'iVBORw0K' }],
  };
  test.activity('working');
  test.chat.send(ROW_ID, first);
  test.chat.send(ROW_ID, second);
  return [first, second];
}

// The entry id the `index`th queued row was sent now under.
function sentEntryIdOf(test: ReturnType<typeof setUp>, index: number): string {
  const { sentEntryId } = test.chat.sessions()[0].queued[index];
  if (sentEntryId === null) {
    throw new Error(`queued row ${index} was not sent now`);
  }
  return sentEntryId;
}

function userEntry(id: string, text: string): ChatEntry {
  return {
    kind: 'user',
    id,
    at: 1000,
    text,
    images: [],
    delivery: null,
    raw: [],
  };
}

const REFUSED_TEXT = 'refused write';

// A started session whose process throws on a write of REFUSED_TEXT.
async function startedRefusing() {
  const fake = createFakeAgentHarness(
    { now: () => 1000 },
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
  const refusing: FakeAgentHarness = {
    ...fake,
    start: (request, events) => {
      const process = fake.start(request, events);
      return {
        ...process,
        send: (message) => {
          if (message.text === REFUSED_TEXT) {
            throw new Error('write refused');
          }
          return process.send(message);
        },
      };
    },
  };
  const test = setUp({ harnesses: [refusing] });
  test.chat.start({
    harness: FAKE_HARNESS_ID,
    projectDir: PROJECT_DIR,
    profile: 'personal',
  });
  await flush();
  const process = fake.processes[0];
  const activity = (value: ProcessActivity) => process.events.activity(value);
  return { ...test, process, activity };
}

// Each message the process was sent, as its text and whether it went `now`.
function writtenWithNow(test: { process: { calls: FakeAgentCall[] } }) {
  return test.process.calls.flatMap((call) =>
    call.method === 'send' ? [[call.text, call.now === true]] : [],
  );
}

function sendCall(message: UserMessage) {
  return {
    method: 'send',
    text: message.text,
    imageCount: message.images.length,
  };
}

// Raises a permission request for `BASH_CALL` on the row's live fake process,
// as a tool call in it would, and flushes so the request reaches chat.
// Returns a reader of the request's decision: 'pending' until it settles.
async function askBash(
  test: { harness: FakeAgentHarness },
  rowId = ROW_ID,
): Promise<() => PermissionDecision | 'pending'> {
  let decision: PermissionDecision | 'pending' = 'pending';
  void test.harness.askPermission(rowId, BASH_CALL).then((value) => {
    decision = value;
  });
  await flush();
  return () => decision;
}

// The `answerPermission` calls chat made on the fake process.
function permissionAnswers(process: { calls: FakeAgentCall[] }) {
  return process.calls.filter(
    (call): call is Extract<FakeAgentCall, { method: 'answerPermission' }> =>
      call.method === 'answerPermission',
  );
}

describe('createChatSessions', () => {
  it.each([
    {
      given: 'a started process',
      expected: FAKE_AGENT_PID,
      run: async (test: ReturnType<typeof setUp>) => {
        test.chat.start({
          harness: FAKE_HARNESS_ID,
          projectDir: PROJECT_DIR,
          profile: 'personal',
        });
        await flush();
      },
    },
    {
      given: 'the process ended',
      expected: null,
      run: async (test: ReturnType<typeof setUp>) => {
        test.chat.start({
          harness: FAKE_HARNESS_ID,
          projectDir: PROJECT_DIR,
          profile: 'personal',
        });
        await flush();
        test.chat.send(ROW_ID, { text: FAKE_END_TEXT, images: [] });
        await flush();
      },
    },
    {
      given: 'a re-attached process',
      expected: 4321,
      run: async (test: ReturnType<typeof setUp>) => {
        test.harness.scriptAttach('p1', {
          outcome: 'process',
          replay(events) {
            events.pid(4321);
          },
        });
        restoreOne(test, hostedRecord(), [hostedP1()]);
        await flush();
      },
    },
    {
      given: 'a restored row whose process is gone',
      expected: null,
      run: async (test: ReturnType<typeof setUp>) => {
        restoreOne(test, hostedRecord(), []);
        await flush();
      },
    },
  ])(
    'pid_ProcessLifecycle_PublishedOnlyWhileRunning: $given',
    async ({ expected, run }) => {
      const test = setUp();

      await run(test);

      expect(test.chat.sessions()[0].pid).toBe(expected);
    },
  );

  it('start_opensTheSessionAndStartsTheHarness', async () => {
    const test = setUp();

    const sessionId = test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();

    expect(sessionId).toBe(ROW_ID);
    expect(test.opened).toEqual([
      {
        sessionId: null,
        projectDir: PROJECT_DIR,
        harness: FAKE_HARNESS_ID,
        rowId: null,
        profileDir: '~/.claude-personal',
      },
    ]);
    expect(test.harness.processes.map((process) => process.request)).toEqual([
      {
        processId: 'row-1-1-1000',
        sessionId: null,
        resume: false,
        projectDir: PROJECT_DIR,
        profileDir: '~/.claude-personal',
        controls: {},
        instructions: [],
        idleCompactMinTokens: null,
        rowId: ROW_ID,
      },
    ]);
    expect(test.sent('sessionStarted')).toEqual([
      {
        sessionId: ROW_ID,
        projectDir: PROJECT_DIR,
        harness: FAKE_HARNESS_ID,
        profile: 'personal',
        entries: [],
        controls: [],
        activity: 'idle',
        background: 0,
        activeTime: { totalMs: 0, since: null },
        commands: [],
        running: false,
        pid: null,
        queued: [],
        compaction: null,
        returned: [],
        repo: 'app',
        branch: null,
        worktrees: [],
        headless: false,
      },
    ]);
    expect(test.sent('sessionRunning')).toEqual([{ sessionId: ROW_ID }]);
    expect(test.chat.sessions()[0].running).toBe(true);
    expect(JSON.parse(await test.data.read(RECENT_FOLDERS_FILE))).toEqual([
      {
        projectDir: PROJECT_DIR,
        harness: FAKE_HARNESS_ID,
        profile: 'personal',
        lastUsed: 1000,
      },
    ]);
  });

  it.each([
    {
      row: 'the started row once its harness reported',
      reported: true,
      sessionId: ROW_ID,
      expected: 'fake-session-1',
    },
    {
      row: 'the started row before its harness reported',
      reported: false,
      sessionId: ROW_ID,
      expected: null,
    },
    {
      row: 'a row chat does not hold',
      reported: true,
      sessionId: 'row-9',
      expected: null,
    },
  ])(
    'hostSessionIdOf_$row_ReturnsItsHostId',
    async ({ reported, sessionId, expected }) => {
      const test = setUp();
      test.chat.start({
        harness: FAKE_HARNESS_ID,
        projectDir: PROJECT_DIR,
        profile: 'personal',
      });
      if (reported) {
        await flush();
      }

      expect(test.chat.hostSessionIdOf(sessionId)).toBe(expected);
    },
  );

  it('addInstructions_EachStartCarriesTheRegisteredOnes', async () => {
    const test = setUp();
    const first = test.chat.addInstructions('first note');
    test.chat.addInstructions('second note');

    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    expect(test.harness.processes[0].request.instructions).toEqual([
      'first note',
      'second note',
    ]);

    first.dispose();
    first.dispose();
    test.chat.send(ROW_ID, { text: 'hi', images: [] });
    await flush();
    test.harness.processes[0].events.ended({ code: 0, error: null });
    test.chat.send(ROW_ID, { text: 'again', images: [] });
    await flush();
    expect(test.harness.processes[1].request.instructions).toEqual([
      'second note',
    ]);

    test.chat.addInstructions('third note');
    test.chat.clear(ROW_ID);
    await flush();
    expect(test.harness.processes[2].request.instructions).toEqual([
      'second note',
      'third note',
    ]);
    expect(test.harness.processes[0].request.instructions).toEqual([
      'first note',
      'second note',
    ]);
  });

  it('launch_InstructionsFollowTheGlobalOnesAndSurviveAClear', async () => {
    const test = setUp();
    test.chat.addInstructions('global note');

    const launchedId = test.chat.launch({
      projectDir: PROJECT_DIR,
      profile: 'personal',
      message: { text: 'go', images: [] },
      instructions: ['own note'],
    });
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    expect(
      test.harness.processes.map((process) => process.request.instructions),
    ).toEqual([['global note', 'own note'], ['global note']]);

    test.chat.clear(launchedId);
    await flush();
    expect(test.harness.processes[2].request.instructions).toEqual([
      'global note',
      'own note',
    ]);
  });

  it('pastSessions_LeavesOutOpenAndMarksArchived', async () => {
    const test = setUp();
    await test.archived.set(PAST_ONE.sessionId, true);
    test.chat.recordOpenHostId(connected('row-9', PAST_TWO.sessionId));

    const rows = await test.chat.pastSessions('/w/app', 'personal');

    expect(rows).toEqual([
      {
        hostSessionId: PAST_ONE.sessionId,
        title: 'fake past session one',
        modified: 1767323045000,
        archived: true,
      },
    ]);
    expect(test.harness.pastSessionCalls).toEqual([
      {
        method: 'listSessions',
        sessionId: null,
        projectDir: '/w/app',
        profileDir: '~/.claude-personal',
        before: null,
      },
    ]);
  });

  it('pastSessions_UnreadableArchiveFile_ListsNoneArchivedAndKeepsIt', async () => {
    const test = setUp();
    await test.data.write(ARCHIVED_SESSIONS_FILE, '{oops');

    const rows = await test.chat.pastSessions('/w/app', 'personal');

    expect(rows.map((row) => [row.hostSessionId, row.archived])).toEqual([
      [PAST_ONE.sessionId, false],
      [PAST_TWO.sessionId, false],
    ]);
    expect(test.logged).toContainEqual(
      expect.stringContaining(ARCHIVED_SESSIONS_FILE),
    );
    expect(await test.data.read(ARCHIVED_SESSIONS_FILE)).toBe('{oops');
  });

  it('pastSessions_AfterEnded_ListsItAgain', async () => {
    const test = setUp();
    await test.archived.set(PAST_ONE.sessionId, true);
    test.chat.recordOpenHostId(connected('row-9', PAST_TWO.sessionId));
    await test.chat.pastSessions('/w/app', 'personal');

    test.chat.sessionEnded('row-9');
    const rows = await test.chat.pastSessions('/w/app', 'personal');

    expect(rows.map((row) => row.hostSessionId)).toEqual([
      PAST_ONE.sessionId,
      PAST_TWO.sessionId,
    ]);
  });

  it.each([
    {
      entryPoint: 'pastSessions',
      call: (chat: ChatSessions) => chat.pastSessions('/w/app', 'home'),
    },
    {
      entryPoint: 'resume',
      call: (chat: ChatSessions) =>
        chat.resume({
          projectDir: '/w/app',
          profile: 'home',
          hostSessionId: PAST_ONE.sessionId,
          title: PAST_ONE.title,
        }),
    },
    {
      entryPoint: 'launch',
      call: (chat: ChatSessions) =>
        chat.launch({
          projectDir: PROJECT_DIR,
          profile: 'home',
          message: { text: 'fix the chip', images: [] },
        }),
    },
    {
      entryPoint: 'start',
      call: (chat: ChatSessions) =>
        chat.start({
          harness: FAKE_HARNESS_ID,
          projectDir: PROJECT_DIR,
          profile: 'home',
        }),
    },
  ])(
    '$entryPoint with an unknown profile refuses and calls nothing',
    async ({ call }) => {
      const test = setUp();

      await expect(async () => call(test.chat)).rejects.toThrow('"home"');
      expect(test.harness.pastSessionCalls).toEqual([]);
      expect(test.harness.processes).toEqual([]);
      expect(test.opened).toEqual([]);
    },
  );

  it('resume_OpensWithHistoryAndResumesTheProcess', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;

    const sessionId = await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });
    await flush();

    expect(sessionId).toBe(ROW_ID);
    expect(test.opened).toEqual([
      {
        sessionId: hostId,
        projectDir: '/w/app',
        harness: FAKE_HARNESS_ID,
        rowId: null,
        profileDir: '~/.claude',
      },
    ]);
    const [state] = test.sent('sessionStarted');
    expect(
      state.entries.map((entry) => [
        entry.id,
        'text' in entry ? entry.text : null,
      ]),
    ).toEqual([
      [`history:${hostId}-user`, 'fake earlier message'],
      [`history:${hostId}-assistant`, 'fake earlier reply'],
    ]);
    expect(state.commands).toEqual([]);
    expect(test.harness.processes.at(-1)?.request).toEqual({
      processId: `${hostId}-1-1000`,
      sessionId: hostId,
      resume: true,
      projectDir: '/w/app',
      profileDir: '~/.claude',
      controls: {},
      instructions: [],
      idleCompactMinTokens: null,
      rowId: ROW_ID,
    });
    expect(test.hostIdChanges).toEqual([]);
    expect(JSON.parse(await test.data.read(RECENT_FOLDERS_FILE))).toEqual([
      {
        projectDir: '/w/app',
        harness: FAKE_HARNESS_ID,
        profile: 'work',
        lastUsed: 1000,
      },
    ]);
  });

  it('resume_HistoryFails_NoticeAndStillResumes', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;
    test.harness.failNextHistory('cannot read');

    await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });

    expect(test.sent('sessionStarted')[0].entries).toEqual([
      {
        kind: 'notice',
        id: 'history:unread',
        at: 1000,
        text: 'Earlier conversation not read: cannot read',
        tone: 'error',
        raw: [],
      },
    ]);
    expect(test.logged).toContainEqual(
      expect.stringMatching(new RegExp(`${hostId}.*cannot read`)),
    );
    expect(test.harness.processes.at(-1)?.request.resume).toBe(true);
  });

  it.each([
    {
      given: 'saved usage',
      saved: fakeUsageEvent(2, 1500),
      emitted: [
        {
          sessionId: ROW_ID,
          profileDir: '~/.claude',
          hostSessionId: PAST_ONE.sessionId,
          event: fakeUsageEvent(2, 1500),
          replayed: false,
        },
      ],
    },
    { given: 'none saved', saved: null, emitted: [] },
  ])(
    'resume_SavedUsage_EmitsItAsTheNewRowsAgentEvent given $given',
    async ({ saved, emitted }) => {
      const test = setUp();
      const hostId = PAST_ONE.sessionId;
      test.harness.setLastUsage(hostId, saved);

      await test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: hostId,
        title: PAST_ONE.title,
      });

      expect(test.harness.lastUsageCalls).toEqual([hostId]);
      expect(usageEmitted(test.emitted)).toEqual(emitted);
    },
  );

  it('resume_SavedUsageReadFails_LogsAndStillResumes', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;
    test.harness.setLastUsage(hostId, fakeUsageEvent(2, 1500));
    test.harness.failNextLastUsage('transcript unreadable');

    const sessionId = await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });

    expect(sessionId).toBe(ROW_ID);
    expect(test.harness.processes.at(-1)?.request.resume).toBe(true);
    expect(test.logged).toContain(
      `saved usage of ${hostId} not read: transcript unreadable`,
    );
    expect(usageEmitted(test.emitted)).toEqual([]);
  });

  it.each([
    {
      given: 'its process running here',
      list: [{ ...HOSTED_PAST_ONE }],
      rejects: null,
      attaches: [HOSTED_PAST_ONE.id],
      startResumes: [],
    },
    {
      given: 'its process running in another app version',
      list: [{ ...HOSTED_PAST_ONE, current: false }],
      rejects:
        'This session is still finishing in another app version. Send again once it ends.',
      attaches: [],
      startResumes: [],
    },
    {
      given: 'its process ended',
      list: [{ ...HOSTED_PAST_ONE, running: false }],
      rejects: null,
      attaches: [],
      startResumes: [true],
    },
    {
      given: "another session's process running",
      list: [{ ...HOSTED_PAST_ONE, id: `${PAST_TWO.sessionId}-1-900` }],
      rejects: null,
      attaches: [],
      startResumes: [true],
    },
    {
      given: 'the list rejecting',
      list: null,
      rejects: 'no host',
      attaches: [],
      startResumes: [],
    },
  ])(
    'resume_ListsTheHostFirst given $given',
    async ({ list, rejects, attaches, startResumes }) => {
      const test = setUp({
        sessionHost: {
          list: () =>
            list === null
              ? Promise.reject(new Error('no host'))
              : Promise.resolve(list),
        },
      });
      test.harness.scriptAttach(HOSTED_PAST_ONE.id, {
        outcome: 'process',
        turns: 0,
        replay() {},
      });

      const resuming = test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: PAST_ONE.sessionId,
        title: PAST_ONE.title,
      });
      if (rejects === null) {
        await expect(resuming).resolves.toBe(ROW_ID);
      } else {
        await expect(resuming).rejects.toThrow(rejects);
      }
      await flush();

      expect(
        test.harness.attachCalls.map((request) => request.processId),
      ).toEqual(attaches);
      expect(test.harness.attachCalls.map((request) => request.rowId)).toEqual(
        attaches.map(() => ROW_ID),
      );
      expect(
        test.harness.processes
          .filter((process) => !process.attached)
          .map((process) => process.request.resume),
      ).toEqual(startResumes);
      expect(test.opened).toHaveLength(rejects === null ? 1 : 0);
      if (list === null) {
        expect(test.logged).toContain('session host not listed: no host');
      }
    },
  );

  it.each([
    {
      given: 'its process running here',
      list: [HOSTED_PAST_ONE],
      attaches: [HOSTED_PAST_ONE.id],
      starts: 0,
    },
    { given: 'no process running', list: [], attaches: [], starts: 1 },
  ])(
    'resume_TwiceDuringTheListsWait_OpensOneRow given $given',
    async ({ list, attaches, starts }) => {
      let releaseList = () => {};
      const listed = new Promise<HostedProcessInfo[]>((resolve) => {
        releaseList = () => resolve(list);
      });
      const test = setUp({ sessionHost: { list: () => listed } });
      test.harness.scriptAttach(HOSTED_PAST_ONE.id, {
        outcome: 'process',
        turns: 0,
        replay() {},
      });
      const request = {
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: PAST_ONE.sessionId,
        title: PAST_ONE.title,
      };

      const resuming = [test.chat.resume(request), test.chat.resume(request)];
      releaseList();

      await expect(Promise.all(resuming)).resolves.toEqual([ROW_ID, ROW_ID]);
      await flush();
      expect(test.opened).toHaveLength(1);
      expect(test.activated).toEqual([ROW_ID]);
      expect(
        test.harness.attachCalls.map((attach) => attach.processId),
      ).toEqual(attaches);
      expect(
        test.harness.processes.filter((process) => !process.attached),
      ).toHaveLength(starts);
    },
  );

  // Breaks if a resume finds the session's running process by its id's prefix
  // alone: a new row's process id starts with the row id.
  it('resume_ProcessStartedBeforeItsHostIdWasKnown_AttachesToIt', async () => {
    const test = await started();
    const { processId } = test.process.request;
    test.leave(FAKE_HARNESS_ID);
    test.chat.closed(ROW_ID, 'user');
    test.register(test.harness);
    test.sessionHost.setList([
      { id: processId, startedAt: 900, running: true, current: true },
    ]);
    test.harness.scriptAttach(processId, {
      outcome: 'process',
      turns: 0,
      replay() {},
    });

    await test.chat.resume({
      projectDir: PROJECT_DIR,
      profile: 'personal',
      hostSessionId: test.process.sessionId,
      title: 'a session',
    });
    await flush();

    expect(processId).toBe('row-1-1-1000');
    expect(test.harness.attachCalls.map((attach) => attach.processId)).toEqual([
      processId,
    ]);
    expect(startsOf(test)).toHaveLength(1);
  });

  it('resume_ProcessRunningHere_ReadsHistoryUpToItsStart', async () => {
    const test = setUp({
      sessionHost: { list: () => Promise.resolve([HOSTED_PAST_ONE]) },
    });
    test.harness.scriptAttach(HOSTED_PAST_ONE.id, {
      outcome: 'process',
      turns: 0,
      replay() {},
    });
    test.chat.restore(NOTHING_SAVED, []);

    await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: PAST_ONE.sessionId,
      title: PAST_ONE.title,
    });
    await test.chat.loadHistory(ROW_ID);

    expect(test.openOptions).toEqual([{ select: true }]);
    expect(
      test.harness.pastSessionCalls
        .filter((call) => call.method === 'history')
        .map((call) => call.before),
    ).toEqual([HOSTED_PAST_ONE.startedAt]);
    expect(test.saved.last()?.sessions[0].processId).toBe(HOSTED_PAST_ONE.id);
  });

  it.each([
    {
      given: 'history read, new process',
      hosted: [],
      instructionsOf: (test: ReturnType<typeof setUp>) =>
        test.harness.processes[0].request.instructions,
    },
    {
      given: 'process running here',
      hosted: [HOSTED_PAST_ONE],
      instructionsOf: (test: ReturnType<typeof setUp>) =>
        test.harness.attachCalls[0].instructions,
    },
  ])(
    'resume_OwnerAndInstructions_OpenUnselectedAndStartWithThem: $given',
    async ({ hosted, instructionsOf }) => {
      const test = setUp({
        sessionHost: { list: () => Promise.resolve(hosted) },
      });
      test.harness.scriptAttach(HOSTED_PAST_ONE.id, {
        outcome: 'process',
        turns: 0,
        replay() {},
      });
      test.chat.addInstructions('global note');

      await test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: PAST_ONE.sessionId,
        title: PAST_ONE.title,
        instructions: ['own note'],
        owner: 'practice',
      });
      await flush();

      expect(test.openOptions).toEqual([{ select: false, owner: 'practice' }]);
      expect(instructionsOf(test)).toEqual(['global note', 'own note']);
    },
  );

  it('resume_AlreadyOpen_Rejects', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;
    test.chat.recordOpenHostId(connected('row-9', hostId));

    await expect(
      test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: hostId,
        title: PAST_ONE.title,
      }),
    ).rejects.toThrow(hostId);
    expect(test.harness.pastSessionCalls).toEqual([]);
    expect(test.opened).toEqual([]);
  });

  it.each([
    { given: 'a relay row', secondOwner: undefined },
    { given: 'a chat row with an owner', secondOwner: 'practice' },
  ])(
    'pastSessions_OpenRows_ListsUnownedChatRowsOnly given $given',
    async ({ secondOwner }) => {
      const test = setUp();
      const held = [record(PAST_ONE.sessionId)];
      if (secondOwner !== undefined) {
        held.push(record(PAST_TWO.sessionId, { owner: secondOwner }));
      }
      test.chat.restore({ sessions: held, selectedHostSessionId: null }, []);
      test.chat.recordOpenHostId(connected(ROW_ID, PAST_ONE.sessionId));
      test.chat.recordOpenHostId(connected('row-two', PAST_TWO.sessionId));

      const rows = await test.chat.pastSessions('/w/app', 'work');

      expect(rows.map((row) => row.hostSessionId)).toEqual([
        PAST_ONE.sessionId,
      ]);
    },
  );

  it('resume_HostIdChatHolds_SelectsExistingRow', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;
    test.chat.restore(
      {
        sessions: [record(hostId)],
        selectedHostSessionId: null,
      },
      [],
    );
    test.chat.recordOpenHostId(connected(ROW_ID, hostId));

    const sessionId = await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });

    expect(sessionId).toBe(ROW_ID);
    expect(test.activated).toEqual([ROW_ID]);
    expect(test.opened).toHaveLength(1);
    expect(test.harness.processes).toEqual([]);
    expect(test.harness.pastSessionCalls).toEqual([]);
    expect(test.titleCalls).toEqual([]);
  });

  it('resume_HostIdChatHoldsOnARowWithTheRequestsOwner_ReturnsItWithoutActivating', async () => {
    const test = setUp();
    const launchedId = test.chat.launch({
      projectDir: '/w/app',
      profile: 'work',
      message: { text: 'go', images: [] },
      owner: 'practice',
    });
    await flush();

    const sessionId = await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: 'fake-session-1',
      title: 'go',
      owner: 'practice',
    });

    expect(sessionId).toBe(launchedId);
    expect(test.activated).toEqual([]);
  });

  it.each([
    {
      given: 'an owned row, no owner asked',
      rowOwner: { owner: 'practice' },
      asked: {},
      named: ['practice', 'no owner'],
    },
    {
      given: 'an unowned row, an owner asked',
      rowOwner: {},
      asked: { owner: 'practice' },
      named: ['no owner', 'practice'],
    },
    {
      given: 'another owner asked',
      rowOwner: { owner: 'practice' },
      asked: { owner: 'backlog' },
      named: ['practice', 'backlog'],
    },
  ])(
    'resume_HostIdChatHoldsForAnotherOwner_RejectsNamingBoth given $given',
    async ({ rowOwner, asked, named }) => {
      const test = setUp();
      test.chat.launch({
        projectDir: '/w/app',
        profile: 'work',
        message: { text: 'go', images: [] },
        ...rowOwner,
      });
      await flush();
      const openedBefore = test.opened.length;

      const resumed = test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: 'fake-session-1',
        title: 'go',
        instructions: ['own note'],
        ...asked,
      });

      await expect(resumed).rejects.toThrow(
        new RegExp(`fake-session-1.*${named[0]}.*${named[1]}`),
      );
      expect(test.activated).toEqual([]);
      expect(test.opened).toHaveLength(openedBefore);
    },
  );

  it('commands_StoredAndSentOnChange', async () => {
    const test = await started();

    const fakeCommand = {
      name: 'fake-command',
      description: 'A fake agent command',
      argumentHint: '',
      aliases: ['fake-alias'],
    };
    const commands = [
      { name: 'compact', description: 'd', argumentHint: '', aliases: [] },
      { name: 'model', description: '', argumentHint: 'm', aliases: ['mo'] },
    ];

    test.process.events.commands(commands);
    test.process.events.commands(structuredClone(commands));

    expect(test.sent('commands')).toEqual([
      { sessionId: ROW_ID, commands: [fakeCommand] },
      { sessionId: ROW_ID, commands },
    ]);
    expect(test.chat.sessions()[0].commands).toEqual(commands);
  });

  it.each<{ case: string; changed: Partial<AgentCommand> }>([
    { case: 'description', changed: { description: 'new' } },
    { case: 'argumentHint', changed: { argumentHint: 'new' } },
    { case: 'aliases', changed: { aliases: ['new'] } },
  ])('commands_SameNameNewDescription_Sent: $case', async ({ changed }) => {
    const test = await started();
    const command: AgentCommand = {
      name: 'compact',
      description: 'old',
      argumentHint: '',
      aliases: [],
    };
    test.process.events.commands([command]);
    const sentBefore = test.sent('commands').length;

    test.process.events.commands([{ ...command, ...changed }]);

    expect(test.sent('commands').slice(sentBefore)).toEqual([
      { sessionId: ROW_ID, commands: [{ ...command, ...changed }] },
    ]);
  });

  it('start_OpensSelected', () => {
    const test = setUp();

    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });

    expect(test.openOptions).toEqual([{ select: true }]);
  });

  it.each([
    { given: 'owner absent', owner: {}, options: { select: false } },
    {
      given: 'owner practice',
      owner: { owner: 'practice' },
      options: { select: false, owner: 'practice' },
    },
  ])(
    'launch_OpensUnselectedAndSendsFirstMessage: $given',
    async ({ owner, options }) => {
      const test = setUp();

      const sessionId = test.chat.launch({
        projectDir: PROJECT_DIR,
        profile: PROFILES[0].name,
        message: { text: 'fix the chip', images: [] },
        ...owner,
      });
      await flush();

      expect(sessionId).toBe(ROW_ID);
      expect(test.openOptions).toEqual([options]);
      expect(test.harness.processes[0].calls).toEqual([
        { method: 'send', text: 'fix the chip', imageCount: 0 },
      ]);
      expect(test.activated).toEqual([]);
    },
  );

  it('launch_ImageOverCap_RejectsAndOpensNothing', () => {
    const test = setUp();
    const oversized = {
      mediaType: 'image/png',
      data: 'a'.repeat(6 * 1024 * 1024),
    };

    expect(() =>
      test.chat.launch({
        projectDir: PROJECT_DIR,
        profile: PROFILES[0].name,
        message: { text: 'fix the chip', images: [oversized] },
      }),
    ).toThrow(/5 MB/);
    expect(test.opened).toEqual([]);
  });

  it('start_HarnessNotRegistered_ThrowsNamingItAndOpensNothing', () => {
    const test = setUp({ harnesses: [] });

    expect(() =>
      test.chat.start({
        projectDir: PROJECT_DIR,
        harness: 'claude',
        profile: 'work',
      }),
    ).toThrow('no agent harness "claude"');
    expect(test.opened).toEqual([]);
  });

  it('start_ProfileTheHarnessLacks_ThrowsAndOpensNothing', () => {
    const test = setUp();

    expect(() =>
      test.chat.start({
        projectDir: PROJECT_DIR,
        harness: FAKE_HARNESS_ID,
        profile: 'other',
      }),
    ).toThrow('other');
    expect(test.opened).toEqual([]);
  });

  it('resume_NoHarnessInTheRequest_RunsOnTheProfilesHarness', async () => {
    const fakeOf = (
      id: string,
      profiles: HarnessProfile[],
    ): FakeAgentHarness => {
      const fake = createFakeAgentHarness(
        { now: () => 1000 },
        createMemoryFiles(),
        FAKE_MICROTASK_TIMERS,
      );
      return { ...fake, id, info: () => ({ ...fake.info(), profiles }) };
    };
    const claude = fakeOf('claude', [{ name: 'work', configDir: '~/.claude' }]);
    const fake = fakeOf(FAKE_HARNESS_ID, [
      { name: 'spare', configDir: '~/.spare' },
    ]);
    const test = setUp({ harnesses: [claude, fake] });

    await test.chat.resume({
      projectDir: '/w/app',
      profile: 'spare',
      hostSessionId: PAST_ONE.sessionId,
      title: PAST_ONE.title,
    });
    await flush();

    expect(claude.processes).toEqual([]);
    expect(fake.processes).toHaveLength(1);
    expect(test.opened.map((info) => info.harness)).toEqual([FAKE_HARNESS_ID]);
  });

  // The sessions plugin selects a neighbouring row inside the failed row's
  // `end`, and that selection saves.
  it.each([
    { given: 'no other row', saved: [], rows: [] },
    {
      given: 'a held row the selection moves to',
      saved: [record('host-a')],
      rows: ['row-1'],
    },
  ])(
    'start_harnessThrows_endsTheOwnedSessionAndThrowsTheError given $given',
    ({ saved, rows }) => {
      const test = setUp();
      test.chat.restore({ sessions: saved, selectedHostSessionId: null }, []);
      test.setOnOwnedEnd(() => test.chat.selected(rows[0] ?? null));
      test.harness.failNextStart('spawn failed');

      expect(() =>
        test.chat.start({
          harness: FAKE_HARNESS_ID,
          projectDir: PROJECT_DIR,
          profile: 'work',
        }),
      ).toThrow('spawn failed');
      expect(test.ownedEnds()).toBe(1);
      expect(test.sent('sessionRested')).toEqual([]);
      expect(test.chat.sessions().map((state) => state.sessionId)).toEqual(
        rows,
      );
      expect(
        test.saved.last()?.sessions.map((kept) => kept.hostSessionId),
      ).toEqual(saved.map((kept) => kept.hostSessionId));
    },
  );

  it('entry_sameIdReplacesInPlace', async () => {
    const test = await started();

    test.process.events.entry(assistant('a', 'x'));
    test.process.events.entry(assistant('b', 'y'));
    test.process.events.entry(assistant('a', 'xy'));

    expect(test.chat.sessions()[0].entries).toEqual([
      assistant('a', 'xy'),
      assistant('b', 'y'),
    ]);
    const entries = test.sent('entry');
    expect(entries).toHaveLength(3);
    expect(entries[2]).toEqual({
      sessionId: ROW_ID,
      entry: assistant('a', 'xy'),
    });
  });

  it('entry_SecondProcessReusesAnId_HeldAfterTheExitNotice', async () => {
    const test = await started();
    test.chat.send(ROW_ID, { text: 'first', images: [] });
    await flush();
    test.process.events.ended({ code: 0, error: null });

    test.chat.send(ROW_ID, { text: 'second', images: [] });
    await flush();

    const userOrNotice = test.chat
      .sessions()[0]
      .entries.filter(
        (entry) => entry.kind === 'user' || entry.kind === 'notice',
      );
    expect(userOrNotice).toEqual([
      expect.objectContaining({ kind: 'user', text: 'first' }),
      expect.objectContaining({ kind: 'notice' }),
      expect.objectContaining({ kind: 'user', text: 'second' }),
    ]);
  });

  // The role each reported control declares, by id.
  const REPORTED_ROLES: Readonly<Record<string, string>> = {
    mode: 'permissionMode',
    approval: 'permissionMode',
    model: 'model',
    effort: 'effort',
  };

  // `opus` is the alias Claude's `claude-opus-5-5[1m]` shows as. A row whose
  // pick the process never confirms has its own reports dropped meanwhile.
  it.each([
    {
      case: 'ConfirmedPicksThroughLaterReports',
      picks: [
        ['model', 'fake-large'],
        ['effort', 'low'],
      ],
      confirms: true,
      clears: false,
      reported: { mode: 'auto', model: 'opus', effort: 'high' },
      controls: { mode: 'auto', model: 'fake-large', effort: 'low' },
    },
    {
      case: 'ConfirmedEffortDroppedByNullReport',
      picks: [['effort', 'high']],
      confirms: true,
      clears: false,
      reported: { mode: 'auto', model: 'opus', effort: null },
      later: { mode: 'auto', model: 'opus', effort: 'medium' },
      controls: { mode: 'auto' },
    },
    {
      case: 'ReportedOnly1mModelAndEffort',
      picks: [],
      confirms: true,
      clears: false,
      reported: { mode: 'auto', model: 'opus', effort: 'high' },
      controls: { mode: 'auto' },
    },
    {
      case: 'RefusedModelPick',
      picks: [['model', 'fake-large']],
      confirms: false,
      clears: false,
      reported: { mode: 'auto', model: 'opus', effort: 'high' },
      controls: { mode: 'auto' },
    },
    {
      case: 'ClearBeforeConfirmation',
      picks: [['model', 'fake-large']],
      confirms: true,
      clears: true,
      reported: { mode: 'auto', model: 'fake-large', effort: 'high' },
      controls: { mode: 'auto' },
    },
    {
      case: 'ModeClaudeEntered',
      picks: [],
      confirms: true,
      clears: false,
      reported: { mode: 'plan', model: 'opus', effort: 'high' },
      controls: { mode: 'plan' },
    },
    {
      case: 'ModeHeldByRoleNotId',
      picks: [],
      confirms: true,
      clears: false,
      reported: { approval: 'plan', model: 'opus', effort: 'high' },
      controls: { approval: 'plan' },
    },
  ])(
    'restart_StartCarriesHeldModeAndConfirmedPicks ($case)',
    async ({ picks, confirms, clears, reported, later, controls }) => {
      const test = await started();
      test.chat.send(ROW_ID, { text: 'first', images: [] });
      await flush();
      const reportControls = test.process.events.controls;
      if (!confirms) {
        test.process.events.controls = () => {};
      }
      for (const [id, value] of picks) {
        test.chat.setControl(ROW_ID, id, value);
      }
      if (clears) {
        test.chat.clear(ROW_ID);
      }
      await flush();
      test.process.events.controls = reportControls;
      const current = test.harness.processes[clears ? 1 : 0];
      for (const report of later === undefined
        ? [reported]
        : [reported, later]) {
        current.events.controls(
          Object.entries(report).map(([id, value]) => ({
            id,
            label: id,
            role: REPORTED_ROLES[id],
            choices: [],
            value,
          })),
        );
      }
      current.events.ended({ code: 0, error: null });

      test.chat.send(ROW_ID, { text: 'second', images: [] });
      await flush();

      expect(test.harness.processes.at(-1)?.request.controls).toEqual(controls);
    },
  );

  it('controls_storedAndSent', async () => {
    const test = await started();
    const controls: SessionControl[] = [
      {
        id: 'mode',
        label: 'Mode',
        choices: [{ value: 'auto', label: 'Auto' }],
        value: 'auto',
      },
    ];

    test.process.events.controls(controls);

    expect(test.sent('controls').at(-1)).toEqual({
      sessionId: ROW_ID,
      controls,
    });
    expect(test.chat.sessions()[0].controls).toEqual(controls);
  });

  it('turnFinished_focusedAndSelected_noMark', async () => {
    const test = await started();

    test.activity('working');
    test.activity('idle');

    expect(test.sent('activity')).toEqual([
      { sessionId: ROW_ID, activity: 'working' },
      { sessionId: ROW_ID, activity: 'idle' },
    ]);
    expect(test.marked).toEqual([]);
  });

  it('turnFinished_unfocused_marks', async () => {
    const test = await started();
    test.setFocused(false);

    test.activity('working');
    test.activity('idle');

    expect(test.marked).toEqual([ROW_ID]);
  });

  it.each([
    { label: null, text: 'Turn finished in app' },
    { label: 'gamma 2', text: 'Turn finished in gamma 2' },
  ])(
    'turn finished marks with the folder name when no label: $text',
    async ({ label, text }) => {
      const test = await started();
      if (label !== null) {
        test.rowLabels.set(ROW_ID, label);
      }
      test.setFocused(false);

      test.activity('working');
      test.activity('idle');

      expect(test.markOptions).toEqual([{ text, action: 'read it' }]);
    },
  );

  it.each([
    { given: 'unattended: true', flag: { unattended: true }, marks: 0 },
    { given: 'unattended absent', flag: {}, marks: 1 },
    { given: 'owner: practice', flag: { owner: 'practice' }, marks: 0 },
  ])(
    'turnFinished_LaunchedRow_MarksUnlessUnattendedOrOwned: $given → $marks marks',
    async ({ flag, marks }) => {
      const test = setUp();
      const sessionId = test.chat.launch({
        projectDir: PROJECT_DIR,
        profile: PROFILES[0].name,
        message: { text: 'go', images: [] },
        ...flag,
      });
      await flush();
      test.setFocused(false);
      const { events } = test.harness.processes[0];

      events.activity('working');
      events.activity('idle');

      expect(test.marked).toEqual(marks === 0 ? [] : [sessionId]);
    },
  );

  it('turnFinished_otherSessionSelected_marks', async () => {
    const test = await started();
    test.setSelected('row-other');

    test.activity('working');
    test.activity('idle');

    expect(test.marked).toEqual([ROW_ID]);
  });

  it('turnFinished_backgroundWorkRunning_noMarkUntilLastTurnEnds', async () => {
    const test = await started();
    test.setFocused(false);
    const { events } = test.process;

    test.activity('working');
    events.agentEvent({
      type: 'agentSpawned',
      at: 0,
      agentId: 'agent-1',
      parentAgentId: MAIN_AGENT_ID,
      agentType: 'general-purpose',
      description: 'review',
      name: 'review',
      model: null,
      effort: null,
    });
    events.agentEvent({
      type: 'taskStarted',
      at: 0,
      taskId: 'task-1',
      agentId: MAIN_AGENT_ID,
      description: 'build',
      command: 'npm run build',
    });
    test.activity('idle');

    expect(test.marked).toEqual([]);
    expect(test.chat.sessions()[0].background).toBe(2);

    events.agentEvent({
      type: 'agentFinished',
      at: 0,
      agentId: 'agent-1',
      outcome: 'done',
    });
    events.agentEvent({
      type: 'taskFinished',
      at: 0,
      taskId: 'task-1',
      outcome: 'done',
    });
    test.activity('working');
    test.activity('idle');

    expect(test.sent('background')).toEqual([
      { sessionId: ROW_ID, background: 1 },
      { sessionId: ROW_ID, background: 2 },
      { sessionId: ROW_ID, background: 1 },
      { sessionId: ROW_ID, background: 0 },
    ]);
    expect(test.marked).toEqual([ROW_ID]);
  });

  it('fileWritten_InWorktrees_ListsEachWorktreeOnceInWriteOrder', async () => {
    const test = await started();
    for (const [agentId, path] of [
      [MAIN_AGENT_ID, '/Users/u/dev/.worktrees/app-fix/src/a.ts'],
      [MAIN_AGENT_ID, '/Users/u/dev/app/src/b.ts'],
      ['subagent-1', '/Users/u/dev/.worktrees/docs-fix/README.md'],
      ['subagent-1', '/Users/u/dev/.worktrees/app-fix/src/c.ts'],
    ]) {
      test.process.events.agentEvent({
        type: 'fileWritten',
        at: 0,
        agentId,
        path,
      });
    }

    expect(test.chat.sessions()[0].worktrees).toEqual(['app-fix', 'docs-fix']);
  });

  it('agentEvent_ToolStarted_NotesItsAgentBeforeTheEmit', async () => {
    const test = await started();
    test.notesAndEmits.length = 0;

    test.process.events.agentEvent({
      type: 'toolStarted',
      at: 1000,
      agentId: 'subagent-1',
      toolUseId: 't1',
      tool: 'mcp__wigley-forms__set_workflow_step',
      summary: '',
    });

    expect(
      test.notesAndEmits.map((each) =>
        'noted' in each ? each.noted : each.emitted.event,
      ),
    ).toEqual([[ROW_ID, 't1', 'subagent-1'], 'agentEvent']);
  });

  it('bashEntry_NamesALinkedWorktreeRoot_ListsIt', async () => {
    const test = await started({ git: worktreesGit([FIX_ROOT]) });

    test.process.events.entry(
      toolEntry('a', 'Bash', { command: `ls ${FIX_ROOT}` }),
    );
    test.process.events.entry(
      toolEntry('b', 'Bash', { command: 'ls /repos/clone' }),
    );
    test.process.events.entry(
      toolEntry('c', 'Read', {
        file_path: `${FIX_ROOT}/src/a.ts`,
        command: `ls ${FIX_ROOT}/x`,
      }),
    );

    expect(test.chat.sessions()[0].worktrees).toEqual(['fix']);
  });

  it('bashEntry_NamesARootThroughTheFolderSymlink_ListsIt', async () => {
    const test = await started({
      git: worktreesGit(['/private/work/app-wt']),
      files: {
        realPath: (file) =>
          Promise.resolve(file.startsWith('/work') ? `/private${file}` : file),
      },
    });

    test.process.events.entry(
      toolEntry('a', 'Bash', { command: 'ls /work/app-wt' }),
    );

    expect(test.chat.sessions()[0].worktrees).toEqual(['app-wt']);
  });

  it.each([
    {
      case: 'InputNull_ListsNothing',
      entries: [toolEntry('a', 'Bash', null)],
      worktrees: [],
    },
    {
      case: 'CommandNotAString_ListsNothing',
      entries: [toolEntry('a', 'Bash', { command: 7 })],
      worktrees: [],
    },
    {
      case: 'PutTwice_ListsOnce',
      entries: [
        toolEntry('a', 'Bash', { command: `ls ${FIX_ROOT}` }),
        toolEntry(
          'a',
          'Bash',
          { command: `ls ${FIX_ROOT}` },
          {
            text: 'src',
            isError: false,
          },
        ),
      ],
      worktrees: ['fix'],
    },
  ])('bashEntry_$case', async ({ entries, worktrees }) => {
    const test = await started({ git: worktreesGit([FIX_ROOT]) });

    for (const entry of entries) {
      test.process.events.entry(entry);
    }

    expect(test.chat.sessions()[0].worktrees).toEqual(worktrees);
  });

  // `rootReads` counts the roots reads after the row's open read.
  it.each([
    {
      case: 'GitWorktreeAdd_ReadsAgain',
      command: 'git worktree add x',
      rootReads: 1,
    },
    {
      case: 'GitDashCWorktreeList_ReadsAgain',
      command: 'git -C /repos/clone worktree list',
      rootReads: 1,
    },
    {
      case: 'PathUnderDotWorktrees_ReadsNothing',
      command: `cd ${FIX_ROOT} && git status`,
      rootReads: 0,
    },
    {
      case: 'PathUnderClaudeWorktrees_ReadsNothing',
      command: 'ls /repos/clone/.claude/worktrees/b',
      rootReads: 0,
    },
  ])('bashEntryResult_$case', async ({ command, rootReads }) => {
    let reads = 0;
    const test = await started({
      git: {
        ...worktreesGit([FIX_ROOT]),
        worktrees: () => {
          reads += 1;
          return Promise.resolve(checkoutsOf([FIX_ROOT]));
        },
      },
    });
    const readsAtOpen = reads;

    test.process.events.entry(
      toolEntry('a', 'Bash', { command }, { text: '', isError: false }),
    );
    await flush();

    expect(reads - readsAtOpen).toBe(rootReads);
  });

  it('replay_BashEntries_StartNoRootsReadAndListOnceTheOpenReadLands', async () => {
    const rootReads: ((worktrees: GitWorktree[]) => void)[] = [];
    const test = setUp({
      git: {
        ...worktreesGit([]),
        worktrees: () =>
          new Promise((resolve) => {
            rootReads.push(resolve);
          }),
      },
    });
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      replay: (events) => {
        events.entry(
          toolEntry(
            'a',
            'Bash',
            { command: 'git worktree add /repos/.worktrees/late' },
            { text: '', isError: false },
          ),
        );
        events.entry(toolEntry('b', 'Bash', { command: `ls ${FIX_ROOT}` }));
      },
    });
    restoreOne(test, hostedRecord(), [hostedP1()]);
    await flush();

    expect(rootReads).toHaveLength(1);
    expect(test.chat.sessions()[0].worktrees).toEqual([]);
    rootReads[0](checkoutsOf([FIX_ROOT]));
    await flush();

    expect(test.chat.sessions()[0].worktrees).toEqual(['fix']);
  });

  it('replay_ToolStarted_NotesItsAgent', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      replay: (events) =>
        events.agentEvent({
          type: 'toolStarted',
          at: 1000,
          agentId: 'subagent-1',
          toolUseId: 't1',
          tool: 'mcp__wigley-forms__set_workflow_step',
          summary: '',
        }),
    });
    restoreOne(test, hostedRecord(), [hostedP1()]);
    await flush();

    expect(
      test.notesAndEmits.flatMap((each) =>
        'noted' in each ? [each.noted] : [],
      ),
    ).toEqual([[ROW_ID, 't1', 'subagent-1']]);
  });

  it('bashEntry_BeforeTheRootsRead_ListsOnceTheReadLands', async () => {
    let settleRead: (worktrees: GitWorktree[]) => void = () => undefined;
    const test = await started({
      git: {
        ...worktreesGit([]),
        worktrees: () =>
          new Promise((resolve) => {
            settleRead = resolve;
          }),
      },
    });

    test.process.events.entry(
      toolEntry('a', 'Bash', { command: `ls ${FIX_ROOT}` }),
    );
    expect(test.chat.sessions()[0].worktrees).toEqual([]);
    settleRead(checkoutsOf([FIX_ROOT]));
    await flush();

    expect(test.chat.sessions()[0].worktrees).toEqual(['fix']);
  });

  it('processExit_BackgroundWorkRunning_ClearsBackground', async () => {
    const test = await started();
    test.process.events.agentEvent({
      type: 'taskStarted',
      at: 0,
      taskId: 'task-1',
      agentId: MAIN_AGENT_ID,
      description: 'server',
      command: null,
    });

    test.process.events.ended({ code: 0, error: null });

    expect(test.sent('background').at(-1)).toEqual({
      sessionId: ROW_ID,
      background: 0,
    });
  });

  it('activity_unchanged_sendsNothing', async () => {
    const test = await started();
    test.setFocused(false);

    test.activity('idle');

    expect(test.sent('activity')).toEqual([]);
    expect(test.marked).toEqual([]);
  });

  it.each([
    { code: 0, error: null, tone: 'info', text: 'exit code 0' },
    { code: 1, error: 'boom', tone: 'error', text: '): boom' },
    { code: null, error: null, tone: 'error', text: 'exit code unknown' },
  ])(
    'processExit_RunningRow_RestsWithNotice (code $code, error $error)',
    async ({ code, error, tone, text }) => {
      const test = await started();
      test.process.events.entry(assistant('a1', 'hi'));

      test.process.events.ended({ code, error });
      test.process.events.entry(assistant('late', 'z'));

      expect(test.sent('sessionRested')).toEqual([
        { sessionId: ROW_ID, error },
      ]);
      expect(test.ownedEnds()).toBe(0);
      const [state] = test.chat.sessions();
      expect(state).toMatchObject({ sessionId: ROW_ID, running: false });
      expect(state.entries).toEqual([
        assistant('a1', 'hi'),
        expect.objectContaining({
          kind: 'notice',
          tone,
          text: expect.stringContaining(text),
        }),
      ]);
    },
  );

  it('ended_UncleanExit_NoticeNamesTheHarnessLabel', async () => {
    const test = await started();

    test.process.events.ended({ code: 3, error: 'boom' });

    expect(test.chat.sessions()[0].entries.at(-1)).toMatchObject({
      kind: 'notice',
      tone: 'error',
      text: `${test.harness.info().label} stopped (exit code 3): boom. Your next message resumes this session.`,
    });
  });

  it('processExit_WhileWorking_ShowsIdleAndAnnouncesNothing', async () => {
    const test = await started();
    test.setFocused(false);
    test.activity('working');

    test.process.events.ended({ code: 0, error: null });

    expect(test.sent('activity').at(-1)).toEqual({
      sessionId: ROW_ID,
      activity: 'idle',
    });
    expect(test.chat.sessions()).toMatchObject([
      { sessionId: ROW_ID, running: false, activity: 'idle' },
    ]);
    expect(test.marked).toEqual([]);
  });

  it('closed_RestingSession_EndsTheOwnedSessionAtOnce', async () => {
    const test = await started();
    test.process.events.ended({ code: 0, error: null });
    const callsBefore = test.process.calls.length;

    test.chat.closed(ROW_ID, 'user');

    expect(test.ownedEnds()).toBe(1);
    expect(test.chat.sessions()).toEqual([]);
    expect(test.process.calls).toHaveLength(callsBefore);
    expect(test.logged).toContainEqual(expect.stringContaining(ROW_ID));
  });

  it('restingSession_ProcessCallsIgnoredAndNoticesKept', async () => {
    const test = await started();
    test.process.events.ended({ code: 0, error: null });
    const entriesBefore = test.chat.sessions()[0].entries.length;

    test.chat.interrupt(ROW_ID);
    test.chat.answerPermission(ROW_ID, 'permission-1', {
      allowed: true,
      reason: null,
    });
    test.chat.notice(ROW_ID, 'note', 'info');

    expect(() => test.chat.setControl(ROW_ID, 'mode', 'plan')).toThrow(ROW_ID);
    expect(test.process.calls).toEqual([]);
    expect(test.chat.sessions()[0].entries).toHaveLength(entriesBefore + 1);
  });

  it('closed_endsTheProcessThenTheOwnedSession', async () => {
    const test = await started();
    test.harness.holdEnd();

    test.chat.closed(ROW_ID, 'user');
    test.process.events.entry(assistant('late', 'z'));

    expect(test.chat.sessions()).toEqual([]);
    expect(test.process.calls).toContainEqual({ method: 'end' });
    await flush();
    expect(test.ownedEnds()).toBe(0);
    test.harness.releaseEnd();
    await flush();
    expect(test.ownedEnds()).toBe(1);
    expect(test.sent('entry')).toEqual([]);
    expect(test.sent('sessionRested')).toEqual([]);
    expect(test.logged).toContainEqual(expect.stringContaining(ROW_ID));
  });

  it('detachAll_DetachesHeldProcesses_KillsAClosedRowsStillEnding', async () => {
    const test = await started();
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'work',
    });
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'work',
    });
    await flush();
    const [heldProcess, closedProcess, exitedProcess] = test.harness.processes;
    exitedProcess.events.ended({ code: 0, error: null });
    test.harness.holdEnd();
    test.chat.closed('row-2', 'user');

    test.chat.detachAll();
    const emittedBefore = test.emitted.length;
    closedProcess.events.agentEvent({ type: 'sessionEnded', at: 1000 });

    expect(heldProcess.calls).toEqual([{ method: 'detach' }]);
    expect(closedProcess.calls).toEqual([
      { method: 'end' },
      { method: 'kill' },
    ]);
    expect(exitedProcess.calls).toEqual([]);
    expect(test.emitted.length).toBe(emittedBefore);
  });

  it('lateEventsFromAnEarlierProcess_LeaveTheNewerOneRunning', async () => {
    const test = await started();
    const earlier = test.process.events;
    earlier.ended({ code: 0, error: null });
    test.chat.send(ROW_ID, { text: 'again', images: [] });
    await flush();
    const later = test.harness.processes[1];
    const entriesBefore = test.chat.sessions()[0].entries;

    earlier.entry(assistant('late', 'stale'));
    earlier.ended({ code: 1, error: 'late' });
    test.chat.detachAll();

    expect(test.chat.sessions()[0].running).toBe(true);
    expect(test.chat.sessions()[0].entries).toEqual(entriesBefore);
    expect(test.sent('sessionRested')).toHaveLength(1);
    expect(later.calls).toContainEqual({ method: 'detach' });
  });

  it('closed_processExitsWithAnError_endsTheOwnedSessionAndReportsNoEnd', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const failingExit: FakeAgentHarness = {
      ...fake,
      start: (request, events) => ({
        ...fake.start(request, events),
        end: () => {
          events.ended({ code: 1, error: 'stdin closed early' });
          return Promise.resolve();
        },
      }),
    };
    const test = setUp({ harnesses: [failingExit] });
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();

    test.chat.closed(ROW_ID, 'user');
    await flush();

    expect(test.ownedEnds()).toBe(1);
    expect(test.sent('sessionRested')).toEqual([]);
    expect(test.chat.sessions()).toEqual([]);
  });

  it('closed_processEndRejects_logsAndEndsTheOwnedSession', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const failingEnd: FakeAgentHarness = {
      ...fake,
      start: (request, events) => ({
        ...fake.start(request, events),
        end: () => Promise.reject(new Error('kill failed')),
      }),
    };
    const test = setUp({ harnesses: [failingEnd] });
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();

    test.chat.closed(ROW_ID, 'user');
    await flush();

    expect(test.logged).toContainEqual(
      expect.stringMatching(new RegExp(`${ROW_ID}.*kill failed`)),
    );
    expect(test.ownedEnds()).toBe(1);
    expect(test.chat.sessions()).toEqual([]);
  });

  it('closed_notOwned_doesNothing', async () => {
    const test = await started();
    const sentBefore = test.messages().length;

    test.chat.closed('row-x', 'user');
    await flush();

    expect(test.process.calls).toEqual([]);
    expect(test.messages()).toHaveLength(sentBefore);
  });

  it.each([
    { text: 'hi', images: [], imageCount: 0 },
    {
      text: 'look',
      images: [
        { mediaType: 'image/png', data: 'iVBORw0K' },
        { mediaType: 'image/jpeg', data: '/9j/4AAQ' },
      ],
      imageCount: 2,
    },
  ])(
    'process calls pass through, sending $imageCount images',
    async ({ text, images, imageCount }) => {
      const test = await started();

      test.chat.send(ROW_ID, { text, images });
      test.chat.interrupt(ROW_ID);
      test.chat.setControl(ROW_ID, 'mode', 'plan');

      expect(test.process.calls).toEqual([
        { method: 'send', text, imageCount },
        { method: 'interrupt' },
        { method: 'setControl', id: 'mode', value: 'plan' },
      ]);
    },
  );

  it('send_TurnRunning_QueuesWithoutWriting', async () => {
    const test = await started();

    const [first, second] = queueTwo(test);

    const queued = [
      expect.objectContaining(first),
      expect.objectContaining(second),
    ];
    expect(test.process.calls).toEqual([]);
    expect(test.sent('queued').at(-1)).toEqual({ sessionId: ROW_ID, queued });
    expect(test.chat.sessions()[0].queued).toEqual(queued);
  });

  it('send_HarnessIdleWithPermissionWaiting_WritesAtOnce', async () => {
    const test = await started();
    await askBash(test);
    const message: UserMessage = { text: 'go on', images: [] };

    test.chat.send(ROW_ID, message);

    expect(test.chat.sessions()[0].activity).toBe('waiting');
    expect(test.process.calls).toEqual([sendCall(message)]);
    expect(test.sent('queued')).toEqual([]);
  });

  it('activityIdle_Queued_WritesOneEachIdleAndMarksAfterTheLast', async () => {
    const test = await started();
    test.setFocused(false);
    const [first, second] = queueTwo(test);

    test.activity('idle');

    expect(test.process.calls).toEqual([sendCall(first)]);
    expect(test.sent('queued').at(-1)).toEqual({
      sessionId: ROW_ID,
      queued: [expect.objectContaining(second)],
    });

    test.activity('idle');

    expect(test.process.calls).toEqual([sendCall(first), sendCall(second)]);
    expect(test.sent('activity')).toEqual([
      { sessionId: ROW_ID, activity: 'working' },
    ]);
    expect(test.marked).toEqual([]);

    test.activity('idle');

    expect(test.sent('activity').at(-1)).toEqual({
      sessionId: ROW_ID,
      activity: 'idle',
    });
    expect(test.marked).toHaveLength(1);
  });

  it('pullBack_QueuedReturnsItAloneAndSentIsIgnored', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);
    const [firstId, secondId] = test.chat
      .sessions()[0]
      .queued.map((queued) => queued.id);

    test.chat.pullBack(ROW_ID, secondId);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [second] },
    ]);
    expect(test.sent('queued').at(-1)).toEqual({
      sessionId: ROW_ID,
      queued: [{ ...first, id: firstId, sentEntryId: null, holdReason: null }],
    });

    test.activity('idle');
    const sentBefore = test.messages().length;
    test.chat.pullBack(ROW_ID, firstId);

    expect(test.messages()).toHaveLength(sentBefore);
    expect(test.logged).toContain(`queued message ${firstId} no longer queued`);
  });

  it('interrupt_Queued_ReturnsAllThenInterrupts', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);

    test.chat.interrupt(ROW_ID);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [first, second] },
    ]);
    expect(test.sent('queued').at(-1)).toEqual({
      sessionId: ROW_ID,
      queued: [],
    });
    expect(test.process.calls).toEqual([{ method: 'interrupt' }]);
  });

  it.each([
    { order: 'ended alone', idleFirst: false },
    { order: 'idle after the process closed, then ended', idleFirst: true },
  ])(
    'processExit_Queued_ReturnsAllBeforeResting ($order)',
    async ({ idleFirst }) => {
      const test = await started();
      const [first, second] = queueTwo(test);

      if (idleFirst) {
        test.process.ended = true;
        test.activity('idle');
      }
      test.process.events.ended({ code: 0, error: null });

      expect(test.sentReturned()).toEqual([
        { sessionId: ROW_ID, messages: [first, second] },
      ]);
      const kinds = test.messages().map((sent) => sent.message);
      expect(kinds.indexOf('returned')).toBeLessThan(
        kinds.indexOf('sessionRested'),
      );
      expect(test.chat.sessions()[0].queued).toEqual([]);
      const again = { text: 'again', images: [] };
      await test.chat.send(ROW_ID, again);
      expect(test.harness.processes[1].calls).toEqual([sendCall(again)]);
    },
  );

  it('sendNow_HarnessWithoutMidTurnSend_WritesPlainly', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const plain: FakeAgentHarness = {
      ...fake,
      info: () => ({
        ...fake.info(),
        capabilities: { ...fake.info().capabilities, midTurnSend: false },
      }),
    };
    const test = setUp({ harnesses: [plain] });
    test.chat.start({
      projectDir: PROJECT_DIR,
      harness: FAKE_HARNESS_ID,
      profile: 'personal',
    });
    await flush();
    const process = fake.processes[0];
    const message: UserMessage = { text: 'first', images: [] };
    process.events.activity('working');
    test.chat.send(ROW_ID, message);

    test.chat.sendNow(ROW_ID, 'queued-1');

    expect(process.calls).toEqual([sendCall(message)]);
    expect(test.chat.sessions()[0].queued[0].sentEntryId).toEqual(
      expect.any(String),
    );
  });

  it('sendNow_NewerOfTwoRows_WritesItAndKeepsItMarkedSent', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);

    test.chat.sendNow(ROW_ID, 'queued-2');

    const queued = [
      { ...first, id: 'queued-1', sentEntryId: null, holdReason: null },
      {
        ...second,
        id: 'queued-2',
        sentEntryId: expect.any(String),
        holdReason: null,
      },
    ];
    expect(test.process.calls).toEqual([{ ...sendCall(second), now: true }]);
    expect(test.chat.sessions()[0].queued).toEqual(queued);
    expect(test.sent('queued').at(-1)).toEqual({ sessionId: ROW_ID, queued });
  });

  it.each([
    {
      case: 'an unknown id',
      queuedId: 'queued-9',
      arrange: () => {},
      reason: 'no longer queued',
    },
    {
      case: 'a row already sent now',
      queuedId: 'queued-1',
      arrange: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.sendNow(ROW_ID, 'queued-1'),
      reason: 'already sent',
    },
    {
      case: 'a row already written at an idle',
      queuedId: 'queued-1',
      arrange: (test: Awaited<ReturnType<typeof started>>) =>
        test.activity('idle'),
      reason: 'no longer queued',
    },
  ])('sendNow_NotQueued_LogsAndWritesNothing: $case', async (row) => {
    const test = await started();
    queueTwo(test);
    row.arrange(test);
    const callsBefore = test.process.calls.length;
    const sentBefore = test.messages().length;

    test.chat.sendNow(ROW_ID, row.queuedId);

    expect(test.process.calls).toHaveLength(callsBefore);
    expect(test.messages()).toHaveLength(sentBefore);
    expect(test.logged).toContain(
      `queued message ${row.queuedId} ${row.reason}`,
    );
  });

  it('sendNow_WriteThrows_RowStaysUnsent', async () => {
    const test = await started();
    queueTwo(test);
    test.process.ended = true;

    test.chat.sendNow(ROW_ID, 'queued-1');

    expect(
      test.chat.sessions()[0].queued.map((row) => row.sentEntryId),
    ).toEqual([null, null]);
    expect(test.logged).toContainEqual(
      expect.stringMatching(/queued message queued-1 not sent: .*ended/),
    );
  });

  it('entry_OfASentRow_DropsTheRowAndReturnsNothing', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);
    test.chat.sendNow(ROW_ID, 'queued-2');
    const entryId = sentEntryIdOf(test, 1);
    const queuedBefore = test.sent('queued').length;

    test.process.events.entry(userEntry(entryId, second.text));

    expect(test.sent('queued').slice(queuedBefore)).toEqual([
      {
        sessionId: ROW_ID,
        queued: [
          { ...first, id: 'queued-1', sentEntryId: null, holdReason: null },
        ],
      },
    ]);
    expect(test.sentReturned()).toEqual([]);
  });

  it.each([
    {
      case: 'a sent row',
      arrange: (test: Awaited<ReturnType<typeof started>>) => {
        const [first, second] = queueTwo(test);
        test.chat.sendNow(ROW_ID, 'queued-2');
        return {
          entryId: sentEntryIdOf(test, 1),
          message: second,
          sends: [
            {
              message: 'queued',
              data: {
                sessionId: ROW_ID,
                queued: [
                  {
                    ...first,
                    id: 'queued-1',
                    sentEntryId: null,
                    holdReason: null,
                  },
                ],
              },
            },
            {
              message: 'returned',
              data: {
                sessionId: ROW_ID,
                messages: [{ ...second, id: 'returned-1' }],
              },
            },
          ],
          log: `sent message ${sentEntryIdOf(test, 1)} returned: never taken in`,
        };
      },
    },
    {
      case: 'an idle send',
      arrange: (test: Awaited<ReturnType<typeof started>>) => {
        const message: UserMessage = { text: 'idle send', images: [] };
        test.chat.send(ROW_ID, message);
        return {
          entryId: 'user-1',
          message,
          sends: [
            {
              message: 'returned',
              data: {
                sessionId: ROW_ID,
                messages: [{ ...message, id: 'returned-1' }],
              },
            },
          ],
          log: 'sent message user-1 returned: never taken in',
        };
      },
    },
    {
      case: 'one written before a relaunch, which chat holds nothing for',
      arrange: () => {
        const message: UserMessage = { text: 'before the quit', images: [] };
        return {
          entryId: 'user-9',
          message,
          sends: [
            {
              message: 'returned',
              data: {
                sessionId: ROW_ID,
                messages: [{ ...message, id: 'returned-1' }],
              },
            },
          ],
          log: 'sent message user-9 returned: never taken in',
        };
      },
    },
  ])('messageDropped_ReturnsTheMessage: $case', async (row) => {
    const test = await started();
    const { entryId, message, sends, log } = row.arrange(test);
    const sentBefore = test.messages().length;

    test.process.events.messageDropped(entryId, message);

    expect(test.messages().slice(sentBefore)).toEqual(sends);
    expect(test.logged).toContain(log);
  });

  it('pullBack_SentRow_LogsAndSendsNothing', async () => {
    const test = await started();
    queueTwo(test);
    test.chat.sendNow(ROW_ID, 'queued-1');
    const sentBefore = test.messages().length;

    test.chat.pullBack(ROW_ID, 'queued-1');

    expect(test.messages()).toHaveLength(sentBefore);
    expect(test.logged).toContain('queued message queued-1 already sent');
  });

  it('interrupt_SentAndUnsentRows_ReturnsOnlyTheUnsent', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);
    test.chat.sendNow(ROW_ID, 'queued-1');

    test.chat.interrupt(ROW_ID);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [second] },
    ]);
    expect(test.chat.sessions()[0].queued).toEqual([
      {
        ...first,
        id: 'queued-1',
        sentEntryId: expect.any(String),
        holdReason: null,
      },
    ]);
  });

  it.each([
    { outcome: 'the write lands', writeRow: true },
    { outcome: 'the write throws', writeRow: false },
  ])(
    'activityIdle_SentRowAhead_WritesTheNextUnsent ($outcome)',
    async ({ writeRow }) => {
      const test = await started();
      const [first, second] = queueTwo(test);
      test.chat.sendNow(ROW_ID, 'queued-1');
      if (!writeRow) {
        test.process.ended = true;
      }

      test.activity('idle');

      expect(test.process.calls).toEqual([
        { ...sendCall(first), now: true },
        sendCall(second),
      ]);
      const sentRow = {
        ...first,
        id: 'queued-1',
        sentEntryId: expect.any(String),
        holdReason: null,
      };
      const unsentRow = {
        ...second,
        id: 'queued-2',
        sentEntryId: null,
        holdReason: null,
      };
      expect(test.chat.sessions()[0].queued).toEqual(
        writeRow ? [sentRow] : [sentRow, unsentRow],
      );
    },
  );

  it.each([
    {
      given: 'an idle send, then a sent row',
      hold: (test: Awaited<ReturnType<typeof started>>) => {
        test.chat.send(ROW_ID, IDLE_SEND);
        test.activity('working');
        test.chat.send(ROW_ID, PENDING);
        test.chat.sendNow(ROW_ID, 'queued-1');
        return [IDLE_SEND, PENDING];
      },
    },
    {
      given: 'an idle send and an empty queue',
      hold: (test: Awaited<ReturnType<typeof started>>) => {
        test.chat.send(ROW_ID, IDLE_SEND);
        return [IDLE_SEND];
      },
    },
    {
      given: 'a sent row older than the row the idle wrote',
      hold: (test: Awaited<ReturnType<typeof started>>) => {
        const [first, second] = queueTwo(test);
        test.chat.sendNow(ROW_ID, 'queued-1');
        test.activity('idle');
        return [first, second];
      },
    },
  ])(
    'processExit_WrittenMessagesAndRows_ReturnedInWriteOrder ($given)',
    async ({ hold }) => {
      const test = await started();
      const held = hold(test);

      test.process.events.ended({ code: 0, error: null });

      expect(test.sentReturned()).toEqual([
        { sessionId: ROW_ID, messages: held },
      ]);
      expect(test.chat.sessions()[0].queued).toEqual([]);
    },
  );

  it.each([
    {
      case: 'at an idle with a message',
      running: false,
      rows: [],
      box: true,
      written: ['box'],
      queuedRows: [],
      queueWrites: 0,
      log: null,
    },
    {
      case: 'mid-turn with two rows and a message',
      running: true,
      rows: ['first', 'second'],
      box: true,
      written: ['first', 'second', 'box'],
      queuedRows: [
        ['first', true],
        ['second', true],
        ['box', true],
      ],
      queueWrites: 4,
      log: null,
    },
    {
      case: 'mid-turn with a null message',
      running: true,
      rows: ['first', 'second'],
      box: false,
      written: ['first', 'second'],
      queuedRows: [
        ['first', true],
        ['second', true],
      ],
      queueWrites: 2,
      log: null,
    },
    {
      case: 'mid-turn with nothing unsent and a null message',
      running: true,
      rows: [],
      box: false,
      written: [],
      queuedRows: [],
      queueWrites: 0,
      log: /nothing to send now in row-1/,
    },
    {
      case: 'mid-turn with the second write throwing',
      running: true,
      rows: ['first', REFUSED_TEXT],
      box: true,
      written: ['first'],
      queuedRows: [
        ['first', true],
        [REFUSED_TEXT, false],
        ['box', false],
      ],
      queueWrites: 2,
      log: /queued message queued-2 not sent: write refused/,
    },
  ])('sendAllNow_WritesInTheOrderWritten: $case', async (row) => {
    const test = await startedRefusing();
    if (row.running) {
      test.activity('working');
    }
    for (const text of row.rows) {
      test.chat.send(ROW_ID, { text, images: [] });
    }
    const queuedBefore = test.sent('queued').length;
    const box: UserMessage | null = row.box
      ? { text: 'box', images: [] }
      : null;

    void test.chat.sendAllNow(ROW_ID, box);

    const written = test.process.calls.flatMap((call) =>
      call.method === 'send' ? [call.text] : [],
    );
    const queuedRows = test.chat
      .sessions()[0]
      .queued.map((queued) => [queued.text, queued.sentEntryId !== null]);
    expect(written).toEqual(row.written);
    expect(queuedRows).toEqual(row.queuedRows);
    expect(test.sent('queued').length - queuedBefore).toBe(row.queueWrites);
    if (row.log !== null) {
      expect(test.logged).toContainEqual(expect.stringMatching(row.log));
    }
  });

  it('notice_AddsEntryKeptBySessions', async () => {
    const test = await started();

    test.chat.notice(ROW_ID, 'Signed out of work', 'info');
    test.chat.notice(ROW_ID, 'Status not read', 'error');

    const notices: ChatEntry[] = [
      {
        kind: 'notice',
        id: 'app-notice-1',
        at: 1000,
        text: 'Signed out of work',
        tone: 'info',
        raw: [],
      },
      {
        kind: 'notice',
        id: 'app-notice-2',
        at: 1000,
        text: 'Status not read',
        tone: 'error',
        raw: [],
      },
    ];
    expect(test.chat.sessions()[0].entries).toEqual(notices);
    expect(test.sent('entry')).toEqual(
      notices.map((entry) => ({ sessionId: ROW_ID, entry })),
    );
  });

  it('unknownSession_ignored', async () => {
    const test = await started();
    const sentBefore = test.messages().length;

    test.chat.send('row-x', { text: 'hi', images: [] });
    test.chat.notice('row-x', 'note', 'info');
    test.chat.interrupt('row-x');
    test.chat.answerPermission('row-x', 'permission-1', {
      allowed: true,
      reason: null,
    });

    expect(test.process.calls).toEqual([]);
    expect(test.messages()).toHaveLength(sentBefore);
  });

  it('setControl_unknownSession_throwsAndSetsNothing', async () => {
    const test = await started();

    expect(() => test.chat.setControl('row-x', 'mode', 'plan')).toThrow(
      'row-x',
    );
    expect(test.process.calls).toEqual([]);
  });

  it('permission_callAddsAWaitingEntry', async () => {
    const test = await started();
    test.activity('working');

    const decision = await askBash(test);

    expect(test.sent('entry')).toEqual([
      {
        sessionId: ROW_ID,
        entry: {
          kind: 'permission',
          id: 'fake-permission-1',
          at: 1000,
          toolName: 'Bash',
          input: { command: 'ls' },
          answer: null,
          raw: [{ fake: 'permission', toolUseId: 'tu-1' }],
        },
      },
    ]);
    expect(test.sent('activity').at(-1)).toEqual({
      sessionId: ROW_ID,
      activity: 'waiting',
    });
    expect(decision()).toBe('pending');
  });

  it.each<{
    given: string;
    flag: { unattended?: boolean };
    decision: PermissionDecision | 'pending';
    answers: PermissionDecision[];
    sentByPrompt: string[];
  }>([
    {
      given: 'unattended: true',
      flag: { unattended: true },
      decision: { allowed: false, reason: UNATTENDED_REASON },
      answers: [{ allowed: false, reason: UNATTENDED_REASON }],
      sentByPrompt: [],
    },
    {
      given: 'unattended absent',
      flag: {},
      decision: 'pending',
      answers: [],
      sentByPrompt: ['waiting'],
    },
  ])(
    'permission_LaunchedRow_AnswersByUnattended: $given',
    async ({ flag, decision, answers, sentByPrompt }) => {
      const test = setUp();
      test.chat.launch({
        projectDir: PROJECT_DIR,
        profile: PROFILES[0].name,
        message: { text: 'go', images: [] },
        ...flag,
      });
      await flush();
      const process = test.harness.processes[0];
      process.events.activity('working');
      const activitiesBefore = test.sent('activity').length;

      const settled = await askBash(test);

      expect(settled()).toEqual(decision);
      expect(permissionAnswers(process).map((call) => call.decision)).toEqual(
        answers,
      );
      expect(
        test.sent('entry').filter((sent) => sent.entry.kind === 'permission'),
      ).toEqual(
        answers.map((answer) => ({
          sessionId: ROW_ID,
          entry: expect.objectContaining({ answer }),
        })),
      );
      expect(
        test
          .sent('activity')
          .slice(activitiesBefore)
          .map((sent) => sent.activity),
      ).toEqual(sentByPrompt);
    },
  );

  it('permission_allow_repliesWithTheInput', async () => {
    const test = await started();
    test.activity('working');
    const decision = await askBash(test);

    test.chat.answerPermission(ROW_ID, 'fake-permission-1', {
      allowed: true,
      reason: null,
    });
    await flush();

    expect(permissionAnswers(test.process)).toEqual([
      {
        method: 'answerPermission',
        requestId: 'fake-permission-1',
        decision: { allowed: true, reason: null },
      },
    ]);
    expect(decision()).toEqual({ allowed: true, reason: null });
    expect(test.sent('entry').at(-1)?.entry).toMatchObject({
      id: 'fake-permission-1',
      answer: { allowed: true, reason: null },
    });
    expect(test.sent('activity').at(-1)).toEqual({
      sessionId: ROW_ID,
      activity: 'working',
    });
  });

  it('permission_deny_defaultAndReason', async () => {
    const test = await started();
    await askBash(test);
    await askBash(test);

    test.chat.answerPermission(ROW_ID, 'fake-permission-1', {
      allowed: false,
      reason: null,
    });
    test.chat.answerPermission(ROW_ID, 'fake-permission-2', {
      allowed: false,
      reason: 'use rg',
    });

    expect(
      permissionAnswers(test.process).map(({ requestId, decision }) => ({
        requestId,
        decision,
      })),
    ).toEqual([
      {
        requestId: 'fake-permission-1',
        decision: { allowed: false, reason: null },
      },
      {
        requestId: 'fake-permission-2',
        decision: { allowed: false, reason: 'use rg' },
      },
    ]);
  });

  it('permission_twoPending_staysWaiting', async () => {
    const test = await started();
    await askBash(test);
    await askBash(test);
    const activitiesBefore = test.sent('activity').length;

    test.chat.answerPermission(ROW_ID, 'fake-permission-1', {
      allowed: true,
      reason: null,
    });
    await flush();

    expect(test.sent('activity')).toHaveLength(activitiesBefore);
    expect(test.chat.sessions()[0].activity).toBe('waiting');
  });

  it('permission_sessionEnds_answersCancelledAndShowsIt', async () => {
    const test = await started();
    const decision = await askBash(test);

    await test.chat.send(ROW_ID, { text: FAKE_END_TEXT, images: [] });
    await flush();

    expect(decision()).toEqual({
      allowed: false,
      reason: FAKE_CANCELLED_REASON,
    });
    expect(test.chat.sessions()[0].entries).toContainEqual(
      expect.objectContaining({
        id: 'fake-permission-1',
        answer: { allowed: false, reason: FAKE_CANCELLED_REASON },
      }),
    );
    expect(test.chat.sessions()[0].activity).not.toBe('waiting');
  });

  it('permission_rowCloses_answersCancelledWithNoEntry', async () => {
    const test = await started();
    const decision = await askBash(test);
    const entriesBefore = test.sent('entry').length;

    test.chat.closed(ROW_ID, 'user');
    await flush();

    expect(decision()).toEqual({
      allowed: false,
      reason: FAKE_CANCELLED_REASON,
    });
    expect(test.sent('entry')).toHaveLength(entriesBefore);
    expect(permissionAnswers(test.process)).toEqual([]);
  });

  it('permission_unknownEntry_ignored', async () => {
    const test = await started();
    const decision = await askBash(test);

    test.chat.answerPermission(ROW_ID, 'fake-permission-9', {
      allowed: true,
      reason: null,
    });
    await flush();

    expect(decision()).toBe('pending');
    expect(permissionAnswers(test.process)).toEqual([]);
    expect(test.logged).toContain(
      'answerPermission for unknown entry fake-permission-9 ignored',
    );
  });

  it('permission_AnswerForAnOldProcess_Ignored', async () => {
    const test = await started();
    test.activity('working');
    await askBash(test);
    test.chat.clear(ROW_ID);
    await flush();

    test.chat.answerPermission(ROW_ID, 'fake-permission-1', {
      allowed: true,
      reason: null,
    });
    await flush();

    expect(
      test.harness.processes.flatMap((process) => permissionAnswers(process)),
    ).toEqual([]);
    expect(test.logged).toContain(
      'answerPermission for unknown entry fake-permission-1 ignored',
    );
  });
});

describe('createChatSessions saved sessions', () => {
  it('restore_SavedSnapshot_OpensRestingRowsInOrderUnderSavedRowIds', () => {
    const test = setUp();

    test.chat.restore(
      {
        sessions: [
          record('host-a'),
          record('host-b', { rowId: 'kept-row' }),
          record('host-c'),
        ],
        selectedHostSessionId: 'host-b',
      },
      [],
    );

    expect(test.opened.map((info) => info.sessionId)).toEqual([
      'host-a',
      'host-b',
      'host-c',
    ]);
    expect(test.openOptions).toEqual([
      { select: false },
      { select: false, rowId: 'kept-row' },
      { select: false },
    ]);
    expect(test.activated).toEqual(['kept-row']);
    expect(test.chat.sessions().map((state) => state.running)).toEqual([
      false,
      false,
      false,
    ]);
    expect(test.harness.processes).toEqual([]);
    expect(test.harness.pastSessionCalls).toEqual([]);
  });

  it('createChatSessions_KeysAnEarlierRunLeft_DroppedUntilARestoredRowTakesOneBack', () => {
    const test = setUp({ keptRowIds: ['kept-row', 'stale-row'] });
    const keys = () => [
      ...test.store.read(chatSessionSlot, 'test').all().keys(),
    ];
    const afterCreate = keys();

    test.chat.restore(
      {
        sessions: [record('host-b', { rowId: 'kept-row' })],
        selectedHostSessionId: null,
      },
      [],
    );

    expect(afterCreate).toEqual([]);
    expect(keys()).toEqual(['kept-row']);
  });

  it('restore_SavedRowIdHeldByAnotherSession_OpensOnANewRow', () => {
    const test = setUp();
    test.holdRowId('kept-row');

    test.chat.restore(
      {
        sessions: [record('host-b', { rowId: 'kept-row' })],
        selectedHostSessionId: null,
      },
      [],
    );

    expect(test.openOptions).toEqual([{ select: false }]);
    expect(test.chat.sessions().map((state) => state.sessionId)).toEqual([
      'row-1',
    ]);
    expect(test.logged).toContain(
      'session host-b restored on a new row: row kept-row is held',
    );
  });

  it.each([
    {
      given: 'a host id chat holds',
      arrange: async (test: ReturnType<typeof setUp>) => {
        test.chat.start({
          harness: FAKE_HARNESS_ID,
          projectDir: PROJECT_DIR,
          profile: 'personal',
        });
        await flush();
      },
      saved: ['host-a', 'fake-session-1', 'host-b'],
      opened: [null, 'host-a', 'host-b'],
      logged: 'session fake-session-1 already open; not restored',
    },
    {
      given: 'a host id open on a relay row',
      arrange: (test: ReturnType<typeof setUp>) =>
        test.chat.recordOpenHostId(connected('row-relay', 'host-r')),
      saved: ['host-a', 'host-r', 'host-b'],
      opened: ['host-a', 'host-b'],
      logged: 'session host-r already open; not restored',
    },
    {
      given: 'an open that throws',
      arrange: (test: ReturnType<typeof setUp>) => test.refuseOpen('host-x'),
      saved: ['host-a', 'host-x', 'host-b'],
      opened: ['host-a', 'host-b'],
      logged: 'session host-x not restored: open of host-x refused',
    },
    {
      given: 'a restore after detachAll',
      arrange: (test: ReturnType<typeof setUp>) => test.chat.detachAll(),
      saved: ['host-a', 'host-b'],
      opened: [],
      logged: 'open sessions not restored: chat is stopping',
    },
  ])(
    'restore_RecordNotOpenable_SkippedAndLogged given $given',
    async ({ arrange, saved, opened, logged }) => {
      const test = setUp();
      await arrange(test);

      test.chat.restore(
        {
          sessions: saved.map((hostId) => record(hostId)),
          selectedHostSessionId: null,
        },
        [],
      );

      expect(test.opened.map((info) => info.sessionId)).toEqual(opened);
      expect(test.logged).toContain(logged);
    },
  );

  it.each([
    {
      given: 'a turn running at quit',
      saved: record('host-a', { busy: true }),
      entries: [{ kind: 'notice', tone: 'info' }],
    },
    {
      given: 'a profile missing from settings',
      saved: record('host-a', { profile: 'gone' }),
      entries: [
        {
          kind: 'notice',
          tone: 'error',
          text: expect.stringContaining('gone'),
        },
      ],
    },
    {
      given: 'a harness not registered',
      saved: record('host-a', { harness: 'gone' }),
      entries: [
        {
          kind: 'notice',
          tone: 'info',
          text: 'gone is not loaded. This session waits for it to load again.',
        },
      ],
    },
    { given: 'neither', saved: record('host-a'), entries: [] },
  ])('restore_RecordFlags_AddNotices given $given', ({ saved, entries }) => {
    const test = setUp();

    test.chat.restore({ sessions: [saved], selectedHostSessionId: null }, []);

    expect(test.chat.sessions()[0].entries).toEqual(
      entries.map((entry) => expect.objectContaining(entry)),
    );
  });

  it('restore_HarnessNotRegistered_WaitsAndAttachesWhenItRegisters', async () => {
    const test = setUp();
    const gone = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
      { id: 'gone', label: 'Gone', profiles: PROFILES },
    );
    gone.scriptAttach('p1', { outcome: 'process', replay() {} });
    test.sessionHost.setList([hostedP1()]);

    restoreOne(test, hostedRecord({ harness: 'gone' }), [hostedP1()]);

    expect(test.chat.sessions()[0].running).toBe(false);
    expect(noticesOf(test).at(-1)).toEqual({
      kind: 'notice',
      tone: 'info',
      text: 'gone is not loaded. This session waits for it to load again.',
    });

    test.register(gone);
    await test.chat.harnessReturned('gone');
    await flush();

    expect(gone.attachCalls.map((attach) => attach.processId)).toEqual(['p1']);
    expect(test.chat.sessions()[0].running).toBe(true);
    expect(test.harness.attachCalls).toEqual([]);
  });

  it.each([
    {
      given: 'a sent session with saved usage',
      sent: true,
      profile: 'work',
      saved: fakeUsageEvent(2, 1500),
      calls: ['host-a'],
      emitted: [
        {
          sessionId: ROW_ID,
          profileDir: '~/.claude',
          hostSessionId: 'host-a',
          event: fakeUsageEvent(2, 1500),
          replayed: false,
        },
      ],
    },
    {
      given: 'a sent session with none saved',
      sent: true,
      profile: 'work',
      saved: null,
      calls: ['host-a'],
      emitted: [],
    },
    {
      given: 'an unsent session',
      sent: false,
      profile: 'work',
      saved: fakeUsageEvent(2, 1500),
      calls: [],
      emitted: [],
    },
    {
      given: 'a sent session whose profile is missing',
      sent: true,
      profile: 'gone',
      saved: fakeUsageEvent(2, 1500),
      calls: [],
      emitted: [],
    },
  ])(
    'restore_SavedUsage_EmitsItAsTheRowsAgentEvent given $given',
    async ({ sent, profile, saved, calls, emitted }) => {
      const test = setUp();
      test.harness.setLastUsage('host-a', saved);

      test.chat.restore(
        {
          sessions: [record('host-a', { sent, profile })],
          selectedHostSessionId: null,
        },
        [],
      );
      await flush();

      expect(test.harness.lastUsageCalls).toEqual(calls);
      expect(usageEmitted(test.emitted)).toEqual(emitted);
    },
  );

  it.each([
    {
      given: 'the row closed',
      act: (test: ReturnType<typeof setUp>) => test.chat.closed(ROW_ID, 'user'),
    },
    {
      given: 'the row cleared',
      act: (test: ReturnType<typeof setUp>) => test.chat.clear(ROW_ID),
    },
    {
      given: 'chat stopped',
      act: (test: ReturnType<typeof setUp>) => test.chat.detachAll(),
    },
  ])(
    'restore_SavedUsageReadAfterRowGone_EmitsNothing given $given',
    async ({ act }) => {
      const test = setUp();
      test.harness.setLastUsage('host-a', fakeUsageEvent(2, 1500));
      const release = test.harness.holdNextLastUsage();
      test.chat.restore(
        {
          sessions: [record('host-a', { sent: true })],
          selectedHostSessionId: null,
        },
        [],
      );

      act(test);
      release();
      await flush();

      expect(test.harness.lastUsageCalls).toEqual(['host-a']);
      expect(usageEmitted(test.emitted)).toEqual([]);
    },
  );

  it('restore_SavedUsageReadFails_LogsAndEmitsNothing', async () => {
    const test = setUp();
    test.harness.setLastUsage('host-a', fakeUsageEvent(2, 1500));
    test.harness.failNextLastUsage('transcript unreadable');

    test.chat.restore(
      {
        sessions: [record('host-a', { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );
    await flush();

    expect(test.logged).toContain(
      'saved usage of host-a not read: transcript unreadable',
    );
    expect(usageEmitted(test.emitted)).toEqual([]);
  });

  it.each([{ sent: true }, { sent: false }])(
    'send_RestingRow_StartsProcessWithResumeFromSent (sent $sent)',
    async ({ sent }) => {
      const test = setUp();
      const hostId = PAST_ONE.sessionId;
      test.chat.restore(
        {
          sessions: [record(hostId, { sent, busy: true })],
          selectedHostSessionId: null,
        },
        [],
      );
      expect(test.harness.processes).toEqual([]);

      await test.chat.send(ROW_ID, { text: 'hi', images: [] });

      expect(test.harness.processes.map((process) => process.request)).toEqual([
        {
          processId: `${hostId}-1-1000`,
          sessionId: hostId,
          resume: sent,
          projectDir: '/w/app',
          profileDir: '~/.claude',
          controls: {},
          instructions: [],
          idleCompactMinTokens: null,
          rowId: ROW_ID,
        },
      ]);
      expect(test.sent('sessionRunning')).toEqual([{ sessionId: ROW_ID }]);
      expect(test.harness.processes[0].calls).toEqual([
        { method: 'send', text: 'hi', imageCount: 0 },
      ]);
      expect(test.logged).toContain(
        `session ${ROW_ID} process started (resume ${sent})`,
      );
    },
  );

  it.each([
    {
      given: 'a new session then a send',
      act: (chat: ChatSessions) => {
        chat.start({
          harness: FAKE_HARNESS_ID,
          projectDir: PROJECT_DIR,
          profile: 'personal',
        });
        chat.send(ROW_ID, { text: 'hi', images: [] });
      },
      sent: true,
    },
    {
      given: 'a launch',
      act: (chat: ChatSessions) =>
        chat.launch({
          projectDir: PROJECT_DIR,
          profile: 'personal',
          message: { text: 'hi', images: [] },
        }),
      sent: true,
    },
    {
      given: 'a new session with no send',
      act: (chat: ChatSessions) =>
        chat.start({
          harness: FAKE_HARNESS_ID,
          projectDir: PROJECT_DIR,
          profile: 'personal',
        }),
      sent: false,
    },
  ])('send_NewSession_SavesSentTrue given $given', async ({ act, sent }) => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);

    act(test.chat);
    await flush();

    expect(test.saved.last()?.sessions).toEqual([
      {
        hostSessionId: 'fake-session-1',
        projectDir: PROJECT_DIR,
        harness: FAKE_HARNESS_ID,
        profile: 'personal',
        sent,
        busy: false,
        titles: { ...NO_TITLES, firstMessage: sent ? 'hi' : null },
        processId: 'row-1-1-1000',
        queued: [],
        returned: [],
        launchControls: {},
        launchResume: false,
        launchHeadless: false,
        controls: test.chat.sessions()[0].controls,
        confirmedPicks: {},
        returnedDrops: [],
        activeMs: 0,
        rowId: ROW_ID,
        unattended: false,
        headless: false,
        instructions: [],
        owner: null,
      },
    ]);
  });

  it.each([
    { given: 'as launched', clear: false },
    { given: 'after a clear', clear: true },
  ])(
    'save_LaunchedRow_RecordKeepsItsLaunchFlags: $given',
    async ({ clear }) => {
      const test = setUp();
      test.chat.restore(NOTHING_SAVED, []);

      const launchedId = test.chat.launch({
        projectDir: PROJECT_DIR,
        profile: 'personal',
        message: { text: 'go', images: [] },
        unattended: true,
        instructions: ['own note'],
        owner: 'practice',
      });
      test.chat.start({
        harness: FAKE_HARNESS_ID,
        projectDir: PROJECT_DIR,
        profile: 'personal',
      });
      await flush();
      if (clear) {
        test.chat.clear(launchedId);
        await flush();
      }

      expect(
        test.saved
          .last()
          ?.sessions.map(({ unattended, instructions, owner }) => ({
            unattended,
            instructions,
            owner,
          })),
      ).toEqual([
        { unattended: true, instructions: ['own note'], owner: 'practice' },
        { unattended: false, instructions: [], owner: null },
      ]);
    },
  );

  it.each([{ headless: true }, { headless: false }])(
    'setHeadless_HeldRow_PublishesAndSaves: $headless',
    async ({ headless }) => {
      const test = await started();
      test.chat.restore(NOTHING_SAVED, []);
      test.chat.setHeadless(ROW_ID, !headless);

      test.chat.setHeadless(ROW_ID, headless);

      expect(test.chat.isHeadless(ROW_ID)).toBe(headless);
      expect(test.chat.sessions()[0].headless).toBe(headless);
      expect(test.saved.last()?.sessions[0].headless).toBe(headless);
    },
  );

  it('setHeadless_UnknownRow_LogsAndChangesNothing', async () => {
    const test = await started();
    test.chat.restore(NOTHING_SAVED, []);
    const savesBefore = test.saved.saves();

    test.chat.setHeadless('row-unknown', true);

    expect(test.logged).toContain(
      'setHeadless for unknown session row-unknown ignored',
    );
    expect(test.saved.saves()).toBe(savesBefore);
    expect(test.chat.isHeadless('row-unknown')).toBe(false);
  });

  // The flag at the last process start, whatever it was set to since.
  it.each([
    { given: 'turned on, not cleared', clears: false, expected: false },
    { given: 'turned on, then cleared', clears: true, expected: true },
  ])(
    'launchedHeadless_FlagSetAfterTheStart_KeepsTheStartsFlag: $given → $expected',
    async ({ clears, expected }) => {
      const test = await started();
      test.chat.restore(NOTHING_SAVED, []);
      test.chat.setHeadless(ROW_ID, true);

      if (clears) {
        test.chat.clear(ROW_ID);
        await flush();
      }

      expect(test.chat.launchedHeadless(ROW_ID)).toBe(expected);
      expect(test.saved.last()?.sessions[0].launchHeadless).toBe(expected);
    },
  );

  it('clear_HeadlessRow_KeepsHeadless', async () => {
    const test = await started();
    test.chat.setHeadless(ROW_ID, true);

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.chat.isHeadless(ROW_ID)).toBe(true);
    expect(test.chat.launchedHeadless(ROW_ID)).toBe(true);
    expect(test.chat.sessions()[0].headless).toBe(true);
  });

  it('start_OpensTheRowNotHeadless', async () => {
    const test = setUp();

    const sessionId = test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();

    expect(test.chat.isHeadless(sessionId)).toBe(false);
    expect(test.chat.launchedHeadless(sessionId)).toBe(false);
    expect(test.chat.sessions()[0].headless).toBe(false);
  });

  it.each([
    { given: 'headless: true', flag: { headless: true }, expected: true },
    { given: 'headless absent', flag: {}, expected: false },
  ])(
    'launch_HeadlessRequest_OpensTheRowHeadless: $given → $expected',
    async ({ flag, expected }) => {
      const test = setUp();

      const sessionId = test.chat.launch({
        projectDir: PROJECT_DIR,
        profile: 'personal',
        message: { text: 'go', images: [] },
        ...flag,
      });
      await flush();

      expect(test.chat.isHeadless(sessionId)).toBe(expected);
      expect(test.chat.launchedHeadless(sessionId)).toBe(expected);
      expect(test.chat.sessions()[0].headless).toBe(expected);
    },
  );

  it.each([
    {
      given: 'headless: true',
      flag: { headless: true },
      list: [],
      expected: true,
    },
    { given: 'headless absent', flag: {}, list: [], expected: false },
    {
      given: 'headless: true, its process running here',
      flag: { headless: true },
      list: [{ ...HOSTED_PAST_ONE }],
      expected: true,
    },
  ])(
    'resume_HeadlessRequest_OpensTheRowHeadless: $given → $expected',
    async ({ flag, list, expected }) => {
      const test = setUp({
        sessionHost: { list: () => Promise.resolve(list) },
      });
      test.harness.scriptAttach(HOSTED_PAST_ONE.id, {
        outcome: 'process',
        turns: 0,
        replay() {},
      });

      const sessionId = await test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: PAST_ONE.sessionId,
        title: PAST_ONE.title,
        ...flag,
      });
      await flush();

      expect(test.chat.isHeadless(sessionId)).toBe(expected);
      expect(test.chat.launchedHeadless(sessionId)).toBe(expected);
      expect(test.chat.sessions()[0].headless).toBe(expected);
    },
  );

  it.each([
    {
      given: 'saved headless',
      saved: hostedRecord({ headless: true, launchHeadless: true }),
      hosted: [],
      expected: { headless: true, launched: true },
    },
    {
      given: 'turned off after a headless start, its process attached',
      saved: hostedRecord({ headless: false, launchHeadless: true }),
      hosted: [hostedP1()],
      expected: { headless: false, launched: true },
    },
  ])(
    'restore_SavedHeadless_RestoresTheFlagAndTheLaunchFlag: $given',
    async ({ saved, hosted, expected }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay() {},
      });

      restoreOne(test, saved, hosted);
      await flush();

      expect(test.chat.isHeadless(ROW_ID)).toBe(expected.headless);
      expect(test.chat.launchedHeadless(ROW_ID)).toBe(expected.launched);
      expect(test.chat.sessions()[0].headless).toBe(expected.headless);
    },
  );

  it.each([
    {
      given: 'headless set, then clear',
      flags: [true],
      expected: ['registered', HEADLESS_NOTE],
    },
    {
      given: 'never headless, then clear',
      flags: [],
      expected: ['registered'],
    },
    {
      given: 'headless set and turned off, then clear',
      flags: [true, false],
      expected: ['registered'],
    },
  ])(
    'start_HeadlessRow_CarriesTheHeadlessNote: $given',
    async ({ flags, expected }) => {
      const test = setUp();
      test.chat.addInstructions('registered');
      const sessionId = test.chat.start({
        harness: FAKE_HARNESS_ID,
        projectDir: PROJECT_DIR,
        profile: 'personal',
      });
      await flush();

      for (const headless of flags) {
        test.chat.setHeadless(sessionId, headless);
      }
      test.chat.clear(sessionId);
      await flush();

      expect(test.harness.processes.at(-1)?.request.instructions).toEqual(
        expected,
      );
    },
  );

  it.each([
    { headless: true, expected: ['registered', HEADLESS_NOTE] },
    { headless: false, expected: ['registered'] },
  ])(
    'attach_HeadlessRestoredRow_CarriesTheHeadlessNote: $headless',
    async ({ headless, expected }) => {
      const test = setUp();
      test.chat.addInstructions('registered');
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay() {},
      });

      restoreOne(test, hostedRecord({ headless }), [hostedP1()]);
      await flush();

      expect(test.harness.attachCalls).toHaveLength(1);
      expect(test.harness.attachCalls[0].instructions).toEqual(expected);
    },
  );

  it('restore_UnattendedRecord_DeniesPermissionAtOnce', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record('host-a', { unattended: true })],
        selectedHostSessionId: null,
      },
      [],
    );
    await test.chat.send(ROW_ID, { text: 'hi', images: [] });
    await flush();

    const decision = await askBash(test);

    const unattended = { allowed: false, reason: UNATTENDED_REASON };
    expect(decision()).toEqual(unattended);
    expect(
      permissionAnswers(test.harness.processes[0]).map((call) => call.decision),
    ).toEqual([unattended]);
    expect(
      test
        .sent('entry')
        .filter((sent) => sent.entry.kind === 'permission')
        .map((sent) => (sent.entry as { answer: unknown }).answer),
    ).toEqual([unattended]);
  });

  it.each([
    {
      given: 'resting, then a send',
      processId: null,
      hosted: [],
      instructionsOf: (test: ReturnType<typeof setUp>) =>
        test.harness.processes[0].request.instructions,
    },
    {
      given: 'running here',
      processId: 'p1',
      hosted: [hostedP1()],
      instructionsOf: (test: ReturnType<typeof setUp>) =>
        test.harness.attachCalls[0].instructions,
    },
  ])(
    'restore_RecordWithInstructionsAndOwner_ReopensWithBoth: $given',
    async ({ processId, hosted, instructionsOf }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay() {},
      });
      test.chat.addInstructions('global note');

      test.chat.restore(
        {
          sessions: [
            record('host-a', {
              instructions: ['own note'],
              owner: 'practice',
              processId,
            }),
          ],
          selectedHostSessionId: null,
        },
        hosted,
      );
      if (processId === null) {
        await test.chat.send(ROW_ID, { text: 'hi', images: [] });
      }
      await flush();

      expect(test.openOptions).toEqual([{ select: false, owner: 'practice' }]);
      expect(instructionsOf(test)).toEqual(['global note', 'own note']);
    },
  );

  it('save_BeforeRestore_WritesNothing', async () => {
    const test = setUp();
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    test.chat.send(ROW_ID, { text: 'hi', images: [] });
    await flush();
    expect(test.saved.saves()).toBe(0);

    test.chat.restore(
      {
        sessions: [record('host-a')],
        selectedHostSessionId: null,
      },
      [],
    );

    expect(
      test.saved.last()?.sessions.map((saved) => saved.hostSessionId),
    ).toEqual(['fake-session-1', 'host-a']);
  });

  it.each([
    {
      given: 'a missing profile',
      saved: record('host-a', { profile: 'gone', sent: true }),
      startFailure: null,
      error: 'gone',
    },
    {
      given: 'a harness start that throws',
      saved: record('host-a', { sent: true }),
      startFailure: 'spawn failed',
      error: 'spawn failed',
    },
  ])(
    'send_RestingRowThatCannotStart_RejectsAndStaysResting given $given',
    async ({ saved, startFailure, error }) => {
      const test = setUp();
      test.chat.restore({ sessions: [saved], selectedHostSessionId: null }, []);
      if (startFailure !== null) {
        test.harness.failNextStart(startFailure);
      }

      await expect(
        test.chat.send(ROW_ID, { text: 'hi', images: [] }),
      ).rejects.toThrow(error);
      expect(test.harness.processes).toEqual([]);
      expect(test.chat.sessions()[0].running).toBe(false);
      expect(test.sent('sessionRested')).toEqual([]);
    },
  );

  it.each([
    {
      given: 'a resting row',
      open: (chat: ChatSessions) =>
        chat.restore(
          {
            sessions: [record('host-a')],
            selectedHostSessionId: null,
          },
          [],
        ),
    },
    {
      given: 'a running row',
      open: (chat: ChatSessions) => {
        chat.restore(NOTHING_SAVED, []);
        chat.start({
          harness: FAKE_HARNESS_ID,
          projectDir: PROJECT_DIR,
          profile: 'personal',
        });
      },
    },
  ])('closed_Row_DropsItsRecord given $given', async ({ open }) => {
    const test = setUp();
    open(test.chat);
    await flush();
    expect(test.saved.last()?.sessions).toHaveLength(1);

    test.chat.closed(ROW_ID, 'user');

    expect(test.saved.last()?.sessions).toEqual([]);
  });

  it('detachAll_ThenExits_SavesNothingAndSendsNothing', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    const { events } = test.harness.processes[0];
    events.activity('working');
    await test.chat.send(ROW_ID, { text: 'a', images: [] });
    const messagesBefore = test.messages().length;

    test.chat.detachAll();
    const savesBefore = test.saved.saves();
    events.activity('idle');
    events.ended({ code: 0, error: null });
    await flush();

    expect(test.saved.saves()).toBe(savesBefore);
    expect(test.messages().length).toBe(messagesBefore);
    expect(test.saved.last()?.sessions[0].busy).toBe(true);
    expect(test.saved.last()?.sessions[0].queued).toEqual([
      { text: 'a', images: [] },
    ]);
  });

  it('activity_IdleFlip_SavesBusy', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    const { events } = test.harness.processes[0];

    events.activity('working');
    const busyWhileWorking = test.saved.last()?.sessions[0].busy;
    events.activity('idle');

    expect(busyWhileWorking).toBe(true);
    expect(test.saved.last()?.sessions[0].busy).toBe(false);
  });

  it.each([
    {
      given: 'a resting row',
      hosted: [],
      fields: {},
      before: null,
      ids: [
        `history:${PAST_ONE.sessionId}-user`,
        `history:${PAST_ONE.sessionId}-assistant`,
        'app-notice-1',
      ],
    },
    {
      given: 'an attached row',
      hosted: [{ id: 'p1', startedAt: 5000, running: true, current: true }],
      fields: { processId: 'p1' },
      before: 5000,
      ids: [],
    },
  ])(
    'loadHistory_PendingRow_PrependsOnce given $given',
    async ({ hosted, fields, before, ids }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay() {},
      });
      const hostId = PAST_ONE.sessionId;
      test.chat.restore(
        {
          sessions: [record(hostId, { sent: true, busy: true, ...fields })],
          selectedHostSessionId: null,
        },
        hosted,
      );
      await flush();

      await test.chat.loadHistory(ROW_ID);
      await test.chat.loadHistory(ROW_ID);

      expect(test.chat.sessions()[0].entries.map((entry) => entry.id)).toEqual(
        ids,
      );
      expect(
        test
          .sent('entries')
          .map(({ sessionId, entries }) => [
            sessionId,
            entries.map((entry) => entry.id),
          ]),
      ).toEqual([[ROW_ID, ids]]);
      expect(
        test.harness.pastSessionCalls
          .filter((call) => call.method === 'history')
          .map((call) => call.before),
      ).toEqual([before]);
    },
  );

  it.each([
    {
      given: 'a row never sent to',
      saved: record(PAST_ONE.sessionId),
      arrange: () => {},
      historyCalls: 0,
      entries: [],
    },
    {
      given: 'a failed read',
      saved: record(PAST_ONE.sessionId, { sent: true }),
      arrange: (test: ReturnType<typeof setUp>) =>
        test.harness.failNextHistory('disk gone'),
      historyCalls: 1,
      entries: [
        {
          sessionId: ROW_ID,
          entries: [
            expect.objectContaining({
              kind: 'notice',
              tone: 'error',
              text: 'Earlier conversation not read: disk gone',
            }),
          ],
        },
      ],
    },
  ])(
    'loadHistory_RowWithNothingToRead_SendsNoHistory given $given',
    async ({ saved, arrange, historyCalls, entries }) => {
      const test = setUp();
      test.chat.restore({ sessions: [saved], selectedHostSessionId: null }, []);
      arrange(test);

      await test.chat.loadHistory(ROW_ID);

      expect(
        test.harness.pastSessionCalls.filter(
          (call) => call.method === 'history',
        ),
      ).toHaveLength(historyCalls);
      expect(test.sent('entries')).toEqual(entries);
    },
  );

  it('loadHistory_ProfileMissing_ReadsOnceItIsBack', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record(PAST_ONE.sessionId, { sent: true, profile: 'gone' })],
        selectedHostSessionId: null,
      },
      [],
    );
    const historyCalls = () =>
      test.harness.pastSessionCalls.filter((call) => call.method === 'history');

    await test.chat.loadHistory(ROW_ID);
    const callsWhileMissing = historyCalls().length;
    test.setProfiles([
      ...PROFILES,
      { name: 'gone', configDir: '/Users/u/.claude-gone' },
    ]);
    await test.chat.loadHistory(ROW_ID);

    expect(callsWhileMissing).toBe(0);
    expect(historyCalls()).toHaveLength(1);
    expect(
      test
        .sent('entries')
        .map(({ entries }) => entries.map((entry) => entry.id)),
    ).toEqual([
      [
        `history:${PAST_ONE.sessionId}-user`,
        `history:${PAST_ONE.sessionId}-assistant`,
        'app-notice-1',
      ],
    ]);
  });

  it.each([
    {
      given: 'a read that succeeds',
      historyFailure: null,
      historyIds: [
        `history:${PAST_ONE.sessionId}-user`,
        `history:${PAST_ONE.sessionId}-assistant`,
      ],
    },
    {
      given: 'a read that fails',
      historyFailure: 'disk gone',
      historyIds: ['history:unread'],
    },
  ])(
    'send_RowWithHistoryPending_ReadsItBeforeTheStart given $given',
    async ({ historyFailure, historyIds }) => {
      const test = setUp();
      test.chat.restore(
        {
          sessions: [record(PAST_ONE.sessionId, { sent: true })],
          selectedHostSessionId: null,
        },
        [],
      );
      if (historyFailure !== null) {
        test.harness.failNextHistory(historyFailure);
      }
      const historyCalls = () =>
        test.harness.pastSessionCalls.filter(
          (call) => call.method === 'history',
        );

      const sending = test.chat.send(ROW_ID, { text: 'hi', images: [] });
      const startsDuringRead = test.harness.processes.length;
      await sending;
      await flush();
      await test.chat.loadHistory(ROW_ID);

      expect(startsDuringRead).toBe(0);
      expect(test.harness.processes[0].calls).toEqual([
        { method: 'send', text: 'hi', imageCount: 0 },
      ]);
      expect(historyCalls()).toHaveLength(1);
      expect(test.chat.sessions()[0].entries.map((entry) => entry.id)).toEqual([
        ...historyIds,
        'user-1',
        'assistant-1',
        'result-1',
      ]);
      expect(test.sent('entries')).toHaveLength(1);
    },
  );

  it('send_TwoSendsOnOnePendingRead_StartOneProcessInOrder', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record(PAST_ONE.sessionId, { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );

    const first = test.chat.send(ROW_ID, { text: 'first', images: [] });
    const second = test.chat.send(ROW_ID, { text: 'second', images: [] });
    await Promise.all([first, second]);

    expect(test.harness.processes).toHaveLength(1);
    expect(test.harness.processes[0].calls).toEqual([
      { method: 'send', text: 'first', imageCount: 0 },
      { method: 'send', text: 'second', imageCount: 0 },
    ]);
  });

  it.each([
    {
      given: 'the row closed',
      duringRead: (test: ReturnType<typeof setUp>) =>
        test.chat.closed(ROW_ID, 'user'),
      logged: `send for session ${ROW_ID} closed while reading ignored`,
    },
    {
      given: 'detachAll',
      duringRead: (test: ReturnType<typeof setUp>) => test.chat.detachAll(),
      logged: `send for session ${ROW_ID} ignored: chat is stopping`,
    },
  ])(
    'send_RowWithHistoryPending_StoppedDuringRead_StartsNothing given $given',
    async ({ duringRead, logged }) => {
      const test = setUp();
      test.chat.restore(
        {
          sessions: [record(PAST_ONE.sessionId, { sent: true })],
          selectedHostSessionId: null,
        },
        [],
      );

      const sending = test.chat.send(ROW_ID, { text: 'hi', images: [] });
      duringRead(test);
      await sending;
      await flush();

      expect(test.harness.processes).toEqual([]);
      expect(test.logged).toContain(logged);
    },
  );

  it('resume_DetachedWhileReading_RejectsAndOpensNothing', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;

    const resuming = test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });
    test.chat.detachAll();

    await expect(resuming).rejects.toThrow(hostId);
    expect(test.opened).toEqual([]);
    expect(test.harness.processes).toEqual([]);
  });

  it.each([
    {
      case: 'the row closed',
      stop: (test: ReturnType<typeof setUp>) =>
        test.chat.closed(ROW_ID, 'user'),
    },
    {
      case: 'detachAll',
      stop: (test: ReturnType<typeof setUp>) => void test.chat.detachAll(),
    },
  ])(
    'loadHistory_StoppedWhileReading_SendsNothing ($case)',
    async ({ stop }) => {
      const test = setUp();
      test.chat.restore(
        {
          sessions: [record(PAST_ONE.sessionId, { sent: true })],
          selectedHostSessionId: null,
        },
        [],
      );

      const reading = test.chat.loadHistory(ROW_ID);
      stop(test);
      await reading;

      expect(test.sent('entries')).toEqual([]);
    },
  );

  it.each([
    {
      given: 'a start',
      open: (chat: ChatSessions) =>
        chat.start({
          harness: FAKE_HARNESS_ID,
          projectDir: PROJECT_DIR,
          profile: 'personal',
        }),
      selected: 'fake-session-1',
    },
    {
      given: 'a launch',
      open: (chat: ChatSessions) =>
        chat.launch({
          projectDir: PROJECT_DIR,
          profile: 'personal',
          message: { text: 'hi', images: [] },
        }),
      selected: null,
    },
  ])(
    'selected_RowChatOpens_SavedWhenOpenedSelected given $given',
    async ({ open, selected }) => {
      const test = setUp();
      test.chat.restore(NOTHING_SAVED, []);

      open(test.chat);
      await flush();

      expect(test.saved.last()?.selectedHostSessionId).toBe(selected);
    },
  );

  it('selected_ChatRowThenOtherRow_KeepsLastChatSelection', () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record('host-a'), record('host-b')],
        selectedHostSessionId: null,
      },
      [],
    );

    test.chat.selected('row-1');
    test.chat.selected('row-2');
    test.chat.selected('row-relay');
    test.chat.selected(null);

    expect(test.saved.last()?.selectedHostSessionId).toBe('host-b');
  });
});

describe('createChatSessions branch', () => {
  const TURN_ENDED: AgentEvent = { type: 'turnEnded', at: 1000 };

  // A clone at `/repos/clone` whose branch the test changes.
  function cloneGit(branch: { current: string }): ChatSessionsDeps['git'] {
    return {
      topLevel: () => Promise.resolve('/repos/clone'),
      currentBranch: () => Promise.resolve(branch.current),
      worktrees: () => Promise.resolve([]),
    };
  }

  it.each([
    {
      case: 'clone on main',
      git: cloneGit({ current: 'main' }),
      sent: [{ sessionId: ROW_ID, repo: 'clone', branch: 'main' }],
      logged: null,
    },
    { case: 'no clone', git: NO_CLONE, sent: [], logged: null },
    {
      case: 'topLevel rejects',
      git: {
        ...NO_CLONE,
        topLevel: () => Promise.reject(new Error('git did not start')),
      },
      sent: [],
      logged: 'branch not read in app: git did not start',
    },
    {
      case: 'worktrees rejects',
      git: {
        ...cloneGit({ current: 'main' }),
        worktrees: () => Promise.reject(new Error('git did not start')),
      },
      sent: [{ sessionId: ROW_ID, repo: 'clone', branch: 'main' }],
      logged: 'worktrees not read in app: git did not start',
    },
  ])('branchRead_$case', async ({ git, sent, logged }) => {
    const test = await started({ git });

    expect(test.sent('branch')).toEqual(sent);
    expect(test.chat.sessions()[0]).toMatchObject({
      repo: sent[0]?.repo ?? 'app',
      branch: sent[0]?.branch ?? null,
    });
    if (logged !== null) {
      expect(test.logged).toContain(logged);
    }
  });

  it('agentEvent_TurnEnded_ReadsTheBranchAgain', async () => {
    const branch = { current: 'main' };
    const test = await started({ git: cloneGit(branch) });
    branch.current = 'feature';

    test.process.events.agentEvent(TURN_ENDED);
    await flush();
    test.process.events.agentEvent(TURN_ENDED);
    await flush();

    expect(test.sent('branch')).toEqual([
      { sessionId: ROW_ID, repo: 'clone', branch: 'main' },
      { sessionId: ROW_ID, repo: 'clone', branch: 'feature' },
    ]);
  });

  it('agentEvent_TurnEnded_ReadsTheWorktreeRootsAgain', async () => {
    const linked: string[] = [];
    const test = await started({ git: worktreesGit(linked) });
    linked.push('/repos/.worktrees/late');

    test.process.events.agentEvent(TURN_ENDED);
    await flush();
    test.process.events.entry(
      toolEntry('a', 'Bash', { command: 'ls /repos/.worktrees/late' }),
    );

    expect(test.chat.sessions()[0].worktrees).toEqual(['late']);
  });

  it('bashWorktreeCommand_ResultLands_ReadsTheWorktreeRootsAgain', async () => {
    const linked: string[] = [];
    const test = await started({ git: worktreesGit(linked) });
    const add = 'git worktree add /repos/.worktrees/late';
    test.process.events.entry(toolEntry('a', 'Bash', { command: add }));
    linked.push('/repos/.worktrees/late');

    test.process.events.entry(
      toolEntry('a', 'Bash', { command: add }, { text: '', isError: false }),
    );
    await flush();
    test.process.events.entry(
      toolEntry('b', 'Bash', { command: 'ls /repos/.worktrees/late' }),
    );

    expect(test.chat.sessions()[0].worktrees).toEqual(['late']);
  });

  // `reads` holds each branch read still open, oldest first; `rootReads` each
  // worktree roots read.
  it.each([
    {
      case: 'older read settles after a newer',
      settle: async (
        test: Awaited<ReturnType<typeof started>>,
        reads: ((branch: string) => void)[],
        _rootReads: ((worktrees: GitWorktree[]) => void)[],
      ) => {
        test.process.events.agentEvent(TURN_ENDED);
        await flush();
        reads[1]('feature');
        await flush();
        reads[0]('main');
      },
      sent: [{ sessionId: ROW_ID, repo: 'clone', branch: 'feature' }],
      shown: 'feature',
    },
    {
      case: 'read settles after its row closed',
      settle: async (
        test: Awaited<ReturnType<typeof started>>,
        reads: ((branch: string) => void)[],
        _rootReads: ((worktrees: GitWorktree[]) => void)[],
      ) => {
        test.chat.closed(ROW_ID, 'user');
        reads[0]('main');
      },
      sent: [],
      shown: null,
    },
    {
      case: 'read settles after detachAll',
      settle: async (
        test: Awaited<ReturnType<typeof started>>,
        reads: ((branch: string) => void)[],
        _rootReads: ((worktrees: GitWorktree[]) => void)[],
      ) => {
        test.chat.detachAll();
        reads[0]('main');
      },
      sent: [],
      shown: null,
    },
    {
      case: 'roots read settles after its row closed',
      settle: async (
        test: Awaited<ReturnType<typeof started>>,
        _reads: ((branch: string) => void)[],
        rootReads: ((worktrees: GitWorktree[]) => void)[],
      ) => {
        test.process.events.entry(
          toolEntry('a', 'Bash', { command: `ls ${FIX_ROOT}` }),
        );
        test.chat.closed(ROW_ID, 'user');
        rootReads[0](checkoutsOf([FIX_ROOT]));
      },
      sent: [],
      shown: null,
    },
  ])(
    'branchRead_StaleRead_ChangesNothing ($case)',
    async ({ settle, sent, shown }) => {
      const reads: ((branch: string) => void)[] = [];
      const rootReads: ((worktrees: GitWorktree[]) => void)[] = [];
      const git: ChatSessionsDeps['git'] = {
        topLevel: () => Promise.resolve('/repos/clone'),
        currentBranch: () =>
          new Promise((resolve) => {
            reads.push(resolve);
          }),
        worktrees: () =>
          new Promise((resolve) => {
            rootReads.push(resolve);
          }),
      };
      const test = await started({ git });

      await settle(test, reads, rootReads);
      await flush();

      expect(test.sent('branch')).toEqual(sent);
      expect(test.chat.sessions()[0]?.branch ?? null).toBe(shown);
      const worktreesWritten = test.timeline.flatMap((item) =>
        'value' in item && item.id === chatSessionSlot.id
          ? ((item.value as ChatSessionInfo | undefined)?.worktrees ?? [])
          : [],
      );
      expect(worktreesWritten).toEqual([]);
    },
  );
});

describe('createChatSessions usage forwarding', () => {
  it.each([
    {
      case: 'running',
      close: false,
      event: {
        type: 'toolStarted',
        at: 1000,
        agentId: MAIN_AGENT_ID,
        toolUseId: 'tool-1',
        tool: 'Read',
        summary: '',
      } satisfies AgentEvent,
    },
    {
      case: 'after close',
      close: true,
      event: { type: 'sessionEnded', at: 1000 } satisfies AgentEvent,
    },
  ])('agentEvent_$case_ReachesTheBusWithBothIds', async ({ close, event }) => {
    const test = await started();
    if (close) {
      test.chat.closed(ROW_ID, 'user');
    }
    test.emitted.length = 0;

    test.process.events.agentEvent(event);

    expect(test.emitted).toEqual([
      {
        event: 'agentEvent',
        data: {
          sessionId: ROW_ID,
          profileDir: '~/.claude-personal',
          hostSessionId: 'fake-session-1',
          event,
          replayed: false,
        },
      },
    ]);
    expect((test.emitted[0].data as ChatMainEvents['agentEvent']).event).toBe(
      event,
    );
  });

  it.each([
    {
      given: 'a plan row update',
      act: (test: Awaited<ReturnType<typeof started>>) =>
        test.process.events.planUsage(fakePlanRowUpdate(1, 1000)),
      emitted: [
        {
          event: 'planUsage',
          data: {
            profileDir: '~/.claude-personal',
            update: fakePlanRowUpdate(1, 1000),
          },
        },
      ],
    },
    {
      given: 'the profile setting changed after the start',
      act: (test: Awaited<ReturnType<typeof started>>) => {
        test.setProfiles([{ name: 'personal', configDir: '/elsewhere' }]);
        test.process.events.agentEvent(fakeUsageEvent(1, 1000));
      },
      emitted: [
        {
          event: 'agentEvent',
          data: {
            sessionId: ROW_ID,
            profileDir: '~/.claude-personal',
            hostSessionId: 'fake-session-1',
            event: fakeUsageEvent(1, 1000),
            replayed: false,
          },
        },
      ],
    },
    {
      given: 'an agent event after the row closed',
      act: (test: Awaited<ReturnType<typeof started>>) => {
        test.chat.closed(ROW_ID, 'user');
        test.process.events.agentEvent(fakeUsageEvent(1, 1000));
      },
      emitted: [],
    },
    {
      given: 'a plan row update after the process ended',
      act: (test: Awaited<ReturnType<typeof started>>) => {
        test.process.events.ended({ code: 0, error: null });
        test.process.events.planUsage(fakePlanRowUpdate(1, 1000));
      },
      emitted: [],
    },
  ])(
    'processEvents_UsageForwarding_EmitsWhileLive given $given',
    async ({ act, emitted }) => {
      const test = await started();
      test.emitted.length = 0;

      act(test);

      expect(
        test.emitted.filter(
          ({ event }) => event === 'agentEvent' || event === 'planUsage',
        ),
      ).toEqual(emitted);
    },
  );
});

describe('createChatSessions clear', () => {
  const CLEARED: ChatEntry = {
    kind: 'notice',
    id: 'app-notice-1',
    at: 1000,
    text: 'Conversation cleared',
    tone: 'info',
    raw: [],
  };

  it('clear_RunningRow_RestartsUnderNewIdWithOneNotice', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    const old = test.harness.processes[0];
    test.chat.send(ROW_ID, { text: 'first', images: [] });
    await flush();
    old.events.entry(assistant('extra', 'more'));
    test.chat.setControl(ROW_ID, 'model', 'fake-large');
    await flush();

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.chat.sessions()[0].entries).toEqual([CLEARED]);
    expect(test.sent('entries').at(-1)).toEqual({
      sessionId: ROW_ID,
      entries: [CLEARED],
    });
    expect(old.sessionId).toBe('fake-session-1');
    expect(old.request.rowId).toBe(ROW_ID);
    expect(test.harness.processes[1].request).toMatchObject({
      sessionId: null,
      rowId: ROW_ID,
      resume: false,
      controls: { model: 'fake-large' },
    });
    expect(test.harness.processes[1].sessionId).toBe('fake-session-2');
    expect(old.calls).toContainEqual({ method: 'end' });
    expect(test.hostIdChanges).toEqual(['fake-session-1', 'fake-session-2']);
    expect(test.saved.last()).toEqual({
      sessions: [
        {
          hostSessionId: 'fake-session-2',
          projectDir: PROJECT_DIR,
          harness: FAKE_HARNESS_ID,
          profile: 'personal',
          sent: false,
          busy: false,
          titles: { ...NO_TITLES, firstMessage: 'first' },
          processId: 'row-1-2-1000',
          queued: [],
          returned: [],
          launchControls: { mode: 'auto', model: 'fake-large' },
          launchResume: false,
          launchHeadless: false,
          controls: test.chat.sessions()[0].controls,
          confirmedPicks: { model: 'fake-large' },
          returnedDrops: [],
          activeMs: 0,
          rowId: ROW_ID,
          unattended: false,
          headless: false,
          instructions: [],
          owner: null,
        },
      ],
      selectedHostSessionId: 'fake-session-2',
    });
    expect(test.chat.sessions()[0].running).toBe(true);
    expect(test.logged).toContain('conversation cleared in app');
  });

  it('clear_MidTurn_StopsOldProcessAndIgnoresItsLateEvents', async () => {
    const test = await started();
    test.activity('working');
    const decision = await askBash(test);

    test.chat.clear(ROW_ID);
    await flush();
    test.process.events.entry(assistant('late', 'stale'));
    test.process.events.ended({ code: 1, error: 'late' });

    expect(test.process.calls).toEqual([
      { method: 'interrupt' },
      { method: 'end' },
    ]);
    expect(decision()).toEqual({
      allowed: false,
      reason: FAKE_CANCELLED_REASON,
    });
    expect(test.chat.sessions()[0].entries).toEqual([CLEARED]);
    expect(test.chat.sessions()[0].running).toBe(true);
    expect(test.sent('sessionRested')).toEqual([]);
    const sessionEndedHostIds = test.emitted.flatMap((emitted) =>
      emitted.event === 'agentEvent' &&
      emitted.data.event.type === 'sessionEnded'
        ? [emitted.data.hostSessionId]
        : [],
    );
    expect(sessionEndedHostIds).toEqual(['fake-session-1']);
  });

  it('clear_RowWithRunTime_ResetsTheClockAndSavesZero', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record('host-a', { activeMs: 30000 })],
        selectedHostSessionId: null,
      },
      [],
    );

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.sent('activeTime').at(-1)).toEqual({
      sessionId: ROW_ID,
      activeTime: { totalMs: 0, since: null },
    });
    expect(test.saved.last()?.sessions[0].activeMs).toBe(0);
  });

  it('clear_RestingRow_StartsFreshProcess', async () => {
    const test = await started();
    test.process.events.ended({ code: 0, error: null });

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.harness.processes).toHaveLength(2);
    expect(test.harness.processes[1].request).toMatchObject({
      sessionId: null,
      resume: false,
    });
    expect(test.process.calls).not.toContainEqual({ method: 'end' });
    expect(test.chat.sessions()[0].entries).toEqual([
      { ...CLEARED, id: 'app-notice-2' },
    ]);
  });

  it('clear_QueuedMessages_ReturnedOldestFirst', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.chat.sessions()[0].queued).toEqual([]);
    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [first, second] },
    ]);
    expect(
      test.harness.processes[1].calls.filter((call) => call.method === 'send'),
    ).toEqual([]);
  });

  it('clear_WrittenAndSentMessages_ReturnedInWriteOrder', async () => {
    const test = await started();
    const idleSend: UserMessage = { text: 'idle send', images: [] };
    test.chat.send(ROW_ID, idleSend);
    const [first, second] = queueTwo(test);
    test.chat.sendNow(ROW_ID, 'queued-1');

    test.chat.clear(ROW_ID);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [idleSend, first, second] },
    ]);
    expect(test.chat.sessions()[0].queued).toEqual([]);
  });

  it.each([{ event: 'entry' }, { event: 'messageDropped' }])(
    'clear_OldProcessEventForAReusedId_ChangesNothing: $event',
    async ({ event }) => {
      const test = await started();
      const old = test.process;
      test.chat.clear(ROW_ID);
      await flush();
      const fresh = test.harness.processes[1];
      const message: UserMessage = { text: 'after clear', images: [] };
      test.chat.send(ROW_ID, message);

      if (event === 'entry') {
        old.events.entry(userEntry('user-1', 'stale'));
      } else {
        old.events.messageDropped('user-1', { text: 'stale', images: [] });
      }
      fresh.events.ended({ code: 0, error: null });

      expect(test.sentReturned()).toEqual([
        { sessionId: ROW_ID, messages: [message] },
      ]);
    },
  );

  // Breaks if a clear whose start throws moves the row to a host id no
  // harness reported, or loses the clear before the next start reports.
  it('clear_StartThrows_ClearPendingUntilNextStartReports', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    await test.chat.send(ROW_ID, IDLE_SEND);
    test.harness.failNextStart('spawn failed');

    expect(() => test.chat.clear(ROW_ID)).toThrow('spawn failed');

    expect(test.chat.sessions()[0]).toMatchObject({
      running: false,
      entries: [CLEARED],
    });
    expect(test.saved.last()?.sessions).toEqual([
      expect.objectContaining({
        hostSessionId: 'fake-session-1',
        sent: true,
        processId: null,
      }),
    ]);
    expect(test.sent('sessionRested')).toEqual([
      { sessionId: ROW_ID, error: null },
    ]);
    expect(emittedOf(test, 'sessionCleared')).toEqual([]);

    await test.chat.send(ROW_ID, IDLE_SEND);
    await flush();

    expect(test.harness.processes.at(-1)?.request.sessionId).toBeNull();
    expect(emittedOf(test, 'sessionCleared')).toEqual([
      expect.objectContaining({
        oldHostSessionId: 'fake-session-1',
        newHostSessionId: 'fake-session-2',
        sent: true,
      }),
    ]);
    expect(test.saved.last()?.sessions).toEqual([
      expect.objectContaining({ hostSessionId: 'fake-session-2' }),
    ]);
  });

  it.each([
    {
      given: 'an unknown session',
      arrange: () => {},
      sessionId: 'row-x',
      logged: 'clear for unknown session row-x ignored',
    },
    {
      given: 'detachAll',
      arrange: (test: ReturnType<typeof setUp>) => test.chat.detachAll(),
      sessionId: ROW_ID,
      logged: `clear for session ${ROW_ID} ignored: chat is stopping`,
    },
  ])(
    'clear_Ignored_ChangesNothingAndLogs given $given',
    async ({ arrange, sessionId, logged }) => {
      const test = await started();
      arrange(test);

      test.chat.clear(sessionId);
      await flush();

      expect(test.harness.processes).toHaveLength(1);
      expect(test.hostIdChanges).toEqual([]);
      expect(test.logged).toContain(logged);
    },
  );

  it('clear_ProfileMissing_ThrowsAndChangesNothing', async () => {
    const test = await started();
    test.process.events.entry(assistant('kept', 'still here'));
    const entriesBefore = test.chat.sessions()[0].entries;
    test.setProfiles([]);

    expect(() => test.chat.clear(ROW_ID)).toThrow('personal');

    expect(test.chat.sessions()[0].entries).toEqual(entriesBefore);
    expect(test.hostIdChanges).toEqual([]);
    expect(test.process.calls).toEqual([]);
    expect(test.harness.processes).toHaveLength(1);
  });

  it('clear_HistoryReadInFlight_Dropped', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record(PAST_ONE.sessionId, { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );
    const sending = test.chat.send(ROW_ID, { text: 'after', images: [] });

    test.chat.clear(ROW_ID);
    await sending;
    await flush();

    const { entries } = test.chat.sessions()[0];
    expect(entries[0]).toEqual(CLEARED);
    expect(entries.filter((entry) => entry.id.startsWith('history:'))).toEqual(
      [],
    );
    expect(test.sent('entries')).toHaveLength(1);
  });

  it('clear_WorkingRowUnfocused_NoTurnFinishedMark', async () => {
    const test = await started();
    test.setFocused(false);
    test.activity('working');

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.marked).toEqual([]);
  });
});

// A change to a session's work at `at`: the activity its harness reports, its
// one permission call asked or answered, or its one background task starting (1)
// or finishing (0).
type ClockStep =
  | { at: number; activity: ProcessActivity }
  | { at: number; permission: 'asked' | 'answered' }
  | { at: number; background: 0 | 1 };

function backgroundEvent(at: number, background: 0 | 1): AgentEvent {
  return background === 1
    ? {
        type: 'taskStarted',
        at,
        taskId: 'task-1',
        agentId: MAIN_AGENT_ID,
        description: 'server',
        command: null,
      }
    : { type: 'taskFinished', at, taskId: 'task-1', outcome: 'done' };
}

function runClockSteps(
  test: Awaited<ReturnType<typeof started>>,
  steps: readonly ClockStep[],
) {
  for (const step of steps) {
    test.setNow(step.at);
    if ('activity' in step) {
      test.activity(step.activity);
    } else if ('background' in step) {
      test.process.events.agentEvent(backgroundEvent(step.at, step.background));
    } else if (step.permission === 'asked') {
      // Raised straight through the process's events, as the fake would one
      // microtask later, so the step lands at its own clock time.
      test.process.events.permission({
        entry: {
          kind: 'permission',
          id: 'fake-permission-1',
          at: step.at,
          toolName: 'Bash',
          input: { command: 'ls' },
          answer: null,
          raw: [],
        },
      });
    } else {
      test.chat.answerPermission(ROW_ID, 'fake-permission-1', {
        allowed: true,
        reason: null,
      });
    }
  }
}

describe('createChatSessions active time', () => {
  it.each<{ given: string; steps: ClockStep[]; expected: ActiveTime[] }>([
    {
      given: 'working, then idle',
      steps: [
        { at: 1000, activity: 'working' },
        { at: 4000, activity: 'idle' },
      ],
      expected: [
        { totalMs: 0, since: 1000 },
        { totalMs: 3000, since: null },
      ],
    },
    {
      given: 'working, a permission asked, then answered',
      steps: [
        { at: 1000, activity: 'working' },
        { at: 4000, permission: 'asked' },
        { at: 9000, permission: 'answered' },
      ],
      expected: [
        { totalMs: 0, since: 1000 },
        { totalMs: 3000, since: null },
        { totalMs: 3000, since: 9000 },
      ],
    },
    {
      given: 'working with background running through a permission wait',
      steps: [
        { at: 1000, activity: 'working' },
        { at: 2000, background: 1 },
        { at: 4000, permission: 'asked' },
        { at: 9000, permission: 'answered' },
      ],
      expected: [{ totalMs: 0, since: 1000 }],
    },
    {
      given: 'working, idle with background running, then background over',
      steps: [
        { at: 1000, activity: 'working' },
        { at: 2000, background: 1 },
        { at: 5000, activity: 'idle' },
        { at: 9000, background: 0 },
      ],
      expected: [
        { totalMs: 0, since: 1000 },
        { totalMs: 8000, since: null },
      ],
    },
    {
      given: 'a permission waiting, background starting then over',
      steps: [
        { at: 500, activity: 'working' },
        { at: 1000, permission: 'asked' },
        { at: 2000, background: 1 },
        { at: 6000, background: 0 },
      ],
      expected: [
        { totalMs: 0, since: 500 },
        { totalMs: 500, since: null },
        { totalMs: 500, since: 2000 },
        { totalMs: 4500, since: null },
      ],
    },
  ])(
    'activeTime_WorkSteps_SendsEachStartAndStop: $given',
    async ({ steps, expected }) => {
      const test = await started();

      runClockSteps(test, steps);

      expect(test.sent('activeTime').map((sent) => sent.activeTime)).toEqual(
        expected,
      );
      expect(test.chat.sessions()[0].activeTime).toEqual(expected.at(-1));
    },
  );

  it('activeTime_ClockStopsWithNoOtherSave_SnapshotCarriesTheStoppedTotal', async () => {
    const test = await started();
    test.chat.restore(NOTHING_SAVED, []);

    runClockSteps(test, [
      { at: 1000, activity: 'working' },
      { at: 2000, background: 1 },
      { at: 5000, activity: 'idle' },
      { at: 9000, background: 0 },
    ]);

    expect(test.saved.last()?.sessions[0].activeMs).toBe(8000);
  });

  const CLOCK_RUNNING: { given: string; steps: ClockStep[] }[] = [
    { given: 'working', steps: [{ at: 1000, activity: 'working' }] },
    { given: 'with background only', steps: [{ at: 1000, background: 1 }] },
    {
      given: 'working with background',
      steps: [
        { at: 1000, activity: 'working' },
        { at: 2000, background: 1 },
      ],
    },
  ];

  it('restore_SavedActiveMs_SessionStartedCarriesThePausedTotal', () => {
    const test = setUp();

    test.chat.restore(
      {
        sessions: [record('host-a', { activeMs: 42000 })],
        selectedHostSessionId: null,
      },
      [],
    );

    expect(test.sent('sessionStarted')[0].activeTime).toEqual({
      totalMs: 42000,
      since: null,
    });
  });

  it('detachAll_ClockRunning_SavesTheOpenSpanUpToNow', async () => {
    const test = await started();
    test.chat.restore(NOTHING_SAVED, []);
    runClockSteps(test, [{ at: 1000, activity: 'working' }]);
    test.setNow(2500);

    test.chat.detachAll();

    expect(test.saved.last()?.sessions[0].activeMs).toBe(1500);
  });

  it('detachAll_SaveInFlight_ItsPromiseHoldsForTheWrite', async () => {
    const test = await started();
    test.chat.restore(NOTHING_SAVED, []);
    let finishWrite = () => {};
    test.saved.store.save = () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      });
    let isHeld = true;

    const detached = test.chat.detachAll().then(() => {
      isHeld = false;
    });
    await flush();
    const heldBeforeTheWrite = isHeld;
    finishWrite();
    await detached;

    expect(heldBeforeTheWrite).toBe(true);
    expect(isHeld).toBe(false);
  });

  it('detachAll_WriteFails_ResolvesAndLogs', async () => {
    const test = await started();
    test.chat.restore(NOTHING_SAVED, []);
    test.saved.store.save = () => Promise.reject(new Error('disk full'));

    await test.chat.detachAll();

    expect(test.logged).toContain('open sessions not saved: disk full');
  });

  // Restores `host-a` with 42 s saved, its attach replaying `replay` at 7000.
  async function restoredAfterReplay(
    replay: (events: AgentProcessEvents) => void,
  ) {
    const test = setUp();
    test.harness.scriptAttach('p1', { outcome: 'process', replay });
    test.setNow(7000);
    restoreOne(test, hostedRecord({ activeMs: 42000 }), [hostedP1()]);
    const savesAfterRestore = test.saved.saves();
    await flush();
    return { test, savesAfterRestore };
  }

  const pastTask = (events: AgentProcessEvents, taskId: string) => {
    events.agentEvent({
      type: 'taskStarted',
      at: 100,
      taskId,
      agentId: MAIN_AGENT_ID,
      description: 'server',
      command: null,
    });
    events.agentEvent({
      type: 'taskFinished',
      at: 200,
      taskId,
      outcome: 'done',
    });
  };

  it.each<{ given: string; replay: (events: AgentProcessEvents) => void }>([
    { given: 'working', replay: (events) => events.activity('working') },
    {
      given: 'a task still running',
      replay: (events) => {
        pastTask(events, 'task-past');
        events.agentEvent(backgroundEvent(100, 1));
      },
    },
  ])(
    'replay_EndingWithWorkRunning_OpensTheClockOnceAtItsEnd: $given',
    async ({ replay }) => {
      const { test } = await restoredAfterReplay(replay);

      const running = { totalMs: 42000, since: 7000 };
      expect(test.sent('activeTime').map((sent) => sent.activeTime)).toEqual([
        running,
      ]);
      expect(test.chat.sessions()[0].activeTime).toEqual(running);
    },
  );

  it.each<{ given: string; replay: (events: AgentProcessEvents) => void }>([
    { given: 'nothing', replay: () => {} },
    {
      given: 'past tasks that finished',
      replay: (events) => {
        pastTask(events, 'task-1');
        pastTask(events, 'task-2');
      },
    },
    {
      given: 'a past turn that ended',
      replay: (events) => {
        events.activity('working');
        events.activity('idle');
      },
    },
  ])(
    'replay_EndingIdle_LeavesTheClockAtTheSavedTotal: $given',
    async ({ replay }) => {
      const { test } = await restoredAfterReplay(replay);

      expect(test.sent('activeTime')).toEqual([]);
      expect(test.chat.sessions()[0].activeTime).toEqual({
        totalMs: 42000,
        since: null,
      });
      expect(test.saved.last()?.sessions[0].activeMs).toBe(42000);
    },
  );

  it('replay_PastTasks_SavesNothing', async () => {
    const { test, savesAfterRestore } = await restoredAfterReplay((events) => {
      pastTask(events, 'task-1');
      pastTask(events, 'task-2');
    });

    expect(test.saved.saves()).toBe(savesAfterRestore);
  });

  it.each([
    { outcome: 'null' as const, message: '', background: false },
    { outcome: 'reject' as const, message: 'no attach', background: false },
    { outcome: 'null' as const, message: '', background: true },
    { outcome: 'reject' as const, message: 'no attach', background: true },
  ])(
    'attach_FailsAfterReplayingWorking_ClockStaysPaused: $outcome, background $background',
    async ({ outcome, message, background }) => {
      const test = setUp();
      const replay = (events: AgentProcessEvents) => {
        events.activity('working');
        if (background) {
          events.agentEvent(backgroundEvent(100, 1));
        }
      };
      test.harness.scriptAttach(
        'p1',
        outcome === 'null' ? { outcome, replay } : { outcome, message, replay },
      );

      restoreOne(test, hostedRecord({ activeMs: 42000 }), [hostedP1()]);
      test.setNow(7000);
      await flush();

      expect(test.chat.sessions()[0].running).toBe(false);
      expect(test.sent('activeTime')).toEqual([]);
      expect(test.chat.sessions()[0].activeTime).toEqual({
        totalMs: 42000,
        since: null,
      });
      expect(test.saved.last()?.sessions[0].activeMs).toBe(42000);
    },
  );

  it.each(CLOCK_RUNNING)(
    'ended_MidSpan_ClosesTheTotal: $given',
    async ({ steps }) => {
      const test = await started();
      test.chat.restore(NOTHING_SAVED, []);
      runClockSteps(test, steps);
      test.setNow(5000);

      test.process.events.ended({ code: 0, error: null });

      const closed = { totalMs: 4000, since: null };
      expect(test.chat.sessions()[0].activeTime).toEqual(closed);
      expect(test.sent('activeTime').at(-1)?.activeTime).toEqual(closed);
      expect(test.saved.last()?.sessions[0].activeMs).toBe(4000);
    },
  );

  it.each(CLOCK_RUNNING)(
    'clear_ClockRunning_StaysAtZero: $given',
    async ({ steps }) => {
      const test = await started();
      test.chat.restore(NOTHING_SAVED, []);
      runClockSteps(test, steps);
      test.setNow(5000);

      test.chat.clear(ROW_ID);
      await flush();
      test.setNow(8000);
      test.process.events.agentEvent(backgroundEvent(8000, 0));
      test.process.events.ended({ code: 0, error: null });
      await flush();

      expect(test.sent('activeTime').at(-1)?.activeTime).toEqual(
        NO_ACTIVE_TIME,
      );
      expect(test.chat.sessions()[0].activeTime).toEqual(NO_ACTIVE_TIME);
      expect(test.saved.last()?.sessions[0].activeMs).toBe(0);
    },
  );

  it.each([
    { given: 'the start succeeding', startFails: false },
    { given: 'the start throwing', startFails: true },
  ])(
    'restore_SkippedRecord_ANewHeldRowTakesOverItsTotal given $given',
    async ({ startFails }) => {
      const test = setUp();
      const hostId = PAST_ONE.sessionId;
      test.chat.recordOpenHostId(connected('row-relay', hostId));
      test.chat.restore(
        {
          sessions: [
            record(hostId, {
              activeMs: 42000,
              queued: [{ text: 'saved', images: [] }],
            }),
          ],
          selectedHostSessionId: null,
        },
        [],
      );
      test.chat.sessionEnded('row-relay');
      if (startFails) {
        test.harness.failNextStart('no start');
      }

      const resuming = test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: hostId,
        title: PAST_ONE.title,
      });
      await (startFails ? expect(resuming).rejects.toThrow() : resuming);

      expect(test.saved.last()?.sessions[0].activeMs).toBe(42000);
      expect(test.sent('activeTime')[0].activeTime).toEqual({
        totalMs: 42000,
        since: null,
      });
    },
  );

  it('restore_RecordOfAHeldRow_AddsItsTotalToARunningClock', async () => {
    const test = await started();
    runClockSteps(test, [{ at: 1000, activity: 'working' }]);
    test.setNow(3000);

    restoreOne(test, record('fake-session-1', { activeMs: 42000 }), []);

    expect(test.chat.sessions()[0].activeTime).toEqual({
      totalMs: 42000,
      since: 1000,
    });
    expect(test.sent('activeTime').at(-1)?.activeTime).toEqual({
      totalMs: 42000,
      since: 1000,
    });
    expect(test.saved.last()?.sessions[0].activeMs).toBe(44000);
  });
});

describe('createChatSessions titles', () => {
  it.each([
    {
      given: 'a first message then a second',
      act: async (chat: ChatSessions) => {
        await chat.send(ROW_ID, { text: '  fix the\nlogin bug', images: [] });
        await chat.send(ROW_ID, { text: 'and the logout', images: [] });
      },
      expected: [[ROW_ID, 'firstMessage', 'fix the\nlogin bug']],
    },
    {
      given: 'a first message over 200 code points',
      act: (chat: ChatSessions) =>
        chat.send(ROW_ID, { text: '🙂a'.repeat(150), images: [] }),
      expected: [[ROW_ID, 'firstMessage', '🙂a'.repeat(100)]],
    },
    {
      given: 'a first message opening with 250 spaces',
      act: (chat: ChatSessions) =>
        chat.send(ROW_ID, { text: `${' '.repeat(250)}fix it`, images: [] }),
      expected: [[ROW_ID, 'firstMessage', 'fix it']],
    },
    {
      given: 'a whitespace-only first message',
      act: (chat: ChatSessions) =>
        chat.send(ROW_ID, { text: ' \n\t ', images: [] }),
      expected: [],
    },
    {
      given: 'an images-only first message',
      act: (chat: ChatSessions) =>
        chat.send(ROW_ID, {
          text: '',
          images: [{ mediaType: 'image/png', data: 'iVBORw0K' }],
        }),
      expected: [],
    },
  ])('deliver_FirstMessage_SetsItsTitle given $given', async (row) => {
    const test = await started();

    await row.act(test.chat);

    expect(test.titleCalls).toEqual(row.expected);
  });

  it('deliver_FirstMessageAfterClear_KeepsTheTitle', async () => {
    const test = await started();
    await test.chat.send(ROW_ID, { text: 'first', images: [] });
    test.chat.clear(ROW_ID);
    await flush();
    test.titleCalls.length = 0;

    await test.chat.send(ROW_ID, { text: 'second', images: [] });

    expect(test.titleCalls).toEqual([]);
    expect(test.titlesOf(ROW_ID)?.firstMessage).toBe('first');
  });

  it.each([
    { given: 'a short title', title: 'Past work', expected: 'Past work' },
    {
      given: 'a title over 200 code points',
      title: '🙂a'.repeat(150),
      expected: '🙂a'.repeat(100),
    },
  ])(
    'resume_SetsTheRequestTitleAndSavesIt given $given',
    async ({ title, expected }) => {
      const test = setUp();
      test.chat.restore(NOTHING_SAVED, []);

      await test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: PAST_ONE.sessionId,
        title,
      });

      expect(test.titleCalls).toEqual([[ROW_ID, 'firstMessage', expected]]);
      expect(test.saved.last()?.sessions[0].titles).toEqual({
        ...NO_TITLES,
        firstMessage: expected,
      });
    },
  );

  it('restore_SavedTitles_SetsEachSavedSource', () => {
    const test = setUp();
    const titles = { user: null, agent: 'Plan review', firstMessage: 'hi' };

    test.chat.restore(
      {
        sessions: [record('host-a', { titles })],
        selectedHostSessionId: null,
      },
      [],
    );

    expect(test.titleCalls).toEqual([
      [ROW_ID, 'agent', 'Plan review'],
      [ROW_ID, 'firstMessage', 'hi'],
    ]);
    expect(test.titlesOf(ROW_ID)).toEqual(titles);
  });

  it('titleChanged_HeldRow_SavesItsCurrentTitles', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    const renamed = { ...NO_TITLES, agent: 'Named by agent' };
    test.setRowTitles(ROW_ID, renamed);
    const savesBefore = test.saved.saves();

    test.chat.titleChanged(ROW_ID);

    expect(test.saved.saves()).toBe(savesBefore + 1);
    expect(test.saved.last()?.sessions[0].titles).toEqual(renamed);
  });

  it('titleChanged_RowChatDoesNotHold_SavesNothing', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    const savesBefore = test.saved.saves();

    test.chat.titleChanged('row-9');

    expect(test.saved.saves()).toBe(savesBefore);
  });
});

// The host's entry for process `p1`, running in the current host and started at
// 5000, unless `fields` say otherwise.
function hostedP1(fields: Partial<HostedProcessInfo> = {}): HostedProcessInfo {
  return { id: 'p1', startedAt: 5000, running: true, current: true, ...fields };
}

// A record of `host-a` whose process is `p1`, unless `fields` say otherwise.
function hostedRecord(fields: Partial<SavedSession> = {}): SavedSession {
  return record('host-a', { processId: 'p1', ...fields });
}

function restoreOne(
  test: ReturnType<typeof setUp>,
  saved: SavedSession,
  hosted: readonly HostedProcessInfo[] | null,
) {
  test.chat.restore({ sessions: [saved], selectedHostSessionId: null }, hosted);
}

const QUIT_NOTICE =
  'The app quit during this turn. Your next message resumes this session.';
const OLDER_HOST_NOTICE =
  'This session is finishing its turn in another app version. Send a message once it ends.';
const OLDER_HOST_REFUSAL =
  'This session is still finishing in another app version. Send again once it ends.';
const STOPPED_NOTICE =
  'Session stopped. Your next message resumes this session.';

function noticesOf(test: ReturnType<typeof setUp>, row = 0) {
  return test.chat
    .sessions()
    [row].entries.flatMap((entry) =>
      entry.kind === 'notice'
        ? [{ kind: entry.kind, tone: entry.tone, text: entry.text }]
        : [],
    );
}

function startsOf(test: ReturnType<typeof setUp>) {
  return test.harness.processes.filter((process) => !process.attached);
}

function attachedOf(test: ReturnType<typeof setUp>) {
  return test.harness.processes.filter((process) => process.attached);
}

describe('createChatSessions process ids and the saved queue', () => {
  // Breaks if a process id starts with the host id before the row has one,
  // or with the row id once it does, which a later resume could not find.
  it('startProcess_ProcessId_RowIdUntilTheHostIdIsKnown', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    const firstSaved = test.saved.last()?.sessions[0];
    await test.chat.send(ROW_ID, { text: 'hi', images: [] });

    test.harness.processes[0].events.ended({ code: 0, error: null });
    await test.chat.send(ROW_ID, { text: 'again', images: [] });
    await flush();

    expect(
      test.harness.processes.map((each) => each.request.processId),
    ).toEqual(['row-1-1-1000', 'fake-session-1-2-1000']);
    expect(firstSaved?.processId).toBe('row-1-1-1000');
    expect(firstSaved?.launchResume).toBe(false);
    const lastSaved = test.saved.last()?.sessions[0];
    expect(lastSaved?.processId).toBe('fake-session-1-2-1000');
    expect(lastSaved?.launchResume).toBe(true);
  });

  it('save_QueuedChange_SavesUnsentRowsWithImages', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    test.harness.processes[0].events.activity('working');
    const image = { mediaType: 'image/png' as const, data: 'AAAA' };
    const saves = [test.saved.saves()];

    await test.chat.send(ROW_ID, { text: 'a', images: [image] });
    saves.push(test.saved.saves());
    await test.chat.send(ROW_ID, { text: 'b', images: [] });
    saves.push(test.saved.saves());
    test.chat.sendNow(ROW_ID, 'queued-2');
    saves.push(test.saved.saves());

    expect(saves[1]).toBeGreaterThan(saves[0]);
    expect(saves[2]).toBeGreaterThan(saves[1]);
    expect(saves[3]).toBeGreaterThan(saves[2]);
    expect(test.saved.last()?.sessions[0].queued).toEqual([
      { text: 'a', images: [image] },
    ]);
  });
});

describe('createChatSessions restoring hosted processes', () => {
  it.each([
    {
      given: 'running, current',
      fields: {
        sent: true,
        launchResume: false,
        launchControls: { effort: 'high' },
      },
      hosted: [hostedP1()],
      attaches: 1,
      notices: [],
      running: true,
    },
    {
      given: 'running, older',
      fields: {},
      hosted: [hostedP1({ current: false })],
      attaches: 0,
      notices: [{ kind: 'notice', tone: 'info', text: OLDER_HOST_NOTICE }],
      running: false,
    },
    {
      given: 'ended',
      fields: {},
      hosted: [hostedP1({ running: false })],
      attaches: 0,
      notices: [{ kind: 'notice', tone: 'info', text: QUIT_NOTICE }],
      running: false,
    },
    {
      given: 'not listed',
      fields: {},
      hosted: [],
      attaches: 0,
      notices: [{ kind: 'notice', tone: 'info', text: QUIT_NOTICE }],
      running: false,
    },
    {
      given: 'running, current, profile gone',
      fields: { profile: 'gone' },
      hosted: [hostedP1()],
      attaches: 0,
      notices: [
        {
          kind: 'notice',
          tone: 'error',
          text: expect.stringContaining('gone'),
        },
      ],
      running: false,
    },
    {
      given: 'list unknown',
      fields: {},
      hosted: null,
      attaches: 0,
      notices: [],
      running: false,
    },
    {
      given: 'list unknown, no process id',
      fields: { processId: null },
      hosted: null,
      attaches: 0,
      notices: [],
      running: false,
    },
  ])(
    'restore_HostedProcess_PicksThePath given $given',
    async ({ fields, hosted, attaches, notices, running }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay() {},
      });

      restoreOne(test, hostedRecord({ busy: true, ...fields }), hosted);
      await flush();

      expect(test.harness.attachCalls).toHaveLength(attaches);
      if (attaches === 1) {
        expect(test.harness.attachCalls[0]).toMatchObject({
          processId: 'p1',
          resume: false,
          controls: { effort: 'high' },
        });
      }
      expect(noticesOf(test)).toEqual(notices);
      expect(test.chat.sessions()[0].running).toBe(running);
    },
  );

  const heldControl = (id: string, value: string | null): SessionControl => ({
    id,
    label: id,
    choices: [],
    value,
  });
  const HELD_CONTROLS = [
    heldControl('mode', 'plan'),
    heldControl('model', 'opus'),
    heldControl('effort', 'high'),
  ];
  const HELD_RECORD = {
    processId: 'p1',
    controls: HELD_CONTROLS,
    confirmedPicks: { model: 'opus', effort: 'high' },
  };
  const LOW_EFFORT_PICK: Record<string, string> = { effort: 'low' };

  it.each([
    {
      given: 'a re-attached row whose process ends',
      fields: HELD_RECORD,
      hosted: [hostedP1()],
      replayed: [
        heldControl('mode', 'default'),
        heldControl('model', 'opus'),
        heldControl('effort', 'high'),
      ],
      shown: HELD_CONTROLS,
      passed: { mode: 'default', model: 'opus', effort: 'high' },
    },
    {
      given: 'a re-attached row whose replay reports no effort',
      fields: HELD_RECORD,
      hosted: [hostedP1()],
      replayed: [
        heldControl('mode', 'default'),
        heldControl('model', 'opus'),
        heldControl('effort', null),
      ],
      shown: HELD_CONTROLS,
      passed: { mode: 'default', model: 'opus' },
    },
    {
      given: 'a resting row',
      fields: HELD_RECORD,
      hosted: [],
      replayed: null,
      shown: HELD_CONTROLS,
      passed: { mode: 'plan', model: 'opus', effort: 'high' },
    },
    {
      given: 'a row whose picks are only reports',
      fields: { ...HELD_RECORD, confirmedPicks: {} },
      hosted: [],
      replayed: null,
      shown: HELD_CONTROLS,
      passed: { mode: 'plan' },
    },
    {
      given: 'a row whose held effort differs from its pick',
      fields: { ...HELD_RECORD, confirmedPicks: LOW_EFFORT_PICK },
      hosted: [],
      replayed: null,
      shown: HELD_CONTROLS,
      passed: { mode: 'plan', effort: 'low' },
    },
    {
      given: 'a saved file without controls',
      fields: { processId: 'p1' },
      hosted: [],
      replayed: null,
      shown: [],
      passed: {},
    },
  ])(
    'restore_HeldControls_ShownAndPassedAtTheNextStart given $given',
    async ({ fields, hosted, replayed, shown, passed }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay: (events) => {
          expect(test.chat.sessions()[0].controls).toEqual(shown);
          events.controls(replayed ?? []);
        },
      });

      restoreOne(test, hostedRecord(fields), hosted);
      expect(test.chat.sessions()[0].controls).toEqual(shown);
      expect(test.saved.last()?.sessions[0].confirmedPicks).toEqual(
        hostedRecord(fields).confirmedPicks,
      );
      await flush();
      attachedOf(test)[0]?.events.ended({ code: 0, error: null });
      await test.chat.send(ROW_ID, { text: 'next', images: [] });
      await flush();

      expect(startsOf(test).at(-1)?.request.controls).toEqual(passed);
    },
  );

  it('controls_ConfirmedPick_SavedWithTheRow', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    const controls = [
      heldControl('mode', 'auto'),
      heldControl('model', 'fake-large'),
    ];

    test.chat.setControl(ROW_ID, 'model', 'fake-large');
    test.harness.processes[0].events.controls(controls);

    expect(test.saved.last()?.sessions[0]).toMatchObject({
      controls,
      confirmedPicks: { model: 'fake-large' },
    });
  });

  it.each([
    { queued: [{ text: 'a', images: [] }], returned: [], kept: true },
    { queued: [], returned: [{ text: 'b', images: [] }], kept: true },
    { queued: [], returned: [], kept: false },
  ])(
    'restore_SkippedRecordHoldingMessages_StaysSaved given $queued.length queued, $returned.length returned',
    ({ queued, returned, kept }) => {
      const test = setUp();
      test.chat.recordOpenHostId(connected('row-relay', 'host-a'));

      test.chat.restore(
        {
          sessions: [record('host-a', { queued, returned }), record('host-b')],
          selectedHostSessionId: null,
        },
        [],
      );

      const saved = test.saved.last()?.sessions ?? [];
      expect(saved.map((each) => each.hostSessionId)).toEqual(
        kept ? ['host-b', 'host-a'] : ['host-b'],
      );
      const line =
        'session host-a not restored; its 1 queued or returned message(s) stay saved';
      expect(test.logged.includes(line)).toBe(kept);
      if (kept) {
        expect(saved[1].queued).toEqual(queued);
        expect(saved[1].returned).toEqual(returned);
      }
    },
  );

  it.each([
    { given: 'the start succeeding', startFails: false },
    { given: 'the start throwing', startFails: true },
  ])(
    'restore_SkippedRecord_ANewHeldRowTakesOverItsMessages given $given',
    async ({ startFails }) => {
      const test = setUp();
      const hostId = PAST_ONE.sessionId;
      const queued = [{ text: 'saved', images: [] }];
      const returned = [{ text: 'not placed', images: [] }];
      test.chat.recordOpenHostId(connected('row-relay', hostId));
      test.chat.restore(
        {
          sessions: [record(hostId, { queued, returned })],
          selectedHostSessionId: null,
        },
        [],
      );
      test.chat.sessionEnded('row-relay');
      if (startFails) {
        test.harness.failNextStart('no start');
      }

      const resuming = test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: hostId,
        title: PAST_ONE.title,
      });
      if (startFails) {
        await expect(resuming).rejects.toThrow('no start');
      } else {
        await resuming;
      }

      expect(test.sent('queued')[0].queued.map((row) => row.text)).toEqual([
        'saved',
      ]);
      expect(test.sentReturned()[0].messages).toEqual(returned);
      const saved = test.saved.last()?.sessions ?? [];
      expect(saved.map((each) => each.hostSessionId)).toEqual([hostId]);
      expect(saved[0].returned).toEqual(returned);
      if (startFails) {
        expect(test.chat.sessions()).toEqual([]);
        expect(saved[0].queued).toEqual(queued);
      }
    },
  );

  it('restore_RecordOfAHeldRow_TheRowTakesOverItsQueued', () => {
    const test = setUp();

    test.chat.restore(
      {
        sessions: [
          record('host-a', { queued: [{ text: 'first', images: [] }] }),
          record('host-a', { queued: [{ text: 'second', images: [] }] }),
        ],
        selectedHostSessionId: null,
      },
      [],
    );

    const saved = test.saved.last()?.sessions ?? [];
    expect(saved.map((each) => each.hostSessionId)).toEqual(['host-a']);
    expect(saved[0].queued.map((message) => message.text)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('createChatSessions attaching', () => {
  it.each([
    {
      given: 'detachAll',
      act: (test: ReturnType<typeof setUp>) => test.chat.detachAll(),
      replayEnds: false,
      calls: [{ method: 'detach' }],
      ownedEnds: 0,
      callsAtOwnedEnd: [],
      resting: null,
    },
    {
      given: 'a closed row',
      act: (test: ReturnType<typeof setUp>) => test.chat.closed(ROW_ID, 'user'),
      replayEnds: false,
      calls: [{ method: 'end' }],
      ownedEnds: 1,
      callsAtOwnedEnd: [{ method: 'end' }],
      resting: null,
    },
    {
      given: 'a closed row, then detachAll',
      act: (test: ReturnType<typeof setUp>) => {
        test.chat.closed(ROW_ID, 'user');
        test.chat.detachAll();
      },
      replayEnds: false,
      calls: [{ method: 'kill' }],
      ownedEnds: 1,
      callsAtOwnedEnd: [{ method: 'kill' }],
      resting: null,
    },
    {
      given: 'the replay firing ended',
      act: () => {},
      replayEnds: true,
      calls: [],
      ownedEnds: 0,
      callsAtOwnedEnd: [],
      resting: 'stopped (exit code 0). Your next message resumes this session.',
    },
  ])(
    'attach_LateResult_DetachesOrEnds given $given',
    async ({ act, replayEnds, calls, ownedEnds, callsAtOwnedEnd, resting }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 1,
        replay(events) {
          events.entry(userEntry('r1', 'replayed'));
          if (replayEnds) {
            events.ended({ code: 0, error: null });
          }
        },
      });
      restoreOne(test, hostedRecord(), [hostedP1()]);
      let seenAtOwnedEnd: unknown[] = [];
      test.setOnOwnedEnd(() => {
        seenAtOwnedEnd = [...attachedOf(test)[0].calls];
      });

      act(test);
      await flush();

      expect(attachedOf(test)[0].calls).toEqual(calls);
      expect(test.ownedEnds()).toBe(ownedEnds);
      expect(seenAtOwnedEnd).toEqual(callsAtOwnedEnd);
      if (!replayEnds) {
        expect(test.sent('entry')).toEqual([]);
      }
      if (resting !== null) {
        expect(test.chat.sessions()[0].running).toBe(false);
        expect(noticesOf(test).map((notice) => notice.text)).toEqual([
          `${test.harness.info().label} ${resting}`,
        ]);
      }
    },
  );

  it.each([
    {
      call: 'setControl',
      act: (test: ReturnType<typeof setUp>) =>
        test.chat.setControl(ROW_ID, 'effort', 'high'),
      throws: `session ${ROW_ID} is still attaching`,
      logged: null,
      calls: [],
    },
    {
      call: 'clear',
      act: (test: ReturnType<typeof setUp>) => test.chat.clear(ROW_ID),
      throws: `session ${ROW_ID} is still attaching`,
      logged: null,
      calls: [],
    },
    {
      call: 'interrupt',
      act: (test: ReturnType<typeof setUp>) => test.chat.interrupt(ROW_ID),
      throws: null,
      logged: `session ${ROW_ID} interrupt waits for the attach`,
      calls: [{ method: 'interrupt' }],
    },
  ])(
    'attach_CallsWhileAttaching_WaitOrRefuse given $call',
    async ({ act, throws, logged, calls }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay: (events) => events.activity('working'),
      });
      restoreOne(test, hostedRecord(), [hostedP1()]);

      if (throws === null) {
        act(test);
      } else {
        expect(() => act(test)).toThrow(throws);
      }
      if (logged !== null) {
        expect(test.logged).toContain(logged);
      }
      await flush();

      expect(attachedOf(test)[0].calls).toEqual(calls);
      expect(test.hostIdChanges).toEqual([]);
    },
  );

  const WRITTEN_BEFORE_QUIT: UserMessage = { text: 'dropped', images: [] };

  it.each([
    {
      given: 'a drop in the replay',
      returnedDrops: [],
      inReplay: 1,
      live: 0,
      returned: 1,
    },
    {
      given: 'a drop once live',
      returnedDrops: [],
      inReplay: 0,
      live: 1,
      returned: 1,
    },
    {
      given: 'a repeat of the drop',
      returnedDrops: [],
      inReplay: 1,
      live: 1,
      returned: 1,
    },
    {
      given: 'a drop an earlier run returned',
      returnedDrops: ['user-1'],
      inReplay: 1,
      live: 0,
      returned: 0,
    },
  ])(
    'attach_DroppedMessage_ComesBackOnce given $given',
    async ({ returnedDrops, inReplay, live, returned }) => {
      const test = setUp();
      const dropTimes = (events: AgentProcessEvents, times: number) => {
        for (let drop = 0; drop < times; drop += 1) {
          events.messageDropped('user-1', WRITTEN_BEFORE_QUIT);
        }
      };
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay: (events) => dropTimes(events, inReplay),
      });

      restoreOne(test, hostedRecord({ returnedDrops }), [hostedP1()]);
      await flush();
      dropTimes(attachedOf(test)[0].events, live);

      expect(test.sentReturned()).toEqual(
        Array.from({ length: returned }, () => ({
          sessionId: ROW_ID,
          messages: [WRITTEN_BEFORE_QUIT],
        })),
      );
      expect(test.saved.last()?.sessions[0].returnedDrops).toEqual(['user-1']);
    },
  );

  it.each([
    {
      path: 'a pull-back',
      returns: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.pullBack(ROW_ID, 'queued-1'),
      texts: ['first'],
    },
    {
      path: 'an interrupt',
      returns: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.interrupt(ROW_ID),
      texts: ['first', 'second'],
    },
    {
      path: 'a clear',
      returns: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.clear(ROW_ID),
      texts: ['first', 'second'],
    },
    {
      path: 'the process ending',
      returns: (test: Awaited<ReturnType<typeof started>>) =>
        test.process.events.ended({ code: 0, error: null }),
      texts: ['first', 'second'],
    },
    {
      path: 'a drop',
      returns: (test: Awaited<ReturnType<typeof started>>) =>
        test.process.events.messageDropped('user-9', {
          text: 'dropped',
          images: [],
        }),
      texts: ['dropped'],
    },
  ])(
    'returned_EveryPath_HeldAndSavedUntilThePagePlacesIt: $path',
    async ({ returns, texts }) => {
      const test = await started();
      test.chat.restore({ sessions: [], selectedHostSessionId: null }, []);
      queueTwo(test);

      returns(test);

      const heldTexts = () =>
        test.chat.sessions()[0].returned.map((held) => held.text);
      const savedTexts = () =>
        test.saved.last()?.sessions[0].returned.map((held) => held.text);
      expect(heldTexts()).toEqual(texts);
      expect(savedTexts()).toEqual(texts);

      test.chat.returnedPlaced(ROW_ID, [
        test.chat.sessions()[0].returned[0].id,
      ]);

      expect(heldTexts()).toEqual(texts.slice(1));
      expect(savedTexts()).toEqual(texts.slice(1));
    },
  );

  it('returned_DropInReplayAcrossRelaunches_HeldUntilPlacedThenGone', async () => {
    const relaunch = async (saved: SavedSession) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay: (events) =>
          events.messageDropped('user-1', WRITTEN_BEFORE_QUIT),
      });
      restoreOne(test, saved, [hostedP1()]);
      await flush();
      return test;
    };

    // No page heard the first return; the app quits before one places it.
    const noPage = await relaunch(hostedRecord());
    const quitRecord = noPage.saved.last()?.sessions[0];
    expect(quitRecord?.returned).toEqual([WRITTEN_BEFORE_QUIT]);
    expect(quitRecord?.returnedDrops).toEqual(['user-1']);

    // The next relaunch holds it once, though the replay finds the drop again.
    const held = await relaunch(quitRecord as SavedSession);
    const [{ id, ...message }] = held.chat.sessions()[0].returned;
    expect(message).toEqual(WRITTEN_BEFORE_QUIT);
    expect(held.chat.sessions()[0].returned).toHaveLength(1);

    // The page places it, and it never comes back.
    held.chat.returnedPlaced(ROW_ID, [id]);
    const placedRecord = held.saved.last()?.sessions[0];
    expect(placedRecord?.returned).toEqual([]);
    const after = await relaunch(placedRecord as SavedSession);
    expect(after.chat.sessions()[0].returned).toEqual([]);
    expect(after.sent('returned')).toEqual([]);
  });

  it('startProcess_NewProcess_ForgetsTheOldProcessesDrops', async () => {
    const test = setUp();
    const message: UserMessage = { text: 'second process', images: [] };

    restoreOne(test, record('host-a', { returnedDrops: ['user-1'] }), []);
    await test.chat.send(ROW_ID, { text: 'starts it', images: [] });
    await flush();
    test.harness.processes[0].events.messageDropped('user-1', message);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [message] },
    ]);
  });

  it('attach_ReplayedEvents_FlaggedNoMarkNoPlanUsage', async () => {
    const test = setUp();
    test.setFocused(false);
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 1,
      replay(events) {
        events.entry(assistant('r1', 'replayed'));
        events.activity('working');
        events.activity('idle');
        events.agentEvent({ type: 'turnEnded', at: 1000 });
        events.planUsage(fakePlanRowUpdate(1, 1000));
        events.agentEvent({ type: 'sessionEnded', at: 1500 });
      },
    });
    restoreOne(test, hostedRecord(), [hostedP1()]);
    await flush();
    const { events } = attachedOf(test)[0];

    events.activity('working');
    events.agentEvent({ type: 'turnEnded', at: 2000 });
    events.activity('idle');

    expect(test.sent('entry').map(({ entry }) => entry.id)).toEqual(['r1']);
    expect(
      test.emitted.flatMap((each) =>
        each.event === 'agentEvent'
          ? [[each.data.event.at, each.data.replayed]]
          : [],
      ),
    ).toEqual([
      [1000, true],
      [1500, false],
      [2000, false],
    ]);
    expect(test.emitted.filter((each) => each.event === 'planUsage')).toEqual(
      [],
    );
    expect(test.marked).toHaveLength(1);
  });

  it.each([
    {
      given: 'the turn running',
      replayed: 'working' as const,
      writesAtResolve: [],
    },
    // The fake's echo of `a` ends its turn, which writes `b`; no idle came
    // before `a`.
    {
      given: 'the turn over',
      replayed: 'idle' as const,
      writesAtResolve: ['a', 'b'],
    },
  ])(
    'attach_SavedQueued_WrittenOnceTheTurnEnds given $given',
    async ({ replayed, writesAtResolve }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay: (events) => events.activity(replayed),
      });
      const queued = [
        { text: 'a', images: [] },
        { text: 'b', images: [] },
      ];
      restoreOne(test, hostedRecord({ queued }), [hostedP1()]);
      expect(
        test
          .sent('queued')
          .at(-1)
          ?.queued.map((row) => row.id),
      ).toEqual(['queued-1', 'queued-2']);
      await flush();
      const process = attachedOf(test)[0];
      const written = () =>
        process.calls.flatMap((call) =>
          call.method === 'send' ? [call.text] : [],
        );

      expect(written()).toEqual(writesAtResolve);
      if (replayed === 'working') {
        process.events.activity('idle');
        expect(written()).toEqual(['a']);
        await flush();
      }
      expect(written()).toEqual(['a', 'b']);
    },
  );

  it.each([
    {
      given: 'a null',
      script: { outcome: 'null' as const },
      logged: `session ${ROW_ID} not re-attached: process p1 is not running`,
      notices: [QUIT_NOTICE],
    },
    {
      given: 'a rejection, whose turn may still run',
      script: { outcome: 'reject' as const, message: 'host gone' },
      logged: `session ${ROW_ID} not re-attached: host gone`,
      notices: [],
    },
  ])(
    'attach_NullOrRejects_RestsWithQuitNoticeOnlyOnNull given $given',
    async ({ script, logged, notices }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', script);
      const attach = test.harness.attach.bind(test.harness);
      test.harness.attach = (request, events) => {
        events.activity('working');
        events.permission({
          entry: {
            kind: 'permission',
            id: 'replayed-permission',
            at: 0,
            toolName: 'Bash',
            input: { command: 'ls' },
            answer: null,
            raw: [],
          },
        });
        events.agentEvent({
          type: 'taskStarted',
          at: 0,
          taskId: 'task-1',
          agentId: MAIN_AGENT_ID,
          description: 'task',
          command: null,
        });
        return attach(request, events);
      };

      restoreOne(test, hostedRecord({ busy: true, sent: true }), [hostedP1()]);
      expect(test.chat.sessions()[0].background).toBe(1);
      expect(test.harness.lastUsageCalls).toEqual([]);
      await flush();

      expect(test.chat.sessions()[0].background).toBe(0);
      expect(test.saved.last()?.sessions[0].busy).toBe(false);
      expect(test.chat.sessions()[0].running).toBe(false);
      expect(test.chat.sessions()[0].activity).toBe('idle');
      expect(
        test.chat
          .sessions()[0]
          .entries.find((entry) => entry.kind === 'permission'),
      ).toEqual(
        expect.objectContaining({
          answer: { allowed: false, reason: PERMISSION_CANCELLED_REASON },
        }),
      );
      expect(test.sent('sessionRested')).toEqual([
        { sessionId: ROW_ID, error: null },
      ]);
      expect(noticesOf(test).map((notice) => notice.text)).toEqual(notices);
      expect(test.logged).toContain(logged);
      expect(test.harness.lastUsageCalls).toEqual(['host-a']);
      test.sessionHost.setList([]);
      await test.chat.loadHistory(ROW_ID);
      expect(
        test.harness.pastSessionCalls
          .filter((call) => call.method === 'history')
          .map((call) => call.before),
      ).toEqual([null]);
    },
  );

  it('attach_ProcessExitsDuringTheReplay_KeepsItsSavedQueued', async () => {
    const test = setUp();
    const queued = [{ text: 'a', images: [] }];
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 0,
      replay: (events) => events.ended({ code: 0, error: null }),
    });

    restoreOne(test, hostedRecord({ queued }), [hostedP1()]);
    await flush();

    expect(test.sentReturned()).toEqual([]);
    expect(test.chat.sessions()[0].queued.map((row) => row.text)).toEqual([
      'a',
    ]);
    expect(test.saved.last()?.sessions[0].queued).toEqual(queued);
  });

  it('loadHistory_BeforeAnAttachResolvesNull_ReadsWithNoCut', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', { outcome: 'null' });
    restoreOne(test, hostedRecord({ sent: true }), [hostedP1()]);

    await test.chat.loadHistory(ROW_ID);

    expect(
      test.harness.pastSessionCalls
        .filter((call) => call.method === 'history')
        .map((call) => call.before),
    ).toEqual([null]);
  });

  it('send_WhileAttaching_WaitsForTheAttach', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 0,
      replay() {},
    });
    restoreOne(test, hostedRecord(), [hostedP1()]);
    const message = { text: 'c', images: [] };

    const sending = test.chat.send(ROW_ID, message);
    expect(test.harness.processes).toEqual([]);
    await sending;
    await flush();

    expect(startsOf(test)).toEqual([]);
    expect(attachedOf(test)[0].calls).toEqual([sendCall(message)]);
  });
});

describe('createChatSessions unheld processes', () => {
  // A restored resting row with `unheldProcessId` p1, and a `list` the test sets.
  async function unheldRow(arrangement: 'profileBack' | 'attachRejected') {
    const held = { list: () => Promise.resolve<HostedProcessInfo[]>([]) };
    const test = setUp({ sessionHost: { list: () => held.list() } });
    if (arrangement === 'profileBack') {
      restoreOne(test, hostedRecord({ sent: true, profile: 'gone' }), [
        hostedP1(),
      ]);
      test.setProfiles([...PROFILES, { name: 'gone', configDir: '/gone' }]);
    } else {
      test.harness.scriptAttach('p1', {
        outcome: 'reject',
        message: 'defs failed',
      });
      restoreOne(test, hostedRecord({ sent: true }), [hostedP1()]);
      await flush();
    }
    return { test, held };
  }

  const ARRANGEMENTS = ['profileBack', 'attachRejected'] as const;
  const message = { text: 'c', images: [] };

  it.each(
    ARRANGEMENTS.flatMap((arrangement) => [
      {
        arrangement,
        at: 'p1 running, current, attach resolves',
        list: () => Promise.resolve([hostedP1()]),
        script: {
          outcome: 'process' as const,
          turns: 0,
          replay() {},
        },
        rejects: null,
        logged: null,
        attaches: 1,
        startResumes: [],
      },
      {
        arrangement,
        at: 'p1 running, current, attach rejects',
        list: () => Promise.resolve([hostedP1()]),
        script: { outcome: 'reject' as const, message: 'again' },
        rejects: 'again',
        logged: null,
        attaches: 1,
        startResumes: [],
      },
      {
        arrangement,
        at: 'p1 not running',
        list: () => Promise.resolve([hostedP1({ running: false })]),
        script: null,
        rejects: null,
        logged: null,
        attaches: 0,
        startResumes: [true],
      },
      {
        arrangement,
        at: 'list rejects',
        list: () => Promise.reject<HostedProcessInfo[]>(new Error('no host')),
        script: null,
        rejects: 'no host',
        logged: 'session host not listed: no host',
        attaches: 0,
        startResumes: [],
      },
    ]),
  )(
    'unheldGuard_SendListsFirst given $arrangement and $at',
    async ({
      arrangement,
      list,
      script,
      rejects,
      logged,
      attaches,
      startResumes,
    }) => {
      const { test, held } = await unheldRow(arrangement);
      held.list = list;
      if (script !== null) {
        test.harness.scriptAttach('p1', script);
      }
      const attachesBefore = test.harness.attachCalls.length;

      const sending = test.chat.send(ROW_ID, message);
      if (rejects === null) {
        await sending;
      } else {
        await expect(sending).rejects.toThrow(rejects);
      }
      await flush();

      const newAttaches = test.harness.attachCalls.slice(attachesBefore);
      expect(newAttaches.map((request) => request.processId)).toEqual(
        Array.from({ length: attaches }, () => 'p1'),
      );
      expect(startsOf(test).map((start) => start.request.resume)).toEqual(
        startResumes,
      );
      if (logged !== null) {
        expect(test.logged).toContain(logged);
      }
      if (rejects === null) {
        const process = test.harness.processes.at(-1);
        expect(process?.calls).toContainEqual(sendCall(message));
      }
    },
  );

  it.each([
    {
      given: 'an unheld row',
      arrange: async () => (await unheldRow('profileBack')).test,
    },
    {
      given: 'an attach that then rejects',
      arrange: () => {
        const test = setUp();
        test.harness.scriptAttach('p1', {
          outcome: 'reject',
          message: 'defs failed',
        });
        restoreOne(test, hostedRecord({ sent: true }), [hostedP1()]);
        return Promise.resolve(test);
      },
    },
  ])(
    'unheldGuard_ClosedRow_LogsTheProcessLeftRunning given $given',
    async ({ arrange }) => {
      const test = await arrange();

      test.chat.closed(ROW_ID, 'user');
      await flush();

      expect(test.logged).toContain(
        `session ${ROW_ID} closed; process p1 left running on the session host`,
      );
      expect(test.ownedEnds()).toBe(1);
    },
  );

  it('unheldGuard_ClearedRow_LogsAndStartsFresh', async () => {
    const { test } = await unheldRow('profileBack');

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.logged).toContain(
      `session ${ROW_ID} cleared; process p1 left running on the session host`,
    );
    expect(startsOf(test).map((start) => start.request.resume)).toEqual([
      false,
    ]);
    expect(test.harness.attachCalls).toEqual([]);
  });

  it('send_OlderHostProcess_RefusedUntilItEnds', async () => {
    const held = { list: () => Promise.resolve<HostedProcessInfo[]>([]) };
    const test = setUp({ sessionHost: { list: () => held.list() } });
    const older = [hostedP1({ current: false })];
    restoreOne(test, hostedRecord({ sent: true }), older);
    expect(test.logged).toContain(
      `session ${ROW_ID} waits on process p1 in another app version`,
    );

    held.list = () => Promise.resolve(older);
    await expect(test.chat.send(ROW_ID, message)).rejects.toThrow(
      OLDER_HOST_REFUSAL,
    );
    expect(test.harness.processes).toEqual([]);

    held.list = () => Promise.reject(new Error('no host'));
    await expect(test.chat.send(ROW_ID, message)).rejects.toThrow('no host');
    expect(test.logged).toContain('session host not listed: no host');
    expect(test.harness.processes).toEqual([]);
    expect(noticesOf(test).map((notice) => notice.text)).toEqual([
      OLDER_HOST_NOTICE,
    ]);

    held.list = () => Promise.resolve([hostedP1({ running: false })]);
    await test.chat.send(ROW_ID, message);
    await flush();

    expect(noticesOf(test).map((notice) => notice.text)).not.toContain(
      OLDER_HOST_NOTICE,
    );
    expect(
      test
        .sent('entries')
        .flatMap(({ entries }) => entries)
        .map((entry) => (entry.kind === 'notice' ? entry.text : null)),
    ).not.toContain(OLDER_HOST_NOTICE);
    expect(
      test.harness.pastSessionCalls.filter((call) => call.method === 'history'),
    ).toHaveLength(1);
    expect(startsOf(test).map((start) => start.request.resume)).toEqual([true]);
  });

  it('loadHistory_OlderHostRow_ReadsNothing', async () => {
    const test = setUp();
    const older = [hostedP1({ current: false })];
    restoreOne(test, hostedRecord({ sent: true }), older);

    test.sessionHost.setList(older);
    await test.chat.loadHistory(ROW_ID);
    expect(test.harness.pastSessionCalls).toEqual([]);

    test.sessionHost.setList([hostedP1({ running: false })]);
    await test.chat.loadHistory(ROW_ID);

    expect(test.harness.pastSessionCalls.map((call) => call.before)).toEqual([
      null,
    ]);
  });

  it('send_RestingRowWithSavedQueued_WritesTheSavedFirst', async () => {
    const test = setUp();
    restoreOne(
      test,
      record('host-a', { queued: [{ text: 'a', images: [] }] }),
      [],
    );

    const sending = test.chat.send(ROW_ID, message);

    expect(startsOf(test)).toHaveLength(1);
    expect(
      startsOf(test)[0].calls.flatMap((call) =>
        call.method === 'send' ? [call.text] : [],
      ),
    ).toEqual(['a']);
    expect(test.chat.sessions()[0].queued.map((row) => row.text)).toEqual([
      'c',
    ]);
    await sending;
  });
});

describe('createChatSessions stopAll', () => {
  it('stopAll_KillsEveryRunningProcess_RowsRestWithStoppedNotice', async () => {
    const test = setUp();
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'work',
    });
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();

    test.chat.stopAll();
    await flush();

    for (const process of test.harness.processes) {
      expect(process.calls).toEqual([{ method: 'kill' }]);
    }
    const stopped = [{ kind: 'notice', tone: 'info', text: STOPPED_NOTICE }];
    expect(noticesOf(test, 0)).toEqual(stopped);
    expect(noticesOf(test, 1)).toEqual(stopped);
    expect(test.chat.sessions().map((state) => state.running)).toEqual([
      false,
      false,
    ]);
    expect(test.logged).toContain('stopped 2 session process(es)');
  });

  it('stopAll_WorkingRow_MarksNothingAndWritesNothingQueued', async () => {
    const test = await started();
    const queued = { text: 'queued', images: [] };
    test.setFocused(false);
    test.activity('working');
    await test.chat.send(ROW_ID, queued);

    test.chat.stopAll();
    // The harness reports a closed process idle before its `ended`.
    test.activity('idle');
    await flush();

    expect(test.process.calls).toEqual([{ method: 'kill' }]);
    expect(test.marked).toEqual([]);
    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [queued] },
    ]);
    expect(noticesOf(test).map((notice) => notice.text)).toEqual([
      STOPPED_NOTICE,
    ]);
  });

  it('stopAll_SkipsAnAttachingRow', async () => {
    const test = await started();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 0,
      replay() {},
    });
    restoreOne(test, hostedRecord(), [hostedP1()]);

    test.chat.stopAll();
    await flush();

    expect(test.process.calls).toEqual([{ method: 'kill' }]);
    expect(test.logged).toContain('session row-2 still attaching; not stopped');
    expect(test.logged).toContain('stopped 1 session process(es)');
    expect(attachedOf(test)[0].calls).toEqual([]);
  });
});

const answerA: SendGate = () => ({ action: 'compact', reason: 'a' });
const answerB: SendGate = () => ({ action: 'compact', reason: 'b' });
const LATER: UserMessage = { text: 'later', images: [] };

function compactionStartedEvent(
  trigger: CompactionTrigger,
  at = 2000,
): AgentEvent {
  return { type: 'compactionStarted', at, trigger };
}

function compactionEndedEvent(
  outcome: 'done' | 'failed' | 'interrupted',
  trigger: CompactionTrigger = 'app',
): AgentEvent {
  return {
    type: 'compactionEnded',
    at: 3000,
    trigger,
    outcome,
    beforeTokens: null,
    durationMs: null,
  };
}

// A running session whose idle send of IDLE_SEND is held with reason `a`, row
// `queued-1`, the fake keeping its compaction open.
async function startedAndHeld(options?: Parameters<typeof setUp>[0]) {
  const test = await started(options);
  test.harness.holdCompactions();
  test.chat.addSendGate(answerA);
  await test.chat.send(ROW_ID, IDLE_SEND);
  await flush();
  return test;
}

describe('createChatSessions send gate and hold', () => {
  it.each([
    {
      given: 'no gate',
      gates: [] as SendGate[],
      disposes: false,
      calls: [sendCall(IDLE_SEND)],
      reasons: [] as (string | null)[],
      logged: [] as string[],
    },
    {
      given: 'a null gate',
      gates: [() => null],
      disposes: false,
      calls: [sendCall(IDLE_SEND)],
      reasons: [],
      logged: [],
    },
    {
      given: 'a null gate then A',
      gates: [() => null, answerA],
      disposes: false,
      calls: [{ method: 'compact' }],
      reasons: ['a'],
      logged: ['send held in row-1: a'],
    },
    {
      given: 'A then B',
      gates: [answerA, answerB],
      disposes: false,
      calls: [{ method: 'compact' }],
      reasons: ['a'],
      logged: ['send held in row-1: a'],
    },
    {
      given: 'a gate that throws then A',
      gates: [
        () => {
          throw new Error('boom');
        },
        answerA,
      ],
      disposes: false,
      calls: [{ method: 'compact' }],
      reasons: ['a'],
      logged: ['send gate failed in row-1: boom', 'send held in row-1: a'],
    },
    {
      given: 'A disposed twice',
      gates: [answerA],
      disposes: true,
      calls: [sendCall(IDLE_SEND)],
      reasons: [],
      logged: [],
    },
  ])(
    'sendGate_IdleSend_FirstVerdictWinsInRegistrationOrder: $given',
    async ({ gates, disposes, calls, reasons, logged }) => {
      const test = await started();
      test.harness.holdCompactions();
      const disposers = gates.map((gate) => test.chat.addSendGate(gate));
      if (disposes) {
        disposers.forEach((handle) => {
          handle.dispose();
          handle.dispose();
        });
      }

      await test.chat.send(ROW_ID, IDLE_SEND);

      expect(test.process.calls).toEqual(calls);
      expect(
        test.chat.sessions()[0].queued.map((row) => row.holdReason),
      ).toEqual(reasons);
      expect(test.logged).toEqual(expect.arrayContaining(logged));
    },
  );

  it('sendGate_SameFunctionAddedTwice_DisposeRemovesOnlyItsRegistration', async () => {
    const test = await started();
    test.harness.holdCompactions();
    const handle = test.chat.addSendGate(answerA);
    test.chat.addSendGate(answerA);

    handle.dispose();
    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(test.process.calls).toEqual([{ method: 'compact' }]);
  });

  it('sendGate_LaterGateAfterAVerdict_NotAsked', async () => {
    const test = await started();
    test.harness.holdCompactions();
    let laterCalls = 0;
    test.chat.addSendGate(answerA);
    test.chat.addSendGate(() => {
      laterCalls += 1;
      return null;
    });

    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(laterCalls).toBe(0);
  });

  it('sendGate_Input_RowHostTextAndNow', async () => {
    const test = await started({ clockNow: 5000 });
    const inputs: SendGateInput[] = [];
    test.chat.addSendGate((input) => {
      inputs.push(input);
      return null;
    });

    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(inputs).toEqual([
      {
        sessionId: 'row-1',
        hostSessionId: 'fake-session-1',
        text: IDLE_SEND.text,
        now: 5000,
      },
    ]);
  });

  it.each<{
    given: string;
    act(test: Awaited<ReturnType<typeof started>>): unknown;
    asked: number;
  }>([
    {
      given: 'a send while a turn runs',
      act: (test) => {
        test.activity('working');
        return test.chat.send(ROW_ID, IDLE_SEND);
      },
      asked: 0,
    },
    {
      given: 'an idle that drains a queued row',
      act: (test) => {
        queueTwo(test);
        test.activity('idle');
      },
      asked: 0,
    },
    {
      given: 'sendNow on a queued row',
      act: (test) => {
        queueTwo(test);
        test.chat.sendNow(ROW_ID, 'queued-1');
      },
      asked: 0,
    },
    {
      given: 'a launch',
      act: (test) =>
        test.chat.launch({
          projectDir: PROJECT_DIR,
          profile: 'personal',
          message: IDLE_SEND,
        }),
      asked: 0,
    },
    {
      given: 'sendAllNow at idle with a message',
      act: (test) => test.chat.sendAllNow(ROW_ID, IDLE_SEND),
      asked: 1,
    },
  ])('sendGate_NotAskedOffTheIdleWrite: $given', async ({ act, asked }) => {
    const test = await started();
    let calls = 0;
    test.chat.addSendGate(() => {
      calls += 1;
      return null;
    });

    await act(test);

    expect(calls).toBe(asked);
  });

  it('send_RestingRowHeld_StartsProcessThenCompacts', async () => {
    const test = setUp();
    test.harness.holdCompactions();
    test.chat.addSendGate(answerA);
    test.chat.restore(
      {
        sessions: [record('host-a', { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );

    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(test.harness.processes[0].calls).toEqual([{ method: 'compact' }]);
    const startedAt = test.logged.indexOf(
      'session row-1 process started (resume true)',
    );
    expect(startedAt).toBeGreaterThanOrEqual(0);
    expect(test.logged.indexOf('send held in row-1: a')).toBeGreaterThan(
      startedAt,
    );
  });

  it('send_TwoSendsToARestingRow_OneVerdictAndTwoRows', async () => {
    const test = setUp();
    test.harness.holdCompactions();
    let asked = 0;
    test.chat.addSendGate(() => {
      asked += 1;
      return { action: 'compact', reason: 'a' };
    });
    test.chat.restore(
      {
        sessions: [record('host-a', { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );

    await Promise.all([
      test.chat.send(ROW_ID, IDLE_SEND),
      test.chat.send(ROW_ID, LATER),
    ]);

    expect(asked).toBe(1);
    expect(test.harness.processes[0].calls).toEqual([{ method: 'compact' }]);
    expect(
      test.chat.sessions()[0].queued.map((row) => [row.text, row.holdReason]),
    ).toEqual([
      [IDLE_SEND.text, 'a'],
      [LATER.text, null],
    ]);
  });

  it('send_SavedRowsBehindAHold_WriteNoneUntilTheCompactionEnds', async () => {
    const test = setUp();
    test.harness.holdCompactions();
    test.chat.addSendGate(answerA);
    test.chat.restore(
      {
        sessions: [record('host-a', { queued: [PENDING] })],
        selectedHostSessionId: null,
      },
      [],
    );

    await test.chat.send(ROW_ID, IDLE_SEND);
    const process = test.harness.processes[0];
    process.events.activity('idle');

    expect(process.calls).toEqual([{ method: 'compact' }]);
    process.events.agentEvent(compactionEndedEvent('done'));
    expect(process.calls.at(-1)).toEqual(sendCall(PENDING));
  });

  it.each(['done', 'failed', 'interrupted'] as const)(
    'hold_LaterSendsQueueBehindAndReleaseInOrder: %s',
    async (outcome) => {
      const test = await startedAndHeld();
      const third: UserMessage = { text: 'third', images: [] };
      await test.chat.send(ROW_ID, LATER);
      await test.chat.send(ROW_ID, third);
      expect(test.chat.sessions()[0].queued.map((row) => row.text)).toEqual([
        IDLE_SEND.text,
        LATER.text,
        third.text,
      ]);

      test.activity('idle');
      expect(test.process.calls).toEqual([{ method: 'compact' }]);

      test.process.events.agentEvent(compactionEndedEvent(outcome));
      expect(test.process.calls.at(-1)).toEqual(sendCall(IDLE_SEND));
      expect(test.logged).toContain(
        `held message queued-1 released in row-1 (${outcome})`,
      );
      test.activity('idle');
      expect(test.process.calls.at(-1)).toEqual(sendCall(LATER));
      test.activity('idle');
      expect(test.process.calls.at(-1)).toEqual(sendCall(third));
    },
  );

  it('hold_CompactThrows_WritesAtOnce', async () => {
    const test = await started();
    let asked = 0;
    test.chat.addSendGate(() => {
      asked += 1;
      return asked === 2 ? { action: 'compact', reason: 'a' } : null;
    });

    void test.chat.send(ROW_ID, { text: FAKE_HOLD_TEXT, images: [] });
    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(test.process.calls.at(-1)).toEqual(sendCall(IDLE_SEND));
    expect(test.logged).toContain(
      'compaction not started in row-1: fake agent is running a turn',
    );
    expect(test.chat.sessions()[0].queued).toEqual([]);
  });

  it('hold_CompactAndThenSendThrow_SendRejectsWithNoRowLeft', async () => {
    const test = await startedRefusing();
    const refused: UserMessage = { text: REFUSED_TEXT, images: [] };
    test.chat.addSendGate((input) =>
      input.text === REFUSED_TEXT ? { action: 'compact', reason: 'a' } : null,
    );

    void test.chat.send(ROW_ID, { text: FAKE_HOLD_TEXT, images: [] });

    await expect(test.chat.send(ROW_ID, refused)).rejects.toThrow(
      'write refused',
    );
    expect(test.chat.sessions()[0].queued).toEqual([]);
  });

  it.each(['app', 'manual', 'harness'] as const)(
    'compaction_StateFollowsStartedAndEnded: %s',
    async (trigger) => {
      const test = await started({ clockNow: 2000 });
      expect(test.chat.sessions()[0].compaction).toBeNull();
      expect(test.sent('sessionStarted')[0].compaction).toBeNull();
      if (trigger === 'app') {
        test.harness.holdCompactions();
        test.chat.addSendGate(answerA);
        await test.chat.send(ROW_ID, IDLE_SEND);
        await flush();
      } else {
        test.process.events.agentEvent(compactionStartedEvent(trigger));
      }
      const running = {
        trigger,
        reason: trigger === 'app' ? 'a' : null,
        startedAt: 2000,
      };
      expect(test.chat.sessions()[0].compaction).toEqual(running);

      test.process.events.agentEvent(compactionEndedEvent('done', trigger));

      expect(test.chat.sessions()[0].compaction).toBeNull();
      expect(test.sent('compaction')).toEqual([
        { sessionId: ROW_ID, compaction: running },
        { sessionId: ROW_ID, compaction: null },
      ]);
    },
  );

  it('compaction_NoHold_QueuedRowsWaitForItsEnd', async () => {
    const test = await started();
    const [first] = queueTwo(test);
    test.process.events.agentEvent(compactionStartedEvent('manual'));

    test.activity('idle');
    expect(test.process.calls).toEqual([]);

    test.process.events.agentEvent(compactionEndedEvent('done', 'manual'));
    expect(test.process.calls).toEqual([sendCall(first)]);
  });

  it.each([
    {
      route: 'sendNow',
      act: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.sendNow(ROW_ID, 'queued-1'),
      written: [['first', false]],
    },
    {
      route: 'sendAllNow',
      act: (test: Awaited<ReturnType<typeof started>>) =>
        void test.chat.sendAllNow(ROW_ID, null),
      written: [
        ['first', false],
        ['second', false],
      ],
    },
  ])(
    'sendNow_CompactionInARunningTurn_WritesWithoutNow ($route)',
    async ({ act, written }) => {
      const test = await started();
      queueTwo(test);
      test.process.events.agentEvent(compactionStartedEvent('harness'));

      act(test);

      expect(writtenWithNow(test)).toEqual(written);
    },
  );

  it.each([
    {
      given: 'plain rows in a running turn',
      rows: ['a', 'b'],
      written: [
        ['a', true],
        ['b', true],
        ['box', true],
      ],
    },
    {
      // `/compact` may start a compaction a `now` write would cut short, and a
      // `now` row would run ahead of the plain row the agent has not taken in.
      given: 'slash text ahead of a plain row',
      rows: ['/compact', 'b'],
      written: [
        ['/compact', false],
        ['b', false],
        ['box', false],
      ],
    },
    {
      given: 'a plain row ahead of slash text',
      rows: ['a', '/compact'],
      written: [
        ['a', true],
        ['/compact', false],
        ['box', false],
      ],
    },
  ])(
    'sendAllNow_TurnRunning_WritesNowUntilAPlainWrite: $given',
    async (row) => {
      const test = await started();
      test.activity('working');
      for (const text of row.rows) {
        test.chat.send(ROW_ID, { text, images: [] });
      }

      await test.chat.sendAllNow(ROW_ID, { text: 'box', images: [] });

      expect(writtenWithNow(test)).toEqual(row.written);
    },
  );

  it('sendNow_PlainWriteNotTakenIn_WritesWithoutNow', async () => {
    const test = await started();
    queueTwo(test);
    test.process.events.agentEvent(compactionStartedEvent('harness'));
    test.chat.sendNow(ROW_ID, 'queued-1');
    test.process.events.agentEvent(compactionEndedEvent('done', 'harness'));

    test.chat.sendNow(ROW_ID, 'queued-2');

    expect(writtenWithNow(test)).toEqual([
      ['first', false],
      ['second', false],
    ]);
  });

  it('compaction_EndWithNoStart_SendsNoMessage', async () => {
    const test = await started();

    test.process.events.agentEvent(compactionEndedEvent('done'));

    expect(test.sent('compaction')).toEqual([]);
  });

  it('compaction_Replayed_EndDrainsOnlyAtTheAttachSettling', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      replay(events) {
        events.agentEvent(compactionStartedEvent('harness'));
        events.agentEvent(compactionEndedEvent('done', 'harness'));
      },
    });

    restoreOne(test, hostedRecord({ queued: [PENDING] }), [hostedP1()]);
    await flush();

    expect(attachedOf(test)[0].calls).toEqual([sendCall(PENDING)]);
    expect(test.logged).not.toContainEqual(expect.stringContaining('not sent'));
  });

  it('compaction_ReplayLeavesOneRunning_QueueWaitsForItsLiveEnd', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      replay(events) {
        events.agentEvent(compactionStartedEvent('harness'));
      },
    });

    restoreOne(test, hostedRecord({ queued: [PENDING] }), [hostedP1()]);
    await flush();

    const attached = attachedOf(test)[0];
    expect(attached.calls).toEqual([]);
    attached.events.agentEvent(compactionEndedEvent('done', 'harness'));
    expect(attached.calls).toEqual([sendCall(PENDING)]);
  });

  it.each<{
    given: string;
    end(test: Awaited<ReturnType<typeof started>>): void;
  }>([
    {
      given: 'the process ends',
      end: (test) => test.process.events.ended({ code: 0, error: null }),
    },
    {
      given: 'a clear',
      end: (test) => test.chat.clear(ROW_ID),
    },
  ])('hold_$given_ReturnsRowsAndClears', async ({ end }) => {
    const test = await startedAndHeld();
    await test.chat.send(ROW_ID, LATER);

    end(test);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [IDLE_SEND, LATER] },
    ]);
    expect(test.chat.sessions()[0].compaction).toBeNull();
    expect(test.sent('compaction').at(-1)?.compaction).toBeNull();
  });

  it.each<{
    given: string;
    arrange(): ReturnType<typeof started>;
    end(test: Awaited<ReturnType<typeof started>>): void;
    ends: { trigger: CompactionTrigger; outcome: string }[];
  }>([
    {
      given: 'a clear, whose old process reports its end too late',
      arrange: () => startedAndHeld(),
      end: (test) => test.chat.clear(ROW_ID),
      ends: [{ trigger: 'app', outcome: 'interrupted' }],
    },
    {
      given: 'a clear with no compaction running',
      arrange: () => started(),
      end: (test) => test.chat.clear(ROW_ID),
      ends: [],
    },
    {
      given: 'an exit the harness ended it before',
      arrange: () => startedAndHeld(),
      end: (test) => {
        const { events } = test.process;
        events.agentEvent(compactionEndedEvent('failed'));
        events.agentEvent({ type: 'sessionEnded', at: 3000 });
        events.ended({ code: 0, error: null });
      },
      ends: [{ trigger: 'app', outcome: 'failed' }],
    },
  ])(
    'compaction_ProcessLetGo_AgentEventCarriesOneEnd: $given',
    async ({ arrange, end, ends }) => {
      const test = await arrange();

      end(test);
      await flush();

      expect(
        compactionEndsEmitted(test.emitted).map(({ event }) => ({
          trigger: event.trigger,
          outcome: event.outcome,
        })),
      ).toEqual(ends);
    },
  );

  it('compaction_Clear_EmittedEndCarriesTheOldHostAndNoSizes', async () => {
    const test = await startedAndHeld({ clockNow: 2000 });

    test.chat.clear(ROW_ID);

    expect(compactionEndsEmitted(test.emitted)).toEqual([
      {
        sessionId: ROW_ID,
        profileDir: '~/.claude-personal',
        hostSessionId: 'fake-session-1',
        replayed: false,
        event: {
          type: 'compactionEnded',
          at: 2000,
          trigger: 'app',
          outcome: 'interrupted',
          beforeTokens: null,
          durationMs: null,
        },
      },
    ]);
  });

  it('compaction_FailedAttach_AgentEventCarriesItsEnd', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const test = setUp({
      harnesses: [
        {
          ...fake,
          attach: (_request, events) => {
            events.agentEvent(compactionStartedEvent('harness'));
            return Promise.resolve(null);
          },
        },
      ],
    });

    restoreOne(test, hostedRecord(), [hostedP1()]);
    await flush();

    expect(test.chat.sessions()[0].compaction).toBeNull();
    expect(
      compactionEndsEmitted(test.emitted).map(({ event, replayed }) => [
        event.trigger,
        event.outcome,
        replayed,
      ]),
    ).toEqual([['harness', 'interrupted', false]]);
  });

  it.each<{
    given: string;
    skip(test: Awaited<ReturnType<typeof started>>): void;
  }>([
    {
      given: 'interrupt',
      skip: (test) => test.chat.interrupt(ROW_ID),
    },
    {
      given: 'sendNow on the held row',
      skip: (test) => test.chat.sendNow(ROW_ID, 'queued-1'),
    },
    {
      given: 'sendAllNow with no message',
      skip: (test) => void test.chat.sendAllNow(ROW_ID, null),
    },
  ])('hold_Skip_KeepsRowsAndWritesInOrder: $given', async ({ skip }) => {
    const test = await startedAndHeld();
    await test.chat.send(ROW_ID, LATER);

    skip(test);

    expect(test.process.calls).toEqual([
      { method: 'compact' },
      { method: 'interrupt' },
    ]);
    expect(test.sentReturned()).toEqual([]);
    expect(
      test.chat.sessions()[0].queued.map((row) => row.sentEntryId),
    ).toEqual([null, null]);
    expect(test.logged).toContain('skipping the compaction in row-1');

    await flush();

    expect(test.process.calls).toEqual([
      { method: 'compact' },
      { method: 'interrupt' },
      sendCall(IDLE_SEND),
      sendCall(LATER),
    ]);
  });

  it('sendAllNow_HoldUp_QueuesTheBoxBehindAndSkips', async () => {
    const test = await startedAndHeld();

    const sending = test.chat.sendAllNow(ROW_ID, LATER);

    expect(test.process.calls).toEqual([
      { method: 'compact' },
      { method: 'interrupt' },
    ]);
    expect(
      test.chat
        .sessions()[0]
        .queued.map((row) => [row.text, row.sentEntryId, row.holdReason]),
    ).toEqual([
      [IDLE_SEND.text, null, 'a'],
      [LATER.text, null, null],
    ]);
    await sending;
  });

  it('sendNow_UnsentRowBehindTheHeldRow_WritesIt', async () => {
    const test = await startedAndHeld();
    await test.chat.send(ROW_ID, LATER);

    test.chat.sendNow(ROW_ID, 'queued-2');

    expect(test.process.calls).toEqual([
      { method: 'compact' },
      sendCall(LATER),
    ]);
    expect(test.chat.sessions()[0].queued[0].holdReason).toBe('a');
  });

  it('sendAllNow_CompactionUpNoHold_WritesAllAndAsksNoGate', async () => {
    const test = await started();
    let asked = 0;
    test.chat.addSendGate(() => {
      asked += 1;
      return null;
    });
    test.process.events.agentEvent(compactionStartedEvent('manual'));
    await test.chat.send(ROW_ID, IDLE_SEND);

    await test.chat.sendAllNow(ROW_ID, LATER);

    expect(asked).toBe(0);
    expect(test.process.calls).toEqual([sendCall(IDLE_SEND), sendCall(LATER)]);
  });

  it('pullBack_HeldRow_ReturnsItAndTheCompactionGoesOn', async () => {
    const test = await startedAndHeld();
    await test.chat.send(ROW_ID, LATER);

    test.chat.pullBack(ROW_ID, 'queued-1');

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [IDLE_SEND] },
    ]);
    expect(test.process.calls).toEqual([{ method: 'compact' }]);
    expect(test.chat.sessions()[0].compaction).not.toBeNull();
    test.activity('idle');
    expect(test.process.calls).toEqual([{ method: 'compact' }]);

    test.process.events.agentEvent(compactionEndedEvent('done'));

    expect(test.process.calls.at(-1)).toEqual(sendCall(LATER));
  });

  it.each<{
    given: string;
    act(test: Awaited<ReturnType<typeof started>>): Promise<void>;
    marks: number;
  }>([
    {
      given: 'a pulled-back compaction, its stretch held no turn',
      act: async (test) => {
        test.chat.pullBack(ROW_ID, 'queued-1');
        test.harness.releaseCompactions();
        await flush();
      },
      marks: 0,
    },
    {
      given: 'an idle before the compaction ends, in the skip grace order',
      act: async (test) => {
        test.chat.interrupt(ROW_ID);
        test.activity('idle');
        expect(test.marked).toEqual([]);
        await flush();
      },
      marks: 1,
    },
    {
      given: 'the held row written at the end, its own turn',
      act: async (test) => {
        test.harness.releaseCompactions();
        await flush();
      },
      marks: 1,
    },
    {
      given: 'a later stretch after a pulled-back compaction',
      act: async (test) => {
        test.chat.pullBack(ROW_ID, 'queued-1');
        test.harness.releaseCompactions();
        await flush();
        test.activity('working');
        test.activity('idle');
      },
      marks: 1,
    },
    {
      given: 'a stretch of the fresh process after a clear',
      act: async (test) => {
        test.chat.clear(ROW_ID);
        await flush();
        const fresh = test.harness.processes[1];
        fresh.events.activity('working');
        fresh.events.activity('idle');
      },
      marks: 1,
    },
  ])('hold_TurnFinishedMark: $given', async ({ act, marks }) => {
    const test = await startedAndHeld();
    test.setFocused(false);

    await act(test);

    expect(test.marked).toHaveLength(marks);
  });

  it('hold_IdleAfterARowBehindWasSentNow_NoMarkWhileTheHoldIsUp', async () => {
    const test = await startedAndHeld();
    test.setFocused(false);
    await test.chat.send(ROW_ID, LATER);
    test.chat.sendNow(ROW_ID, 'queued-2');

    test.activity('idle');

    expect(test.marked).toEqual([]);
  });

  it('hold_IdleWithNoCompaction_WritesTheRowAndALaterEndReleasesNothing', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const test = setUp({
      harnesses: [
        {
          ...fake,
          start: (request, events) => ({
            ...fake.start(request, events),
            compact: () => undefined,
          }),
        },
      ],
    });
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    const { calls, events } = fake.processes[0];
    test.chat.addSendGate(answerA);
    await test.chat.send(ROW_ID, IDLE_SEND);

    events.activity('idle');
    expect(calls).toEqual([]);
    expect(test.chat.sessions()[0].queued).toHaveLength(1);

    events.activity('working');
    events.activity('idle');
    expect(calls).toEqual([sendCall(IDLE_SEND)]);
    expect(test.logged).toContain(
      'held message queued-1 released in row-1: idle with no compaction',
    );

    events.agentEvent(compactionEndedEvent('failed'));
    expect(calls).toEqual([sendCall(IDLE_SEND)]);
    expect(test.logged).not.toContainEqual(expect.stringContaining('(failed)'));
  });

  it.each<{
    given: string;
    register(chat: ChatSessions): void;
    tokens: number | null;
    logged: string | null;
  }>([
    {
      given: 'a reader of 150000',
      register: (chat) => chat.addIdleCompactThreshold(() => 150_000),
      tokens: 150_000,
      logged: null,
    },
    {
      given: 'no reader',
      register: () => undefined,
      tokens: null,
      logged: null,
    },
    {
      given: 'a removed reader',
      register: (chat) => {
        const handle = chat.addIdleCompactThreshold(() => 150_000);
        handle.dispose();
        handle.dispose();
      },
      tokens: null,
      logged: null,
    },
    {
      given: 'two readers',
      register: (chat) => {
        chat.addIdleCompactThreshold(() => 1);
        chat.addIdleCompactThreshold(() => 2);
      },
      tokens: 2,
      logged: null,
    },
    {
      given: 'a newest reader that throws over an older one',
      register: (chat) => {
        chat.addIdleCompactThreshold(() => 1);
        chat.addIdleCompactThreshold(() => {
          throw new Error('boom');
        });
      },
      tokens: null,
      logged: 'idle compaction threshold failed in row-1: boom',
    },
  ])(
    'idleCompactThreshold_ProcessStart_CarriesTheNewestReader: $given',
    ({ register, tokens, logged }) => {
      const test = setUp();
      register(test.chat);

      test.chat.start({
        harness: FAKE_HARNESS_ID,
        projectDir: PROJECT_DIR,
        profile: 'personal',
      });

      expect(test.harness.processes[0].request.idleCompactMinTokens).toBe(
        tokens,
      );
      if (logged !== null) {
        expect(test.logged).toContain(logged);
      }
    },
  );
});

function emittedOf<K extends Emitted['event']>(
  test: ReturnType<typeof setUp>,
  event: K,
) {
  return test.emitted.flatMap((emitted) =>
    emitted.event === event ? [emitted.data as ChatMainEvents[K]] : [],
  );
}

describe('createChatSessions compact', () => {
  const REASON = 'auto · agents running · 214k';

  it('compact_IdleSession_ShowsItsReasonFromTheCallToTheEnd', async () => {
    const test = await started({ clockNow: 1500 });
    test.harness.holdCompactions();

    expect(test.chat.compact(ROW_ID, REASON)).toBe(true);

    expect(test.process.calls).toEqual([{ method: 'compact' }]);
    expect(test.chat.sessions()[0].compaction).toEqual({
      trigger: 'app',
      reason: REASON,
      startedAt: 1500,
    });
    await flush();
    expect(test.chat.sessions()[0].compaction?.reason).toBe(REASON);
    test.harness.releaseCompactions();
    await flush();
    expect(test.chat.sessions()[0].compaction).toBeNull();
  });

  it.each<{
    given: string;
    sessionId?: string;
    act(test: Awaited<ReturnType<typeof started>>): Promise<void> | void;
    logged: string;
  }>([
    {
      given: 'a session chat does not hold',
      sessionId: 'row-9',
      act: () => undefined,
      logged: 'compact for session row-9 ignored: not held',
    },
    {
      given: 'a resting session',
      act: async (test) => {
        test.process.events.ended({ code: 0, error: null });
        await flush();
      },
      logged: 'compact for session row-1 ignored: no running process',
    },
    {
      given: 'a turn running',
      act: (test) => test.activity('working'),
      logged: 'compact for session row-1 ignored: not idle',
    },
    {
      given: 'a compaction running',
      act: (test) =>
        test.process.events.agentEvent(compactionStartedEvent('manual')),
      logged: 'compact for session row-1 ignored: a compaction runs',
    },
    {
      given: 'a hold up',
      act: async (test) => {
        test.harness.holdCompactions();
        test.chat.addSendGate(answerA);
        await test.chat.send(ROW_ID, IDLE_SEND);
      },
      logged: 'compact for session row-1 ignored: a hold is up',
    },
  ])('compact_Refused_StartsNothing: $given', async (row) => {
    const test = await started();
    await row.act(test);
    const before = test.chat.sessions()[0].compaction;
    const calls = test.process.calls.filter(
      (call) => call.method === 'compact',
    ).length;

    expect(test.chat.compact(row.sessionId ?? ROW_ID, REASON)).toBe(false);

    expect(test.logged).toContain(row.logged);
    expect(test.chat.sessions()[0].compaction).toEqual(before);
    expect(
      test.process.calls.filter((call) => call.method === 'compact').length,
    ).toBe(calls);
  });

  it('compact_FromATurnFinishedListener_ItsIdleAnnouncesNothing', async () => {
    const test = await started();
    test.harness.holdCompactions();
    test.setFocused(false);
    const { events } = test.process;
    let compacted = false;
    test.setOnEmit((emitted) => {
      if (emitted.event === 'turnFinished' && !compacted) {
        compacted = test.chat.compact(ROW_ID, REASON);
      }
    });

    test.activity('working');
    events.agentEvent({
      type: 'agentSpawned',
      at: 0,
      agentId: 'agent-1',
      parentAgentId: MAIN_AGENT_ID,
      agentType: 'general-purpose',
      description: 'review',
      name: 'review',
      model: null,
      effort: null,
    });
    test.activity('idle');
    await flush();
    events.agentEvent({
      type: 'agentFinished',
      at: 0,
      agentId: 'agent-1',
      outcome: 'done',
    });
    test.harness.releaseCompactions();
    await flush();

    expect(compacted).toBe(true);
    expect(test.chat.sessions()[0].compaction).toBeNull();
    expect(test.chat.sessions()[0].activity).toBe('idle');
    expect(test.marked).toEqual([]);
  });

  it('compact_HarnessThrows_ReturnsFalseAndShowsNothing', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const test = setUp({
      harnesses: [
        {
          ...fake,
          start: (request, events) => ({
            ...fake.start(request, events),
            compact: () => {
              throw new Error('refused');
            },
          }),
        },
      ],
    });
    test.chat.start({
      harness: FAKE_HARNESS_ID,
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();
    test.setFocused(false);

    expect(test.chat.compact(ROW_ID, REASON)).toBe(false);

    expect(test.logged).toContain('compaction not started in row-1: refused');
    expect(test.chat.sessions()[0].compaction).toBeNull();
    fake.processes[0].events.activity('working');
    fake.processes[0].events.activity('idle');
    expect(test.marked).toHaveLength(1);
  });

  it('compact_MessageSentDuringIt_QueuesUntilItsEnd', async () => {
    const test = await started();
    test.harness.holdCompactions();
    test.chat.compact(ROW_ID, REASON);

    await test.chat.send(ROW_ID, LATER);

    expect(test.chat.sessions()[0].queued.map((row) => row.text)).toEqual([
      'later',
    ]);
    expect(test.process.calls).toEqual([{ method: 'compact' }]);
    test.harness.releaseCompactions();
    await flush();
    expect(test.process.calls.at(-1)).toEqual(sendCall(LATER));
  });

  it('compact_StretchRanOnlyIt_NoTurnFinishedMark', async () => {
    const test = await started();
    test.setFocused(false);

    test.chat.compact(ROW_ID, REASON);
    await flush();

    expect(test.chat.sessions()[0].compaction).toBeNull();
    expect(test.chat.sessions()[0].activity).toBe('idle');
    expect(test.marked).toEqual([]);
    test.activity('working');
    test.activity('idle');
    expect(test.marked).toHaveLength(1);
  });
});

const AGENT_TITLES: SessionTitles = {
  user: null,
  agent: 'agent title',
  firstMessage: 'first message',
};

describe('createChatSessions lifecycle events', () => {
  const START = {
    projectDir: PROJECT_DIR,
    harness: FAKE_HARNESS_ID,
    profile: 'personal',
  };
  const OPENED_NEW = {
    sessionId: ROW_ID,
    profileDir: '~/.claude-personal',
    hostSessionId: 'fake-session-1',
    projectDir: PROJECT_DIR,
    profile: 'personal',
    origin: 'new',
  };
  const RESUME = {
    projectDir: PROJECT_DIR,
    profile: 'personal',
    hostSessionId: PAST_ONE.sessionId,
    title: PAST_ONE.title,
  };

  it.each([
    {
      given: 'a new start',
      list: [],
      open: (test: ReturnType<typeof setUp>) => test.chat.start(START),
      opened: [OPENED_NEW],
    },
    {
      given: 'a launch',
      list: [],
      open: (test: ReturnType<typeof setUp>) =>
        test.chat.launch({ ...START, message: IDLE_SEND }),
      opened: [{ ...OPENED_NEW, origin: 'launched' }],
    },
    {
      given: 'a resume by a fresh start',
      list: [],
      open: (test: ReturnType<typeof setUp>) => test.chat.resume(RESUME),
      opened: [
        {
          ...OPENED_NEW,
          hostSessionId: PAST_ONE.sessionId,
          origin: 'resumed',
        },
      ],
    },
    {
      given: 'a resume by a re-attach',
      list: [HOSTED_PAST_ONE],
      open: (test: ReturnType<typeof setUp>) => test.chat.resume(RESUME),
      opened: [
        {
          ...OPENED_NEW,
          hostSessionId: PAST_ONE.sessionId,
          origin: 'resumed',
        },
      ],
    },
    {
      given: 'a resume of a session a row holds',
      list: [],
      open: async (test: ReturnType<typeof setUp>) => {
        await test.chat.resume(RESUME);
        test.emitted.length = 0;
        await test.chat.resume(RESUME);
      },
      opened: [],
    },
    {
      given: 'a restore',
      list: [],
      open: (test: ReturnType<typeof setUp>) =>
        test.chat.restore(
          {
            sessions: [
              record('host-a', {
                projectDir: PROJECT_DIR,
                profile: 'personal',
              }),
            ],
            selectedHostSessionId: null,
          },
          [],
        ),
      opened: [{ ...OPENED_NEW, hostSessionId: 'host-a', origin: 'restored' }],
    },
    {
      given: 'a restore whose profile is missing',
      list: [],
      open: (test: ReturnType<typeof setUp>) =>
        test.chat.restore(
          {
            sessions: [record('host-a', { profile: 'gone' })],
            selectedHostSessionId: null,
          },
          [],
        ),
      opened: [],
    },
  ])(
    'sessionOpened_EachPath_CarriesOrigin given $given',
    async ({ list, open, opened }) => {
      const test = setUp({
        sessionHost: { list: () => Promise.resolve(list) },
      });
      test.harness.scriptAttach(HOSTED_PAST_ONE.id, {
        outcome: 'process',
        turns: 0,
        replay() {},
      });

      await open(test);
      await flush();

      expect(emittedOf(test, 'sessionOpened')).toEqual(opened);
    },
  );

  it.each([
    { given: 'a sent row', sends: true, sent: true, headless: false },
    { given: 'an unsent row', sends: false, sent: false, headless: false },
    { given: 'a headless row', sends: true, sent: true, headless: true },
  ])(
    'sessionClosed_RestingRow_CarriesTitlesBeforeEnded given $given',
    async ({ sends, sent, headless }) => {
      const test = await started();
      if (sends) {
        await test.chat.send(ROW_ID, IDLE_SEND);
      }
      test.chat.setHeadless(ROW_ID, headless);
      test.process.events.ended({ code: 0, error: null });
      test.setRowTitles(ROW_ID, AGENT_TITLES);
      let closedAtOwnedEnd: unknown[] = [];
      test.setOnOwnedEnd(() => {
        closedAtOwnedEnd = emittedOf(test, 'sessionClosed');
      });

      test.chat.closed(ROW_ID, 'user');
      await flush();

      expect(closedAtOwnedEnd).toEqual([
        {
          sessionId: ROW_ID,
          hostSessionId: 'fake-session-1',
          projectDir: PROJECT_DIR,
          profile: 'personal',
          titles: AGENT_TITLES,
          sent,
          headless,
          reason: 'user',
        },
      ]);
      expect(test.ownedEnds()).toBe(1);
    },
  );

  it.each([
    { given: 'a sent row', sends: true, failsRestart: false, sent: true },
    { given: 'an unsent row', sends: false, failsRestart: false, sent: false },
    { given: 'a failed restart', sends: true, failsRestart: true, sent: true },
  ])(
    'sessionCleared_EachRow_CarriesBothIdsOnceReported given $given',
    async ({ sends, failsRestart, sent }) => {
      const test = await started();
      if (sends) {
        await test.chat.send(ROW_ID, IDLE_SEND);
      }
      test.setRowTitles(ROW_ID, AGENT_TITLES);
      if (failsRestart) {
        test.harness.failNextStart('spawn failed');
        expect(() => test.chat.clear(ROW_ID)).toThrow('spawn failed');
      } else {
        test.chat.clear(ROW_ID);
      }
      expect(emittedOf(test, 'sessionCleared')).toEqual([]);
      await flush();

      expect(emittedOf(test, 'sessionCleared')).toEqual(
        failsRestart
          ? []
          : [
              {
                sessionId: ROW_ID,
                oldHostSessionId: 'fake-session-1',
                newHostSessionId: 'fake-session-2',
                projectDir: PROJECT_DIR,
                profile: 'personal',
                titles: AGENT_TITLES,
                sent,
              },
            ],
      );
    },
  );

  it.each([
    {
      given: 'a stop',
      stops: true,
      exit: { code: 1, error: null },
      reason: 'stopped',
    },
    {
      given: 'an exit with code 0',
      stops: false,
      exit: { code: 0, error: null },
      reason: 'clean',
    },
    {
      given: 'an exit with code 1',
      stops: false,
      exit: { code: 1, error: null },
      reason: 'crash',
    },
    {
      given: 'an exit with code 0 and an error',
      stops: false,
      exit: { code: 0, error: 'stdin closed early' },
      reason: 'crash',
    },
  ])(
    'processEnded_EachExit_CarriesReason given $given',
    async ({ stops, exit, reason }) => {
      const test = await started();
      if (stops) {
        test.chat.stopAll();
      }

      test.process.events.ended(exit);

      expect(emittedOf(test, 'processEnded')).toEqual([
        { sessionId: ROW_ID, hostSessionId: 'fake-session-1', reason, ...exit },
      ]);
    },
  );

  it.each([
    {
      given: 'a closed row',
      act: (test: ReturnType<typeof setUp>) => test.chat.closed(ROW_ID, 'user'),
    },
    {
      given: 'a cleared row',
      act: (test: ReturnType<typeof setUp>) => test.chat.clear(ROW_ID),
    },
    {
      given: 'detachAll',
      act: (test: ReturnType<typeof setUp>) => void test.chat.detachAll(),
    },
  ])(
    'processEnded_ProcessNoLongerLive_FiresNothing given $given',
    async ({ act }) => {
      const test = await started();
      test.harness.holdEnd();
      act(test);

      test.process.events.ended({ code: 0, error: null });

      expect(emittedOf(test, 'processEnded')).toEqual([]);
    },
  );

  it('processEnded_DuringReplay_FiresNothing', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 1,
      replay(events) {
        events.ended({ code: 0, error: null });
      },
    });

    restoreOne(test, hostedRecord(), [hostedP1()]);
    await flush();

    expect(noticesOf(test)).not.toEqual([]);
    expect(emittedOf(test, 'processEnded')).toEqual([]);
  });

  // Breaks if a new row whose start throws fires lifecycle events or saves a
  // record under a host id no harness reported.
  it('openAndStart_StartThrows_NoOpenedNoClosedNoRecord', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.harness.failNextStart('spawn failed');

    expect(() => test.chat.start(START)).toThrow('spawn failed');
    await flush();

    expect(emittedOf(test, 'sessionOpened')).toEqual([]);
    expect(emittedOf(test, 'sessionClosed')).toEqual([]);
    expect(test.saved.last()?.sessions ?? []).toEqual([]);
  });

  it.each([
    { given: 'a write that lands', rejects: false, archived: [true] },
    { given: 'a rejected write', rejects: true, archived: [] },
  ])(
    'sessionArchived_EachWrite_FiresOnceWritten given $given',
    async ({ rejects, archived }) => {
      const test = setUp();
      if (rejects) {
        test.archived.set = () => Promise.reject(new Error('disk full'));
      }

      const writing = test.chat.setArchived('host-a', true);
      expect(emittedOf(test, 'sessionArchived')).toEqual([]);
      await writing.catch(() => undefined);

      expect(emittedOf(test, 'sessionArchived')).toEqual(
        archived.map((flag) => ({ hostSessionId: 'host-a', archived: flag })),
      );
      if (rejects) {
        await expect(writing).rejects.toThrow('disk full');
      }
    },
  );
});

describe('createChatSessions message and turn events', () => {
  type Started = Awaited<ReturnType<typeof started>>;
  const MESSAGE: UserMessage = { text: 'hi', images: [] };
  const queueOne = (test: Started) => {
    test.activity('working');
    void test.chat.send(ROW_ID, MESSAGE);
  };

  it.each<{
    case: string;
    queue: (test: Started) => void;
    write: (test: Started) => void;
    written: number;
  }>([
    {
      case: 'idle send',
      queue: () => undefined,
      write: (test) => void test.chat.send(ROW_ID, MESSAGE),
      written: 1,
    },
    {
      case: 'queued then written',
      queue: queueOne,
      write: (test) => test.activity('idle'),
      written: 1,
    },
    {
      case: 'send now',
      queue: queueOne,
      write: (test) => test.chat.sendNow(ROW_ID, 'queued-1'),
      written: 1,
    },
    {
      case: 'throwing write',
      queue: (test) => {
        queueOne(test);
        test.process.ended = true;
      },
      write: (test) => test.chat.sendNow(ROW_ID, 'queued-1'),
      written: 0,
    },
  ])(
    'messageSent_RowQueuedThenWritten_FiresAtWrite ($case)',
    async ({ queue, write, written }) => {
      const test = await started();

      queue(test);
      await flush();
      expect(emittedOf(test, 'messageSent')).toEqual([]);

      write(test);
      await flush();

      expect(emittedOf(test, 'messageSent')).toEqual(
        Array.from({ length: written }, () => ({
          sessionId: ROW_ID,
          entryId: expect.any(String),
        })),
      );
    },
  );

  it.each([
    { case: "the row's first process", exits: 0 },
    { case: "the row's second process", exits: 1 },
  ])('messageSent_EntryId_NamesTheRowsEntry ($case)', async ({ exits }) => {
    const test = await started();
    for (let exit = 0; exit < exits; exit += 1) {
      test.process.events.ended({ code: 0, error: null });
    }

    await test.chat.send(ROW_ID, MESSAGE);
    await flush();

    const [{ entryId }] = emittedOf(test, 'messageSent') as {
      entryId: string;
    }[];
    expect(test.chat.sessions()[0].entries.map(({ id }) => id)).toContain(
      entryId,
    );
  });

  // Each turn event, with the row's activity and clock as a listener reads them.
  function turnEventsHeard(test: ReturnType<typeof setUp>) {
    const heard: unknown[] = [];
    test.setOnEmit(({ event, data }) => {
      if (event === 'turnStarted' || event === 'turnFinished') {
        const { activity, activeTime } = test.chat.sessions()[0];
        heard.push({ event, data, activity, activeTime });
      }
    });
    return heard;
  }

  const startedHeard = (since: number) => ({
    event: 'turnStarted',
    data: { sessionId: ROW_ID },
    activity: 'working',
    activeTime: { totalMs: 0, since },
  });
  const finishedHeard = (how: 'idle' | 'rested', activeTime: ActiveTime) => ({
    event: 'turnFinished',
    data: { sessionId: ROW_ID, how },
    activity: 'idle',
    activeTime,
  });

  it.each<{ case: string; act: (test: Started) => void; rest: unknown[] }>([
    {
      case: 'start and idle',
      act: (test) => test.activity('idle'),
      rest: [finishedHeard('idle', { totalMs: 3000, since: null })],
    },
    {
      case: 'waiting then idle',
      act: (test) => {
        test.activity('waiting');
        test.activity('idle');
      },
      rest: [finishedHeard('idle', { totalMs: 3000, since: null })],
    },
    {
      case: 'rest, the process exiting mid-turn',
      act: (test) => test.process.events.ended({ code: 1, error: 'gone' }),
      rest: [finishedHeard('rested', { totalMs: 3000, since: null })],
    },
    {
      case: 'stop all, then the exit',
      act: (test) => {
        test.chat.stopAll();
        test.activity('idle');
        test.process.events.ended({ code: 0, error: null });
      },
      rest: [finishedHeard('idle', { totalMs: 3000, since: null })],
    },
    {
      case: '/clear mid-turn',
      act: (test) => test.chat.clear(ROW_ID),
      rest: [finishedHeard('rested', { totalMs: 3000, since: null })],
    },
    {
      case: 'idle with background work running',
      act: (test) => {
        test.process.events.agentEvent({
          type: 'taskStarted',
          at: 5000,
          taskId: 'task-1',
          agentId: MAIN_AGENT_ID,
          description: 'server',
          command: null,
        });
        test.activity('idle');
      },
      rest: [finishedHeard('idle', { totalMs: 0, since: 2000 })],
    },
    {
      case: 'the user looking at the row',
      act: (test) => {
        test.setFocused(true);
        test.setSelected(ROW_ID);
        test.activity('idle');
      },
      rest: [finishedHeard('idle', { totalMs: 3000, since: null })],
    },
  ])(
    'turnEvents_ActivityCrossesIdle_FireOncePerCrossing ($case)',
    async ({ act, rest }) => {
      const test = await started();
      const heard = turnEventsHeard(test);

      test.setNow(2000);
      test.activity('working');
      test.setNow(5000);
      act(test);
      await flush();

      expect(heard).toEqual([startedHeard(2000), ...rest]);
    },
  );

  it.each<{
    case: string;
    script: Parameters<ReturnType<typeof setUp>['harness']['scriptAttach']>[1];
  }>([
    {
      case: 'a replayed turn that ran and ended',
      script: {
        outcome: 'process',
        replay: (events) => {
          events.activity('working');
          events.activity('idle');
        },
      },
    },
    {
      case: 'a replayed turn the replayed exit ended',
      script: {
        outcome: 'process',
        replay: (events) => {
          events.activity('working');
          events.ended({ code: 0, error: null });
        },
      },
    },
    { case: 'an attach finding no process', script: { outcome: 'null' } },
    {
      case: 'an attach that rejects',
      script: { outcome: 'reject', message: 'host gone' },
    },
  ])('turnEvents_Attach_FireNothing ($case)', async ({ script }) => {
    const test = setUp();
    const heard = turnEventsHeard(test);
    test.harness.scriptAttach('p1', script);

    restoreOne(test, hostedRecord(), [hostedP1()]);
    await flush();

    expect(heard).toEqual([]);
  });

  it('turnEvents_ReplayEndsWorking_TheLiveIdleFiresTheFinish', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      replay: (events) => events.activity('working'),
    });
    restoreOne(test, hostedRecord(), [hostedP1()]);
    await flush();
    expect(emittedOf(test, 'turnStarted')).toEqual([]);

    test.harness.processes[0].events.activity('idle');

    expect(emittedOf(test, 'turnFinished')).toEqual([
      { sessionId: test.chat.sessions()[0].sessionId, how: 'idle' },
    ]);
  });
});

describe('createChatSessions resume sections', () => {
  const START = {
    projectDir: PROJECT_DIR,
    harness: FAKE_HARNESS_ID,
    profile: 'personal',
  };

  function rowFor(hostSessionId: string) {
    return {
      hostSessionId,
      projectDir: PROJECT_DIR,
      profile: 'personal',
      title: `title of ${hostSessionId}`,
      at: 1000,
    };
  }

  // The ids among `hostSessionIds` a section's `isResumable` answers true for.
  async function resumableAmong(
    test: ReturnType<typeof setUp>,
    hostSessionIds: string[],
  ) {
    const section = test.chat.addResumeSection({
      title: 'probe',
      rows: (isResumable) =>
        Promise.resolve(hostSessionIds.filter(isResumable).map(rowFor)),
    });
    const answers = await test.chat.resumeSections();
    section.dispose();
    return answers.flatMap((answer) =>
      answer.rows.map((row) => row.hostSessionId),
    );
  }

  it.each([
    {
      given: 'one held, one archived and one free session',
      arrange: async (test: ReturnType<typeof setUp>) => {
        test.chat.start(START);
        await flush();
        await test.archived.set('host-archived', true);
      },
      ids: ['fake-session-1', 'host-archived', 'host-free'],
      resumable: ['host-free'],
    },
    {
      given: 'a session open on a row chat does not hold',
      arrange: (test: ReturnType<typeof setUp>) => {
        test.chat.recordOpenHostId(connected('row-9', 'host-relay'));
      },
      ids: ['host-relay', 'host-free'],
      resumable: ['host-free'],
    },
    {
      given: 'a row /clear moved to a new host id',
      arrange: async (test: ReturnType<typeof setUp>) => {
        test.chat.start(START);
        await flush();
        test.chat.recordOpenHostId(connected(ROW_ID, 'fake-session-1'));
        test.chat.clear(ROW_ID);
        await flush();
      },
      ids: ['fake-session-1', 'fake-session-2'],
      resumable: ['fake-session-1'],
    },
    {
      given: 'an unreadable archived file',
      arrange: (test: ReturnType<typeof setUp>) =>
        test.data.write(ARCHIVED_SESSIONS_FILE, '["host-archived"'),
      ids: ['host-archived', 'host-free'],
      resumable: ['host-archived', 'host-free'],
      logsUnreadable: true,
    },
  ])(
    'resumeSections_IsResumable_FollowsHeldArchivedAndOpen given $given',
    async ({ arrange, ids, resumable, logsUnreadable = false }) => {
      const test = setUp();
      await arrange(test);

      expect(await resumableAmong(test, ids)).toEqual(resumable);
      expect(
        test.logged.some((line) => line.includes(ARCHIVED_SESSIONS_FILE)),
      ).toBe(logsUnreadable);
    },
  );

  it.each([
    {
      failure: 'rejects',
      rows: () => Promise.reject(new Error('boom')),
    },
    {
      failure: 'throws at the call',
      rows: () => {
        throw new Error('boom');
      },
    },
  ])(
    'resumeSections_SectionFails_KeepsTheOthers when rows $failure',
    async ({ rows }) => {
      const test = setUp();
      const row = rowFor('host-a');
      test.chat.addResumeSection({ title: 'broken', rows });
      test.chat.addResumeSection({
        title: 'whole',
        rows: () => Promise.resolve([row]),
      });

      expect(await test.chat.resumeSections()).toEqual([
        { title: 'whole', rows: [row] },
      ]);
      expect(test.logged).toContainEqual(expect.stringMatching(/broken.*boom/));
    },
  );

  it.each([
    {
      given: 'a row closed',
      clears: false,
      ids: ['fake-session-1'],
      whileEnding: [],
    },
    {
      given: 'a row /clear moved to a new host id, then closed',
      clears: true,
      ids: ['fake-session-1', 'fake-session-2'],
      whileEnding: ['fake-session-1'],
    },
  ])(
    'isResumable_JustClosedRowEnding_IsFalseUntilEnded given $given',
    async ({ clears, ids, whileEnding }) => {
      const test = setUp();
      test.chat.start(START);
      await flush();
      test.chat.recordOpenHostId(connected(ROW_ID, 'fake-session-1'));
      if (clears) {
        test.chat.clear(ROW_ID);
        test.chat.recordOpenHostId(connected(ROW_ID, 'fake-session-2'));
        await flush();
      }
      test.harness.holdEnd();

      test.chat.closed(ROW_ID, 'user');
      expect(await resumableAmong(test, ids)).toEqual(whileEnding);

      test.chat.sessionEnded(ROW_ID);
      expect(await resumableAmong(test, ids)).toEqual(ids);
    },
  );

  it('resumeSections_NoRows_LeavesSectionOut', async () => {
    const test = setUp();
    const slow = rowFor('host-slow');
    const quick = rowFor('host-quick');
    test.chat.addResumeSection({
      title: 'slow',
      rows: async () => {
        await flush();
        return [slow];
      },
    });
    test.chat.addResumeSection({
      title: 'empty',
      rows: () => Promise.resolve([]),
    });
    test.chat.addResumeSection({
      title: 'quick',
      rows: () => Promise.resolve([quick]),
    });

    expect(await test.chat.resumeSections()).toEqual([
      { title: 'slow', rows: [slow] },
      { title: 'quick', rows: [quick] },
    ]);
  });

  it('resumeSections_LaterSection_RefusesSessionsAnEarlierOneListed', async () => {
    const test = setUp();
    const ids = ['host-a', 'host-b', 'host-c'];
    test.chat.addResumeSection({
      title: 'first',
      rows: () => Promise.resolve([rowFor('host-b')]),
    });
    test.chat.addResumeSection({
      title: 'capped',
      rows: (isResumable) =>
        Promise.resolve(ids.filter(isResumable).slice(-2).map(rowFor)),
    });

    expect(await test.chat.resumeSections()).toEqual([
      { title: 'first', rows: [rowFor('host-b')] },
      { title: 'capped', rows: [rowFor('host-a'), rowFor('host-c')] },
    ]);
  });
});

describe('createChatSessions queue order', () => {
  it('sendNow_FreshRowObject_KeepsQueuePlace', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);

    test.chat.sendNow(ROW_ID, test.chat.sessions()[0].queued[1].id);
    test.process.events.ended({ code: 0, error: null });

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [first, second] },
    ]);
  });

  it.each([
    { case: 'WriteLands', firstText: 'first', stillQueued: ['second'] },
    {
      case: 'WriteThrows',
      firstText: REFUSED_TEXT,
      stillQueued: [REFUSED_TEXT, 'second'],
    },
  ])(
    'writeNextQueued_RowLeavesQueue_KeepsOrderForWrite: $case',
    async ({ firstText, stillQueued }) => {
      const test = await startedRefusing();
      const first = { text: firstText, images: [] };
      const second = { text: 'second', images: [] };
      test.activity('working');
      void test.chat.send(ROW_ID, first);
      void test.chat.send(ROW_ID, second);

      test.activity('idle');

      expect(test.chat.sessions()[0].queued.map((row) => row.text)).toEqual(
        stillQueued,
      );
      test.process.events.ended({ code: 0, error: null });
      expect(test.sentReturned()).toEqual([
        { sessionId: ROW_ID, messages: [first, second] },
      ]);
    },
  );
});

describe('createChatSessions restored entries', () => {
  it('restore_ReplayThenHistory_LandInOrder', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 0,
      replay: (events) =>
        events.entry(assistant('replayed', 'from the replay')),
    });
    restoreOne(
      test,
      record(PAST_ONE.sessionId, { sent: true, processId: 'p1' }),
      [hostedP1({ startedAt: Number.MAX_SAFE_INTEGER })],
    );
    await flush();

    await test.chat.loadHistory(ROW_ID);

    const [replaced] = test.sent('entries');
    expect(test.sent('entries')).toHaveLength(1);
    expect(replaced.entries.length).toBeGreaterThan(1);
    expect(replaced.entries.at(-1)?.id).toBe('replayed');
    expect(test.chat.sessions()[0].entries).toEqual(replaced.entries);
  });
});

const NEW_GAMES: ChatProject = {
  kind: 'pool',
  name: 'New Games',
  pool: 'ng',
  profile: 'work',
};
const AI_DEV: ChatProject = {
  kind: 'folder',
  name: 'AI Dev',
  folder: '~/ai-dev',
  profile: null,
};
const CLONES = { ng: ['/pool/ng-1', '/pool/ng-2'] };

// A pool provider whose clones are `folders`.
function fakePoolProvider(folders: Record<string, string[]>): PoolProvider {
  return { folders: (pool) => folders[pool] ?? [] };
}

describe('createChatSessions projects', () => {
  it('start_folderProject_StartsInTheExpandedFolder', async () => {
    const test = setUp({
      projects: [AI_DEV],
      poolProvider: fakePoolProvider(CLONES),
    });

    test.chat.start({
      harness: FAKE_HARNESS_ID,
      project: 'AI Dev',
      profile: 'personal',
    });
    await flush();

    expect(test.opened[0].projectDir).toBe('/home/me/ai-dev');
    expect(test.harness.processes[0].request.projectDir).toBe(
      '/home/me/ai-dev',
    );
  });

  it.each([
    {
      name: 'an unknown project names the known ones',
      projects: [NEW_GAMES, AI_DEV],
      folders: CLONES,
      project: 'Nope',
      profile: 'work',
      fragment: 'New Games, AI Dev',
    },
    {
      name: 'an unknown project with none set',
      projects: [],
      folders: CLONES,
      project: 'Nope',
      profile: 'work',
      fragment: 'Projects: none',
    },
    {
      name: "a profile other than the pool project's",
      projects: [NEW_GAMES],
      folders: CLONES,
      project: 'New Games',
      profile: 'personal',
      fragment: 'profile work, not personal',
    },
    {
      name: "a profile other than the folder project's",
      projects: [{ ...AI_DEV, profile: 'work' }],
      folders: CLONES,
      project: 'AI Dev',
      profile: 'personal',
      fragment: 'profile work, not personal',
    },
    {
      name: 'no provider registered',
      projects: [NEW_GAMES],
      folders: null,
      project: 'New Games',
      profile: 'work',
      fragment: 'No Unity pool provider',
    },
    {
      name: 'a pool with no clones',
      projects: [NEW_GAMES],
      folders: {},
      project: 'New Games',
      profile: 'work',
      fragment: 'Pool "ng" has no clones',
    },
  ])(
    'start_RejectedTarget_ThrowsAndOpensNothing: $name',
    ({ projects, folders, project, profile, fragment }) => {
      const test = setUp({
        projects,
        poolProvider: folders === null ? null : fakePoolProvider(folders),
      });

      expect(() =>
        test.chat.start({ harness: FAKE_HARNESS_ID, project, profile }),
      ).toThrow(fragment);
      expect(test.opened).toEqual([]);
    },
  );

  // Breaks if a pool project's start waits on a clone claim again, or opens
  // anywhere but the pool's lowest-numbered clone.
  it('start_PoolProject_StartsInTheLowestCloneAtOnce', async () => {
    const test = setUp({
      projects: [NEW_GAMES],
      poolProvider: fakePoolProvider(CLONES),
    });
    test.chat.restore(NOTHING_SAVED, []);

    const rowId = test.chat.start({
      harness: FAKE_HARNESS_ID,
      project: 'New Games',
      profile: 'work',
    });
    await flush();

    expect(rowId).toBe(ROW_ID);
    expect(test.opened[0].projectDir).toBe('/pool/ng-1');
    expect(test.openOptions).toEqual([{ select: true }]);
    const { request } = test.harness.processes[0];
    expect([request.projectDir, request.sessionId]).toEqual([
      '/pool/ng-1',
      null,
    ]);
    expect(noticesOf(test)).toEqual([]);
    expect(
      emittedOf(test, 'sessionOpened').map(({ projectDir, origin }) => ({
        projectDir,
        origin,
      })),
    ).toEqual([{ projectDir: '/pool/ng-1', origin: 'new' }]);
    expect(
      test.saved.last()?.sessions.map((saved) => saved.projectDir),
    ).toEqual(['/pool/ng-1']);
    expect(await test.data.stat(RECENT_FOLDERS_FILE)).toBeNull();
  });

  it('launch_PoolProject_SendsTheFirstMessageAtOnce', async () => {
    const message: UserMessage = { text: 'fix the chip', images: [] };
    const test = setUp({
      projects: [NEW_GAMES],
      poolProvider: fakePoolProvider(CLONES),
    });
    test.chat.restore(NOTHING_SAVED, []);

    test.chat.launch({ project: 'New Games', profile: 'work', message });
    await flush();

    expect(test.openOptions).toEqual([{ select: false }]);
    expect(test.harness.processes[0].request.projectDir).toBe('/pool/ng-1');
    expect(test.harness.processes[0].calls).toEqual([sendCall(message)]);
    expect(
      emittedOf(test, 'sessionOpened').map((opened) => opened.origin),
    ).toEqual(['launched']);
  });

  const ONE = PAST_ONE.sessionId;
  const TWO = PAST_TWO.sessionId;

  it.each([
    {
      name: 'a pool’s clones, newest first across them',
      project: 'New Games',
      listed: ['/pool/ng-1', '/pool/ng-2'],
      rows: [
        [ONE, '/pool/ng-1'],
        [ONE, '/pool/ng-2'],
        [TWO, '/pool/ng-1'],
        [TWO, '/pool/ng-2'],
      ],
    },
    {
      name: "a folder project's expanded folder",
      project: 'AI Dev',
      listed: ['/home/me/ai-dev'],
      rows: [
        [ONE, '/home/me/ai-dev'],
        [TWO, '/home/me/ai-dev'],
      ],
    },
  ])(
    'projectPastSessions_MergesEveryCoveredFolder: $name',
    async ({ project, listed, rows }) => {
      const test = setUp({
        projects: [NEW_GAMES, AI_DEV],
        poolProvider: fakePoolProvider(CLONES),
      });

      const found = await test.chat.projectPastSessions(project, 'personal');

      expect(
        test.harness.pastSessionCalls.map((call) => call.projectDir),
      ).toEqual(listed);
      expect(found.map((row) => [row.hostSessionId, row.projectDir])).toEqual(
        rows,
      );
    },
  );

  it('projectPastSessions_UnknownProject_Rejects', async () => {
    const test = setUp({ projects: [NEW_GAMES] });

    await expect(
      test.chat.projectPastSessions('Nope', 'personal'),
    ).rejects.toThrow('Unknown project');
  });
});

describe('createChatSessions host session ids', () => {
  const START = {
    projectDir: PROJECT_DIR,
    harness: FAKE_HARNESS_ID,
    profile: 'personal',
  };

  // Breaks if a new row starts under an id chat made up, or fires
  // `sessionOpened` or saves before its harness reports the id.
  it('startNew_NewSession_StartsWithNullAndAdoptsReportedId', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);

    test.chat.start(START);

    expect(test.harness.processes[0].request.sessionId).toBeNull();
    expect(test.chat.hostSessionIdOf(ROW_ID)).toBeNull();
    expect(emittedOf(test, 'sessionOpened')).toEqual([]);

    await flush();

    expect(test.hostIdChanges).toEqual(['fake-session-1']);
    expect(test.chat.hostSessionIdOf(ROW_ID)).toBe('fake-session-1');
    expect(emittedOf(test, 'sessionOpened')).toEqual([
      expect.objectContaining({
        sessionId: ROW_ID,
        hostSessionId: 'fake-session-1',
        origin: 'new',
      }),
    ]);
    expect(
      test.saved.last()?.sessions.map((saved) => saved.hostSessionId),
    ).toEqual(['fake-session-1']);
  });

  // Breaks if a known conversation's process id stops starting with its host
  // id, or a clear's fresh process takes the old conversation's.
  it.each([
    {
      given: 'a restored row with a known host id',
      act: async (test: ReturnType<typeof setUp>) => {
        test.chat.restore(
          {
            sessions: [record('host-b', { rowId: 'kept-row' })],
            selectedHostSessionId: null,
          },
          [],
        );
        await test.chat.send('kept-row', IDLE_SEND);
      },
      processIds: ['host-b-1-1000'],
    },
    {
      given: 'a cleared row',
      act: async (test: ReturnType<typeof setUp>) => {
        test.chat.start(START);
        await flush();
        test.chat.clear(ROW_ID);
      },
      processIds: ['row-1-1-1000', 'row-1-2-1000'],
    },
  ])(
    'startProcess_ProcessId_Cases given $given',
    async ({ act, processIds }) => {
      const test = setUp({ keptRowIds: ['kept-row'] });

      await act(test);

      expect(
        test.harness.processes.map((process) => process.request.processId),
      ).toEqual(processIds);
    },
  );

  // Breaks if a row that was never sent a message restarts as a new
  // conversation instead of under the id its harness reported.
  it('restart_NeverSentRow_PassesKnownHostId', async () => {
    const test = await started();
    test.process.events.ended({ code: 0, error: null });

    await test.chat.send(ROW_ID, IDLE_SEND);
    await flush();

    expect(test.harness.processes[1].request).toMatchObject({
      sessionId: 'fake-session-1',
      resume: false,
    });
    expect(test.hostIdChanges).toEqual(['fake-session-1']);
  });

  // Breaks if a clear names the new conversation itself, or fires
  // `sessionCleared` before the fresh process reports its id.
  it('clear_FreshProcess_StartsWithNullAndFiresClearedOnReport', async () => {
    const test = await started();

    test.chat.clear(ROW_ID);

    expect(test.harness.processes[1].request.sessionId).toBeNull();
    expect(test.chat.hostSessionIdOf(ROW_ID)).toBe('fake-session-1');
    expect(emittedOf(test, 'sessionCleared')).toEqual([]);

    await flush();

    expect(test.chat.hostSessionIdOf(ROW_ID)).toBe('fake-session-2');
    expect(emittedOf(test, 'sessionCleared')).toEqual([
      expect.objectContaining({
        oldHostSessionId: 'fake-session-1',
        newHostSessionId: 'fake-session-2',
      }),
    ]);
  });

  // Breaks if a reported id another row holds moves the row anyway, or
  // fires `sessionOpened` for it.
  it('adoptHostId_IdHeldElsewhere_LogsAndKeepsRow', async () => {
    const test = setUp();
    test.refuseHostId('fake-session-1');

    test.chat.start(START);
    await flush();

    expect(test.logged).toContain(
      `session ${ROW_ID} not moved to host fake-session-1: host fake-session-1 is held by another row`,
    );
    expect(test.chat.hostSessionIdOf(ROW_ID)).toBeNull();
    expect(test.chat.sessions()).toHaveLength(1);
    expect(emittedOf(test, 'sessionOpened')).toEqual([]);
  });

  // Breaks if a send gate runs for a row with no host id to name.
  it('sendGate_NoHostId_NotRun', async () => {
    const test = setUp();
    const inputs: SendGateInput[] = [];
    test.chat.addSendGate((input) => {
      inputs.push(input);
      return null;
    });
    test.chat.start(START);

    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(inputs).toEqual([]);
  });

  it.each([
    {
      given: 'a row with a known host id',
      arrange: async (test: ReturnType<typeof setUp>) => {
        test.chat.restore(
          { sessions: [record('host-a')], selectedHostSessionId: null },
          [],
        );
      },
      settles: 'host-a',
    },
    {
      given: 'a new row once its harness reports',
      arrange: async (test: ReturnType<typeof setUp>) => {
        test.chat.start(START);
      },
      settles: 'fake-session-1',
    },
    {
      given: 'a cleared row once its fresh process reports',
      arrange: async (test: ReturnType<typeof setUp>) => {
        test.chat.start(START);
        await flush();
        test.chat.clear(ROW_ID);
      },
      settles: 'fake-session-2',
    },
  ])(
    'hostSessionIdSettled_Cases resolve given $given',
    async ({ arrange, settles }) => {
      const test = setUp();
      await arrange(test);

      await expect(test.chat.hostSessionIdSettled(ROW_ID)).resolves.toBe(
        settles,
      );
    },
  );

  it.each([
    {
      given: 'a row chat does not hold',
      settle: (test: ReturnType<typeof setUp>) =>
        test.chat.hostSessionIdSettled('row-9'),
      rejects: 'chat holds no session row-9',
    },
    {
      given: 'a new row closed before its harness reports',
      settle: (test: ReturnType<typeof setUp>) => {
        test.chat.start(START);
        const settling = test.chat.hostSessionIdSettled(ROW_ID);
        test.chat.closed(ROW_ID, 'user');
        return settling;
      },
      rejects: `session ${ROW_ID} closed before its harness reported a session id`,
    },
    {
      given: 'a new row whose process ends before its harness reports',
      settle: (test: ReturnType<typeof setUp>) => {
        test.chat.start(START);
        const settling = test.chat.hostSessionIdSettled(ROW_ID);
        test.harness.processes[0].events.ended({ code: 1, error: null });
        return settling;
      },
      rejects: `session ${ROW_ID} ended before its harness reported a session id`,
    },
    {
      given: "a cleared row whose fresh process ends before it reports",
      settle: async (test: ReturnType<typeof setUp>) => {
        test.chat.start(START);
        await flush();
        test.chat.clear(ROW_ID);
        const settling = test.chat.hostSessionIdSettled(ROW_ID);
        test.harness.processes[1].events.ended({ code: 1, error: null });
        return settling;
      },
      rejects: `session ${ROW_ID} ended before its harness reported a session id`,
    },
    {
      given: 'detachAll while it waits',
      settle: (test: ReturnType<typeof setUp>) => {
        test.chat.start(START);
        const settling = test.chat.hostSessionIdSettled(ROW_ID);
        void test.chat.detachAll();
        return settling;
      },
      rejects: `session ${ROW_ID} not settled: chat is stopping`,
    },
    {
      given: 'a call after detachAll that would wait',
      settle: (test: ReturnType<typeof setUp>) => {
        test.chat.start(START);
        void test.chat.detachAll();
        return test.chat.hostSessionIdSettled(ROW_ID);
      },
      rejects: `session ${ROW_ID} not settled: chat is stopping`,
    },
  ])(
    'hostSessionIdSettled_Cases reject given $given',
    async ({ settle, rejects }) => {
      const test = setUp();

      await expect(settle(test)).rejects.toThrow(rejects);
    },
  );

  // Breaks if the selection is kept by host id again, which a new row lacks
  // when it is selected.
  it('snapshot_SelectedNewRow_SavedByRowOnceIdArrives', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);

    test.chat.start(START);
    expect(test.saved.last()?.selectedHostSessionId ?? null).toBeNull();
    await flush();

    expect(test.saved.last()?.selectedHostSessionId).toBe('fake-session-1');
  });
});

const WAITING_NOTICE =
  'Fake is not loaded. This session waits for it to load again.';
const WAITING_REFUSAL = 'Fake is not loaded. Send again once it is.';
const START_ON_FAKE = {
  harness: FAKE_HARNESS_ID,
  projectDir: PROJECT_DIR,
  profile: 'personal',
};

// A row resumed on the fake from `PAST_ONE`, whose history the fake reads, with
// its process `<PAST_ONE's id>-1-1000` running.
async function resumedOnFake(options?: Parameters<typeof setUp>[0]) {
  const test = setUp(options);
  await test.chat.resume({
    projectDir: '/w/app',
    profile: 'work',
    hostSessionId: PAST_ONE.sessionId,
    title: PAST_ONE.title,
  });
  await flush();
  return { ...test, process: test.harness.processes[0] };
}

// A restored row of `PAST_ONE`, sent before, that rests with no process and no
// unheld process.
function restoredResting(options?: Parameters<typeof setUp>[0]) {
  const test = setUp(options);
  restoreOne(test, record(PAST_ONE.sessionId, { sent: true }), []);
  return test;
}

function historyCallsOf(test: ReturnType<typeof setUp>) {
  return test.harness.pastSessionCalls.filter(
    (call) => call.method === 'history',
  );
}

describe('createChatSessions harness leave and return', () => {
  it('harnessLeft_RunningRow_DetachesAndRestsWithTheNotice', async () => {
    const test = await started();
    await test.chat.send(ROW_ID, IDLE_SEND);
    await flush();

    test.leave(FAKE_HARNESS_ID);

    expect(test.registry.get(FAKE_HARNESS_ID)).toBeNull();
    expect(test.process.detached).toBe(true);
    expect(test.process.calls).not.toContainEqual({ method: 'kill' });
    expect(test.process.calls).not.toContainEqual({ method: 'end' });
    const [session] = test.chat.sessions();
    expect(session).toEqual(
      expect.objectContaining({ running: false, activity: 'idle' }),
    );
    expect(noticesOf(test).at(-1)).toEqual({
      kind: 'notice',
      tone: 'info',
      text: WAITING_NOTICE,
    });
    expect(test.sent('sessionRested')).toEqual([
      { sessionId: ROW_ID, error: null },
    ]);
  });

  it.each([
    {
      given: 'send',
      queues: false,
      act: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.send(ROW_ID, IDLE_SEND),
    },
    {
      given: 'sendAllNow',
      queues: false,
      act: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.sendAllNow(ROW_ID, IDLE_SEND),
    },
    {
      given: 'clear',
      queues: false,
      act: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.clear(ROW_ID),
    },
    {
      given: 'setControl',
      queues: false,
      act: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.setControl(ROW_ID, 'mode', 'plan'),
    },
    {
      given: 'sendNow',
      queues: true,
      act: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.sendNow(ROW_ID, test.chat.sessions()[0].queued[0].id),
    },
  ])(
    'send_HarnessLeft_RejectsNamingTheLabel given $given',
    async ({ queues, act }) => {
      const test = await started();
      if (queues) {
        test.activity('working');
        await test.chat.send(ROW_ID, PENDING);
      }
      test.leave(FAKE_HARNESS_ID);
      const queuedBefore = test.chat.sessions()[0].queued;
      const callsBefore = test.process.calls.length;

      await expect(Promise.resolve().then(() => act(test))).rejects.toThrow(
        WAITING_REFUSAL,
      );
      await flush();

      expect(test.chat.sessions()[0].queued).toEqual(queuedBefore);
      expect(test.process.calls).toHaveLength(callsBefore);
      expect(test.harness.processes).toHaveLength(1);
    },
  );

  it('harnessLeft_PullBackHeadlessInterrupt_WorkAsOnAnyRestingRow', async () => {
    const test = await started();
    test.activity('working');
    await test.chat.send(ROW_ID, PENDING);
    const [queued] = test.chat.sessions()[0].queued;
    test.leave(FAKE_HARNESS_ID);
    const callsBefore = test.process.calls.length;

    test.chat.pullBack(ROW_ID, queued.id);
    test.chat.setHeadless(ROW_ID, true);
    const entriesBefore = test.chat.sessions()[0].entries;
    test.chat.interrupt(ROW_ID);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [PENDING] },
    ]);
    const [session] = test.chat.sessions();
    expect(session.queued).toEqual([]);
    expect(session.headless).toBe(true);
    expect(session.entries).toEqual(entriesBefore);
    expect(test.process.calls).toHaveLength(callsBefore);
  });

  it('harnessLeft_AttachingRow_DetachesOnceTheAttachSettles', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', { outcome: 'process', replay() {} });
    restoreOne(test, hostedRecord(), [hostedP1()]);

    test.leave(FAKE_HARNESS_ID);
    await flush();

    const [attached] = attachedOf(test);
    expect(attached.detached).toBe(true);
    expect(attached.calls).not.toContainEqual({ method: 'kill' });
    expect(test.chat.sessions()[0].running).toBe(false);
    expect(noticesOf(test).at(-1)).toEqual({
      kind: 'notice',
      tone: 'info',
      text: WAITING_NOTICE,
    });
    await expect(test.chat.send(ROW_ID, IDLE_SEND)).rejects.toThrow(
      WAITING_REFUSAL,
    );
  });

  // Breaks if a process whose conversation has no settled host id is kept
  // unheld, which the return would attach with no session id or the old one.
  it.each([
    {
      given: 'a new row before its harness reports',
      arrange: (test: ReturnType<typeof setUp>) => {
        test.chat.start(START_ON_FAKE);
        return test.harness.processes[0];
      },
    },
    {
      given: "a cleared row before its fresh process reports",
      arrange: async (test: ReturnType<typeof setUp>) => {
        test.chat.start(START_ON_FAKE);
        await flush();
        test.chat.clear(ROW_ID);
        return test.harness.processes[1];
      },
    },
  ])(
    'harnessLeft_NoSettledHostId_EndsTheProcess given $given',
    async ({ arrange }) => {
      const test = setUp();
      const process = await arrange(test);
      const settling = test.chat.hostSessionIdSettled(ROW_ID);

      test.leave(FAKE_HARNESS_ID);

      await expect(settling).rejects.toThrow(
        `session ${ROW_ID} ended before its harness reported a session id`,
      );
      await flush();
      expect(process.calls).toContainEqual({ method: 'end' });
      expect(process.detached).toBe(false);
      expect(test.logged).toContain(
        `session ${ROW_ID} ended process ${process.request.processId}: its harness left before it reported a session id`,
      );
      test.register(test.harness);
      await test.chat.harnessReturned(FAKE_HARNESS_ID);
      await test.chat.send(ROW_ID, IDLE_SEND);
      await flush();
      expect(test.harness.attachCalls).toEqual([]);
      expect(test.harness.processes.at(-1)?.request.sessionId).toBeNull();
    },
  );

  it('harnessLeft_AfterDetachAll_ChangesNoRow', async () => {
    const test = await started();
    await test.chat.detachAll();
    const timelineBefore = test.timeline.length;

    test.leave(FAKE_HARNESS_ID);
    await flush();

    expect(test.timeline).toHaveLength(timelineBefore);
    expect(test.logged).toContain('harness fake left; chat is stopping');
  });

  it('harnessReturned_ProcessRunningHere_AttachesThroughAttach', async () => {
    const test = await resumedOnFake();
    const { processId } = test.process.request;
    test.leave(FAKE_HARNESS_ID);
    test.sessionHost.setList([
      { id: processId, startedAt: 5000, running: true, current: true },
    ]);
    test.harness.scriptAttach(processId, {
      outcome: 'process',
      replay(events) {
        events.entry(assistant('r1', 'replayed'));
      },
    });
    test.register(test.harness);

    await test.chat.harnessReturned(FAKE_HARNESS_ID);
    await flush();

    expect(test.harness.attachCalls.map((attach) => attach.processId)).toEqual([
      processId,
    ]);
    const [session] = test.chat.sessions();
    expect(session.running).toBe(true);
    expect(noticesOf(test).map((notice) => notice.text)).not.toContain(
      WAITING_NOTICE,
    );
    const ids = session.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('harnessReturned_ProcessEnded_RestsAndReadsTheHistory', async () => {
    const test = await resumedOnFake();
    test.leave(FAKE_HARNESS_ID);
    test.sessionHost.setList([]);
    test.register(test.harness);

    await test.chat.harnessReturned(FAKE_HARNESS_ID);
    await flush();

    expect(test.harness.attachCalls).toEqual([]);
    const [session] = test.chat.sessions();
    expect(session.running).toBe(false);
    expect(session.entries.map((entry) => entry.id)).toEqual([
      `history:${PAST_ONE.sessionId}-user`,
      `history:${PAST_ONE.sessionId}-assistant`,
    ]);

    await test.chat.send(ROW_ID, IDLE_SEND);
    await flush();

    const starts = startsOf(test);
    expect(starts).toHaveLength(2);
    expect(starts[1].request.resume).toBe(true);
  });

  it('harnessReturned_ProfileGone_RestsWithTheMissingProfileNotice', async () => {
    const test = await resumedOnFake();
    test.leave(FAKE_HARNESS_ID);
    test.setProfiles([{ name: 'personal', configDir: '~/.claude-personal' }]);
    test.register(test.harness);

    await test.chat.harnessReturned(FAKE_HARNESS_ID);
    await flush();

    expect(test.harness.attachCalls).toEqual([]);
    expect(noticesOf(test).at(-1)).toEqual({
      kind: 'notice',
      tone: 'error',
      text: 'Profile work is not declared by Fake; add it back to resume this session.',
    });
  });

  it('harnessLeft_WaitingPermissionCard_SettlesAsAborted', async () => {
    const test = await started();
    const decision = await askBash(test);

    test.leave(FAKE_HARNESS_ID);
    await flush();

    const card = test.chat
      .sessions()[0]
      .entries.find((entry) => entry.kind === 'permission');
    expect(card).toEqual(
      expect.objectContaining({
        answer: { allowed: false, reason: PERMISSION_CANCELLED_REASON },
      }),
    );
    expect(decision()).toEqual({
      allowed: false,
      reason: FAKE_CANCELLED_REASON,
    });
    expect(test.chat.sessions()[0].activity).toBe('idle');
  });

  it('loadHistory_HarnessLeft_ReadsNothingAndLaterTriesAgain', async () => {
    const test = restoredResting();
    test.leave(FAKE_HARNESS_ID);

    await test.chat.loadHistory(ROW_ID);

    expect(historyCallsOf(test)).toEqual([]);

    test.register(test.harness);
    await test.chat.harnessReturned(FAKE_HARNESS_ID);
    await test.chat.loadHistory(ROW_ID);

    expect(historyCallsOf(test)).toHaveLength(1);
  });

  it('harnessLeft_RestingRowWithNoProcess_StillWaits', async () => {
    const test = restoredResting();

    test.leave(FAKE_HARNESS_ID);

    await expect(test.chat.send(ROW_ID, IDLE_SEND)).rejects.toThrow(
      WAITING_REFUSAL,
    );
    expect(noticesOf(test).at(-1)).toEqual({
      kind: 'notice',
      tone: 'info',
      text: WAITING_NOTICE,
    });
    expect(test.harness.processes).toEqual([]);
  });

  it('harnessReturned_NoUnheldProcessId_ChangesNothingMore', async () => {
    let lists = 0;
    const test = restoredResting({
      sessionHost: {
        list: () => {
          lists++;
          return Promise.resolve([]);
        },
      },
    });
    const entriesBefore = test.chat.sessions()[0].entries;
    test.leave(FAKE_HARNESS_ID);
    test.register(test.harness);

    await test.chat.harnessReturned(FAKE_HARNESS_ID);
    await flush();

    expect(test.chat.sessions()[0].entries).toEqual(entriesBefore);
    expect(test.harness.attachCalls).toEqual([]);
    expect(lists).toBe(0);
    expect(historyCallsOf(test)).toEqual([]);
    // The history the row had pending before the leave is still pending.
    await test.chat.loadHistory(ROW_ID);
    expect(historyCallsOf(test)).toHaveLength(1);
  });

  it('harnessReturned_ListRejects_KeepsTheGuard', async () => {
    const test = await resumedOnFake();
    test.leave(FAKE_HARNESS_ID);
    test.sessionHost.failList('boom');
    test.register(test.harness);

    await test.chat.harnessReturned(FAKE_HARNESS_ID);
    await flush();

    expect(test.harness.attachCalls).toEqual([]);
    expect(noticesOf(test).map((notice) => notice.text)).not.toContain(
      WAITING_NOTICE,
    );
    // The send lists the host again, which still rejects.
    await expect(test.chat.send(ROW_ID, IDLE_SEND)).rejects.toThrow('boom');
    expect(test.harness.processes).toHaveLength(1);
  });

  it('harnessReturned_NotInTheRegistry_ChangesNothing', async () => {
    const test = await started();
    test.leave(FAKE_HARNESS_ID);

    await test.chat.harnessReturned(FAKE_HARNESS_ID);

    expect(test.logged).toContain(
      'harness fake set in core.agentHarnesses but not registered',
    );
    await expect(test.chat.send(ROW_ID, IDLE_SEND)).rejects.toThrow(
      WAITING_REFUSAL,
    );
  });
});
