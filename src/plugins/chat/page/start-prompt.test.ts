import { describe, expect, it } from 'vitest';
import type { ToastTone } from '../../../contracts/plugin';
import type {
  ChatProfile,
  PastSessionRow,
  RecentFolder,
  StartRequest,
} from '../contract';
import type { Picker, PickerRequest } from './picker';
import { createStartPrompt } from './start-prompt';
import { CHOOSE_FOLDER_LABEL, type FolderItem } from './start-prompt-items';

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
  homeDir: () => Promise<string>;
  chooseFolder: () => Promise<string | null>;
  pastSessions: () => Promise<PastSessionRow[]>;
  start: (request: StartRequest) => Promise<string>;
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
  const revealed: string[] = [];
  const logs: string[] = [];
  const toasts: { text: string; tone: ToastTone }[] = [];
  const answers: Answers = {
    recentFolders: () => Promise.resolve(recent),
    homeDir: () => Promise.resolve(HOME),
    chooseFolder: () => Promise.resolve('/Users/u/dev/new'),
    pastSessions: () => Promise.resolve([]),
    start: () => Promise.resolve('row-1'),
    ...options.answers,
  };
  const picker: Pick<Picker, 'open'> = {
    open<T>(request: PickerRequest<T>) {
      opened.push({
        title: request.title,
        labels: request.items.map((item) => request.label(item)),
        selected: request.selected,
        request: request as PickerRequest<unknown>,
      });
    },
  };
  const invoke = (method: string, ...args: unknown[]): Promise<unknown> => {
    invoked.push(method);
    if (method === 'start') {
      const request = args[0] as StartRequest;
      started.push(request);
      return answers.start(request);
    }
    return answers[method as Exclude<keyof Answers, 'start'>]();
  };
  createStartPrompt({
    picker: picker as Picker,
    channel: { invoke } as Parameters<typeof createStartPrompt>[0]['channel'],
    profiles: () => profiles,
    reveal: (sessionId) => revealed.push(sessionId),
    log: (source, message) => logs.push(`[${source}] ${message}`),
    toast: (text, tone) => toasts.push({ text, tone }),
  }).open();
  return { opened, invoked, started, revealed, logs, toasts };
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
    expect(run.logs).toEqual([
      '[chat] starting a session in ~/dev/app with work',
    ]);
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
    expect(run.logs).toEqual(['[chat] no folder chosen']);
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
    expect(run.logs).toEqual(['[chat] folder dialog failed: no dialog']);
    expect(run.toasts).toEqual([
      { text: 'Folder dialog failed: no dialog', tone: 'error' },
    ]);
  });

  it('noProfiles_toastsAndOpensNothing', async () => {
    const run = setUp({ profiles: [] });
    await flush();
    expect(run.opened).toEqual([]);
    expect(run.logs).toEqual(['[chat] no profiles in the chat settings']);
    expect(run.toasts).toEqual([
      { text: "Add a profile to chat's profiles setting first", tone: 'error' },
    ]);
  });

  it('recentFoldersRejects_toastsAndOpensNothing', async () => {
    const run = setUp({
      answers: { recentFolders: () => Promise.reject(new Error('bad file')) },
    });
    await flush();
    expect(run.opened).toEqual([]);
    expect(run.logs).toEqual(['[chat] start prompt not opened: bad file']);
    expect(run.toasts).toEqual([
      { text: 'Start prompt not opened: bad file', tone: 'error' },
    ]);
  });

  it('homeDirRejects_toastsAndOpensNothing', async () => {
    const run = setUp({
      answers: { homeDir: () => Promise.reject(new Error('no home')) },
    });
    await flush();
    expect(run.opened).toEqual([]);
    expect(run.toasts).toEqual([
      { text: 'Start prompt not opened: no home', tone: 'error' },
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
      '[chat] starting a session in ~/dev/app with work',
      '[chat] session not started: no claude',
    ]);
    expect(run.toasts).toEqual([
      { text: 'Session not started: no claude', tone: 'error' },
    ]);
  });
});
