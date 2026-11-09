import { describe, expect, it, vi } from 'vitest';
import type { Files } from '../contracts/files';
import type { Git, GitWorktree } from '../contracts/git';
import { createMemoryFiles } from './memory-files';
import {
  type PlanCopyDeps,
  planCopies,
  readCopyAt,
  readMovedCopy,
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

// `[path, modified time, text]`: each file is written at its time, a
// `plan.md` with `PLAN_TEXT` and any other file empty unless `text` is given.
type Write = readonly [string, number, string?];

// A three-task plan with its first `ticks` tasks ticked.
function planTicked(ticks: number): string {
  const boxes = ['one', 'two', 'three'].map(
    (task, index) => `- [${index < ticks ? 'x' : ' '}] ${task}\n`,
  );
  return `# A — plan\n\n## Tasks\n\n${boxes.join('')}`;
}

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
// `vanished` names a file whose read fails as missing, as one deleted after
// the listing.
async function setUp(
  writes: readonly Write[],
  options: {
    trees?: GitWorktree[];
    linked?: boolean;
    vanished?: string;
  } = {},
) {
  const trees = options.trees ?? TREES;
  const clock = { time: 0, now: () => clock.time };
  const memory = createMemoryFiles(clock);
  for (const [path, time, text] of writes) {
    clock.time = time;
    await memory.write(
      path,
      text ?? (path.endsWith('plan.md') ? PLAN_TEXT : ''),
    );
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
  const shown = options.linked ? linkedFiles(memory) : memory;
  const files: PlanCopyDeps['files'] = {
    ...shown,
    read: async (path) => {
      if (path === options.vanished) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      return shown.read(path);
    },
  };
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
  { planDir: `/r/${PLAN}`, checkout: '/r', changedAt: 25, isMainTree: true },
  {
    planDir: `/w1/${PLAN}`,
    checkout: '/w1',
    changedAt: 30,
    isMainTree: false,
  },
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
      expected: [
        {
          planDir: `/w1/${PLAN}`,
          checkout: '/w1',
          changedAt: 30,
          isMainTree: false,
        },
      ],
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
        {
          planDir: '/o/plan-a',
          checkout: '/o/plan-a',
          changedAt: 12,
          isMainTree: true,
        },
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
        { planDir: '/o/p', checkout: '/o/p', changedAt, isMainTree: true },
      ]);
    },
  );

  it('planCopies_WorktreesRejects_ReturnsTheNamedCopy', async () => {
    const test = await setUp(THREE_CHECKOUTS);
    test.git.worktrees.mockRejectedValue(new Error('git worktree exited 128'));

    expect(await planCopies(`/w1/${PLAN}`, test.deps)).toEqual([
      {
        planDir: `/w1/${PLAN}`,
        checkout: `/w1/${PLAN}`,
        changedAt: 30,
        isMainTree: true,
      },
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

describe('readMovedCopy', () => {
  const MAIN = `/r/${PLAN}/plan.md`;
  const FIRST = `/w1/${PLAN}/plan.md`;
  const SECOND = `/w2/${PLAN}/plan.md`;
  // Keeps the main tree's folder, so its clone is found with no main copy.
  const MAIN_FOLDER: Write = ['/r/docs/features/f/checklist.md', 5];

  it.each([
    {
      name: 'a newer worktree copy equal to main',
      writes: [
        [MAIN, 10, planTicked(1)],
        [FIRST, 50, planTicked(1)],
      ] satisfies Write[],
      vanished: undefined,
      expected: '/r',
    },
    {
      name: 'a moved copy and a newer fresh copy equal to main',
      writes: [
        [MAIN, 10, planTicked(1)],
        [FIRST, 20, planTicked(2)],
        [SECOND, 50, planTicked(1)],
      ] satisfies Write[],
      vanished: undefined,
      expected: '/w1',
    },
    {
      name: 'two moved copies',
      writes: [
        [MAIN, 10, planTicked(1)],
        [FIRST, 20, planTicked(2)],
        [SECOND, 30, planTicked(3)],
      ] satisfies Write[],
      vanished: undefined,
      expected: '/w2',
    },
    {
      name: 'no main copy',
      writes: [
        MAIN_FOLDER,
        [FIRST, 20, planTicked(2)],
        [SECOND, 30, planTicked(1)],
      ] satisfies Write[],
      vanished: undefined,
      expected: '/w2',
    },
    {
      name: 'a newer worktree copy behind main',
      writes: [
        [MAIN, 10, planTicked(2)],
        [FIRST, 50, planTicked(1)],
      ] satisfies Write[],
      vanished: undefined,
      expected: '/r',
    },
    {
      name: 'a newer worktree copy with an earlier status, equal ticks',
      writes: [
        [MAIN, 10],
        [`/r/${PLAN}/01-a.md`, 10, 'Status: in progress\n'],
        [FIRST, 50],
        [`/w1/${PLAN}/01-a.md`, 50, 'Status: not started\n'],
      ] satisfies Write[],
      vanished: undefined,
      expected: '/r',
    },
    {
      name: 'a newer worktree copy with a later status, equal ticks',
      writes: [
        [MAIN, 10],
        [`/r/${PLAN}/01-a.md`, 10, 'Status: in progress\n'],
        [FIRST, 50],
        [`/w1/${PLAN}/01-a.md`, 50, 'Status: done\n'],
      ] satisfies Write[],
      vanished: undefined,
      expected: '/w1',
    },
    {
      name: 'two moved copies at equal times',
      writes: [
        [MAIN, 10, planTicked(1)],
        [FIRST, 30, planTicked(2)],
        [SECOND, 30, planTicked(3)],
      ] satisfies Write[],
      vanished: undefined,
      expected: '/w1',
    },
    {
      name: 'a worktree copy whose plan.md does not read',
      writes: [
        [MAIN, 10, planTicked(1)],
        [FIRST, 50, planTicked(2)],
      ] satisfies Write[],
      vanished: FIRST,
      expected: '/r',
    },
    {
      name: 'no copy',
      writes: [MAIN_FOLDER] satisfies Write[],
      vanished: undefined,
      expected: null,
    },
  ])(
    'readMovedCopy_PicksTheMovedCopy ($name)',
    async ({ writes, vanished, expected }) => {
      const test = await setUp(writes, { vanished });

      const moved = await readMovedCopy(`/r/${PLAN}`, test.deps);

      expect(moved?.copy.checkout ?? null).toEqual(expected);
    },
  );
});

describe('readCopyAt', () => {
  it.each([
    {
      name: 'a folder with plan.md, a newer differing copy elsewhere',
      planDir: `/w1/${PLAN}`,
      expected: { planDir: `/w1/${PLAN}`, checked: 1 },
    },
    {
      name: 'a folder with no plan.md',
      planDir: `/w2/${PLAN}`,
      expected: null,
    },
  ])(
    'readCopyAt_ReadsThatFolderAlone ($name)',
    async ({ planDir, expected }) => {
      const test = await setUp([
        [`/r/${PLAN}/plan.md`, 50, planTicked(2)],
        [`/w1/${PLAN}/plan.md`, 10, planTicked(1)],
        [`/w2/${PLAN}/notes.md`, 60],
      ]);

      const read = await readCopyAt(planDir, test.deps);

      expect(
        read === null
          ? null
          : { planDir: read.copy.planDir, checked: read.progress.checked },
      ).toEqual(expected);
    },
  );
});

describe('readPlanCopy', () => {
  const COPY = {
    planDir: `/w1/${PLAN}`,
    checkout: '/w1',
    changedAt: 0,
    isMainTree: false,
  };
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
