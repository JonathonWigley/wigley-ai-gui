import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { MainApi, MainPart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { chatMainKey } from '../../chat/contract';
import { scopedAgentsMainKey } from '../../scoped-agents/contract';
import { sessionsMainKey } from '../../sessions/contract';
import type {
  OpenedProblem,
  PracticeChannel,
  ProblemSummary,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { practiceManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { interviewerAgentSpec } from './interviewer-agent';
import { createJudge, type Judge } from './judge';
import { createPracticeRuns, type PracticeRuns } from './practice-runs';
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

type PracticeApi = MainApi<typeof practiceManifest, PracticeChannel>;

// What the page's channel serves from: one practice folder's problems.
interface ServedPractice {
  store: ProblemStore;
  progress: Progress;
  judge: Judge;
  runs: PracticeRuns;
}

// Serves the page the practice folder's problems through the problem store,
// progress and the judge, and from the page's first `list` watches
// `problems/`, sending `changed` with the slug of each change; a change of the
// `folder` setting moves the watch. Runs the import session through chat and
// registers the interviewer with scoped-agents, and gives every session the
// `add_practice_problem` and `read_practice_state` tools. Registers the
// Practice layout contract. Hands the self-test its script, telling it of each
// submit, and offers a drive run the `writeFixture` action. While a demo step
// holds a sample folder, the channel serves it, the watch moves to it, and an
// import rejects; the tools and the interviewer keep the setting's folder.
export const practiceMainPart: MainPart<typeof practiceManifest> = {
  manifest: practiceManifest,
  start(api: PracticeApi) {
    const { services, channel } = api;
    api.layouts.register({ layoutTypes });
    const folder = () =>
      services.paths.expandTilde(api.settings().folder, services.homeDir);
    // The problem store, progress, judge and runs over the practice folder
    // `folderOf` names.
    const servePractice = (folderOf: () => string): ServedPractice => {
      const store = createProblemStore({
        files: services.files,
        paths: services.paths,
        log: services.log,
        folder: folderOf,
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
      return { store, progress, judge, runs };
    };
    const real = servePractice(folder);
    const { store, progress, judge, runs } = real;
    // A demo step's sample folder, which the channel serves while it is held;
    // the tools and the interviewer keep `real`.
    let heldSample: ServedPractice | null = null;
    const served = () => heldSample ?? real;
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const scopedAgents = api.dependency(scopedAgentsMainKey);
    const practiceSessions = createPracticeSessions({
      chat,
      store,
      files: services.files,
    });
    const interviewer = scopedAgents.addScopedAgent(
      interviewerAgentSpec({ store, progress }),
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
        interviewerSlug: (session) => interviewer.scopeOf(session),
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
      const current = served();
      current.store.startWatching();
      return listProblems(current.store, current.progress, services.log);
    });
    channel.handle('open', (slug) => {
      const current = served();
      return openProblem(current.store, current.progress, slug);
    });
    channel.handle('saveCode', (slug, text) =>
      served().store.writeText(slug, 'solution.cpp', text),
    );
    channel.handle('saveNotes', (slug, text) =>
      served().store.writeText(slug, 'notes.md', text),
    );
    channel.handle('saveCustomCases', (slug, text) =>
      served().store.writeText(slug, 'custom-cases.json', text),
    );
    channel.handle('run', (slug) => served().runs.run(slug));
    channel.handle('submit', (slug) => {
      selfTestScript?.submitStarted(slug);
      return served().runs.submit(slug);
    });
    channel.handle('peek', async (slug) => {
      const current = served();
      await current.progress.peek(slug);
      const [approach, reference] = await Promise.all([
        current.store.readText(slug, 'approach.md'),
        current.store.readText(slug, 'reference.cpp'),
      ]);
      return { approach: approach ?? '', reference: reference ?? '' };
    });
    channel.handle('startImport', async (request) => {
      if (heldSample !== null) {
        throw new Error('The sample practice folder imports nothing.');
      }
      return practiceSessions.startImport(request);
    });
    // The served store's `problems/`, watched again on each change of the
    // folder setting and each take and release of a sample.
    const watchProblems = (): Disposable =>
      served().store.watch((slug) => channel.send('changed', { slug }));
    let watchedFolder = folder();
    let watch = watchProblems();
    const moveWatch = () => {
      watch.dispose();
      watch = watchProblems();
    };
    api.onSettingsChanged(() => {
      if (folder() === watchedFolder) {
        return;
      }
      watchedFolder = folder();
      moveWatch();
    });
    const holdSample = (sampleFolder: string): Disposable => {
      if (heldSample !== null) {
        throw new Error('Practice already serves a sample');
      }
      const held = servePractice(() => sampleFolder);
      heldSample = held;
      moveWatch();
      reload();
      return {
        dispose() {
          if (heldSample !== held) {
            return;
          }
          heldSample = null;
          moveWatch();
          reload();
        },
      };
    };
    registerDemoSteps(services, {
      files: services.files,
      paths: services.paths,
      holdSample,
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
