import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DemoStep } from '../../../contracts/demo';
import type {
  ListPicker,
  ListPickerRequest,
} from '../../../contracts/list-picker';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import { startDrawingPagePart } from '../../../shared/page/layout-host/page-part-harness.test-support';
import { PLAIN_MARKDOWN } from '../../../shared/page/markdown-mount.test-support';
import { asFake, findAll, installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  deferred,
  fakeDependency,
} from '../../../shared/plugin-part-harness.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import { chatPageKey, type ChatPageExports } from '../../chat/contract';
import {
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import type {
  BackendCapabilities,
  BackendView,
  BuildRecord,
  BuildsSnapshot,
  GameView,
} from '../contract';
import { buildsSnapshotSlot } from '../contract';
import { buildRecord, gameEntry } from '../contract.test-support';
import { buildsPagePart } from './start';

const MODE = 'builds.main';
const G1 = 'work/g1';

interface Fixture {
  capabilities?: BackendCapabilities | null;
  clone?: string | null;
  g1Builds?: BuildRecord[];
  extraBackends?: BackendView[];
}

function g1View(fixture: Fixture): GameView {
  return {
    backendId: 'work',
    game: gameEntry({
      id: 'g1',
      label: 'Game One',
      defaultBranch: 'protos/game',
      clone: fixture.clone === undefined ? '/clones/g1' : fixture.clone,
      kinds: {
        dev: { label: 'Dev', target: null },
        release: { label: 'Release', target: null },
      },
      sets: [
        {
          id: 'rc',
          label: 'RC',
          kinds: ['dev', 'release'],
          branches: 'releases/*',
          agentPrompt: 'Make the RC set.',
        },
      ],
    }),
    builds: fixture.g1Builds ?? [],
    subjects: {},
    setRuns: [],
  };
}

// Backend `work` (label `Work`) with games `g1` (`Game One`: kinds `dev` and `release`, set `rc` on `releases/*`)
// and `g2` (`Game Two`), then `extraBackends`.
function workSnapshot(fixture: Fixture = {}): BuildsSnapshot {
  return {
    polledAt: 0,
    backends: [
      {
        id: 'work',
        kind: 'fixture',
        label: 'Work',
        problem: null,
        capabilities:
          fixture.capabilities === undefined
            ? { cancel: true, choosesBranch: true }
            : fixture.capabilities,
        games: [
          g1View(fixture),
          {
            backendId: 'work',
            game: gameEntry({ id: 'g2', label: 'Game Two' }),
            builds: [],
            subjects: {},
            setRuns: [],
          },
        ],
      },
      ...(fixture.extraBackends ?? []),
    ],
  };
}

type Answer = (...args: unknown[]) => unknown;

// The Builds page on the harness, drawing its layout for real, with `snapshot` published to `builds.snapshot`.
// `answers` answers an invoke by method, else undefined; `calls` holds each invoke, `opens` each picker request,
// `opened` each `openExternal` url.
function startBuildsPage(
  snapshot: BuildsSnapshot,
  answers: Record<string, Answer> = {},
) {
  installFocusFakeDom(vi.stubGlobal);
  const calls: { method: string; args: unknown[] }[] = [];
  const opens: ListPickerRequest<unknown>[] = [];
  const opened: string[] = [];
  const pickers = fakeListPickerService();
  const recordingPickers = {
    create(options: Parameters<typeof pickers.create>[0]): ListPicker {
      const picker = pickers.create(options);
      return {
        ...picker,
        open<T>(request: ListPickerRequest<T>) {
          opens.push(request as ListPickerRequest<unknown>);
          picker.open(request);
        },
      };
    },
  };
  const demoSteps = createDemoStepRegistry<DemoStep>();
  const state = createSlotStore(() => undefined);
  const snapshotWriter = state.publish(buildsSnapshotSlot);
  snapshotWriter.set(snapshot);
  const harness = startDrawingPagePart(buildsPagePart, {
    firstModeTaken: true,
    state,
    services: {
      markdown: PLAIN_MARKDOWN,
      picker: recordingPickers,
      demoSteps,
      async openExternal(url) {
        opened.push(url);
      },
    },
    dependencies: [
      fakeDependency(sessionsPageKey, () => ({}) as SessionsPageExports),
      fakeDependency(chatPageKey, () => ({}) as ChatPageExports),
    ],
    invoke: async (method, ...args) => {
      calls.push({ method, args });
      return answers[method]?.(...args);
    },
  });
  harness.ready();
  const commands = harness.started().commands;
  const run = (
    command: Exclude<
      keyof typeof commands,
      | 'selectEntry'
      | 'selectBuild'
      | 'queueButton'
      | 'withAgent'
      | 'setFilter'
      | 'openLink'
    >,
  ) => commands[command]({ arg: undefined });
  const callsOf = (method: string) =>
    calls.filter((call) => call.method === method).map((call) => call.args[0]);
  const logged = () => harness.logs.map((line) => line.message);
  const toasts = () => logged().filter((line) => line.startsWith('toast '));
  const lastOpen = () => opens.at(-1);
  // The open request's rows as `label` or `section: label`.
  const rows = () => {
    const request = lastOpen();
    if (request === undefined) {
      return [];
    }
    return request.items.map((item) => {
      const section = request.section?.(item) ?? null;
      const label = request.label(item);
      return section === null ? label : `${section}: ${label}`;
    });
  };
  const sheet = () => asFake(harness.mode(MODE).element);
  const showGame = (key: string) => {
    run('showMode');
    commands.selectEntry({ arg: key });
  };
  return {
    harness,
    commands,
    run,
    calls,
    callsOf,
    opens,
    opened,
    lastOpen,
    rows,
    logged,
    toasts,
    sheet,
    showGame,
    demoSteps,
    publish: (next: BuildsSnapshot) => snapshotWriter.set(next),
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const problem = () => ({ problem: 'teamcity is not installed' });
const heads = () => [{ name: 'main', sha: '2993a9e4c1' }];

const running = (id: string, queuedAt = 100) =>
  buildRecord({
    id,
    gameId: 'g1',
    number: id,
    state: 'running',
    result: null,
    queuedAt,
  });

describe('buildsPagePart', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tells main when the mode shows and hides', () => {
    const page = startBuildsPage(workSnapshot());

    page.run('showMode');
    page.harness.mode(MODE).hidden();

    expect(page.callsOf('setShown')).toEqual([true, false]);
  });

  it('tells main the mode hides when the part is disposed', async () => {
    const page = startBuildsPage(workSnapshot());
    page.run('showMode');

    await page.harness.stop();

    expect(page.callsOf('setShown').at(-1)).toBe(false);
  });

  it('logs a failed setShown', async () => {
    const page = startBuildsPage(workSnapshot(), {
      setShown: () => Promise.reject(new Error('closed')),
    });

    page.run('showMode');
    await settle();

    expect(page.logged()).toContain('setShown failed: closed');
  });

  it.each([
    {
      choice: 'a kind on a backend that chooses the branch',
      fixture: {},
      down: 0,
      branches: [{ backend: 'work', game: 'g1', set: null }],
      queue: { kind: 'dev', branch: 'main' },
    },
    {
      choice: 'a set',
      fixture: {},
      down: 2,
      branches: [{ backend: 'work', game: 'g1', set: 'rc' }],
      queue: { kind: 'rc', branch: 'main' },
    },
    {
      choice: 'a kind on a backend that builds as it stands',
      fixture: { capabilities: { cancel: true, choosesBranch: false } },
      down: 0,
      branches: [],
      queue: { kind: 'dev', branch: 'protos/game' },
    },
    {
      choice: 'a kind of a game with no clone',
      fixture: { clone: null },
      down: 0,
      branches: [],
      queue: { kind: 'dev', branch: 'protos/game' },
    },
  ])('queues $choice', async ({ fixture, down, branches, queue }) => {
    const page = startBuildsPage(workSnapshot(fixture), {
      branches: heads,
      queue: () => ({ ok: true }),
    });
    page.showGame(G1);

    page.run('pickQueue');
    for (let step = 0; step < down; step += 1) {
      page.run('pickerDown');
    }
    page.run('pickerChoose');
    await settle();
    if (branches.length > 0) {
      page.run('pickerChoose');
    }
    await settle();

    expect(page.callsOf('branches')).toEqual(branches);
    expect(page.callsOf('queue')).toEqual([
      { backend: 'work', game: 'g1', ...queue, sessionId: null },
    ]);
  });

  it('logs a queued build', async () => {
    const page = startBuildsPage(workSnapshot(), {
      branches: heads,
      queue: () => ({ ok: true }),
    });
    page.showGame(G1);

    page.run('pickQueue');
    page.run('pickerChoose');
    await settle();
    page.run('pickerChoose');
    await settle();

    expect(page.logged()).toContain('queued work/g1 dev on main');
  });

  it.each([
    {
      state: 'running, on a backend that cannot cancel',
      capabilities: { cancel: false, choosesBranch: true },
      record: running('41'),
      cancels: [],
      toast: 'toast info: Work cannot cancel builds',
    },
    {
      state: 'running, on a backend with no instance',
      capabilities: null,
      record: running('41'),
      cancels: [],
      toast: 'toast info: Work cannot cancel builds',
    },
    {
      state: 'finished',
      capabilities: { cancel: true, choosesBranch: true },
      record: buildRecord({ id: '41', gameId: 'g1' }),
      cancels: [],
      toast: 'toast info: The build has ended',
    },
    {
      state: 'running',
      capabilities: { cancel: true, choosesBranch: true },
      record: running('41'),
      cancels: [{ backend: 'work', game: 'g1', build: '41' }],
      toast: null,
    },
  ])('x on a $state build', async ({ capabilities, record, cancels, toast }) => {
    const page = startBuildsPage(
      workSnapshot({ capabilities, g1Builds: [record] }),
      { cancel: () => ({ ok: true }) },
    );
    page.showGame(G1);

    page.run('cancel');
    await settle();

    expect(page.callsOf('cancel')).toEqual(cancels);
    expect(page.toasts()).toEqual(toast === null ? [] : [toast]);
  });

  it('toasts a build with no link on o', () => {
    const page = startBuildsPage(
      workSnapshot({ g1Builds: [buildRecord({ id: '41', gameId: 'g1' })] }),
    );
    page.showGame(G1);

    page.run('openWeb');

    expect(page.opened).toEqual([]);
    expect(page.toasts()).toEqual([
      'toast info: This build has no link in the backend',
    ]);
  });

  it.each([
    {
      method: 'branches',
      fixture: {},
      press: (page: ReturnType<typeof startBuildsPage>) =>
        page.commands.queueButton({
          arg: { backend: 'work', game: 'g1', kind: 'dev' },
        }),
    },
    {
      method: 'queue',
      fixture: { capabilities: { cancel: true, choosesBranch: false } },
      press: (page: ReturnType<typeof startBuildsPage>) =>
        page.commands.queueButton({
          arg: { backend: 'work', game: 'g1', kind: 'dev' },
        }),
    },
    {
      method: 'cancel',
      fixture: { g1Builds: [running('41')] },
      press: (page: ReturnType<typeof startBuildsPage>) => page.run('cancel'),
    },
    {
      method: 'launchSetAgent',
      fixture: {},
      press: (page: ReturnType<typeof startBuildsPage>) =>
        page.commands.withAgent({
          arg: { backend: 'work', game: 'g1', set: 'rc' },
        }),
    },
  ])('toasts the $method problem', async ({ method, fixture, press }) => {
    const page = startBuildsPage(workSnapshot(fixture), { [method]: problem });
    page.showGame(G1);

    press(page);
    await settle();

    expect(page.toasts()).toEqual(['toast error: teamcity is not installed']);
  });

  it.each([
    { choice: 'set', kind: 'rc', toast: 'toast info: No branch on origin matches releases/*' },
    { choice: 'kind', kind: 'dev', toast: 'toast info: No branches on origin' },
  ])('toasts no heads for a $choice', async ({ kind, toast }) => {
    const page = startBuildsPage(workSnapshot(), { branches: () => [] });
    page.showGame(G1);

    page.commands.queueButton({ arg: { backend: 'work', game: 'g1', kind } });
    await settle();

    expect(page.toasts()).toEqual([toast]);
    expect(page.callsOf('queue')).toEqual([]);
  });

  it.each([
    { case: 'All is shown', shows: true },
    { case: 'the mode was never shown', shows: false },
  ])('opens step 0 when $case', ({ shows }) => {
    const off: BackendView = {
      id: 'off',
      kind: 'fixture',
      label: 'Off',
      problem: null,
      capabilities: null,
      games: [
        {
          backendId: 'off',
          game: gameEntry({ id: 'g3', label: 'Game Three' }),
          builds: [],
          subjects: {},
          setRuns: [],
        },
      ],
    };
    const page = startBuildsPage(workSnapshot({ extraBackends: [off] }));
    if (shows) {
      page.run('showMode');
    }

    page.run('pickQueue');

    expect(page.lastOpen()?.title).toBe('Queue a build');
    expect(page.rows()).toEqual(['Work · Game One', 'Work · Game Two']);
  });

  it('lists kinds then sets in step 1', () => {
    const page = startBuildsPage(workSnapshot());
    page.showGame(G1);

    page.run('pickQueue');

    expect(page.lastOpen()?.title).toBe('Queue Game One');
    expect(page.rows()).toEqual(['Kinds: Dev', 'Kinds: Release', 'Sets: RC']);
  });

  it('queues the game under the side-bar cursor', () => {
    const page = startBuildsPage(workSnapshot());
    page.showGame(G1);
    page.run('gameDown');

    page.run('pickQueue');

    expect(page.lastOpen()?.title).toBe('Queue Game Two');
  });

  it('drops a branches answer that lands after Esc', async () => {
    const answer = deferred<{ name: string; sha: string }[]>();
    const page = startBuildsPage(workSnapshot(), {
      branches: () => answer.promise,
      queue: () => ({ ok: true }),
    });
    page.showGame(G1);
    page.run('pickQueue');
    page.run('pickerChoose');
    const opensBeforeAnswer = page.opens.length;

    page.run('pickerCancel');
    answer.resolve(heads());
    await settle();

    expect(page.opens).toHaveLength(opensBeforeAnswer);
    expect(page.callsOf('queue')).toEqual([]);
  });

  it('queues once on two quick presses', async () => {
    const answer = deferred<{ ok: true }>();
    const page = startBuildsPage(
      workSnapshot({ capabilities: { cancel: true, choosesBranch: false } }),
      { queue: () => answer.promise },
    );
    page.showGame(G1);
    const press = () =>
      page.commands.queueButton({
        arg: { backend: 'work', game: 'g1', kind: 'dev' },
      });

    press();
    press();
    answer.resolve({ ok: true });
    await settle();

    expect(page.callsOf('queue')).toHaveLength(1);
  });

  // The number of the row under the list cursor, and of the row the open detail sits under.
  function marks(page: ReturnType<typeof startBuildsPage>) {
    const cursor = findAll(page.sheet(), 'builds-row').filter((row) =>
      row.classList.contains('is-selected'),
    );
    const details = findAll(page.sheet(), 'builds-detail');
    return {
      cursor: cursor.map((row) => row.textContent.match(/#(\d+)/)?.[1]),
      detail: details.map(
        (detail) => detail.previousElementSibling?.textContent.match(/#(\d+)/)?.[1],
      ),
    };
  }

  it('keeps the cursor and the detail on their build across a poll', () => {
    const page = startBuildsPage(
      workSnapshot({ g1Builds: [running('41', 200), running('40', 100)] }),
    );
    page.showGame(G1);
    page.run('listDown');
    page.run('openDetail');

    page.publish(
      workSnapshot({
        g1Builds: [running('42', 300), running('41', 200), running('40', 100)],
      }),
    );

    expect(marks(page)).toEqual({ cursor: ['40'], detail: ['40'] });
  });

  it('closes the detail when its build is gone', () => {
    const page = startBuildsPage(
      workSnapshot({ g1Builds: [running('41', 200), running('40', 100)] }),
    );
    page.showGame(G1);
    page.run('listDown');
    page.run('openDetail');

    page.publish(workSnapshot({ g1Builds: [running('41', 200)] }));

    expect(marks(page)).toEqual({ cursor: ['41'], detail: [] });
  });

  it('shows All when the selected game is gone', () => {
    const page = startBuildsPage(workSnapshot());
    page.showGame('work/g2');
    const shown = workSnapshot();
    shown.backends[0].games = shown.backends[0].games.filter(
      (view) => view.game.id !== 'g2',
    );

    page.publish(shown);

    const selected = findAll(asFake(page.harness.mode(MODE).sideBar as HTMLElement), 'is-selected');
    expect(selected.map((entry) => entry.textContent.trim())).toEqual(['All']);
  });

  it('cannot queue a shown game with no backend instance', () => {
    const page = startBuildsPage(workSnapshot({ capabilities: null }));
    page.showGame(G1);

    page.run('pickQueue');

    expect(page.opens).toEqual([]);
    expect(page.toasts()).toEqual(['toast info: Work cannot queue builds']);
  });

  it('launches the set agent from its button', () => {
    const page = startBuildsPage(workSnapshot(), {
      launchSetAgent: () => ({ ok: true }),
    });

    page.commands.withAgent({ arg: { backend: 'work', game: 'g1', set: 'rc' } });

    expect(page.callsOf('launchSetAgent')).toEqual([
      { backend: 'work', game: 'g1', set: 'rc' },
    ]);
  });

  it.each([
    {
      command: 'queueButton',
      press: (page: ReturnType<typeof startBuildsPage>) =>
        page.commands.queueButton({
          arg: { backend: 'sample', game: 'sky-hop', kind: 'dev' },
        }),
    },
    {
      command: 'pickQueue',
      press: (page: ReturnType<typeof startBuildsPage>) => page.run('pickQueue'),
    },
  ])('$command does nothing while the demo sample shows', async ({ command, press }) => {
    const page = startBuildsPage(workSnapshot());
    const step = page.demoSteps.list().find((held) => held.id === 'builds.mode');
    if (step === undefined) {
      throw new Error('no builds.mode step');
    }
    await step.enter({ scratchDir: '/scratch', sessions: {} });
    const callsBefore = page.calls.length;

    press(page);
    await settle();

    expect(page.calls).toHaveLength(callsBefore);
    expect(page.opens).toEqual([]);
    expect(page.logged()).toContain(`demo: ${command} does nothing`);
  });
});
