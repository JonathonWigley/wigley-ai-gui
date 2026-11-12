import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type {
  SelfTestGroup,
  SelfTestScript,
  SelfTestStep,
} from '../../../contracts/plugin';
import type { ProcessRunner } from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import { writeBacklogFixture } from './selftest-fixture';

export interface BacklogSelfTestDeps {
  files: Files;
  processes: ProcessRunner;
  paths: Paths;
  // `services.homeDir`, the self-test's temp home.
  homeDir: string;
  // Settles once the fixture main wrote at start is on disk, so a run's
  // rewrite never races it.
  started: Promise<unknown>;
  // Tells the page to read the homes again.
  reload(): void;
}

// The table, done hidden: the git home's Ready item, Plain item, Moved item
// and Stale item (fresh, fresh, moved, stale), then the list-shaped home's
// First follow-up (unknown: outside git); Shipped item follows Plain item
// while done shows.
function backlogGroups(): SelfTestGroup[] {
  const open: SelfTestStep[] = [
    { keys: [' ', 'k', 'b'], expect: '[backlog] shown', checksFit: true },
    {
      keys: ['R'],
      expect: '[backlog] loaded 2 homes',
      why: 'The table reads both homes: the git home and the list-shaped home.',
    },
    {
      keys: ['G'],
      expect: '[backlog] selected First follow-up',
      why: "The list-shaped home's item ends the one table.",
    },
    { keys: ['g', 'g'], expect: '[backlog] selected Ready item' },
    { keys: ['j'], expect: '[backlog] selected Plain item' },
    {
      keys: ['j'],
      expect: '[backlog] selected Moved item',
      why: 'The struck item is hidden, so Moved item follows Plain item.',
    },
    {
      keys: ['j'],
      expect: '[backlog] selected Stale item',
      checksFit: true,
      screenshot: 'table',
      why: 'The screenshot shows the four staleness levels: fresh, moved, stale and unknown.',
    },
  ];
  const filters: SelfTestStep[] = [
    { keys: [' ', 'v', 'd'], expect: '[backlog] done shown' },
    {
      keys: ['k', 'k'],
      expect: '[backlog] selected Shipped item',
      why: 'The struck item now shows after Plain item.',
    },
    { keys: [' ', 'v', 'd'], expect: '[backlog] done hidden' },
    {
      keys: [' ', 'v', 'a'],
      expect: '[backlog] selected Ready item',
      why: 'Only the agent-ready item shows, so the selection moves to it.',
    },
    { keys: [' ', 'v', 'a'], expect: '[backlog] agent-ready only off' },
    { keys: [' ', 'v', 'r'], expect: '[backlog] picker shown: Repos' },
    {
      keys: ['G', 'Enter'],
      expect: '[backlog] repo selftest-repo',
      why: 'The last repo row filters the table to the list-shaped home.',
    },
    { keys: [' ', 'v', 'r'], expect: '[backlog] picker shown: Repos' },
    {
      keys: ['g', 'g', 'Enter'],
      expect: '[backlog] repo all',
      why: 'All repos shows every row again; the selection stays on First follow-up.',
    },
    { keys: [' ', 'v', 's'], expect: '[backlog] stale first on' },
    {
      keys: ['g', 'g'],
      expect: '[backlog] selected Stale item',
      why: 'Stale ranks first.',
    },
    {
      keys: ['j', 'j'],
      expect: '[backlog] selected First follow-up',
      why: 'Stale, then moved, then unknown rank above fresh, so the levels main read from git are in place.',
    },
    { keys: [' ', 'v', 's'], expect: '[backlog] stale first off' },
    {
      keys: ['/', ...'plain'],
      expect: '[backlog] selected Plain item',
      why: 'The filter hides every other row, so the selection moves to the match.',
    },
    { keys: ['Enter'], expect: '[backlog] filter plain' },
    {
      keys: ['/', 'Escape', 'g', 'g'],
      expect: '[backlog] selected Ready item',
      why: '/ then Esc clears the filter, so the first row shows again.',
    },
  ];
  const review: SelfTestStep[] = [
    { keys: ['j', 'j'], expect: '[backlog] selected Moved item' },
    { keys: ['<A-l>'], expect: '[backlog] review focused' },
    { keys: ['g', 'l'], expect: '[backlog] commits shown' },
    {
      keys: ['G'],
      expect: '[backlog] scrolled the review to the end',
      screenshot: 'review',
      why: "The screenshot shows Moved item's staleness note and its one commit since, Change the app.",
    },
    { keys: ['g', 'g'], expect: '[backlog] scrolled the review to the top' },
    { keys: ['g', 'l'], expect: '[backlog] commits hidden' },
    { keys: ['<A-h>'], expect: '[backlog] table focused' },
  ];
  const chunks: SelfTestStep[] = [
    { keys: ['g', 'g'], expect: '[backlog] selected Ready item' },
    { keys: ['x'], expect: '[backlog] marked Ready item' },
    { keys: ['j', 'x'], expect: '[backlog] marked Plain item' },
    {
      keys: ['c'],
      expect: '[backlog] added 2 to Ready item',
      screenshot: 'chunk',
      why: 'With the strip on New chunk, c makes a chunk of both marked rows, named after the first.',
    },
    { keys: ['<A-j>'], expect: '[backlog] strip focused' },
    { keys: ['H'], expect: '[backlog] headless Ready item on' },
    { keys: ['H'], expect: '[backlog] headless Ready item off' },
    { keys: ['r'], expect: '[backlog] renaming Ready item' },
    {
      keys: [...'Pair', 'Enter'],
      expect: '[backlog] renamed Pair',
      why: "The letters replace the rename box's selected name.",
    },
    { keys: ['<A-k>'], expect: '[backlog] table focused' },
    {
      keys: [' ', 'v', 'c'],
      expect: '[backlog] chunked hidden',
      alsoExpect: [/^\[backlog\] selected Stale item$/],
      why: 'Both chunked rows hide, so the selection moves from Plain item to the row now at its place.',
    },
    { keys: [' ', 'v', 'c'], expect: '[backlog] chunked shown' },
  ];
  const startRefused: SelfTestStep[] = [
    { keys: ['<A-j>'], expect: '[backlog] strip focused' },
    { keys: ['l'], expect: '[backlog] strip on new chunk' },
    { keys: ['<A-k>'], expect: '[backlog] table focused' },
    { keys: ['G'], expect: '[backlog] selected First follow-up' },
    { keys: ['c'], expect: '[backlog] added 1 to First follow-up' },
    {
      keys: ['s'],
      expect: '[backlog] start refused First follow-up',
      why: 'selftest-repo has no repo folder, so main refuses the start.',
    },
  ];
  const unchunk: SelfTestStep[] = [
    { keys: ['u'], expect: '[backlog] took 1 out of chunks' },
    {
      keys: ['g', 'g', 'x', 'j', 'x', 'u'],
      expect: '[backlog] took 2 out of chunks',
      why: "The emptied chunks are dropped, so the next run starts with none, and the selection rests on Plain item for the next run's G to change.",
    },
  ];
  const assistant: SelfTestStep[] = [
    {
      keys: [' ', 'v', 'b'],
      expect: '[backlog] assistant shown',
      alsoExpect: [/^\[backlog\] assistant focused$/],
      checksFit: true,
      screenshot: 'assistant',
      why: 'The pane opens beside the table and takes the keys.',
    },
    { keys: ['<A-h>'], expect: '[backlog] table focused' },
    { keys: [' ', 'v', 'b'], expect: '[backlog] assistant hidden' },
  ];
  return [
    {
      name: 'open',
      why: "Space k b shows Backlog's one table across both repos, the struck item hidden.",
      steps: open,
    },
    {
      name: 'filters',
      why: 'Space v d, Space v a, Space v r, Space v s and / each narrow or reorder the one table.',
      steps: filters,
    },
    {
      name: 'review',
      why: 'The review pane takes its keys, lists the commits since the item was written, and gives focus back to the table.',
      steps: review,
    },
    {
      name: 'chunks',
      why: 'x marks rows, c makes a chunk of them, the strip turns headless on and off and renames it, and Space v c hides the chunked rows.',
      steps: chunks,
    },
    {
      name: 'start refused',
      why: "s asks main to start the chunk and shows main's refusal for a repo with no folder.",
      steps: startRefused,
    },
    {
      name: 'unchunk',
      why: 'u takes the cursor row, or the marked rows, out of their chunks.',
      steps: unchunk,
    },
    {
      name: 'assistant',
      why: 'Space v b opens the assistant pane beside the table with the keys, Option+h gives them back, and Space v b hides it. No step asks or sweeps: each launches a session.',
      steps: assistant,
    },
  ];
}

// Each run rewrites the fixture repo, once the one before it is written, and
// tells the page to read the homes again. The result lists what was wrong
// with the fixture, empty when nothing was.
export function backlogSelfTestScript(
  deps: BacklogSelfTestDeps,
): SelfTestScript {
  let written: Promise<unknown> = deps.started;
  return {
    pageBinds: [],
    settings: {},
    // A table cell and a chunk card's name clip their text in their own box.
    scrollsItself: ['.backlog-cell', '.backlog-chunk-title'],
    open() {
      const fixture = written
        .catch(() => undefined)
        .then(() => writeBacklogFixture(deps, deps.homeDir));
      written = fixture;
      const result = fixture.then(
        () => {
          deps.reload();
          return [];
        },
        (error: unknown) => [`fixture not ready: ${errorText(error)}`],
      );
      return { shownLine: '[backlog] loaded 2 homes', result };
    },
    groups: backlogGroups(),
    problems: (result) => result as string[],
  };
}
