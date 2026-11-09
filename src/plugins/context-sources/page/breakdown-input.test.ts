import { describe, expect, it } from 'vitest';
import type { ContextBreakdownAgentEvent } from '../../../contracts/agent';
import { breakdownInput, breakdownSummary } from './breakdown-input';

const EVENT: ContextBreakdownAgentEvent = {
  type: 'contextBreakdown',
  agentId: 'main',
  at: 0,
  totalTokens: 160_000,
  contextWindow: 1_000_000,
  autocompactAt: 967_000,
  deferredTokens: 23_000,
  sources: [
    {
      id: 'memory_files',
      label: 'Memory files',
      tokens: 120_000,
      items: [{ label: '/home/u/AGENTS.md', isPath: true, tokens: 120_000 }],
    },
    {
      id: 'tools',
      label: 'Tool results',
      tokens: 40_000,
      items: [{ label: 'Bash', isPath: false, tokens: 40_000 }],
    },
  ],
};

const READERS = {
  isOpen: (id: string) => id === 'tools',
  showsAll: false,
  showPath: (path: string) => path.replace('/home/u', '~'),
};

const NO_TOGGLES = { toggle: () => {}, toggleShowsAll: () => {} };

describe('breakdownSummary', () => {
  it.each([
    ['a known window', EVENT, '160k · 16%'],
    ['no window', { ...EVENT, contextWindow: null }, '160k'],
  ])('%s', (_case, event, summary) => {
    expect(breakdownSummary(event)).toBe(summary);
  });
});

describe('breakdownInput', () => {
  it('event_SharesOfContext_PathsShown_OpenRead', () => {
    const input = breakdownInput(EVENT, READERS, NO_TOGGLES);

    expect(input.sources).toEqual([
      {
        id: 'memory_files',
        label: 'Memory files',
        tokens: '120k',
        share: 0.75,
        shareText: '75%',
        position: 1,
        items: [{ label: '~/AGENTS.md', tokens: '120k' }],
        isOpen: false,
      },
      {
        id: 'tools',
        label: 'Tool results',
        tokens: '40k',
        share: 0.25,
        shareText: '25%',
        position: 2,
        items: [{ label: 'Bash', tokens: '40k' }],
        isOpen: true,
      },
    ]);
    expect(input.window).toEqual({
      share: 0.16,
      text: '160k of 1M',
      autocompactShare: 0.967,
      autocompactText: 'compacts at 967k',
    });
    expect(input.deferred).toBe('23k');
  });

  it.each([
    ['no window', { contextWindow: null }, 'window', null],
    [
      'no limit',
      { autocompactAt: null },
      'window',
      {
        share: 0.16,
        text: '160k of 1M',
        autocompactShare: null,
        autocompactText: null,
      },
    ],
    ['nothing deferred', { deferredTokens: 0 }, 'deferred', null],
  ] as const)('%s', (_case, change, field, expected) => {
    const input = breakdownInput({ ...EVENT, ...change }, READERS, NO_TOGGLES);

    expect(input[field]).toEqual(expected);
  });
});
