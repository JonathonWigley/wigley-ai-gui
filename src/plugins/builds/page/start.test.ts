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
import {
  asFake,
  asHtml,
  type FakeElement,
  FocusFakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import {
  deferred,
  fakeDependency,
} from '../../../shared/plugin-part-harness.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type ChatComposerPart,
  type ChatSidePart,
  chatPageKey,
  type ChatPageExports,
  type ComposerStop,
} from '../../chat/contract';
import {
  type RowActivity,
  type SessionPart,
  type SessionsPageExports,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import type {
  BackendCapabilities,
  BackendView,
  BuildDownload,
  BuildFile,
  BuildJob,
  BuildRecord,
  BuildsPlace,
  BuildsSnapshot,
  GameView,
  SessionBuilds,
} from '../contract';
import {
  buildsDownloadsSlot,
  buildsPlaceSlot,
  buildsSessionsSlot,
  buildsSnapshotSlot,
} from '../contract';
import {
  buildJob,
  buildOffer,
  buildRecord,
  gameEntry,
} from '../contract.test-support';
import { buildsPagePart } from './start';

const MODE = 'builds.main';
const G1 = 'work/g1';

interface Fixture {
  capabilities?: BackendCapabilities | null;
  clone?: string | null;
  g1Builds?: BuildRecord[];
  g1Files?: Record<string, BuildFile[]>;
  g2Builds?: BuildRecord[];
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
        dev: { label: 'Dev', target: null, downloads: [] },
        release: { label: 'Release', target: null, downloads: [] },
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
    files: fixture.g1Files ?? {},
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
            ? { cancel: true, choosesBranch: true, saveLog: false }
            : fixture.capabilities,
        games: [
          g1View(fixture),
          {
            backendId: 'work',
            game: gameEntry({ id: 'g2', label: 'Game Two' }),
            builds: fixture.g2Builds ?? [],
            subjects: {},
            setRuns: [],
            files: {},
          },
        ],
      },
      ...(fixture.extraBackends ?? []),
    ],
  };
}

type Answer = (...args: unknown[]) => unknown;

// The Builds page on the harness, drawing its layout for real, with `snapshot` published to `builds.snapshot` (none
// for null) and `seed.place` in `builds.place` as the last page wrote it. `answers` answers an invoke by method, else
// undefined; `calls` holds each invoke, `opens` each picker request, `opened` each `openExternal` url. `putDownload`
// writes `builds.downloads`, `place` reads `builds.place`, and `focusTarget` is the focus target the view set last. The fake sessions record each `setActivity` in `activities` and answer
// `shownSessionId` with `shown.sessionId`; the fakes record each row, side and composer part, `drawPart(id, sessionId)`
// builds one into a wrapper and returns the wrapper, and `stop()` is the offer card's stop.
function startBuildsPage(
  snapshot: BuildsSnapshot | null,
  answers: Record<string, Answer> = {},
  seed: { place?: BuildsPlace } = {},
) {
  installFocusFakeDom(vi.stubGlobal);
  // The job graph draws its arrows in an animation frame, which the fake DOM lacks; the frame never comes.
  vi.stubGlobal('requestAnimationFrame', () => 0);
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
  if (snapshot !== null) {
    snapshotWriter.set(snapshot);
  }
  const sessionsWriter = state.publish(buildsSessionsSlot);
  const downloadsWriter = state.publish(buildsDownloadsSlot);
  if (seed.place !== undefined) {
    const lastPage = state.publish(buildsPlaceSlot);
    lastPage.set(seed.place);
    lastPage.dispose();
  }
  const rowsWriter = state.publish(sessionsRowsSlot);
  const activities: [string, string, RowActivity | null][] = [];
  const shown: { sessionId: string | null } = { sessionId: null };
  const composerParts: ChatComposerPart[] = [];
  const rowParts: SessionPart[] = [];
  const sideParts: ChatSidePart[] = [];
  const fakeSessions = {
    addRowPart(part: SessionPart) {
      rowParts.push(part);
      return { dispose() {} };
    },
    setActivity(
      sessionId: string,
      sourceId: string,
      activity: RowActivity | null,
    ) {
      activities.push([sessionId, sourceId, activity]);
    },
    shownSessionId: () => shown.sessionId,
    activate() {},
  } as Partial<SessionsPageExports> as SessionsPageExports;
  const fakeChat = {
    addSidePart(part: ChatSidePart) {
      sideParts.push(part);
      return { dispose() {} };
    },
    addComposerPart(part: ChatComposerPart) {
      composerParts.push(part);
      return { dispose() {} };
    },
    showHubForNow: () => ({ dispose() {} }),
  } as Partial<ChatPageExports> as ChatPageExports;
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
      fakeDependency(sessionsPageKey, () => fakeSessions),
      fakeDependency(chatPageKey, () => fakeChat),
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
      | 'selectJob'
      | 'downloadFile'
      | 'showBuild'
      | 'queueButton'
      | 'withAgent'
      | 'setFilter'
      | 'openLink'
      | 'queueSessionOffer'
      | 'dismissSessionOffer'
    >,
  ) => commands[command]({ arg: undefined });
  const stop = (): ComposerStop => {
    const found = composerParts.find(
      (part) => part.id === 'builds.offer',
    )?.stop;
    if (found === undefined) {
      throw new Error('no builds.offer stop');
    }
    return found;
  };
  const drawPart = (id: string, sessionId: string): FakeElement => {
    const wrapper = new FocusFakeElement('div');
    const row = rowParts.find((part) => part.id === id);
    const side = sideParts.find((part) => part.id === id);
    const composer = composerParts.find((part) => part.id === id);
    if (row !== undefined) {
      row.build(asHtml(wrapper), sessionId);
    } else if (side !== undefined) {
      side.build(asHtml(wrapper), sessionId, { setSummary() {} });
    } else if (composer !== undefined) {
      composer.build(asHtml(wrapper), sessionId);
    } else {
      throw new Error(`no part ${id}`);
    }
    return wrapper;
  };
  const enterStep = async (id: string, sessions: Record<string, string>) => {
    const step = demoSteps.list().find((held) => held.id === id);
    if (step === undefined) {
      throw new Error(`no ${id} step`);
    }
    return step.enter({ scratchDir: '/scratch', sessions });
  };
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
    putDownload: (download: BuildDownload) =>
      downloadsWriter.set(download.id, download),
    place: () => state.read(buildsPlaceSlot, 'test').get(),
    focusTarget: () => harness.focusTarget(),
    setSession: (sessionId: string, builds: SessionBuilds) =>
      sessionsWriter.set(sessionId, builds),
    dropSession: (sessionId: string) => sessionsWriter.delete(sessionId),
    addRow: (sessionId: string) =>
      rowsWriter.set(sessionId, sessionRow(sessionId)),
    activities,
    shown,
    stop,
    drawPart,
    enterStep,
  };
}

type Page = ReturnType<typeof startBuildsPage>;

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

const job = (id: string, changes: Partial<BuildJob> = {}) =>
  buildJob({ id, label: id.toUpperCase(), ...changes });
const runningJob = (id: string, changes: Partial<BuildJob> = {}) =>
  job(id, { state: 'running', result: null, ...changes });

// Running build `id` of game `g1` listing `jobs`.
const withJobs = (id: string, queuedAt: number, jobs: BuildJob[]) =>
  buildRecord({
    id,
    gameId: 'g1',
    number: id,
    state: 'running',
    result: null,
    queuedAt,
    jobs,
  });

const ONE_JOB: Fixture = { g1Builds: [withJobs('41', 100, [runningJob('a')])] };
const SAVES_LOGS: BackendCapabilities = {
  cancel: true,
  choosesBranch: true,
  saveLog: true,
};

// The list place of the row under the list cursor, and the number the detail pane's build head names.
function marks(page: Page) {
  const rows = findAll(page.sheet(), 'builds-row');
  return {
    cursor: rows.flatMap((row, place) =>
      row.classList.contains('is-selected') ? [place] : [],
    ),
    detail: findAll(page.sheet(), 'builds-build-header').map(
      (header) => header.textContent.match(/#(\w+)/)?.[1] ?? null,
    ),
  };
}

// The job id of each graph box under the job cursor.
function selectedJobs(page: Page): (string | undefined)[] {
  return findAll(page.sheet(), 'builds-job-box')
    .filter((box) => box.classList.contains('is-selected'))
    .map((box) => box.dataset.jobId);
}

// Gives the build list the keys, from the side bar where showing the mode leaves them.
function toList(page: Page): void {
  page.focusTarget()?.move('right');
}

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
      fixture: {
        capabilities: { cancel: true, choosesBranch: false, saveLog: false },
      },
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
      capabilities: { cancel: false, choosesBranch: true, saveLog: false },
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
      capabilities: { cancel: true, choosesBranch: true, saveLog: false },
      record: buildRecord({ id: '41', gameId: 'g1' }),
      cancels: [],
      toast: 'toast info: The build has ended',
    },
    {
      state: 'running',
      capabilities: { cancel: true, choosesBranch: true, saveLog: false },
      record: running('41'),
      cancels: [{ backend: 'work', game: 'g1', build: '41' }],
      toast: null,
    },
  ])(
    'x on a $state build',
    async ({ capabilities, record, cancels, toast }) => {
      const page = startBuildsPage(
        workSnapshot({ capabilities, g1Builds: [record] }),
        { cancel: () => ({ ok: true }) },
      );
      page.showGame(G1);

      page.run('cancel');
      await settle();

      expect(page.callsOf('cancel')).toEqual(cancels);
      expect(page.toasts()).toEqual(toast === null ? [] : [toast]);
    },
  );

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
      fixture: {
        capabilities: { cancel: true, choosesBranch: false, saveLog: false },
      },
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
    {
      choice: 'set',
      kind: 'rc',
      toast: 'toast info: No branch on origin matches releases/*',
    },
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
          files: {},
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
      workSnapshot({
        capabilities: { cancel: true, choosesBranch: false, saveLog: false },
      }),
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

  it('toasts no queue problem that lands after the part stops', async () => {
    const answer = deferred<{ problem: string }>();
    const page = startBuildsPage(
      workSnapshot({
        capabilities: { cancel: true, choosesBranch: false, saveLog: false },
      }),
      { queue: () => answer.promise },
    );
    page.showGame(G1);
    page.commands.queueButton({
      arg: { backend: 'work', game: 'g1', kind: 'dev' },
    });

    await page.harness.stop();
    answer.resolve(problem());
    await settle();

    expect(page.toasts()).toEqual([]);
  });

  it('keeps the cursor and the detail pane on their build across a poll', () => {
    const page = startBuildsPage(
      workSnapshot({ g1Builds: [running('41', 200), running('40', 100)] }),
    );
    page.showGame(G1);
    page.run('listDown');

    page.publish(
      workSnapshot({
        g1Builds: [running('42', 300), running('41', 200), running('40', 100)],
      }),
    );

    // 40 is the third row, under 42 and 41.
    expect(marks(page)).toEqual({ cursor: [2], detail: ['40'] });
  });

  it('shows the new cursor build when the shown build is gone', () => {
    const page = startBuildsPage(
      workSnapshot({ g1Builds: [running('41', 200), running('40', 100)] }),
    );
    page.showGame(G1);
    page.run('listDown');

    page.publish(workSnapshot({ g1Builds: [running('41', 200)] }));

    expect(marks(page)).toEqual({ cursor: [0], detail: ['41'] });
  });

  it("shows the list cursor's build in the detail pane", () => {
    const page = startBuildsPage(
      workSnapshot({ g1Builds: [running('41', 200), running('40', 100)] }),
    );
    page.showGame(G1);
    const first = marks(page).detail;

    page.run('listDown');
    const second = marks(page).detail;
    page.commands.selectEntry({ arg: 'work/g2' });

    expect([first, second, marks(page).detail]).toEqual([['41'], ['40'], []]);
    expect(
      findAll(page.sheet(), 'builds-detail-body').map((body) =>
        body.textContent.includes('Pick a build to see its jobs.'),
      ),
    ).toEqual([true]);
  });

  it('keeps the job cursor on its job across a poll', () => {
    const jobs = (a: number, b: number) => [
      runningJob('a', { percent: a }),
      runningJob('b', { percent: b }),
    ];
    const page = startBuildsPage(
      workSnapshot({ g1Builds: [withJobs('41', 100, jobs(10, 20))] }),
    );
    page.showGame(G1);
    page.run('graphDown');

    page.publish(
      workSnapshot({ g1Builds: [withJobs('41', 100, jobs(50, 60))] }),
    );

    const panelPercents = findAll(page.sheet(), 'builds-job-panel')
      .flatMap((panel) => findAll(panel, 'ui-meter'))
      .map((meter) => meter.getAttribute('aria-valuenow'));
    expect({ selected: selectedJobs(page), panelPercents }).toEqual({
      selected: ['b'],
      panelPercents: ['60'],
    });
  });

  it("keeps the graph's scroll across a poll", () => {
    const snapshotAt = (percent: number) =>
      workSnapshot({
        g1Builds: [withJobs('41', 100, [runningJob('a', { percent })])],
      });
    const page = startBuildsPage(snapshotAt(10));
    page.showGame(G1);
    const before = findAll(page.sheet(), 'builds-graph')[0];
    (before as unknown as { scrollLeft: number }).scrollLeft = 40;

    page.publish(snapshotAt(70));

    const after = findAll(page.sheet(), 'builds-graph');
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before);
    expect((after[0] as unknown as { scrollLeft: number }).scrollLeft).toBe(40);
  });

  it.each<{
    case: string;
    fixture: Fixture;
    act: (page: Page) => unknown;
    scope: string;
    moved: boolean | null;
    logs: string[];
  }>([
    {
      case: 'Enter in the list enters the graph',
      fixture: ONE_JOB,
      act: (page) => {
        toList(page);
        page.run('focusGraph');
      },
      scope: 'builds.graph',
      moved: null,
      logs: ['focus graph', 'graph on work/41 job a'],
    },
    {
      case: 'Esc in the graph gives the keys back to the list',
      fixture: ONE_JOB,
      act: (page) => {
        toList(page);
        page.run('focusGraph');
        page.run('leaveGraph');
      },
      scope: 'builds.list',
      moved: null,
      logs: [],
    },
    {
      case: 'Enter on an empty list stays in the list',
      fixture: {},
      act: (page) => {
        toList(page);
        page.run('focusGraph');
      },
      scope: 'builds.list',
      moved: null,
      logs: ['no build under the cursor'],
    },
    {
      case: 'Alt+j side by side goes on to the core',
      fixture: ONE_JOB,
      act: (page) => {
        toList(page);
        return page.focusTarget()?.move('down');
      },
      scope: 'builds.list',
      moved: false,
      logs: [],
    },
    {
      case: 'Alt+j while the split stacks enters the graph',
      fixture: ONE_JOB,
      act: (page) => {
        toList(page);
        // The fake DOM reports no width, so the test stacks the split by hand.
        findAll(page.sheet(), 'builds-split')[0].classList.add('is-stacked');
        return page.focusTarget()?.move('down');
      },
      scope: 'builds.graph',
      moved: true,
      logs: [],
    },
    {
      case: 'main takes the keys back to the graph',
      fixture: ONE_JOB,
      act: (page) => {
        toList(page);
        page.run('focusGraph');
        page.harness.mode(MODE).focusSideBar?.();
        page.harness.mode(MODE).focusMain();
      },
      scope: 'builds.graph',
      moved: null,
      logs: [],
    },
  ])(
    'moves the keys between the list and the graph: $case',
    ({ fixture, act, scope, moved, logs }) => {
      const page = startBuildsPage(workSnapshot(fixture));
      page.showGame(G1);

      const result = act(page);

      expect(page.harness.scope()).toBe(scope);
      expect(result ?? null).toBe(moved);
      expect(page.logged().filter((line) => logs.includes(line))).toEqual(logs);
    },
  );

  it('gives the keys to the list when the shown build goes', () => {
    const page = startBuildsPage(workSnapshot(ONE_JOB));
    page.showGame(G1);
    toList(page);
    page.run('focusGraph');

    page.publish(workSnapshot());

    expect(page.harness.scope()).toBe('builds.list');
    expect(page.logged()).toContain('build work/41 gone');
  });

  it.each<{
    case: string;
    capabilities?: BackendCapabilities;
    jobs: BuildJob[];
    answer: Answer;
    saves: unknown[];
    graphs: number;
    toasts: string[];
  }>([
    {
      case: 'the cursor job',
      capabilities: SAVES_LOGS,
      jobs: [runningJob('a')],
      answer: () => ({ ok: true }),
      saves: [{ backend: 'work', game: 'g1', build: '41', job: 'a' }],
      graphs: 1,
      toasts: [],
    },
    {
      case: 'a build with no jobs',
      capabilities: SAVES_LOGS,
      jobs: [],
      answer: () => ({ ok: true }),
      saves: [{ backend: 'work', game: 'g1', build: '41', job: null }],
      graphs: 0,
      toasts: [],
    },
    {
      case: 'a backend that cannot save logs',
      jobs: [runningJob('a')],
      answer: () => ({ ok: true }),
      saves: [],
      graphs: 1,
      toasts: ['toast info: Work cannot save logs'],
    },
    {
      case: 'a problem answer',
      capabilities: SAVES_LOGS,
      jobs: [runningJob('a')],
      answer: () => ({ problem: 'x' }),
      saves: [{ backend: 'work', game: 'g1', build: '41', job: 'a' }],
      graphs: 1,
      toasts: ['toast error: x'],
    },
    {
      case: 'a rejection',
      capabilities: SAVES_LOGS,
      jobs: [runningJob('a')],
      answer: () => Promise.reject(new Error('boom')),
      saves: [{ backend: 'work', game: 'g1', build: '41', job: 'a' }],
      graphs: 1,
      toasts: ['toast error: boom'],
    },
  ])(
    'saves a log: $case',
    async ({ capabilities, jobs, answer, saves, graphs, toasts }) => {
      const page = startBuildsPage(
        workSnapshot({ capabilities, g1Builds: [withJobs('41', 100, jobs)] }),
        { saveLog: answer },
      );
      page.showGame(G1);

      page.run('saveLog');
      await settle();

      expect(page.callsOf('saveLog')).toEqual(saves);
      expect(findAll(page.sheet(), 'builds-graph')).toHaveLength(graphs);
      expect(page.toasts()).toEqual(toasts);
    },
  );

  const APK: BuildFile = { label: 'APK', path: '/builds/41.apk', entry: 1 };
  const IPA: BuildFile = { label: 'IPA', path: '/builds/41.ipa', entry: 3 };
  it.each<{
    case: string;
    files: BuildFile[];
    picksSecond: boolean;
    title: string | null;
    rows: string[];
    downloads: number[];
    toasts: string[];
  }>([
    {
      case: 'the only file',
      files: [APK],
      picksSecond: false,
      title: null,
      rows: [],
      downloads: [1],
      toasts: [],
    },
    {
      case: 'the second of two files',
      files: [APK, IPA],
      picksSecond: true,
      title: 'Download a file',
      rows: ['APK', 'IPA'],
      downloads: [3],
      toasts: [],
    },
    {
      case: 'no file',
      files: [],
      picksSecond: false,
      title: null,
      rows: [],
      downloads: [],
      toasts: ['toast info: This build has no files to download'],
    },
  ])(
    'downloads the only file and picks among several: $case',
    async ({ files, picksSecond, title, rows, downloads, toasts }) => {
      const page = startBuildsPage(
        workSnapshot({ g1Builds: [running('41')], g1Files: { '41': files } }),
        { download: () => ({ ok: true }) },
      );
      page.showGame(G1);

      page.run('download');
      const opened = {
        title: page.lastOpen()?.title ?? null,
        rows: page.rows(),
      };
      if (picksSecond) {
        page.run('pickerDown');
        page.run('pickerChoose');
      }
      await settle();

      expect(opened).toEqual({ title, rows });
      expect(page.callsOf('download')).toEqual(
        downloads.map((file) => ({
          backend: 'work',
          game: 'g1',
          build: '41',
          file,
        })),
      );
      expect(page.toasts()).toEqual(toasts);
    },
  );

  it('logs each download state it hears', () => {
    const page = startBuildsPage(workSnapshot({ g1Builds: [running('41')] }));
    const saving: BuildDownload = {
      id: 'work/41/log/a',
      backendId: 'work',
      buildId: '41',
      label: 'A',
      state: 'running',
      path: null,
      problem: null,
      startedAt: 0,
    };

    page.putDownload(saving);
    page.putDownload({
      ...saving,
      state: 'saved',
      path: '/home/Downloads/x.log',
    });

    expect(
      page.logged().filter((line) => line.startsWith('download work/')),
    ).toEqual([
      'download work/41/log/a running',
      'download work/41/log/a saved x.log',
    ]);
  });

  it.each<{
    case: string;
    jobs: BuildJob[];
    opened: string[];
    toasts: string[];
  }>([
    {
      case: 'a job with a link',
      jobs: [job('a', { webUrl: 'https://ci.test/a' })],
      opened: ['https://ci.test/a'],
      toasts: [],
    },
    {
      case: 'a job with no link',
      jobs: [job('a')],
      opened: [],
      toasts: ['toast info: This job has no link in the backend'],
    },
    {
      case: 'a build with no jobs',
      jobs: [],
      opened: ['https://ci.test/41'],
      toasts: [],
    },
  ])(
    'opens a link with o in the graph: $case',
    async ({ jobs, opened, toasts }) => {
      const page = startBuildsPage(
        workSnapshot({
          g1Builds: [
            buildRecord({
              id: '41',
              gameId: 'g1',
              webUrl: 'https://ci.test/41',
              jobs,
            }),
          ],
        }),
      );
      page.showGame(G1);

      page.run('openJob');
      await settle();

      expect(page.opened).toEqual(opened);
      expect(page.toasts()).toEqual(toasts);
    },
  );

  it.each([
    {
      case: 'a job the build lists',
      id: 'b',
      scope: 'builds.graph',
      log: 'job cursor on b',
      selected: ['b'],
    },
    {
      case: 'a job the build lacks',
      id: 'z',
      scope: 'builds.games',
      log: 'no job z',
      selected: ['a'],
    },
  ])('selects a job by id: $case', ({ id, scope, log, selected }) => {
    const page = startBuildsPage(
      workSnapshot({
        g1Builds: [withJobs('41', 100, [runningJob('a'), job('b')])],
      }),
    );
    page.showGame(G1);

    page.commands.selectJob({ arg: id });

    expect(page.harness.scope()).toBe(scope);
    expect(page.logged()).toContain(log);
    expect(selectedJobs(page)).toEqual(selected);
  });

  it('shows a build from the hub', () => {
    const page = startBuildsPage(
      workSnapshot({
        g1Builds: [running('41')],
        g2Builds: [buildRecord({ id: '50', gameId: 'g2', number: '50' })],
      }),
    );

    page.commands.showBuild({ arg: { backend: 'work', build: '50' } });
    const sideBar = asFake(page.harness.mode(MODE).sideBar as HTMLElement);
    const shown = {
      setShown: page.callsOf('setShown'),
      entry: findAll(sideBar, 'is-selected').map((entry) =>
        entry.textContent.includes('Game Two'),
      ),
      marks: marks(page),
      scope: page.harness.scope(),
    };
    page.harness.mode(MODE).hidden();
    page.harness.mode(MODE).shown();

    expect(shown).toEqual({
      setShown: [true],
      entry: [true],
      marks: { cursor: [0], detail: ['50'] },
      scope: 'builds.list',
    });
    expect(page.harness.scope()).toBe('builds.games');
  });

  it('shows no mode for a build the snapshot lacks', () => {
    const page = startBuildsPage(workSnapshot());

    page.commands.showBuild({ arg: { backend: 'work', build: '99' } });

    expect(page.toasts()).toEqual([
      'toast info: The build is no longer listed',
    ]);
    expect(page.callsOf('setShown')).toEqual([]);
  });

  const SAVED: BuildsPlace = { entry: G1, build: 'work/40', job: 'b' };
  it.each<{
    case: string;
    movesFirst: boolean;
    expected: BuildsPlace;
    jobs: string[];
  }>([
    {
      case: 'the snapshot that holds it puts it back',
      movesFirst: false,
      expected: SAVED,
      jobs: ['b'],
    },
    {
      case: 'a move before it drops it',
      movesFirst: true,
      expected: { entry: 'all', build: 'work/41', job: null },
      jobs: [],
    },
  ])(
    'keeps the saved place until the restore: $case',
    ({ movesFirst, expected, jobs }) => {
      const page = startBuildsPage(null, {}, { place: SAVED });
      page.publish({ backends: [], polledAt: 0 });
      const held = page.place();
      if (movesFirst) {
        page.run('listDown');
      }

      // Job a runs, so the default job of 40 is a, not the saved b.
      page.publish(
        workSnapshot({
          g1Builds: [
            running('41', 200),
            withJobs('40', 100, [runningJob('a'), job('b')]),
          ],
        }),
      );

      expect(held).toEqual(SAVED);
      expect(page.place()).toEqual(expected);
      expect(selectedJobs(page)).toEqual(jobs);
    },
  );

  it('shows All when the selected game is gone', () => {
    const page = startBuildsPage(workSnapshot());
    page.showGame('work/g2');
    const shown = workSnapshot();
    shown.backends[0].games = shown.backends[0].games.filter(
      (view) => view.game.id !== 'g2',
    );

    page.publish(shown);

    const selected = findAll(
      asFake(page.harness.mode(MODE).sideBar as HTMLElement),
      'is-selected',
    );
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

    page.commands.withAgent({
      arg: { backend: 'work', game: 'g1', set: 'rc' },
    });

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
      press: (page: ReturnType<typeof startBuildsPage>) =>
        page.run('pickQueue'),
    },
  ])(
    '$command does nothing while the demo sample shows',
    async ({ command, press }) => {
      const page = startBuildsPage(workSnapshot());
      const step = page.demoSteps
        .list()
        .find((held) => held.id === 'builds.mode');
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
    },
  );
});

const BUILDING = { word: 'building', tone: 'running', rank: 18 };
const OFFERED: SessionBuilds = {
  builds: [],
  offer: buildOffer({ backendId: 'work', gameId: 'g1' }),
};
const linking = (buildId: string): SessionBuilds => ({
  builds: [{ backendId: 'work', buildId }],
  offer: null,
});

// Exits that record each call.
function fakeExits() {
  return { toEntries: vi.fn(), toBox: vi.fn() };
}

// A page where sessions `s1` and `s2` each hold an offer and the stop holds `s2`.
function holdingS2(answers: Record<string, Answer> = {}) {
  const page = startBuildsPage(workSnapshot(), answers);
  page.setSession('s1', OFFERED);
  page.setSession('s2', OFFERED);
  const exits = fakeExits();
  page.stop().enter('s2', exits);
  return { page, exits };
}

describe('buildsPagePart session parts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets building while a linked build runs, then clears it', () => {
    const page = startBuildsPage(workSnapshot({ g1Builds: [running('41')] }));
    page.setSession('s1', linking('41'));

    page.publish(
      workSnapshot({ g1Builds: [buildRecord({ id: '41', gameId: 'g1' })] }),
    );

    expect(page.activities.filter(([id]) => id === 's1')).toEqual([
      ['s1', 'builds', BUILDING],
      ['s1', 'builds', null],
    ]);
  });

  it('clears the activity of a session that left the slot', () => {
    const page = startBuildsPage(workSnapshot({ g1Builds: [running('41')] }));
    page.setSession('s1', linking('41'));

    page.dropSession('s1');

    expect(page.activities.at(-1)).toEqual(['s1', 'builds', null]);
  });

  it.each([
    { where: 'the held session', holds: true, shown: 's1', invoked: ['s2'] },
    {
      where: 'the focused session',
      holds: false,
      shown: 's1',
      invoked: ['s1'],
    },
    { where: 'no session', holds: false, shown: null, invoked: [] },
  ])('queueOffer acts on $where', async ({ holds, shown, invoked }) => {
    const page = startBuildsPage(workSnapshot(), {
      queueOffer: () => ({ ok: true }),
    });
    page.setSession('s1', OFFERED);
    page.setSession('s2', OFFERED);
    if (holds) {
      page.stop().enter('s2', fakeExits());
    }
    page.shown.sessionId = shown;

    page.run('queueOffer');
    await settle();

    expect(page.callsOf('queueOffer')).toEqual(invoked);
    expect(page.toasts()).toEqual(
      invoked.length === 0
        ? ['toast info: No build offer in this session']
        : [],
    );
  });

  it("dismisses the focused session's offer", async () => {
    const page = startBuildsPage(workSnapshot());
    page.setSession('s1', OFFERED);
    page.shown.sessionId = 's1';

    page.run('dismissOffer');
    await settle();

    expect(page.callsOf('dismissOffer')).toEqual(['s1']);
  });

  it.each([
    { offer: 'no offer', builds: linking('41'), enters: false },
    { offer: 'an offer', builds: OFFERED, enters: true },
  ])('the stop with $offer', ({ builds, enters }) => {
    const page = startBuildsPage(workSnapshot());
    page.setSession('s1', builds);

    expect(page.stop().enter('s1', fakeExits())).toBe(enters);
  });

  it.each([
    { command: 'leaveOffer', entries: 1, box: [] },
    { command: 'offerFocusBox', entries: 0, box: [['insert']] },
    { command: 'offerAppendBox', entries: 0, box: [['append']] },
  ] as const)(
    '$command leaves the stop through exits',
    ({ command, entries, box }) => {
      const { page, exits } = holdingS2();

      page.run(command);

      expect(exits.toEntries).toHaveBeenCalledTimes(entries);
      expect(exits.toBox.mock.calls).toEqual(box);
    },
  );

  it('queues and dismisses the session its arg names', async () => {
    const { page, exits } = holdingS2({ queueOffer: () => ({ ok: true }) });

    page.commands.queueSessionOffer({ arg: 's1' });
    page.commands.dismissSessionOffer({ arg: 's1' });
    await settle();

    expect(page.callsOf('queueOffer')).toEqual(['s1']);
    expect(page.callsOf('dismissOffer')).toEqual(['s1']);
    expect(exits.toEntries).not.toHaveBeenCalled();
  });

  it('keeps the hold on a problem', async () => {
    const { page, exits } = holdingS2({
      queueOffer: () => ({ problem: 'Local has a problem' }),
    });

    page.run('queueOffer');
    await settle();

    expect(page.toasts()).toEqual(['toast error: Local has a problem']);
    expect(page.logged()).toContain('queueOffer refused: Local has a problem');
    expect(exits.toEntries).not.toHaveBeenCalled();
  });

  it('ends the hold when the held offer goes', async () => {
    const { page, exits } = holdingS2({ queueOffer: () => ({ ok: true }) });

    page.setSession('s2', { builds: [], offer: null });
    page.shown.sessionId = 's1';
    page.run('queueOffer');
    await settle();

    expect(exits.toEntries).toHaveBeenCalledTimes(1);
    expect(page.callsOf('queueOffer')).toEqual(['s1']);
  });

  it('drops the hold on leave', async () => {
    const { page } = holdingS2({ queueOffer: () => ({ ok: true }) });
    const scopeAfterEnter = page.harness.scope();
    page.harness.changeBase('builds.list');

    page.stop().leave('s2');
    page.shown.sessionId = 's1';
    page.run('queueOffer');
    await settle();

    expect(page.callsOf('queueOffer')).toEqual(['s1']);
    // `leave` sets no scope: the one another view set after `enter` stays.
    expect([scopeAfterEnter, page.harness.scope()]).toEqual([
      'builds.offer',
      'builds.list',
    ]);
  });

  it('queues once on two quick presses', async () => {
    const answer = deferred<{ ok: true }>();
    const page = startBuildsPage(workSnapshot(), {
      queueOffer: () => answer.promise,
    });
    page.setSession('s1', OFFERED);
    const press = () => page.commands.queueSessionOffer({ arg: 's1' });

    press();
    press();
    answer.resolve({ ok: true });
    await settle();
    press();

    expect(page.callsOf('queueOffer')).toEqual(['s1', 's1']);
  });

  it('draws the row line under a session linking a running build', () => {
    const page = startBuildsPage(workSnapshot({ g1Builds: [running('41')] }));
    page.setSession('s1', linking('41'));

    const wrapper = page.drawPart('builds.row', 's1');

    const lines = findAll(wrapper, 'builds-row-line');
    expect(lines.map((line) => line.textContent.includes('#41'))).toEqual([
      true,
    ]);
  });

  it("lists the session's builds in its hub newest first", () => {
    const page = startBuildsPage(
      workSnapshot({ g1Builds: [running('40', 100), running('42', 300)] }),
    );
    page.setSession('s1', {
      builds: [
        { backendId: 'work', buildId: '42' },
        { backendId: 'work', buildId: '40' },
      ],
      offer: null,
    });

    const wrapper = page.drawPart('builds.hub', 's1');

    expect(
      findAll(wrapper, 'builds-hub-build').map(
        (build) => build.textContent.match(/#(\d+)/)?.[1],
      ),
    ).toEqual(['42', '40']);
  });

  it('marks the offer card while its stop holds the cursor', () => {
    const page = startBuildsPage(workSnapshot());
    page.setSession('s1', OFFERED);
    const wrapper = page.drawPart('builds.offer', 's1');
    const isCursor = () =>
      findAll(wrapper, 'builds-offer-card').map((card) =>
        card.classList.contains('is-cursor'),
      );
    const before = isCursor();

    page.stop().enter('s1', fakeExits());
    const held = isCursor();
    page.stop().leave('s1');

    expect([before, held, isCursor()]).toEqual([[false], [true], [false]]);
  });

  it('drops the offer card once its offer goes', () => {
    const page = startBuildsPage(workSnapshot());
    page.setSession('s1', OFFERED);
    const wrapper = page.drawPart('builds.offer', 's1');
    const cards = () => findAll(wrapper, 'builds-offer-card').length;
    const before = cards();

    page.setSession('s1', { builds: [], offer: null });

    expect([before, cards()]).toEqual([1, 0]);
  });

  it('queues nothing for the demo session', async () => {
    const page = startBuildsPage(workSnapshot());
    await page.enterStep('builds.session', { build: 'd1' });
    page.shown.sessionId = 'd1';

    page.run('queueOffer');
    await settle();

    expect(page.callsOf('queueOffer')).toEqual([]);
    expect(page.logged()).toContain('demo: queueOffer does nothing');
  });

  it('sets activity only for the demo session while the sample shows', async () => {
    const page = startBuildsPage(workSnapshot({ g1Builds: [running('41')] }));
    page.addRow('s1');
    page.setSession('s1', linking('41'));
    const callsBefore = page.activities.length;

    await page.enterStep('builds.session', { build: 'd1' });
    page.publish(workSnapshot({ g1Builds: [running('41'), running('42')] }));

    const after = page.activities.slice(callsBefore);
    expect(after).toContainEqual(['d1', 'builds', BUILDING]);
    expect(after.filter(([id]) => id === 's1')).toEqual([]);
  });
});
