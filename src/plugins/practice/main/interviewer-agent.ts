import type {
  ScopedAgentRecord,
  ScopedAgentSpec,
  ScopedAgentStore,
} from '../../scoped-agents/contract';
import type { Attempt } from '../contract';
import { practiceManifest } from '../manifest';
import { INTERVIEWER_INSTRUCTIONS } from './instructions';
import type { ProblemStore } from './problem-store';
import type { Progress } from './progress';

export interface InterviewerAgentDeps {
  store: Pick<
    ProblemStore,
    'slugs' | 'folder' | 'readProblem' | 'interviewerText'
  >;
  progress: Pick<Progress, 'read' | 'setInterviewer'>;
}

// Practice's interviewer as a scoped agent: one per problem, its scope the
// problem's slug, run in the practice folder with `interviewer.md`'s text as
// its instructions when that file holds any, else the built-in ones.
export function interviewerAgentSpec(
  deps: InterviewerAgentDeps,
): ScopedAgentSpec {
  const { store } = deps;
  return {
    owner: practiceManifest.id,
    agentId: 'interviewer',
    folder: () => store.folder(),
    async instructions() {
      const text = await store.interviewerText();
      return text !== null && text.trim() !== ''
        ? text
        : INTERVIEWER_INSTRUCTIONS;
    },
    async title(slug) {
      return `Interviewer: ${(await store.readProblem(slug)).title}`;
    },
    store: createInterviewerStore(deps),
  };
}

// The interviewer's records in each problem's `progress.json`: a scope's
// record is its current attempt's (the last in `attempts`) `interviewer`.
// `write` stores on the attempt current when it runs, and rejects
// `<slug> has no attempt; open it first.` for a problem with none, as
// `checkAsk` does. `entries` lists current attempts only, leaving out a
// problem whose progress fails to read. `superseded` is the latest earlier
// attempt's interviewer.
export function createInterviewerStore(
  deps: InterviewerAgentDeps,
): ScopedAgentStore {
  const { store, progress } = deps;
  const attemptsOf = async (slug: string): Promise<Attempt[]> =>
    (await progress.read(slug)).attempts;
  const noAttempt = (slug: string) =>
    new Error(`${slug} has no attempt; open it first.`);

  return {
    async read(slug) {
      return (await attemptsOf(slug)).at(-1)?.interviewer ?? null;
    },
    async write(slug, record) {
      const current = (await attemptsOf(slug)).at(-1);
      if (current === undefined) {
        throw noAttempt(slug);
      }
      await progress.setInterviewer(slug, current.id, record);
    },
    async entries() {
      const found: { scope: string; record: ScopedAgentRecord }[] = [];
      for (const slug of await store.slugs()) {
        let attempts: Attempt[];
        try {
          attempts = await attemptsOf(slug);
        } catch {
          continue;
        }
        const record = attempts.at(-1)?.interviewer ?? null;
        if (record !== null) {
          found.push({ scope: slug, record });
        }
      }
      return found;
    },
    async superseded(slug) {
      return (
        (await attemptsOf(slug))
          .slice(0, -1)
          .findLast((earlier) => earlier.interviewer !== null)?.interviewer ??
        null
      );
    },
    async checkAsk(slug) {
      if ((await attemptsOf(slug)).length === 0) {
        throw noAttempt(slug);
      }
    },
  };
}
