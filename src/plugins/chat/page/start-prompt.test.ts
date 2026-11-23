import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountStatus,
  AgentHarnessInfo,
  HarnessProfile,
} from '../../../contracts/agent';
import { DEMO_HARNESS_ID, DEMO_PROFILE } from '../../../contracts/demo';
import type { ToastTone } from '../../../contracts/plugin';
import { harnessInfo } from '../../../shared/agent-harness-registry.test-support';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  filterPicker,
  openPicker,
} from '../../../shared/page/list-picker-state';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { fakeTimers } from '../../../shared/fake-timers.test-support';
import type {
  ChatProject,
  ChatSessionInfo,
  PastSessionRow,
  ProjectPastSessionRow,
  RecentFolder,
  ResumeRequest,
  ResumeSectionRow,
  ResumeSectionRows,
  StartRequest,
} from '../contract';
import { chatCommand, chatScope } from '../ids';
import type { PickerRowInput, PickerRowKit } from '../layouts/layout';
import type { ChatLayouts } from './chat-layouts';
import { createPicker, type Picker, type PickerRequest } from './picker';
import {
  type ArchiveState,
  NEW_SESSION_LABEL,
  SESSION_STEP_TITLE,
  SESSIONS_HEADING,
  sessionTime,
} from './resume-items';
import { createStartPrompt, JOIN_WAIT_MS } from './start-prompt';
import {
  CHOOSE_FOLDER_LABEL,
  FOLDERS_HEADING,
  type FolderItem,
  OTHER_FOLDER_LABEL,
  PROJECT_STEP_TITLE,
  PROJECTS_HEADING,
} from './start-prompt-items';

const HOME = '/Users/u';

const work: HarnessProfile = { name: 'work', configDir: '~/.claude' };
const personal: HarnessProfile = {
  name: 'personal',
  configDir: '~/.claude-personal',
};

const app: RecentFolder = {
  projectDir: '/Users/u/dev/app',
  harness: 'claude',
  profile: 'personal',
  lastUsed: 2,
};

// What the fake channel answers; a function answer runs per call, so it can
// reject or answer differently each time.
interface ChannelAnswers {
  recentFolders: () => Promise<RecentFolder[]>;
  resumeSections: () => Promise<ResumeSectionRows[]>;
  accountStatus: () => Promise<AccountStatus>;
  pastSessions: () => Promise<PastSessionRow[]>;
  projects: () => Promise<ChatProject[]>;
  projectPastSessions: () => Promise<ProjectPastSessionRow[]>;
  start: (request: StartRequest) => Promise<string>;
  resume: (request: ResumeRequest) => Promise<string>;
  setArchived: (hostSessionId: string, archived: boolean) => Promise<void>;
}

interface Answers extends ChannelAnswers {
  chooseFolder: () => Promise<string | null>;
}

interface Opened {
  title: string;
  labels: string[];
  selected: number | undefined;
  request: PickerRequest<unknown>;
}

// Lets the prompt's chained invokes settle.
async function flush() {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

// `profiles` are those of the one harness `claude`, unless `harnesses`
// replaces every harness; `defaultHarness` is `claude` unless given. The
// prompt opens at once unless `skipOpen`. `stop` marks chat's page part
// stopped and disposes the prompt, as chat's page part does. `setSession`
// writes or deletes a key of the fake `chat.session` slot.
function setUp(
  options: {
    profiles?: HarnessProfile[];
    harnesses?: ReadonlyMap<string, AgentHarnessInfo>;
    defaultHarness?: string;
    recent?: RecentFolder[];
    answers?: Partial<Answers>;
    skipOpen?: boolean;
  } = {},
) {
  const harnesses =
    options.harnesses ??
    new Map([
      [
        'claude',
        harnessInfo({ profiles: options.profiles ?? [work, personal] }),
      ],
    ]);
  const recent = options.recent ?? [app];
  let isStopped = false;
  const opened: Opened[] = [];
  const invoked: string[] = [];
  // The arguments of each `projectPastSessions` and `accountStatus` invoke.
  const projectSessionReads: [string, string][] = [];
  const statusAsked: string[] = [];
  const started: StartRequest[] = [];
  const resumed: ResumeRequest[] = [];
  const archiveWrites: { hostSessionId: string; archived: boolean }[] = [];
  const revealed: string[] = [];
  const logs: string[] = [];
  const toasts: { text: string; tone: ToastTone }[] = [];
  // Each sign-in the prompt opens, with the callback that finishes it.
  const signIns: {
    profile: string;
    finished: ((signedIn: boolean) => void) | undefined;
  }[] = [];
  const answers: Answers = {
    recentFolders: () => Promise.resolve(recent),
    resumeSections: () => Promise.resolve([]),
    accountStatus: () =>
      Promise.resolve({ signedIn: true, account: 'me@example.invalid' }),
    chooseFolder: () => Promise.resolve('/Users/u/dev/new'),
    pastSessions: () => Promise.resolve([]),
    projects: () => Promise.resolve([]),
    projectPastSessions: () => Promise.resolve([]),
    start: () => Promise.resolve('row-1'),
    resume: () => Promise.resolve('row-2'),
    setArchived: () => Promise.resolve(),
    ...options.answers,
  };
  // Holds one request at a time, as the real picker does: a pick or `close`
  // closes it, and a new `open` replaces it with its cursor on `selected`.
  let shown: Opened | null = null;
  let cursor = 0;
  const picker: Pick<Picker, 'open' | 'isOpen' | 'cursorIndex'> = {
    open<T>(request: PickerRequest<T>) {
      const entry: Opened = {
        title: request.title,
        labels: request.items.map((item) => request.label(item)),
        selected: request.selected,
        request: {
          ...(request as PickerRequest<unknown>),
          picked: (item) => {
            shown = null;
            request.picked(item as T);
          },
        },
      };
      opened.push(entry);
      shown = entry;
      cursor = request.selected ?? 0;
      return { isOpen: () => shown === entry };
    },
    isOpen: () => shown !== null,
    cursorIndex: () => (shown === null ? null : cursor),
  };
  const invoke = (method: string, ...args: unknown[]): Promise<unknown> => {
    invoked.push(method);
    if (method === 'start') {
      const request = args[0] as StartRequest;
      started.push(request);
      return answers.start(request);
    }
    if (method === 'resume') {
      const request = args[0] as ResumeRequest;
      resumed.push(request);
      return answers.resume(request);
    }
    if (method === 'setArchived') {
      const [hostSessionId, archived] = args as [string, boolean];
      archiveWrites.push({ hostSessionId, archived });
      return answers.setArchived(hostSessionId, archived);
    }
    if (method === 'projectPastSessions') {
      projectSessionReads.push(args as [string, string]);
    }
    if (method === 'accountStatus') {
      statusAsked.push(args[0] as string);
    }
    return answers[
      method as Exclude<
        keyof ChannelAnswers,
        'start' | 'resume' | 'setArchived'
      >
    ]();
  };
  const sessionKeys = new Map<string, ChatSessionInfo>();
  const sessionListeners = new Set<
    (sessionId: string, info: ChatSessionInfo | undefined) => void
  >();
  const fills: [string, string][] = [];
  const timers = fakeTimers();
  const prompt = createStartPrompt({
    picker: picker as Picker,
    signIn: {
      open: (profile, finished) => signIns.push({ profile, finished }),
    },
    channel: { invoke } as Parameters<typeof createStartPrompt>[0]['channel'],
    chooseFolder: () => answers.chooseFolder(),
    harnesses: () => harnesses,
    defaultHarness: () => options.defaultHarness ?? 'claude',
    reveal: (sessionId) => revealed.push(sessionId),
    paths: posixPaths,
    homeDir: HOME,
    log: (message) => logs.push(message),
    toast: (text, tone) => toasts.push({ text, tone }),
    isStopped: () => isStopped,
    sessions: {
      get: (sessionId) => sessionKeys.get(sessionId),
      on: (listener) => {
        sessionListeners.add(listener);
        return { dispose: () => sessionListeners.delete(listener) };
      },
    },
    fillComposer: (sessionId, text) => fills.push([sessionId, text]),
    timers: timers.timers,
  });
  if (options.skipOpen !== true) {
    prompt.open();
  }
  return {
    prompt,
    stop: () => {
      isStopped = true;
      prompt.dispose();
    },
    setSession: (sessionId: string, isOpen: boolean) => {
      if (isOpen) {
        sessionKeys.set(sessionId, { sessionId } as ChatSessionInfo);
      } else {
        sessionKeys.delete(sessionId);
      }
      for (const listener of [...sessionListeners]) {
        listener(sessionId, sessionKeys.get(sessionId));
      }
    },
    sessionListeners: () => sessionListeners.size,
    fills,
    timers,
    // Closes the shown list unpicked, as Esc does.
    cancel: () => {
      const entry = shown;
      shown = null;
      entry?.request.cancelled?.();
    },
    opened,
    invoked,
    projectSessionReads,
    statusAsked,
    started,
    resumed,
    archiveWrites,
    revealed,
    logs,
    toasts,
    signIns,
    last: () => opened[opened.length - 1],
    moveCursor: (index: number) => {
      cursor = index;
    },
    close: () => {
      shown = null;
    },
    // Opens another list over the prompt's, as a control picker does.
    openOther: (title: string, items: string[]) =>
      picker.open<string>({
        title,
        items,
        label: (item) => item,
        rowInput: (item) => ({
          list: 'choices',
          label: item,
          isCurrent: false,
        }),
        picked: () => undefined,
      }),
  };
}

function pickItem(opened: Opened, label: string) {
  const index = opened.labels.indexOf(label);
  expect(index).not.toBe(-1);
  opened.request.picked(opened.request.items[index]);
}

function pickFolder(opened: Opened, label: string) {
  expect(opened.title).toBe('Folder');
  const items = opened.request.items as FolderItem[];
  const item = items.find((candidate) => candidate.label === label);
  expect(item).toBeDefined();
  opened.request.picked(item);
}

const alpha: PastSessionRow = {
  hostSessionId: 'a',
  title: 'Alpha',
  modified: 3,
  archived: false,
};
const beta: PastSessionRow = {
  hostSessionId: 'b',
  title: 'Beta',
  modified: 2,
  archived: false,
};
const gamma: PastSessionRow = {
  hostSessionId: 'g',
  title: 'Gamma',
  modified: 1,
  archived: true,
};

function rowLabel(row: PastSessionRow, archived = row.archived): string {
  const label = `${row.title} · ${sessionTime(row.modified)}`;
  return archived ? `${label} · archived` : label;
}

const closedAlpha: ResumeSectionRow = {
  hostSessionId: 'a',
  projectDir: '/Users/u/dev/app',
  profile: 'work',
  title: 'Fix login',
  at: 5,
};
const headlessAlpha: ResumeSectionRow = { ...closedAlpha, headless: true };
const closedElsewhere: ResumeSectionRow = {
  hostSessionId: 'e',
  projectDir: '/Users/u/dev/other',
  profile: 'personal',
  title: 'Add cache',
  at: 6,
};

// The listed `claude` harness beside the demo harness, as a demo run holds them.
const withDemoHarness: ReadonlyMap<string, AgentHarnessInfo> = new Map([
  ['claude', harnessInfo({ profiles: [work, personal] })],
  [
    DEMO_HARNESS_ID,
    harnessInfo({
      profiles: [{ name: DEMO_PROFILE, configDir: '/demo' }],
      unlisted: true,
    }),
  ],
]);

function folderSectionLabel(row: ResumeSectionRow, base: string): string {
  return `${row.title} · ${base} · ${row.profile} · ${sessionTime(row.at)}`;
}

function recentlyClosed(
  ...rows: ResumeSectionRow[]
): () => Promise<ResumeSectionRows[]> {
  return () => Promise.resolve([{ title: 'Recently closed', rows }]);
}

// The heading the opened list gives each of its items.
function sectionsOf(opened: Opened): (string | null | undefined)[] {
  return opened.request.items.map((item) => opened.request.section?.(item));
}

// A promise the test settles by hand.
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// The prompt on its session step for ~/dev/app with one profile.
async function atSessionStep(
  answers: Partial<Answers> = {},
  rows: PastSessionRow[] = [alpha, beta, gamma],
) {
  const run = setUp({
    profiles: [work],
    answers: { pastSessions: () => Promise.resolve(rows), ...answers },
  });
  await flush();
  pickFolder(run.opened[0], '~/dev/app');
  await flush();
  return run;
}

const newGames: ChatProject = {
  kind: 'pool',
  name: 'New Games',
  pool: 'new-games-prototypes',
  profile: 'work',
};
const aiDev: ChatProject = {
  kind: 'folder',
  name: 'Wigley AI Dev',
  folder: '~/Documents/ai-dev',
  profile: null,
};
const NEW_GAMES_LABEL = 'New Games · new-games-prototypes';
const AI_DEV_LABEL = 'Wigley AI Dev · ~/Documents/ai-dev';

// The prompt opened with New Games and Wigley AI Dev in the settings.
function setUpWithProjects(
  answers: Partial<Answers> = {},
  options: { profiles?: HarnessProfile[]; recent?: RecentFolder[] } = {},
) {
  return setUp({
    ...options,
    answers: {
      projects: () => Promise.resolve([newGames, aiDev]),
      ...answers,
    },
  });
}

// Picks each label in turn on the list then shown, letting the prompt settle
// after each.
async function pickInTurn(run: ReturnType<typeof setUp>, ...labels: string[]) {
  for (const label of labels) {
    pickItem(run.last(), label);
    await flush();
  }
}

function titlesOf(run: ReturnType<typeof setUp>): string[] {
  return run.opened.map(({ title }) => title);
}

describe('start prompt', () => {
  it('open_opensTheFolderStepWithRecentThenChoose', async () => {
    const run = setUp();
    await flush();
    expect(
      run.opened.map(({ title, labels, selected }) => ({
        title,
        labels,
        selected,
      })),
    ).toEqual([
      {
        title: 'Folder',
        labels: ['~/dev/app', CHOOSE_FOLDER_LABEL],
        selected: 0,
      },
    ]);
  });

  it('folderStep_Filter_NameOutranksAnotherRowsPath', async () => {
    const run = setUp({
      recent: [
        {
          projectDir: '/Users/u/gui/backlog',
          harness: 'claude',
          profile: 'work',
          lastUsed: 3,
        },
        {
          projectDir: '/Users/u/dev/wigley-gui',
          harness: 'claude',
          profile: 'work',
          lastUsed: 2,
        },
      ],
    });
    await flush();
    const { labels, request } = run.last();
    const names = request.items.map((item) => request.name?.(item) ?? '');

    const filtered = filterPicker(
      openPicker(labels, 0, names),
      'gui',
      fakeFuzzyMatcher,
    );

    expect(labels[filtered.cursor]).toBe('~/dev/wigley-gui');
  });

  it('open_Sections_ListsThemAndKeepsCursorOnFirstFolder', async () => {
    const run = setUp({
      answers: {
        resumeSections: recentlyClosed(closedAlpha, closedElsewhere),
      },
    });
    await flush();

    expect(run.last().labels).toEqual([
      folderSectionLabel(closedAlpha, 'app'),
      folderSectionLabel(closedElsewhere, 'other'),
      '~/dev/app',
      CHOOSE_FOLDER_LABEL,
    ]);
    expect(sectionsOf(run.last())).toEqual([
      'Recently closed',
      'Recently closed',
      FOLDERS_HEADING,
      FOLDERS_HEADING,
    ]);
    expect(run.last().selected).toBe(2);
    expect(run.logs).toEqual(['resume section Recently closed: 2 rows']);
  });

  it('open_NoSections_HasNoHeadings', async () => {
    const run = await atSessionStep();

    expect(sectionsOf(run.opened[0])).toEqual([null, null]);
    expect(sectionsOf(run.last())).toEqual([null, null, null]);
  });

  it('openForNewSession_AsksForNoSections', async () => {
    const run = setUp();
    await flush();
    const asked = () =>
      run.invoked.filter((method) => method === 'resumeSections');
    expect(asked()).toHaveLength(1);

    run.prompt.openForNewSession();
    await flush();

    expect(asked()).toHaveLength(1);
    expect(run.last().title).toBe('Folder');
  });

  it('open_SectionsReject_StillOpens', async () => {
    const run = setUp({
      answers: { resumeSections: () => Promise.reject(new Error('no log')) },
    });
    await flush();

    expect(run.last().labels).toEqual(['~/dev/app', CHOOSE_FOLDER_LABEL]);
    expect(run.logs).toEqual([expect.stringContaining('no log')]);
    expect(run.toasts).toEqual([]);
  });

  it('pick_SectionRow_SignedOut_SignsInThenResumes', async () => {
    const run = setUp({
      answers: {
        resumeSections: recentlyClosed(closedAlpha),
        accountStatus: () =>
          Promise.resolve({ signedIn: false, account: null }),
      },
    });
    await flush();
    pickFolder(run.last(), folderSectionLabel(closedAlpha, 'app'));
    await flush();

    expect(run.signIns.map(({ profile }) => profile)).toEqual(['work']);
    expect(run.resumed).toEqual([]);

    run.signIns[0].finished?.(true);
    await flush();

    expect(run.resumed).toEqual([
      {
        projectDir: '/Users/u/dev/app',
        profile: 'work',
        hostSessionId: 'a',
        title: 'Fix login',
        headless: false,
      },
    ]);
    expect(run.revealed).toEqual(['row-2']);
  });

  it('pick_SectionRow_MissingProfile_ToastsRejection', async () => {
    const gone = { ...closedAlpha, profile: 'gone' };
    const run = setUp({
      answers: {
        resumeSections: recentlyClosed(gone),
        resume: () => Promise.reject(new Error('no profile gone')),
      },
    });
    await flush();
    pickFolder(run.last(), folderSectionLabel(gone, 'app'));
    await flush();

    expect(run.invoked).not.toContain('accountStatus');
    expect(run.resumed.map(({ profile }) => profile)).toEqual(['gone']);
    expect(run.toasts).toEqual([
      { text: expect.stringContaining('no profile gone'), tone: 'error' },
    ]);
  });

  it('hides projects and recent folders while the demo harness is registered', async () => {
    const run = setUp({
      harnesses: withDemoHarness,
      answers: {
        projects: () => Promise.resolve([newGames, aiDev]),
        resumeSections: recentlyClosed(closedAlpha),
      },
    });
    await flush();

    expect(titlesOf(run)).toEqual(['Folder']);
    expect(run.last().labels).toEqual([
      folderSectionLabel(closedAlpha, 'app'),
      CHOOSE_FOLDER_LABEL,
    ]);
  });

  it('a sample section row resumes nothing', async () => {
    const sample: ResumeSectionRow = {
      ...closedAlpha,
      harness: DEMO_HARNESS_ID,
      profile: DEMO_PROFILE,
    };
    const run = setUp({
      harnesses: withDemoHarness,
      answers: { resumeSections: recentlyClosed(sample) },
    });
    await flush();

    pickFolder(run.last(), folderSectionLabel(sample, 'app'));
    await flush();

    expect(run.invoked).not.toContain('resume');
    expect(run.toasts).toEqual([
      { text: 'A sample session: the demo resumes nothing', tone: 'info' },
    ]);
  });

  it('sessionStep_SectionRow_ResumesWithItsTitle', async () => {
    const label = `Fix login · ${sessionTime(closedAlpha.at)}`;
    const run = await atSessionStep(
      { resumeSections: recentlyClosed(closedAlpha) },
      [alpha, beta],
    );

    expect(run.last().labels).toEqual([
      label,
      NEW_SESSION_LABEL,
      rowLabel(beta),
    ]);
    expect(sectionsOf(run.last())).toEqual([
      'Recently closed',
      SESSIONS_HEADING,
      SESSIONS_HEADING,
    ]);
    expect(run.last().selected).toBe(1);

    pickItem(run.last(), label);
    await flush();

    expect(run.resumed).toEqual([
      {
        projectDir: '/Users/u/dev/app',
        harness: 'claude',
        profile: 'work',
        hostSessionId: 'a',
        title: 'Fix login',
        headless: false,
      },
    ]);
  });

  it.each([
    {
      step: 'folder step',
      pick: async () => {
        const run = setUp({
          answers: { resumeSections: recentlyClosed(headlessAlpha) },
        });
        await flush();
        pickFolder(run.last(), folderSectionLabel(headlessAlpha, 'app'));
        return run;
      },
    },
    {
      step: 'session step',
      pick: async () => {
        const run = await atSessionStep(
          { resumeSections: recentlyClosed(headlessAlpha) },
          [alpha, beta],
        );
        pickItem(run.last(), `Fix login · ${sessionTime(headlessAlpha.at)}`);
        return run;
      },
    },
  ])('pick_HeadlessSectionRow_ResumesHeadless ($step)', async ({ pick }) => {
    const run = await pick();
    await flush();

    expect(run.resumed).toEqual([
      expect.objectContaining({ hostSessionId: 'a', headless: true }),
    ]);
  });

  it('toggleArchive_SectionRow_LeavesTheSectionAndMovesToTheNextRow', async () => {
    const run = await atSessionStep(
      { resumeSections: recentlyClosed(closedAlpha) },
      [alpha, beta],
    );
    run.moveCursor(0);

    run.prompt.toggleArchive();
    await flush();

    expect(run.archiveWrites).toEqual([{ hostSessionId: 'a', archived: true }]);
    expect(run.last().labels).toEqual([NEW_SESSION_LABEL, rowLabel(beta)]);
    expect(run.last().selected).toBe(0);
    expect(sectionsOf(run.last())).toEqual([null, null]);
    expect(run.logs).toContain('archived Fix login');
  });

  it('recentFolder_manyProfiles_opensProfileStepOnItsProfile', async () => {
    const run = setUp();
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();
    expect(run.opened[1].title).toBe('Profile');
    expect(run.opened[1].labels).toEqual([
      'work · ~/.claude',
      'personal · ~/.claude-personal',
    ]);
    expect(run.opened[1].selected).toBe(1);
    expect(run.started).toEqual([]);
  });

  it('profilePicked_startsThereAndRevealsTheRow', async () => {
    const run = setUp();
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    pickItem(run.opened[1], 'work · ~/.claude');
    await flush();
    expect(run.started).toEqual([
      { projectDir: '/Users/u/dev/app', harness: 'claude', profile: 'work' },
    ]);
    expect(run.revealed).toEqual(['row-1']);
    expect(run.logs).toEqual([expect.stringContaining('work')]);
  });

  it('recentFolder_oneProfile_skipsTheProfileStep', async () => {
    const run = setUp({ profiles: [work] });
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();
    expect(run.opened.map((opened) => opened.title)).toEqual(['Folder']);
    expect(run.started).toEqual([
      { projectDir: '/Users/u/dev/app', harness: 'claude', profile: 'work' },
    ]);
    expect(run.revealed).toEqual(['row-1']);
  });

  it('chooseFolder_folderChosen_opensProfileStepOnFirstProfile', async () => {
    const run = setUp();
    await flush();
    pickFolder(run.opened[0], CHOOSE_FOLDER_LABEL);
    await flush();
    expect(run.opened.map((opened) => opened.title)).toEqual([
      'Folder',
      'Profile',
    ]);
    expect(run.opened[1].selected).toBe(0);
    pickItem(run.opened[1], 'personal · ~/.claude-personal');
    await flush();
    expect(run.started).toEqual([
      {
        projectDir: '/Users/u/dev/new',
        harness: 'claude',
        profile: 'personal',
      },
    ]);
  });

  it('chooseFolder_dismissed_reopensTheFolderStep', async () => {
    const run = setUp({
      answers: { chooseFolder: () => Promise.resolve(null) },
    });
    await flush();
    pickFolder(run.opened[0], CHOOSE_FOLDER_LABEL);
    await flush();
    expect(run.opened.map((opened) => opened.title)).toEqual([
      'Folder',
      'Folder',
    ]);
    expect(run.opened[1].labels).toEqual(['~/dev/app', CHOOSE_FOLDER_LABEL]);
    expect(run.started).toEqual([]);
  });

  it('chooseFolder_rejects_logsAndToastsAndOpensNothing', async () => {
    const run = setUp({
      answers: { chooseFolder: () => Promise.reject(new Error('no dialog')) },
    });
    await flush();
    pickFolder(run.opened[0], CHOOSE_FOLDER_LABEL);
    await flush();
    expect(run.opened.map((opened) => opened.title)).toEqual(['Folder']);
    expect(run.logs).toEqual([expect.stringContaining('no dialog')]);
    expect(run.toasts).toEqual([
      { text: expect.stringContaining('no dialog'), tone: 'error' },
    ]);
  });

  it('open_DefaultHarnessNotRegistered_ToastsAndOpensNothing', async () => {
    const run = setUp({ defaultHarness: 'gone' });
    await flush();
    expect(run.opened).toEqual([]);
    expect(run.toasts).toEqual([
      {
        text: 'No agent harness "gone" is registered. Set chat\'s defaultHarness to a registered harness.',
        tone: 'error',
      },
    ]);
  });

  it('recentFolder_OtherHarness_ListsThatHarnessesProfiles', async () => {
    const run = setUp({
      harnesses: new Map([
        ['claude', harnessInfo({ profiles: [work, personal] })],
        [
          'fake',
          harnessInfo({
            profiles: [
              { name: 'spare', configDir: '~/.spare' },
              { name: 'extra', configDir: '~/.extra' },
            ],
          }),
        ],
      ]),
      recent: [{ ...app, harness: 'fake', profile: 'extra' }],
    });
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();
    expect(run.opened[1].labels).toEqual([
      'spare · ~/.spare',
      'extra · ~/.extra',
    ]);
    expect(run.opened[1].selected).toBe(1);

    pickItem(run.opened[1], 'extra · ~/.extra');
    await flush();

    expect(run.started).toEqual([
      { projectDir: '/Users/u/dev/app', harness: 'fake', profile: 'extra' },
    ]);
  });

  it('projectStep_ProjectPinsAnotherHarnessesProfile_StartsOnThatHarness', async () => {
    const spareProject: ChatProject = {
      kind: 'pool',
      name: 'Spare',
      pool: 'spare-pool',
      profile: 'spare',
    };
    const run = setUp({
      harnesses: new Map([
        ['claude', harnessInfo({ profiles: [work] })],
        [
          'fake',
          harnessInfo({
            profiles: [{ name: 'spare', configDir: '~/.spare' }],
          }),
        ],
      ]),
      answers: {
        projects: () => Promise.resolve([spareProject]),
        projectPastSessions: () =>
          Promise.resolve([{ ...alpha, projectDir: '/c/1' }]),
      },
    });
    await flush();

    await pickInTurn(run, 'Spare · spare-pool', NEW_SESSION_LABEL);

    expect(run.started).toEqual([
      { project: 'Spare', harness: 'fake', profile: 'spare' },
    ]);
  });

  it('projectStep_ProjectPinsAnUnlistedHarnessesProfile_ToastsAndStartsNothing', async () => {
    const demoProject: ChatProject = {
      kind: 'pool',
      name: 'Demo',
      pool: 'demo-pool',
      profile: 'demo',
    };
    const run = setUp({
      harnesses: new Map([
        ['claude', harnessInfo({ profiles: [work] })],
        // Not the demo harness's id, which hides every project.
        [
          'unlisted',
          harnessInfo({
            profiles: [{ name: 'demo', configDir: '/demo' }],
            unlisted: true,
          }),
        ],
      ]),
      answers: {
        projects: () => Promise.resolve([demoProject]),
        projectPastSessions: () =>
          Promise.resolve([{ ...alpha, projectDir: '/c/1' }]),
      },
    });
    await flush();

    await pickInTurn(run, 'Demo · demo-pool');

    expect(run.started).toEqual([]);
    expect(run.toasts).toEqual([
      {
        text: 'Profile demo of Demo is not a profile of any registered harness',
        tone: 'error',
      },
    ]);
  });

  it('noProfiles_toastsTheHarnessLabelAndOpensNothing', async () => {
    const run = setUp({
      harnesses: new Map([
        ['claude', harnessInfo({ label: 'Claude Code', profiles: [] })],
      ]),
    });
    await flush();
    expect(run.opened).toEqual([]);
    expect(run.toasts).toEqual([
      {
        text: "Add a profile to Claude Code's profiles setting first",
        tone: 'error',
      },
    ]);
  });

  it('recentFoldersRejects_toastsAndOpensNothing', async () => {
    const run = setUp({
      answers: { recentFolders: () => Promise.reject(new Error('bad file')) },
    });
    await flush();
    expect(run.opened).toEqual([]);
    expect(run.logs).toEqual([expect.stringContaining('bad file')]);
    expect(run.toasts).toEqual([
      { text: expect.stringContaining('bad file'), tone: 'error' },
    ]);
  });

  it('startRejects_logsAndToastsAndRevealsNothing', async () => {
    const run = setUp({
      profiles: [work],
      answers: { start: () => Promise.reject(new Error('no claude')) },
    });
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();
    expect(run.revealed).toEqual([]);
    expect(run.logs).toEqual([
      expect.stringContaining('work'),
      expect.stringContaining('no claude'),
    ]);
    expect(run.toasts).toEqual([
      { text: expect.stringContaining('no claude'), tone: 'error' },
    ]);
  });

  it('sessionStep_savedSessions_opensOnNewThenUnarchivedRows', async () => {
    const run = await atSessionStep();
    expect(run.last().title).toBe('Session');
    expect(run.last().labels).toEqual([
      NEW_SESSION_LABEL,
      rowLabel(alpha),
      rowLabel(beta),
    ]);
    expect(run.last().selected).toBe(0);
    expect(run.started).toEqual([]);
  });

  it('newSessionPicked_startsThere', async () => {
    const run = await atSessionStep();
    pickItem(run.last(), NEW_SESSION_LABEL);
    await flush();
    expect(run.started).toEqual([
      { projectDir: '/Users/u/dev/app', harness: 'claude', profile: 'work' },
    ]);
    expect(run.resumed).toEqual([]);
  });

  it('pastRowPicked_resumesAndRevealsIt', async () => {
    const run = await atSessionStep();
    pickItem(run.last(), rowLabel(beta));
    await flush();
    expect(run.resumed).toEqual([
      {
        projectDir: '/Users/u/dev/app',
        harness: 'claude',
        profile: 'work',
        hostSessionId: 'b',
        title: 'Beta',
        headless: false,
      },
    ]);
    expect(run.revealed).toEqual(['row-2']);
    expect(run.logs).toEqual([expect.stringContaining('Beta')]);
  });

  it('resumeRejects_logsAndToastsAndRevealsNothing', async () => {
    const run = await atSessionStep({
      resume: () => Promise.reject(new Error('gone')),
    });
    pickItem(run.last(), rowLabel(alpha));
    await flush();
    expect(run.revealed).toEqual([]);
    expect(run.logs).toContainEqual(expect.stringContaining('gone'));
    expect(run.toasts).toEqual([
      { text: expect.stringContaining('gone'), tone: 'error' },
    ]);
  });

  it('toggleArchive_shownRow_archivesItAndMovesCursorToTheNextRow', async () => {
    const run = await atSessionStep();
    run.moveCursor(1);
    run.prompt.toggleArchive();
    await flush();
    expect(run.archiveWrites).toEqual([{ hostSessionId: 'a', archived: true }]);
    expect(run.last().labels).toEqual([NEW_SESSION_LABEL, rowLabel(beta)]);
    expect(run.last().selected).toBe(1);
    expect(run.logs).toEqual([expect.stringContaining('Alpha')]);
  });

  it('toggleArchive_archivedRow_restoresItAndKeepsTheCursorOnIt', async () => {
    const run = await atSessionStep();
    run.prompt.showArchived();
    run.moveCursor(3);
    run.prompt.toggleArchive();
    await flush();
    expect(run.archiveWrites).toEqual([
      { hostSessionId: 'g', archived: false },
    ]);
    expect(run.last().labels).toEqual([
      NEW_SESSION_LABEL,
      rowLabel(alpha),
      rowLabel(beta),
      rowLabel(gamma, false),
    ]);
    expect(run.last().selected).toBe(3);
    expect(run.logs).toContainEqual(expect.stringContaining('Gamma'));
  });

  it('toggleArchive_newSessionLine_writesNothing', async () => {
    const run = await atSessionStep();
    run.prompt.toggleArchive();
    await flush();
    expect(run.archiveWrites).toEqual([]);
    expect(run.logs).toHaveLength(1);
  });

  it.each([
    {
      given: 'only archived saved sessions',
      rows: [gamma],
      act: (_run: ReturnType<typeof setUp>) => Promise.resolve(),
      archivedLabel: rowLabel(gamma),
    },
    {
      given: 'the last live row archived',
      rows: [alpha],
      act: async (run: ReturnType<typeof setUp>) => {
        run.moveCursor(1);
        run.prompt.toggleArchive();
        await flush();
      },
      archivedLabel: rowLabel(alpha, true),
    },
  ])(
    'sessionStep_NoLiveRows_KeepsThePickerOnNewSession: $given',
    async ({ rows, act, archivedLabel }) => {
      const run = await atSessionStep({}, rows);
      await act(run);

      expect(run.last().title).toBe(SESSION_STEP_TITLE);
      expect(run.last().labels).toEqual([NEW_SESSION_LABEL]);
      expect(run.last().selected).toBe(0);
      expect(run.started).toEqual([]);

      run.prompt.showArchived();

      expect(run.last().labels).toEqual([NEW_SESSION_LABEL, archivedLabel]);
    },
  );

  it('setArchivedRejects_leavesTheListAsItWas', async () => {
    const run = await atSessionStep({
      setArchived: () => Promise.reject(new Error('read-only')),
    });
    const shownBefore = run.opened.length;
    run.moveCursor(1);
    run.prompt.toggleArchive();
    await flush();
    expect(run.opened.length).toBe(shownBefore);
    expect(run.logs).toEqual([expect.stringContaining('read-only')]);
    expect(run.toasts).toEqual([
      { text: expect.stringContaining('read-only'), tone: 'error' },
    ]);
  });

  it('setArchivedRejects_nextPressWritesAgain', async () => {
    let writes = 0;
    const run = await atSessionStep({
      setArchived: () =>
        writes++ === 0
          ? Promise.reject(new Error('read-only'))
          : Promise.resolve(),
    });
    run.moveCursor(1);
    run.prompt.toggleArchive();
    await flush();
    run.prompt.toggleArchive();
    await flush();
    expect(run.archiveWrites).toEqual([
      { hostSessionId: 'a', archived: true },
      { hostSessionId: 'a', archived: true },
    ]);
    expect(run.logs).toEqual([
      expect.stringContaining('read-only'),
      expect.stringContaining('Alpha'),
    ]);
  });

  it('showArchived_showsThenHidesTheArchivedRows', async () => {
    const run = await atSessionStep();
    run.prompt.showArchived();
    expect(run.last().labels).toEqual([
      NEW_SESSION_LABEL,
      rowLabel(alpha),
      rowLabel(beta),
      rowLabel(gamma),
    ]);
    run.prompt.showArchived();
    expect(run.last().labels).toEqual([
      NEW_SESSION_LABEL,
      rowLabel(alpha),
      rowLabel(beta),
    ]);
    expect(run.logs).toHaveLength(2);
  });

  it('sessionStepReplacedByAnotherList_archiveKeysActOnNothing', async () => {
    const run = await atSessionStep();
    run.openOther('Mode', ['default', 'plan', 'auto', 'bypass']);
    run.moveCursor(3);
    run.prompt.toggleArchive();
    run.prompt.showArchived();
    await flush();
    expect(run.archiveWrites).toEqual([]);
    expect(run.last().title).toBe('Mode');
    expect(run.logs).toHaveLength(2);
  });

  it('sessionStepClosed_archiveKeysActOnNothing', async () => {
    const run = await atSessionStep();
    run.close();
    run.prompt.toggleArchive();
    run.prompt.showArchived();
    await flush();
    expect(run.archiveWrites).toEqual([]);
    expect(run.last().title).toBe('Session');
    expect(run.logs).toHaveLength(2);
  });

  it('setArchivedAnswersAfterTheStepClosed_reopensNothing', async () => {
    const write = deferred<void>();
    const run = await atSessionStep({ setArchived: () => write.promise });
    run.moveCursor(1);
    run.prompt.toggleArchive();
    run.close();
    const shownBefore = run.opened.length;
    write.resolve();
    await flush();
    expect(run.opened.length).toBe(shownBefore);
    expect(run.logs).toEqual([]);
  });

  it('toggleArchive_writeInFlight_isIgnored', async () => {
    const write = deferred<void>();
    const run = await atSessionStep({ setArchived: () => write.promise });
    run.moveCursor(1);
    run.prompt.toggleArchive();
    run.prompt.toggleArchive();
    expect(run.archiveWrites).toEqual([{ hostSessionId: 'a', archived: true }]);
    write.resolve();
    await flush();
    expect(run.last().labels).toEqual([NEW_SESSION_LABEL, rowLabel(beta)]);
    expect(run.logs).toEqual([
      expect.any(String),
      expect.stringContaining('Alpha'),
    ]);
  });

  it('startPrompt_SignedOut_OpensSignIn', async () => {
    const run = setUp({
      profiles: [work],
      answers: {
        accountStatus: () =>
          Promise.resolve({ signedIn: false, account: null }),
      },
    });
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();

    expect(run.signIns.map(({ profile }) => profile)).toEqual(['work']);
    expect(run.invoked).not.toContain('pastSessions');
    expect(run.started).toEqual([]);
  });

  it('startPrompt_SignInFinished_OpensSessionStep', async () => {
    const run = setUp({
      answers: {
        accountStatus: () =>
          Promise.resolve({ signedIn: false, account: null }),
        pastSessions: () => Promise.resolve([alpha]),
      },
    });
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    pickItem(run.opened[1], 'personal · ~/.claude-personal');
    await flush();
    run.signIns[0].finished?.(true);
    await flush();

    expect(run.last().title).toBe(SESSION_STEP_TITLE);
  });

  it('startPrompt_SignInCancelled_StartsNothing', async () => {
    const run = setUp({
      profiles: [work],
      answers: {
        accountStatus: () =>
          Promise.resolve({ signedIn: false, account: null }),
      },
    });
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();
    run.signIns[0].finished?.(false);
    await flush();

    expect(run.invoked).not.toContain('pastSessions');
    expect(run.started).toEqual([]);
  });

  it('startPrompt_StatusReadFails_GoesOn', async () => {
    const run = setUp({
      profiles: [work],
      answers: {
        accountStatus: () => Promise.reject(new Error('claude not found')),
      },
    });
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();

    expect(run.signIns).toEqual([]);
    expect(run.logs).toContainEqual(
      expect.stringContaining('claude not found'),
    );
    expect(run.started).toEqual([
      { projectDir: '/Users/u/dev/app', harness: 'claude', profile: 'work' },
    ]);
  });

  it('startPrompt_ReopenedThenSignInFinished_GoesNoFurther', async () => {
    const run = setUp({
      profiles: [work],
      answers: {
        accountStatus: () =>
          Promise.resolve({ signedIn: false, account: null }),
        pastSessions: () => Promise.resolve([alpha]),
      },
    });
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();
    run.prompt.open();
    await flush();

    run.signIns[0].finished?.(true);
    await flush();

    expect(run.invoked).not.toContain('pastSessions');
    expect(run.last().title).toBe('Folder');
    expect(run.logs).toContainEqual(expect.stringContaining('work'));
  });

  it('startPrompt_ReopenedWhileStatusReads_OpensNoSignIn', async () => {
    const status = deferred<AccountStatus>();
    const run = setUp({
      profiles: [work],
      answers: { accountStatus: () => status.promise },
    });
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();
    run.prompt.open();
    await flush();

    status.resolve({ signedIn: false, account: null });
    await flush();

    expect(run.signIns).toEqual([]);
    expect(run.last().title).toBe('Folder');
  });

  // `gate` is the pending answer the row's `drive` leaves the prompt waiting
  // on; `settle` answers it, or finishes the sign-in, after the stop.
  const atApp = async (run: ReturnType<typeof setUp>) => {
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();
  };
  const signedOut = () => Promise.resolve({ signedIn: false, account: null });
  it.each<{
    reply: string;
    answers: (gate: Promise<never>) => Partial<Answers>;
    drive: (run: ReturnType<typeof setUp>) => Promise<void>;
    settle: (
      gate: ReturnType<typeof deferred<unknown>>,
      run: ReturnType<typeof setUp>,
    ) => void;
  }>([
    {
      reply: 'recent folders that arrive',
      answers: (gate) => ({ recentFolders: () => gate }),
      drive: () => Promise.resolve(),
      settle: (gate) => gate.resolve([app]),
    },
    {
      reply: 'recent folders that fail',
      answers: (gate) => ({ recentFolders: () => gate }),
      drive: () => Promise.resolve(),
      settle: (gate) => gate.reject(new Error('bad file')),
    },
    {
      reply: 'resume sections that fail',
      answers: (gate) => ({ resumeSections: () => gate }),
      drive: () => Promise.resolve(),
      settle: (gate) => gate.reject(new Error('bad file')),
    },
    {
      reply: 'projects that fail',
      answers: (gate) => ({ projects: () => gate }),
      drive: () => Promise.resolve(),
      settle: (gate) => gate.reject(new Error('bad file')),
    },
    {
      reply: 'a chosen folder',
      answers: (gate) => ({ chooseFolder: () => gate }),
      drive: async (run) => {
        await flush();
        pickFolder(run.opened[0], CHOOSE_FOLDER_LABEL);
      },
      settle: (gate) => gate.resolve('/Users/u/dev/new'),
    },
    {
      reply: 'a folder dialog that fails',
      answers: (gate) => ({ chooseFolder: () => gate }),
      drive: async (run) => {
        await flush();
        pickFolder(run.opened[0], CHOOSE_FOLDER_LABEL);
      },
      settle: (gate) => gate.reject(new Error('no dialog')),
    },
    {
      reply: 'a status that reads signed out',
      answers: (gate) => ({ accountStatus: () => gate }),
      drive: atApp,
      settle: (gate) => gate.resolve({ signedIn: false, account: null }),
    },
    {
      reply: 'a status read that fails',
      answers: (gate) => ({ accountStatus: () => gate }),
      drive: atApp,
      settle: (gate) => gate.reject(new Error('claude not found')),
    },
    {
      reply: 'a sign-in that finishes signed in',
      answers: () => ({ accountStatus: signedOut }),
      drive: atApp,
      settle: (_gate, run) => run.signIns[0].finished?.(true),
    },
    {
      reply: 'saved sessions that arrive',
      answers: (gate) => ({ pastSessions: () => gate }),
      drive: atApp,
      settle: (gate) => gate.resolve([alpha]),
    },
    {
      reply: 'saved sessions that fail',
      answers: (gate) => ({ pastSessions: () => gate }),
      drive: atApp,
      settle: (gate) => gate.reject(new Error('unreadable')),
    },
    {
      reply: 'a started session',
      answers: (gate) => ({ start: () => gate }),
      drive: atApp,
      settle: (gate) => gate.resolve('row-1'),
    },
    {
      reply: 'a resumed session',
      answers: (gate) => ({
        pastSessions: () => Promise.resolve([alpha, beta]),
        resume: () => gate,
      }),
      drive: async (run) => {
        await atApp(run);
        pickItem(run.last(), rowLabel(beta));
        await flush();
      },
      settle: (gate) => gate.resolve('row-2'),
    },
    {
      reply: 'an archive write that fails',
      answers: (gate) => ({
        pastSessions: () => Promise.resolve([alpha, beta]),
        setArchived: () => gate,
      }),
      drive: async (run) => {
        await atApp(run);
        run.moveCursor(1);
        run.prompt.toggleArchive();
      },
      settle: (gate) => gate.reject(new Error('read-only')),
    },
  ])(
    'opens, logs, toasts and reveals nothing for $reply after chat stopped',
    async ({ answers, drive, settle }) => {
      const gate = deferred<unknown>();
      const run = setUp({
        profiles: [work],
        answers: answers(gate.promise as Promise<never>),
      });
      await drive(run);
      const shownAtStop = run.opened.length;
      const logsAtStop = [...run.logs];
      const signInsAtStop = run.signIns.length;
      const startedAtStop = run.started.length;

      run.stop();
      settle(gate, run);
      await flush();

      expect(run.opened.length).toBe(shownAtStop);
      expect(run.logs).toEqual(logsAtStop);
      expect(run.toasts).toEqual([]);
      expect(run.signIns.length).toBe(signInsAtStop);
      expect(run.started.length).toBe(startedAtStop);
      expect(run.revealed).toEqual([]);
    },
  );
  it('open_ProjectsReject_OpensTheFolderStep', async () => {
    const run = setUp({
      answers: { projects: () => Promise.reject(new Error('bad setting')) },
    });
    await flush();

    expect(titlesOf(run)).toEqual(['Folder']);
    expect(run.logs).toContainEqual(
      expect.stringContaining('projects not read:'),
    );
  });

  it('open_Projects_OpensTheProjectStepOnTheFirstProject', async () => {
    const run = setUpWithProjects({
      resumeSections: recentlyClosed(closedAlpha),
    });
    await flush();

    expect(run.last().title).toBe(PROJECT_STEP_TITLE);
    expect(run.last().labels).toEqual([
      folderSectionLabel(closedAlpha, 'app'),
      NEW_GAMES_LABEL,
      AI_DEV_LABEL,
      OTHER_FOLDER_LABEL,
    ]);
    expect(sectionsOf(run.last())).toEqual([
      'Recently closed',
      PROJECTS_HEADING,
      PROJECTS_HEADING,
      PROJECTS_HEADING,
    ]);
    expect(run.last().selected).toBe(1);
  });

  it('projectStep_OtherFolder_OpensTheFolderStep', async () => {
    const run = setUpWithProjects();
    await flush();

    await pickInTurn(run, OTHER_FOLDER_LABEL);

    const { title, labels, selected } = run.last();
    expect({ title, labels, selected }).toEqual({
      title: 'Folder',
      labels: ['~/dev/app', CHOOSE_FOLDER_LABEL],
      selected: 0,
    });
  });

  it('projectStep_SectionRow_Resumes', async () => {
    const run = setUpWithProjects({
      resumeSections: recentlyClosed(closedAlpha),
    });
    await flush();

    await pickInTurn(run, folderSectionLabel(closedAlpha, 'app'));

    expect(run.resumed).toEqual([
      {
        projectDir: '/Users/u/dev/app',
        profile: 'work',
        hostSessionId: 'a',
        title: 'Fix login',
        headless: false,
      },
    ]);
  });

  it.each([
    {
      name: 'fixed profile skips the step',
      project: newGames,
      picks: [NEW_GAMES_LABEL],
      profileSelected: null,
      statusAsked: ['work'],
      toasts: [],
      reachesSessionStep: true,
    },
    {
      name: 'folder project pre-selects its last use',
      project: aiDev,
      picks: [AI_DEV_LABEL],
      profileSelected: 1,
      statusAsked: [],
      toasts: [],
      reachesSessionStep: false,
    },
    {
      name: 'pool project with no profile',
      project: { ...newGames, profile: null },
      picks: [NEW_GAMES_LABEL],
      profileSelected: 0,
      statusAsked: [],
      toasts: [],
      reachesSessionStep: false,
    },
    {
      name: 'fixed profile not in settings',
      project: { ...newGames, profile: 'gone' },
      picks: [NEW_GAMES_LABEL],
      profileSelected: null,
      statusAsked: [],
      toasts: [
        {
          text: 'Profile gone of New Games is not a profile of any registered harness',
          tone: 'error',
        },
      ],
      reachesSessionStep: false,
    },
  ])(
    'projectProfile: $name',
    async ({
      project,
      picks,
      profileSelected,
      statusAsked,
      toasts,
      reachesSessionStep,
    }) => {
      const run = setUp({
        profiles: [work, personal],
        recent: [
          {
            projectDir: '/Users/u/Documents/ai-dev',
            harness: 'claude',
            profile: 'personal',
            lastUsed: 3,
          },
        ],
        answers: {
          projects: () => Promise.resolve([project]),
          projectPastSessions: () =>
            Promise.resolve([{ ...alpha, projectDir: '/c/1' }]),
        },
      });
      await flush();

      await pickInTurn(run, ...picks);

      const profileSteps = run.opened.filter(
        ({ title }) => title === 'Profile',
      );
      expect(profileSteps.map(({ selected }) => selected)).toEqual(
        profileSelected === null ? [] : [profileSelected],
      );
      expect(run.statusAsked).toEqual(statusAsked);
      expect(run.toasts).toEqual(toasts);
      expect(titlesOf(run).includes(SESSION_STEP_TITLE)).toBe(
        reachesSessionStep,
      );
    },
  );

  it('projectSessionStep_ListsTheProjectsSessions_ResumesInEachRowsFolder', async () => {
    const run = setUpWithProjects({
      projectPastSessions: () =>
        Promise.resolve([
          { ...alpha, projectDir: '/c/1' },
          { ...beta, projectDir: '/c/3' },
        ]),
    });
    await flush();
    await pickInTurn(run, NEW_GAMES_LABEL);
    expect(run.last().title).toBe(SESSION_STEP_TITLE);

    await pickInTurn(run, rowLabel(beta));

    expect(run.projectSessionReads).toEqual([['New Games', 'work']]);
    expect(run.resumed).toEqual([
      {
        projectDir: '/c/3',
        harness: 'claude',
        profile: 'work',
        hostSessionId: 'b',
        title: 'Beta',
        headless: false,
      },
    ]);
  });

  it.each([
    {
      name: 'New Games under its own profile',
      picks: [NEW_GAMES_LABEL],
      started: {
        project: 'New Games',
        harness: 'claude',
        profile: 'work',
      },
    },
    {
      name: 'Wigley AI Dev under work',
      picks: [AI_DEV_LABEL, 'work · ~/.claude'],
      started: {
        project: 'Wigley AI Dev',
        harness: 'claude',
        profile: 'work',
      },
    },
  ])('projectNewSession: $name', async ({ picks, started }) => {
    const run = setUpWithProjects({
      projectPastSessions: () =>
        Promise.resolve([{ ...alpha, projectDir: '/c/1' }]),
    });
    await flush();

    await pickInTurn(run, ...picks, NEW_SESSION_LABEL);

    expect(run.started).toEqual([started]);
  });

  it.each([
    {
      given: 'openForNewSession on a folder with saved sessions',
      reach: async () => {
        const run = setUp({
          answers: { pastSessions: () => Promise.resolve([alpha, beta]) },
        });
        run.prompt.openForNewSession();
        await flush();
        await pickInTurn(run, '~/dev/app', 'work · ~/.claude');
        return run;
      },
      started: {
        projectDir: '/Users/u/dev/app',
        harness: 'claude',
        profile: 'work',
      },
      toasts: [],
      unlisted: 'pastSessions',
    },
    {
      given: 'a folder with no saved sessions',
      reach: async () => {
        const run = setUp();
        await flush();
        await pickInTurn(run, '~/dev/app', 'work · ~/.claude');
        return run;
      },
      started: {
        projectDir: '/Users/u/dev/app',
        harness: 'claude',
        profile: 'work',
      },
      toasts: [],
      unlisted: null,
    },
    {
      given: 'a folder whose listing rejects',
      reach: async () => {
        const run = setUp({
          answers: {
            pastSessions: () => Promise.reject(new Error('no folder')),
          },
        });
        await flush();
        await pickInTurn(run, '~/dev/app', 'work · ~/.claude');
        return run;
      },
      started: {
        projectDir: '/Users/u/dev/app',
        harness: 'claude',
        profile: 'work',
      },
      toasts: [{ text: expect.stringContaining('no folder'), tone: 'error' }],
      unlisted: null,
    },
    {
      given: 'a project with no saved sessions',
      reach: async () => {
        const run = setUpWithProjects();
        await flush();
        await pickInTurn(run, NEW_GAMES_LABEL);
        return run;
      },
      started: { project: 'New Games', harness: 'claude', profile: 'work' },
      toasts: [],
      unlisted: null,
    },
    {
      given: 'openForNewSession on a project with saved sessions',
      reach: async () => {
        const run = setUpWithProjects({
          resumeSections: recentlyClosed(closedAlpha),
          projectPastSessions: () =>
            Promise.resolve([{ ...alpha, projectDir: '/c/1' }]),
        });
        run.prompt.openForNewSession();
        await flush();
        expect(run.last().labels).toEqual([
          NEW_GAMES_LABEL,
          AI_DEV_LABEL,
          OTHER_FOLDER_LABEL,
        ]);
        await pickInTurn(run, NEW_GAMES_LABEL);
        return run;
      },
      started: { project: 'New Games', harness: 'claude', profile: 'work' },
      toasts: [],
      unlisted: 'projectPastSessions',
    },
  ])(
    'sessionStep_NoRowsToList_StartsAtOnce: $given',
    async ({ reach, started, toasts, unlisted }) => {
      const run = await reach();

      expect(titlesOf(run)).not.toContain(SESSION_STEP_TITLE);
      expect(run.started).toStrictEqual([started]);
      expect(run.toasts).toEqual(toasts);
      if (unlisted !== null) {
        expect(run.invoked).not.toContain(unlisted);
      }
    },
  );
});

const DRAFT = 'Work on XYZ-3: Fix the crash';

// The prompt with one profile, unopened until the test opens a draft.
function setUpForDraft(options: Parameters<typeof setUp>[0] = {}) {
  return setUp({ profiles: [work], skipOpen: true, ...options });
}

// Opens a draft and picks ~/dev/app, which starts `row-1` (one signed-in
// profile, no saved sessions asked for), letting the prompt settle.
async function draftStarted(run: ReturnType<typeof setUp>) {
  const drafted = run.prompt.newSessionWithDraft(DRAFT);
  await flush();
  pickFolder(run.last(), '~/dev/app');
  await flush();
  return drafted;
}

describe('start prompt newSessionWithDraft', () => {
  it('newSessionWithDraft — fills the new session’s box once its tab exists', async () => {
    const run = setUpForDraft();
    const drafted = await draftStarted(run);
    expect(run.invoked).not.toContain('pastSessions');
    expect(run.revealed).toEqual(['row-1']);
    expect(run.fills).toEqual([]);

    run.setSession('row-0', true);
    expect(run.fills).toEqual([]);
    run.setSession('row-1', true);

    await expect(drafted).resolves.toBe('row-1');
    expect(run.fills).toEqual([['row-1', DRAFT]]);
    expect(run.sessionListeners()).toBe(0);
    expect(run.timers.armed.size).toBe(0);
  });

  it('newSessionWithDraft — a key already on the page fills at once', async () => {
    const run = setUpForDraft();
    run.setSession('row-1', true);

    const drafted = await draftStarted(run);

    await expect(drafted).resolves.toBe('row-1');
    expect(run.fills).toEqual([['row-1', DRAFT]]);
    expect(run.sessionListeners()).toBe(0);
    expect(run.timers.armed.size).toBe(0);
  });

  it('newSessionWithDraft — Esc at the first step resolves null', async () => {
    const run = setUpForDraft();
    const drafted = run.prompt.newSessionWithDraft(DRAFT);
    await flush();
    expect(run.last().title).toBe('Folder');

    run.cancel();

    await expect(drafted).resolves.toBeNull();
    expect(run.started).toEqual([]);
  });

  it('newSessionWithDraft — opening the prompt again resolves the earlier one null', async () => {
    const run = setUpForDraft();
    const earlier = run.prompt.newSessionWithDraft(DRAFT);
    await flush();

    const later = run.prompt.newSessionWithDraft('Follow up');
    await expect(earlier).resolves.toBeNull();
    await flush();
    pickFolder(run.last(), '~/dev/app');
    await flush();
    run.setSession('row-1', true);

    await expect(later).resolves.toBe('row-1');
    expect(run.fills).toEqual([['row-1', 'Follow up']]);
  });

  it('newSessionWithDraft — a failed start resolves null', async () => {
    const run = setUpForDraft({
      answers: { start: () => Promise.reject(new Error('no claude')) },
    });

    const drafted = await draftStarted(run);

    await expect(drafted).resolves.toBeNull();
    expect(run.sessionListeners()).toBe(0);
  });

  it('newSessionWithDraft — the page stopping resolves null and disposes the listener', async () => {
    const run = setUpForDraft();
    const drafted = await draftStarted(run);
    expect(run.sessionListeners()).toBe(1);

    run.stop();

    await expect(drafted).resolves.toBeNull();
    expect(run.sessionListeners()).toBe(0);
    expect(run.timers.armed.size).toBe(0);
    run.setSession('row-1', true);
    expect(run.fills).toEqual([]);
  });

  it('newSessionWithDraft — a cancelled sign-in resolves null', async () => {
    const run = setUpForDraft({
      answers: {
        accountStatus: () =>
          Promise.resolve({ signedIn: false, account: null }),
      },
    });

    const drafted = await draftStarted(run);
    run.signIns[0].finished?.(false);

    await expect(drafted).resolves.toBeNull();
    expect(run.started).toEqual([]);
  });

  it('newSessionWithDraft — default harness not registered resolves null', async () => {
    const run = setUpForDraft({ defaultHarness: 'gone' });

    const drafted = run.prompt.newSessionWithDraft(DRAFT);

    await expect(drafted).resolves.toBeNull();
    expect(run.opened).toEqual([]);
  });

  it('newSessionWithDraft — the session closing before its key arrives resolves null', async () => {
    const run = setUpForDraft();
    const drafted = await draftStarted(run);

    run.setSession('row-1', false);

    await expect(drafted).resolves.toBeNull();
    expect(run.fills).toEqual([]);
    expect(run.sessionListeners()).toBe(0);
    expect(run.timers.armed.size).toBe(0);
  });

  it('newSessionWithDraft — no key within JOIN_WAIT_MS resolves null and logs', async () => {
    const run = setUpForDraft();
    const drafted = await draftStarted(run);

    run.timers.runAfter(JOIN_WAIT_MS);

    await expect(drafted).resolves.toBeNull();
    expect(run.logs).toContain(
      'newSessionWithDraft: row-1 never reached the page',
    );
    expect(run.sessionListeners()).toBe(0);
    run.setSession('row-1', true);
    expect(run.fills).toEqual([]);
  });
});

// The chat picker's list drawn through `createPicker`, each row's `pickerRow`
// input recorded by label and its prompt's hints drawn on the real base kit.
function pickerRun(options: {
  scope: 'picker' | 'resume';
  archiveState: ArchiveState | null;
}) {
  const inputs = new Map<string, PickerRowInput>();
  const { anchors, keys } = recordingAnchors();
  const rowAnchors = new Map<string, typeof anchors>();
  const layouts = {
    onChange: () => ({ dispose: () => undefined }),
    draw(
      _part: 'pickerRow' | 'pickerHeading',
      parent: HTMLElement,
      build: (
        builder: unknown,
        at: HTMLElement,
        rollback: unknown,
      ) => { element: HTMLElement },
    ) {
      const builder = (
        at: HTMLElement,
        input: PickerRowInput,
        kit: PickerRowKit,
      ) => {
        inputs.set(input.label, input);
        const anchorsBefore = anchors.length;
        for (const action of input.prompt) {
          kit.keyHint(at, action.command, { label: action.label });
        }
        rowAnchors.set(input.label, anchors.slice(anchorsBefore));
        return { element: at };
      };
      const built = build(builder, parent, {
        recordAnchor: () => undefined,
      });
      return { built, dispose: () => undefined };
    },
  } as unknown as ChatLayouts;
  const picker = createPicker({
    picker: fakeListPickerService({
      place: () => undefined,
      editor: { create: () => ({ setText: () => undefined }) } as never,
    }),
    layouts,
    log: () => undefined,
    keys,
    markdown: {} as never,
    commands: {
      exists: () => true,
      argShape: () => undefined,
      run: () => undefined,
    },
    platform: 'macos',
    state: noLayoutState,
  });
  picker.open<string>({
    title: 'Session',
    items: ['first', 'second'],
    label: (item) => item,
    rowInput: (item) => ({ list: 'choices', label: item, isCurrent: false }),
    scope: options.scope,
    selected: 0,
    archiveState: () => options.archiveState,
    picked: () => undefined,
  });
  return { inputs, rowAnchors };
}

describe('chat picker prompt', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      case: 'a live session at the cursor',
      scope: 'resume' as const,
      archiveState: 'live' as const,
      row: 'first',
      expected: [{ command: 'chat.toggleArchive', label: 'archive' }],
    },
    {
      case: 'an archived session at the cursor',
      scope: 'resume' as const,
      archiveState: 'archived' as const,
      row: 'first',
      expected: [{ command: 'chat.toggleArchive', label: 'restore' }],
    },
    {
      case: 'a row off the cursor',
      scope: 'resume' as const,
      archiveState: 'live' as const,
      row: 'second',
      expected: [],
    },
    {
      case: 'an item with no archive state',
      scope: 'resume' as const,
      archiveState: null,
      row: 'first',
      expected: [],
    },
    {
      case: 'the picker scope',
      scope: 'picker' as const,
      archiveState: 'live' as const,
      row: 'first',
      expected: [],
    },
  ])(
    'resumePicker_CursorRow_PromptNamesArchiveOrRestore: $case',
    ({ scope, archiveState, row, expected }) => {
      const { inputs, rowAnchors } = pickerRun({ scope, archiveState });

      expect(inputs.get(row)?.prompt).toEqual(expected);
      const archiveScopes = (rowAnchors.get(row) ?? [])
        .filter((anchor) => anchor.command === chatCommand('toggleArchive'))
        .map((anchor) => anchor.scope);
      expect(archiveScopes).toEqual(
        expected.length > 0 ? [chatScope('resume')] : [],
      );
    },
  );
});
