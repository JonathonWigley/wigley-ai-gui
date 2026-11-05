import { describe, expect, it } from 'vitest';
import type { AccountStatus } from '../../../contracts/agent';
import type { ToastTone } from '../../../contracts/plugin';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import {
  filterPicker,
  openPicker,
} from '../../../shared/page/list-picker-state';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  ChatProfile,
  PastSessionRow,
  RecentFolder,
  ResumeRequest,
  ResumeSectionRow,
  ResumeSectionRows,
  StartRequest,
} from '../contract';
import type { Picker, PickerRequest } from './picker';
import {
  NEW_SESSION_LABEL,
  SESSION_STEP_TITLE,
  SESSIONS_HEADING,
  sessionTime,
} from './resume-items';
import { createStartPrompt } from './start-prompt';
import {
  CHOOSE_FOLDER_LABEL,
  FOLDERS_HEADING,
  type FolderItem,
} from './start-prompt-items';

const HOME = '/Users/u';

const work: ChatProfile = { name: 'work', configDir: '~/.claude' };
const personal: ChatProfile = {
  name: 'personal',
  configDir: '~/.claude-personal',
};

const app: RecentFolder = {
  projectDir: '/Users/u/dev/app',
  profile: 'personal',
  lastUsed: 2,
};

// What the fake channel answers; a function answer runs per call, so it can
// reject or answer differently each time.
interface Answers {
  recentFolders: () => Promise<RecentFolder[]>;
  resumeSections: () => Promise<ResumeSectionRows[]>;
  accountStatus: () => Promise<AccountStatus>;
  chooseFolder: () => Promise<string | null>;
  pastSessions: () => Promise<PastSessionRow[]>;
  start: (request: StartRequest) => Promise<string>;
  resume: (request: ResumeRequest) => Promise<string>;
  setArchived: (hostSessionId: string, archived: boolean) => Promise<void>;
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

function setUp(
  options: {
    profiles?: ChatProfile[];
    recent?: RecentFolder[];
    answers?: Partial<Answers>;
  } = {},
) {
  const profiles = options.profiles ?? [work, personal];
  const recent = options.recent ?? [app];
  const opened: Opened[] = [];
  const invoked: string[] = [];
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
    return answers[
      method as Exclude<keyof Answers, 'start' | 'resume' | 'setArchived'>
    ]();
  };
  const prompt = createStartPrompt({
    picker: picker as Picker,
    signIn: {
      open: (profile, finished) => signIns.push({ profile, finished }),
    },
    channel: { invoke } as Parameters<typeof createStartPrompt>[0]['channel'],
    profiles: () => profiles,
    reveal: (sessionId) => revealed.push(sessionId),
    paths: posixPaths,
    homeDir: HOME,
    log: (message) => logs.push(message),
    toast: (text, tone) => toasts.push({ text, tone }),
  });
  prompt.open();
  return {
    prompt,
    opened,
    invoked,
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
const closedElsewhere: ResumeSectionRow = {
  hostSessionId: 'e',
  projectDir: '/Users/u/dev/other',
  profile: 'personal',
  title: 'Add cache',
  at: 6,
};

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
        { projectDir: '/Users/u/gui/backlog', profile: 'work', lastUsed: 3 },
        { projectDir: '/Users/u/dev/wigley-gui', profile: 'work', lastUsed: 2 },
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
        profile: 'work',
        hostSessionId: 'a',
        title: 'Fix login',
      },
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
      { projectDir: '/Users/u/dev/app', profile: 'work' },
    ]);
    expect(run.revealed).toEqual(['row-1']);
    expect(run.logs).toEqual([expect.stringContaining('work')]);
  });

  it('recentFolder_oneProfile_startsAtOnce', async () => {
    const run = setUp({ profiles: [work] });
    await flush();
    pickFolder(run.opened[0], '~/dev/app');
    await flush();
    expect(run.opened.map((opened) => opened.title)).toEqual(['Folder']);
    expect(run.started).toEqual([
      { projectDir: '/Users/u/dev/app', profile: 'work' },
    ]);
    expect(run.revealed).toEqual(['row-1']);
  });

  it('chooseFolder_folderChosen_opensProfileStepOnFirstProfile', async () => {
    const run = setUp();
    await flush();
    pickFolder(run.opened[0], CHOOSE_FOLDER_LABEL);
    await flush();
    expect(run.invoked).toContain('chooseFolder');
    expect(run.opened.map((opened) => opened.title)).toEqual([
      'Folder',
      'Profile',
    ]);
    expect(run.opened[1].selected).toBe(0);
    pickItem(run.opened[1], 'personal · ~/.claude-personal');
    await flush();
    expect(run.started).toEqual([
      { projectDir: '/Users/u/dev/new', profile: 'personal' },
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

  it('noProfiles_toastsAndOpensNothing', async () => {
    const run = setUp({ profiles: [] });
    await flush();
    expect(run.opened).toEqual([]);
    expect(run.toasts).toEqual([{ text: expect.any(String), tone: 'error' }]);
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

  it('openForNewSession_savedSessions_startsWithoutTheSessionStep', async () => {
    const run = setUp({
      answers: { pastSessions: () => Promise.resolve([alpha, beta]) },
    });
    run.prompt.openForNewSession();
    await flush();
    pickFolder(run.last(), '~/dev/app');
    await flush();
    pickItem(run.last(), 'work · ~/.claude');
    await flush();
    expect(run.opened.map(({ title }) => title)).toEqual(['Folder', 'Profile']);
    expect(run.invoked).not.toContain('pastSessions');
    expect(run.started).toEqual([
      { projectDir: '/Users/u/dev/app', profile: 'work' },
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

  it('pastSessionsRejects_opensNewSessionAloneAndToasts', async () => {
    const run = await atSessionStep({
      pastSessions: () => Promise.reject(new Error('no folder')),
    });
    expect(run.last().title).toBe('Session');
    expect(run.last().labels).toEqual([NEW_SESSION_LABEL]);
    expect(run.logs).toEqual([expect.stringContaining('no folder')]);
    expect(run.toasts).toEqual([
      { text: expect.stringContaining('no folder'), tone: 'error' },
    ]);
  });

  it('newSessionPicked_startsThere', async () => {
    const run = await atSessionStep();
    pickItem(run.last(), NEW_SESSION_LABEL);
    await flush();
    expect(run.started).toEqual([
      { projectDir: '/Users/u/dev/app', profile: 'work' },
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
        profile: 'work',
        hostSessionId: 'b',
        title: 'Beta',
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
      { projectDir: '/Users/u/dev/app', profile: 'work' },
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
});
