import { describe, expect, it } from 'vitest';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatMainExports, chatMainKey } from '../../chat/contract';
import {
  type ScopedAgentSpec,
  type ScopedAgentsMainExports,
  scopedAgentsMainKey,
} from '../../scoped-agents/contract';
import {
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import type { ToolDefinition } from '../../sessions/contract';
import type { OpenedProblem, ProblemSummary } from '../contract';
import {
  PRACTICE_FOLDER,
  TWO_SUM,
  writeProblem,
} from './practice-fixtures.test-support';
import { practiceMainPart } from './start';

// Practice's main part over the harness, home `/home/u`, so the default
// `folder` setting reads `/home/u/leetcode`. Chat's `launch` resolves `row-1`;
// `contributed` holds each `contributeTools` call's tools, `specs` each
// `addScopedAgent` call's spec, whose agent's `scopeOf` answers `two-sum`.
function startPractice() {
  const contributed: ToolDefinition[][] = [];
  const specs: ScopedAgentSpec[] = [];
  const chat = {
    launch: async () => 'row-1',
    defaultProfile: () => 'default',
  } as unknown as ChatMainExports;
  const sessions = {
    contributeTools: (tools: ToolDefinition[]) => {
      contributed.push(tools);
      return { dispose: () => undefined };
    },
  } as unknown as SessionsMainExports;
  const scopedAgents: ScopedAgentsMainExports = {
    addScopedAgent(spec) {
      specs.push(spec);
      return {
        ask: async () => 'row-1',
        sessionOf: async () => null,
        scopeOf: async () => 'two-sum',
        dispose: () => undefined,
      };
    },
  };
  const harness = startMainPart(practiceMainPart, {
    dependencies: [
      fakeDependency(chatMainKey, () => chat),
      fakeDependency(sessionsMainKey, () => sessions),
      fakeDependency(scopedAgentsMainKey, () => scopedAgents),
    ],
    services: { homeDir: '/home/u' },
  });
  return Object.assign(harness, { contributed, specs });
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
    await harness.invoke('list');

    await harness.files.write(
      `${PRACTICE_FOLDER}/problems/two-sum/notes.md`,
      'idea',
    );

    expect(harness.sent).toContainEqual({
      message: 'changed',
      data: { slug: 'two-sum' },
    });
  });

  it("the interviewer's entries before any list start no watch", async () => {
    const harness = startPractice();

    await harness.specs[0].store.entries();
    await harness.files.write(
      `${PRACTICE_FOLDER}/problems/two-sum/notes.md`,
      'idea',
    );

    expect(harness.sent).toEqual([]);
  });

  it('start registers the interviewer and wires the tools', () => {
    const harness = startPractice();

    expect(
      harness.contributed.map((tools) => tools.map((tool) => tool.name)),
    ).toEqual([['add_practice_problem', 'read_practice_state']]);
    expect(
      harness.specs.map((spec) => ({
        owner: spec.owner,
        agentId: spec.agentId,
      })),
    ).toEqual([{ owner: 'practice', agentId: 'interviewer' }]);
  });
});
