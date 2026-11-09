import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { StatsFixtureVariant, StatsSnapshot } from '../contract';
import { statsFixture } from './stats-fixture';

// `seed` writes the variant's fixture to the slot and stops sampling for the run; `snapshot` reads the slot.
export interface SystemStatsSelfTestDeps {
  seed(variant: StatsFixtureVariant): StatsSnapshot;
  snapshot(): StatsSnapshot | null;
}

const line = (text: string) => `[system-stats] ${text}`;
const TOGGLE = [' ', 'v', 'y'];
const OTHER = 'Other (exited processes, system)';
const BY_CPU = `Google Chrome, WindowServer, Claude Code, ${OTHER}, Finder`;
const CHROME_OPENED =
  'opened Google Chrome: Google Chrome Helper (Renderer), Google Chrome';
const CLAUDE_OPENED = 'opened Claude Code: claude · fix login, claude';

// `open` seeds the `busy` fixture, so the panel draws fixed rows; the self-test starts with the panel hidden. The
// script runs after unity-pool's, so two Alt+l reach the right bar from a Chat tab with its hub.
export function systemStatsSelfTestScript(
  deps: SystemStatsSelfTestDeps,
): SelfTestScript {
  const groups: SelfTestGroup[] = [
    {
      name: 'toggle',
      why: 'The self-test starts with the panel hidden; Space v y shows it with the seeded rows by CPU, fitting the window, hides it, and shows it again.',
      steps: [
        {
          keys: TOGGLE,
          expect: line(`panel shown: ${BY_CPU}`),
          screenshot: 'panel',
          checksFit: true,
        },
        { keys: TOGGLE, expect: line('panel hidden'), screenshot: 'hidden' },
        { keys: TOGGLE, expect: line(`panel shown: ${BY_CPU}`) },
      ],
    },
    {
      name: 'cursor',
      why: 'Alt+l gives the panel the keys with the cursor on the first row; j, G, gg and k move it and stop at the ends.',
      steps: [
        {
          // Two presses, so the step holds with a pane between the Chat tab and the right bar.
          keys: ['<A-l>', '<A-l>'],
          expect: line('panel focused'),
          alsoExpect: [/^\[system-stats\] cursor on Google Chrome$/],
          screenshot: 'panel-cursor',
        },
        { keys: ['j'], expect: line('cursor on WindowServer') },
        { keys: ['G'], expect: line('cursor on Finder') },
        { keys: ['g', 'g'], expect: line('cursor on Google Chrome') },
        { keys: ['k'], expect: line('cursor on Google Chrome') },
      ],
    },
    {
      name: 'sort',
      why: 's cycles the sort through RAM, GPU and back to CPU, a missing RAM or GPU reading sorting last.',
      steps: [
        {
          keys: ['s'],
          expect: line(
            `sorted by ram: Finder, Google Chrome, Claude Code, WindowServer, ${OTHER}`,
          ),
          screenshot: 'sorted-ram',
        },
        {
          keys: ['s'],
          expect: line(
            `sorted by gpu: WindowServer, Google Chrome, Finder, Claude Code, ${OTHER}`,
          ),
        },
        { keys: ['s'], expect: line(`sorted by cpu: ${BY_CPU}`) },
      ],
    },
    {
      name: 'groups',
      why: 'Enter and l open the cursor’s group with its rows sorted under it, h closes it from a child or from the group, the Claude Code group opens to its Chat session row, which has no group of its own, a lone process and the Other row have no group, and Alt+h gives the keys back.',
      steps: [
        {
          keys: ['Enter'],
          expect: line(CHROME_OPENED),
          screenshot: 'group-open',
        },
        {
          keys: ['j'],
          expect: line('cursor on Google Chrome Helper (Renderer)'),
        },
        {
          keys: ['h'],
          expect: line('closed Google Chrome'),
          alsoExpect: [/^\[system-stats\] cursor on Google Chrome$/],
        },
        { keys: ['l'], expect: line(CHROME_OPENED) },
        { keys: ['h'], expect: line('closed Google Chrome') },
        { keys: ['j', 'j'], expect: line('cursor on Claude Code') },
        { keys: ['l'], expect: line(CLAUDE_OPENED) },
        { keys: ['j'], expect: line('cursor on claude · fix login') },
        { keys: ['l'], expect: line('no group: claude · fix login') },
        {
          keys: ['h'],
          expect: line('closed Claude Code'),
          alsoExpect: [/^\[system-stats\] cursor on Claude Code$/],
        },
        { keys: ['G'], expect: line('cursor on Finder') },
        { keys: ['l'], expect: line('no group: Finder') },
        { keys: ['k'], expect: line(`cursor on ${OTHER}`) },
        { keys: ['l'], expect: line(`no group: ${OTHER}`) },
        { keys: ['<A-h>'], expect: '[page] focus back in main' },
      ],
    },
    {
      name: 'hide-last',
      why: 'The panel ends hidden, so later scripts see the right bar as they did.',
      steps: [{ keys: TOGGLE, expect: line('panel hidden') }],
    },
  ];

  return {
    pageBinds: [],
    settings: {},
    scrollsItself: [],
    open() {
      deps.seed('busy');
      return {
        shownLine: line('seeded busy'),
        result: Promise.resolve(deps.snapshot()),
      };
    },
    groups,
    problems(result) {
      const expected = statsFixture('busy', 0).rows.map(({ id }) => id);
      const seeded = (result as StatsSnapshot | null)?.rows.map(({ id }) => id);
      return JSON.stringify(seeded) === JSON.stringify(expected)
        ? []
        : ['the busy seed did not reach the slot'];
    },
  };
}
