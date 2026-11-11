import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { type ChatMainEvents, chatMainKey } from '../../chat/contract';
import { sessionsMainKey } from '../../sessions/contract';
import type {
  OpenedProblem,
  PracticeChannel,
  ProblemSummary,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { practiceManifest } from '../manifest';
import { createJudge } from './judge';
import { createPracticeRuns } from './practice-runs';
import { createPracticeSessions } from './practice-sessions';
import {
  ADD_PRACTICE_PROBLEM_TOOL,
  READ_PRACTICE_STATE_TOOL,
  startPracticeTools,
} from './practice-tools';
import { createProblemStore, type ProblemStore } from './problem-store';
import { createProgress, type Progress } from './progress';
import {
  PRACTICE_FIXTURE_SLUGS,
  writePracticeFixture,
} from './selftest-fixture';
import { practiceSelfTestScript } from './selftest-script';

type PracticeApi = MainApi<
  typeof practiceManifest,
  PracticeChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents>
>;

// Serves the page the practice folder's problems through the problem store,
// progress and the judge, and from the page's first `list` watches
// `problems/`, sending `changed` with the slug of each change; a change of the
// `folder` setting moves the watch. Runs the import and interviewer sessions
// through chat, hearing chat's session events, and gives every session the
// `add_practice_problem` and `read_practice_state` tools. Registers the
// Practice layout contract. Hands the self-test its script, telling it of each
// submit, and offers a drive run the `writeFixture` action.
export const practiceMainPart: MainPart<typeof practiceManifest> = {
  manifest: practiceManifest,
  start(api: PracticeApi) {
    const { services, channel } = api;
    api.layouts.register({ layoutTypes });
    const folder = () =>
      services.paths.expandTilde(api.settings().folder, services.homeDir);
    const store = createProblemStore({
      files: services.files,
      paths: services.paths,
      log: services.log,
      folder,
    });
    const progress = createProgress({
      store,
      clock: services.clock,
      randomHex: services.randomHex,
      steps: () => api.settings().reviewSteps,
    });
    const judge = createJudge({
      files: services.files,
      processes: services.processes,
      paths: services.paths,
      clock: services.clock,
      settings: () => {
        const settings = api.settings();
        return {
          buildFolder: store.buildFolder(),
          compiler: settings.compiler,
          flags: settings.flags,
          timeLimitMs: settings.timeLimitMs,
        };
      },
    });
    const runs = createPracticeRuns({ store, progress, judge });
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const practiceSessions = createPracticeSessions({
      chat,
      store,
      progress,
      files: services.files,
      paths: services.paths,
      timers: services.timers,
      log: services.log,
    });
    api.events.on('chat.sessionOpened', (event) =>
      practiceSessions.opened(event),
    );
    api.events.on('chat.sessionClosed', (event) =>
      practiceSessions.closed(event),
    );
    api.events.on('chat.sessionCleared', (event) =>
      practiceSessions.cleared(event),
    );
    sessions.contributeTools(
      [ADD_PRACTICE_PROBLEM_TOOL, READ_PRACTICE_STATE_TOOL],
      startPracticeTools({
        files: services.files,
        paths: services.paths,
        store,
        progress,
        judge,
        lastResult: runs.lastResult,
        interviewerSlug: practiceSessions.interviewerSlug,
      }),
    );
    const reload = () => channel.send('changed', { slug: null });
    const selfTestScript =
      services.selfTest === null
        ? null
        : practiceSelfTestScript({
            files: services.files,
            paths: services.paths,
            processes: services.processes,
            folder,
            compiler: () => api.settings().compiler,
            reload,
          });
    channel.handle('list', () => {
      store.startWatching();
      return listProblems(store, progress, services.log);
    });
    channel.handle('open', (slug) => openProblem(store, progress, slug));
    channel.handle('saveCode', (slug, text) =>
      store.writeText(slug, 'solution.cpp', text),
    );
    channel.handle('saveNotes', (slug, text) =>
      store.writeText(slug, 'notes.md', text),
    );
    channel.handle('saveCustomCases', (slug, text) =>
      store.writeText(slug, 'custom-cases.json', text),
    );
    channel.handle('run', (slug) => runs.run(slug));
    channel.handle('submit', (slug) => {
      selfTestScript?.submitStarted(slug);
      return runs.submit(slug);
    });
    channel.handle('peek', async (slug) => {
      await progress.peek(slug);
      const [approach, reference] = await Promise.all([
        store.readText(slug, 'approach.md'),
        store.readText(slug, 'reference.cpp'),
      ]);
      return { approach: approach ?? '', reference: reference ?? '' };
    });
    channel.handle('startImport', (request) =>
      practiceSessions.startImport(request),
    );
    channel.handle('askInterviewer', (slug, text) =>
      practiceSessions.askInterviewer(slug, text),
    );
    channel.handle('interviewerOf', (slug) =>
      practiceSessions.interviewerOf(slug),
    );
    const watchProblems = (): Disposable =>
      store.watch((slug) => channel.send('changed', { slug }));
    let watchedFolder = folder();
    let watch = watchProblems();
    api.onSettingsChanged(() => {
      if (folder() === watchedFolder) {
        return;
      }
      watch.dispose();
      watchedFolder = folder();
      watch = watchProblems();
    });
    if (selfTestScript !== null) {
      services.selfTest?.run(selfTestScript);
    }
    api.drive?.add('writeFixture', {
      description:
        'Writes the Practice fixture into the practice folder (the folder setting, default <home>/leetcode), replacing every problem in its problems folder: Two Sum (a function problem, anyOrder, with a correct solution.cpp) and LRU Cache (a design problem whose solution.cpp get always returns -1, so Submit gives Wrong Answer). Tells the page to list again. Returns { folder, problems }.',
      args: '{}',
      async run() {
        await writePracticeFixture(services, folder());
        reload();
        return { folder: folder(), problems: [...PRACTICE_FIXTURE_SLUGS] };
      },
    });
    return { commands: {} };
  },
};

// Every problem's summary; a problem whose files fail is left out and logged.
async function listProblems(
  store: ProblemStore,
  progress: Progress,
  log: PluginLog,
): Promise<ProblemSummary[]> {
  const summaries = await Promise.all(
    (await store.slugs()).map(async (slug) => {
      try {
        return await progress.summary(slug, await store.readProblem(slug));
      } catch (error) {
        log(errorText(error));
        return null;
      }
    }),
  );
  return summaries.filter((summary) => summary !== null);
}

async function openProblem(
  store: ProblemStore,
  progress: Progress,
  slug: string,
): Promise<OpenedProblem> {
  const problem = await store.readProblem(slug);
  const attempt = await progress.open(slug, problem);
  const [summary, statement, code, notes, customCases, submissions] =
    await Promise.all([
      progress.summary(slug, problem),
      store.readText(slug, 'problem.md'),
      store.readText(slug, 'solution.cpp'),
      store.readText(slug, 'notes.md'),
      store.readText(slug, 'custom-cases.json'),
      store.submissions(slug),
    ]);
  return {
    summary,
    statement: statement ?? '',
    signature: problem.signature,
    code: code ?? '',
    notes: notes ?? '',
    customCases: customCases ?? '',
    attempt,
    submissions,
  };
}
