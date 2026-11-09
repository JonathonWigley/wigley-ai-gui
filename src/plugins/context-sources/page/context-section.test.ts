import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextBreakdownAgentEvent } from '../../../contracts/agent';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { BreakdownInput, Layout } from '../layouts/layout';
import { createContextSection } from './context-section';

const SESSION = 'row-1';

const BREAKDOWN: ContextBreakdownAgentEvent = {
  type: 'contextBreakdown',
  agentId: 'main',
  at: 0,
  totalTokens: 20_000,
  contextWindow: 100_000,
  autocompactAt: 90_000,
  deferredTokens: 0,
  sources: [
    {
      id: 'memory_files',
      label: 'Memory files',
      tokens: 15_000,
      items: [{ label: '/home/u/AGENTS.md', isPath: true, tokens: 15_000 }],
    },
    { id: 'system_prompt', label: 'System prompt', tokens: 5000, items: [] },
  ],
};

// A section over a breakdown the test sets (none for null), drawn by a layout that records each input; `nameOf` reads
// every session as `proj`.
function setUp(initial: ContextBreakdownAgentEvent | null = BREAKDOWN) {
  let current = initial ?? undefined;
  const logged: string[] = [];
  const inputs: BreakdownInput[] = [];
  const section = createContextSection({
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
      keys: recordingAnchors().keys,
      commands: {
        exists: () => true,
        argShape: () => undefined,
        run: () => undefined,
      },
      platform: 'macos',
      state: noLayoutState,
    },
    log: (message) => logged.push(message),
    nameOf: () => 'proj',
    breakdown: () => current,
    showPath: (path) => path.replace('/home/u', '~'),
  });
  const recording: Layout = {
    breakdown(parent, input, kit) {
      inputs.push(input);
      return { element: kit.el(parent, 'div', 'recorded-breakdown') };
    },
  };
  section.setLayouts(withUser<Layout>(defaultLayout, recording));
  const parent = new FakeElement('div');
  const summaries: (string | null)[] = [];
  const build = () =>
    section.part.build(asHtml(parent), SESSION, {
      setSummary: (text) => summaries.push(text),
    });
  const change = (next: ContextBreakdownAgentEvent) => {
    current = next;
    section.breakdownUpdated(SESSION);
  };
  const lastInput = () => inputs[inputs.length - 1];
  return { section, parent, summaries, logged, build, change, lastInput };
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createContextSection', () => {
  it('build_NoBreakdown_DrawsNothingAndClearsTheSummary', () => {
    const { parent, summaries, logged, build } = setUp(null);

    build();

    expect(findAll(parent, 'recorded-breakdown')).toEqual([]);
    expect(summaries).toEqual([null]);
    expect(logged).toEqual([]);
  });

  it('build_Breakdown_DrawsItWithItsSummary', () => {
    const { parent, summaries, logged, build, lastInput } = setUp();

    build();

    expect(findAll(parent, 'recorded-breakdown')).toHaveLength(1);
    expect(summaries).toEqual(['20k · 20%']);
    expect(logged).toEqual(['context in proj: 20k · 20%']);
    expect(lastInput()?.sources[0]?.items).toEqual([
      { label: '~/AGENTS.md', tokens: '15k' },
    ]);
  });

  it('toggle_OpensThenClosesTheSource', () => {
    const { build, lastInput } = setUp();
    build();

    lastInput()?.toggle('memory_files');
    const opened = lastInput()?.sources.map(({ isOpen }) => isOpen);
    lastInput()?.toggle('memory_files');
    const closed = lastInput()?.sources.map(({ isOpen }) => isOpen);

    expect(opened).toEqual([true, false]);
    expect(closed).toEqual([false, false]);
  });

  it('toggleShowsAll_FlipsShowsAllForTheSession', () => {
    const { build, lastInput } = setUp();
    build();

    const before = lastInput()?.showsAll;
    lastInput()?.toggleShowsAll();
    const after = lastInput()?.showsAll;

    expect([before, after]).toEqual([false, true]);
  });

  it.each<{
    case: string;
    count: number;
    expected: { rows: number; more: string | undefined }[];
  }>([
    {
      case: 'Five_AllListedAndNoMoreLine',
      count: 5,
      expected: [
        { rows: 5, more: undefined },
        { rows: 5, more: undefined },
      ],
    },
    {
      case: 'Six_FiveUntilTheMoreLineShowsAll',
      count: 6,
      expected: [
        { rows: 5, more: '+ 1 more' },
        { rows: 6, more: 'Show fewer' },
      ],
    },
    {
      case: 'Seven_FiveUntilTheMoreLineShowsAll',
      count: 7,
      expected: [
        { rows: 5, more: '+ 2 more' },
        { rows: 7, more: 'Show fewer' },
      ],
    },
  ])('defaultLayout_$case', ({ count, expected }) => {
    const breakdown: ContextBreakdownAgentEvent = {
      ...BREAKDOWN,
      sources: Array.from({ length: count }, (_, i) => ({
        id: `source-${i + 1}`,
        label: `Source ${i + 1}`,
        tokens: 1000,
        items: [],
      })),
    };
    const { section, parent, build } = setUp(breakdown);
    section.setLayouts(withUser<Layout>(defaultLayout, {}));
    build();
    const shown = () => ({
      rows: findAll(parent, 'context-sources-row').length,
      more: findAll(parent, 'context-sources-more')[0]?.textContent,
    });

    const first = shown();
    findAll(parent, 'context-sources-more')[0]?.click();
    const after = shown();

    expect([first, after]).toEqual(expected);
  });

  it('toggle_ThenANewBreakdown_KeepsTheSourceOpen', () => {
    const { build, change, lastInput } = setUp();
    build();
    lastInput()?.toggle('memory_files');

    change({ ...BREAKDOWN, totalTokens: 21_000 });

    expect(lastInput()?.sources[0]?.isOpen).toBe(true);
  });

  it('forget_ClosesTheSessionsSourcesAndLogsAgain', () => {
    const { section, logged, build, lastInput } = setUp();
    build();
    lastInput()?.toggle('memory_files');

    section.forget(SESSION);
    build();

    expect(lastInput()?.sources[0]?.isOpen).toBe(false);
    expect(logged).toEqual([
      'context in proj: 20k · 20%',
      'context in proj: 20k · 20%',
    ]);
  });

  it('breakdownUpdated_SameSummary_LogsOnce', () => {
    const { logged, build, change } = setUp();
    build();

    change({ ...BREAKDOWN, at: 5 });

    expect(logged).toEqual(['context in proj: 20k · 20%']);
  });
});
