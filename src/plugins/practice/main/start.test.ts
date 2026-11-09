import { describe, expect, it } from 'vitest';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import type { OpenedProblem, ProblemSummary } from '../contract';
import {
  PRACTICE_FOLDER,
  TWO_SUM,
  writeProblem,
} from './practice-fixtures.test-support';
import { practiceMainPart } from './start';

// Practice's main part over the harness, home `/home/u`, so the default
// `folder` setting reads `/home/u/leetcode`.
function startPractice() {
  return startMainPart(practiceMainPart, {
    dependencies: [
      fakeDependency(chatMainKey, () => ({}) as ChatMainExports),
      fakeDependency(sessionsMainKey, () => ({}) as SessionsMainExports),
    ],
    services: { homeDir: '/home/u' },
  });
}

describe('practice main part', () => {
  it('list leaves out a bad problem and logs it', async () => {
    const harness = startPractice();
    await writeProblem(harness.files, TWO_SUM);
    await harness.files.write(
      `${PRACTICE_FOLDER}/problems/bad/problem.json`,
      '{"title": 3}',
    );

    const summaries = (await harness.invoke('list')) as ProblemSummary[];

    expect(summaries.map((summary) => summary.slug)).toEqual(['two-sum']);
    expect(harness.logs.map((log) => log.message)).toEqual([
      expect.stringMatching(/^problems\/bad\/problem\.json: title/),
    ]);
  });

  it('open returns the summary with the attempt', async () => {
    const harness = startPractice();
    await writeProblem(harness.files, TWO_SUM);

    const opened = (await harness.invoke('open', 'two-sum')) as OpenedProblem;

    const progress = JSON.parse(
      await harness.files.read(
        `${PRACTICE_FOLDER}/problems/two-sum/progress.json`,
      ),
    );
    expect(opened.summary).toMatchObject({ slug: 'two-sum', title: 'Two Sum' });
    expect(opened.attempt.id).toBe(progress.attempts[0].id);
  });

  it('sends changed with the slug of a changed file', async () => {
    const harness = startPractice();

    await harness.files.write(
      `${PRACTICE_FOLDER}/problems/two-sum/notes.md`,
      'idea',
    );

    expect(harness.sent).toContainEqual({
      message: 'changed',
      data: { slug: 'two-sum' },
    });
  });
});
