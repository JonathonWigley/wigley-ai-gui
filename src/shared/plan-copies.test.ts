import { describe, expect, it, vi } from 'vitest';
import type { Files } from '../contracts/files';
import type { Git, GitWorktree } from '../contracts/git';
import { createMemoryFiles } from './memory-files';
import {
  type PlanCopyDeps,
  newestPlanCopy,
  planCopies,
  readPlanCopy,
} from './plan-copies';
import { posixPaths } from './paths/posix-paths';

const PLAN = 'docs/features/f/plan-a';
const PLAN_TEXT = '# A — plan\n\n## Tasks\n\n- [ ] [01 — A](01-a.md)\n';

// The main tree `/r` and the linked worktrees `/w1` and `/w2`.
const TREES: GitWorktree[] = [
  { path: '/r', branch: 'main', isMain: true },
  { path: '/w1', branch: 'w1', isMain: false },
  { path: '/w2', branch: 'w2', isMain: false },
];

// `[path, modified time]`: each file is written at its time.
type Write = readonly [string, number];

// The prefix the `linked` files wrapper reads as `/r/docs/features`.
const LINK = '/link';

function unlinked(path: string): string {
  return path.startsWith(`${LINK}/`)
    ? `/r/docs/features${path.slice(LINK.length)}`
    : path;
}

// Files that read the `/link` prefix as `/r/docs/features` in every member,
// as a symlinked spelling of the home reads.
function linkedFiles(files: PlanCopyDeps['files']): PlanCopyDeps['files'] {
  return {
    read: (path) => files.read(unlinked(path)),
    modified: (path) => files.modified(unlinked(path)),
    list: (folder, options) => files.list(unlinked(folder), options),
    stat: (path) => files.stat(unlinked(path)),
    realPath: (path) => files.realPath(unlinked(path)),
  };
}

// Deps over memory files holding `writes`, and a git whose checkouts are
// `trees`: `topLevel` answers the checkout holding an existing folder, as
// `git -C` fails in a missing one, and null outside every checkout.
async function setUp(
  writes: readonly Write[],
  options: { trees?: GitWorktree[]; linked?: boolean } = {},
) {
  const trees = options.trees ?? TREES;
  const clock = { time: 0, now: () => clock.time };
  const memory = createMemoryFiles(clock);
  for (const [path, time] of writes) {
    clock.time = time;
    await memory.write(path, path.endsWith('plan.md') ? PLAN_TEXT : '');
  }
  const git = {
    topLevel: vi.fn<Git['topLevel']>(async (folder) => {
      const real = unlinked(folder);
      if (!(await memory.stat(real))?.isFolder) {
        return null;
      }
      const tree = trees.find((each) => posixPaths.isInside(real, each.path));
      return tree?.path ?? null;
    }),
    worktrees: vi.fn<Git['worktrees']>(async () => trees),
  };
  const files = options.linked ? linkedFiles(memory) : memory;
  const deps: PlanCopyDeps = { git, files, paths: posixPaths };
  return { deps, git, memory };
}

// A main and a first worktree that hold the plan, a second that does not.
const THREE_CHECKOUTS: Write[] = [
  [`/r/${PLAN}/plan.md`, 10],
  [`/r/${PLAN}/01-a.md`, 25],
  [`/w1/${PLAN}/plan.md`, 15],
  [`/w1/${PLAN}/02-b.md`, 30],
  ['/w2/docs/features/f/checklist.md', 5],
];

const MAIN_AND_FIRST = [
  { planDir: `/r/${PLAN}`, checkout: '/r', changedAt: 25 },
  { planDir: `/w1/${PLAN}`, checkout: '/w1', changedAt: 30 },
];

describe('planCopies', () => {
  it.each([
    {
      name: 'main and two worktrees, one without the plan',
      writes: THREE_CHECKOUTS,
      planDir: `/r/${PLAN}`,
      trees: TREES,
      linked: false,
      askedOf: `/r/${PLAN}`,
      expected: MAIN_AND_FIRST,
    },
    {
      name: "asked from a worktree's copy",
      writes: THREE_CHECKOUTS,
      planDir: `/w1/${PLAN}`,
      trees: TREES,
      linked: false,
      askedOf: `/w1/${PLAN}`,
      expected: MAIN_AND_FIRST,
    },
    {
      name: 'the main copy deleted',
      writes: [
        ['/r/docs/features/f/checklist.md', 5],
        [`/w1/${PLAN}/plan.md`, 15],
        [`/w1/${PLAN}/02-b.md`, 30],
      ] satisfies Write[],
      planDir: `/r/${PLAN}`,
      trees: TREES,
      linked: false,
      askedOf: '/r/docs/features/f',
      expected: [{ planDir: `/w1/${PLAN}`, checkout: '/w1', changedAt: 30 }],
    },
    {
      name: 'a symlinked home spelling',
      writes: THREE_CHECKOUTS,
      planDir: `${LINK}/f/plan-a`,
      trees: TREES,
      linked: true,
      askedOf: `${LINK}/f/plan-a`,
      expected: MAIN_AND_FIRST,
    },
    {
      name: 'outside a clone',
      writes: [['/o/plan-a/plan.md', 12]] satisfies Write[],
      planDir: '/o/plan-a',
      trees: [],
      linked: false,
      askedOf: '/o/plan-a',
      expected: [
        { planDir: '/o/plan-a', checkout: '/o/plan-a', changedAt: 12 },
      ],
    },
    {
      name: 'outside a clone with no plan.md',
      writes: [['/o/plan-a/checklist.md', 12]] satisfies Write[],
      planDir: '/o/plan-a',
      trees: [],
      linked: false,
      askedOf: '/o/plan-a',
      expected: [],
    },
  ])(
    'planCopies_PlanFolder_EachCheckoutThatHoldsPlanMd ($name)',
    async ({ writes, planDir, trees, linked, askedOf, expected }) => {
      const test = await setUp(writes, { trees, linked });

      expect(await planCopies(planDir, test.deps)).toEqual(expected);
      expect(test.git.topLevel).toHaveBeenCalledWith(askedOf);
    },
  );

  it.each([
    {
      name: 'plan.md newest',
      writes: [
        ['/o/p/plan.md', 30],
        ['/o/p/01-a.md', 20],
      ] satisfies Write[],
      changedAt: 30,
    },
    {
      name: 'a task document newest',
      writes: [
        ['/o/p/plan.md', 10],
        ['/o/p/02-b.md', 40],
      ] satisfies Write[],
      changedAt: 40,
    },
    {
      name: 'a note is not a task document',
      writes: [
        ['/o/p/plan.md', 10],
        ['/o/p/notes.md', 50],
        ['/o/p/1-a.md', 60],
      ] satisfies Write[],
      changedAt: 10,
    },
    {
      name: 'a file in a subfolder is not read',
      writes: [
        ['/o/p/plan.md', 10],
        ['/o/p/sub/03-c.md', 70],
      ] satisfies Write[],
      changedAt: 10,
    },
  ])(
    'planCopies_ChangedAt_NewestOfPlanAndTaskDocuments ($name)',
    async ({ writes, changedAt }) => {
      const test = await setUp(writes, { trees: [] });

      expect(await planCopies('/o/p', test.deps)).toEqual([
        { planDir: '/o/p', checkout: '/o/p', changedAt },
      ]);
    },
  );

  it('planCopies_WorktreesRejects_ReturnsTheNamedCopy', async () => {
    const test = await setUp(THREE_CHECKOUTS);
    test.git.worktrees.mockRejectedValue(new Error('git worktree exited 128'));

    expect(await planCopies(`/w1/${PLAN}`, test.deps)).toEqual([
      { planDir: `/w1/${PLAN}`, checkout: `/w1/${PLAN}`, changedAt: 30 },
    ]);
  });

  it('planCopies_FilesFails_Rejects', async () => {
    const test = await setUp(THREE_CHECKOUTS);
    const denied = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    const files: PlanCopyDeps['files'] = {
      ...test.memory,
      list: async () => {
        throw denied;
      },
    };

    await expect(
      planCopies(`/r/${PLAN}`, { ...test.deps, files }),
    ).rejects.toBe(denied);
  });
});

describe('newestPlanCopy', () => {
  it.each([
    {
      name: 'a worktree newer',
      writes: [
        [`/r/${PLAN}/plan.md`, 10],
        [`/w1/${PLAN}/plan.md`, 20],
      ] satisfies Write[],
      expected: { planDir: `/w1/${PLAN}`, checkout: '/w1', changedAt: 20 },
    },
    {
      name: 'equal times',
      writes: [
        [`/r/${PLAN}/plan.md`, 10],
        [`/w1/${PLAN}/plan.md`, 10],
      ] satisfies Write[],
      expected: { planDir: `/r/${PLAN}`, checkout: '/r', changedAt: 10 },
    },
    {
      name: 'no copy',
      writes: [['/r/docs/features/f/checklist.md', 10]] satisfies Write[],
      expected: null,
    },
  ])(
    'newestPlanCopy_Copies_LargestChangedAtTiesToMain ($name)',
    async ({ writes, expected }) => {
      const test = await setUp(writes);

      expect(await newestPlanCopy(`/r/${PLAN}`, test.deps)).toEqual(expected);
    },
  );
});

describe('readPlanCopy', () => {
  const COPY = { planDir: `/w1/${PLAN}`, checkout: '/w1', changedAt: 0 };
  const LINKED_PLAN = `# A — plan

## Tasks

- [x] [01 — A](01-a.md)
- [ ] [02 — B](02-b.md)
- [ ] [03 — C](03-c.md)
`;

  async function writeCopies(files: Pick<Files, 'write'>, withPlan: boolean) {
    // The asked main tree's task documents disagree with the copy's.
    await files.write(`/r/${PLAN}/plan.md`, LINKED_PLAN);
    await files.write(`/r/${PLAN}/01-a.md`, 'Status: not started\n');
    await files.write(`/r/${PLAN}/02-b.md`, 'Status: done\n');
    await files.write(`/r/${PLAN}/03-c.md`, 'Status: done\n');
    if (withPlan) {
      await files.write(`/w1/${PLAN}/plan.md`, LINKED_PLAN);
    }
    await files.write(`/w1/${PLAN}/01-a.md`, '# 01\n\nStatus: done\n');
    await files.write(`/w1/${PLAN}/02-b.md`, '# 02\n\nStatus: in progress\n');
  }

  it.each([
    {
      name: "statuses from the copy's task documents",
      withPlan: true,
      expected: {
        checked: 1,
        total: 3,
        wave: null,
        reviewRounds: 0,
        title: 'A',
        tasks: [
          {
            wave: null,
            text: '01 — A',
            done: true,
            file: '01-a.md',
            status: 'done',
          },
          {
            wave: null,
            text: '02 — B',
            done: false,
            file: '02-b.md',
            status: 'in progress',
          },
          {
            wave: null,
            text: '03 — C',
            done: false,
            file: '03-c.md',
            status: null,
          },
        ],
      },
    },
    { name: 'plan.md missing', withPlan: false, expected: null },
  ])(
    'readPlanCopy_PlanAndLinkedTaskDocuments ($name)',
    async ({ withPlan, expected }) => {
      const test = await setUp([]);
      await writeCopies(test.memory, withPlan);

      expect(await readPlanCopy(COPY, test.deps)).toEqual(expected);
    },
  );
});
