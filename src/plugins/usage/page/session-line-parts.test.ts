import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageAgentEvent } from '../../../contracts/agent';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { UsageSnapshot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import { createUsageParts } from './layout/usage-parts';
import { createSessionLineParts } from './session-line-parts';
import {
  createSessionLines,
  type SessionLines,
  sessionLineKind,
} from './session-lines';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

const NOW = 50_000_000;
const MINUTE = 60_000;
const LINE_TEXT =
  'session line in s1: context 180k/300k, cache 42m, spend $1.23';

const USAGE: UsageAgentEvent = {
  type: 'usage',
  agentId: 'main',
  at: NOW,
  contextTokens: 180_000,
  contextWindow: 1_000_000,
  autocompact: { configured: 300_000, reported: null },
  cacheExpiresAt: NOW + 42 * MINUTE,
  spendUsd: 1.234,
};

const SNAPSHOT: UsageSnapshot = {
  plans: [],
  sessions: [
    { sessionId: 's1', profileDir: null, usage: USAGE, compaction: null },
  ],
};

// Two instances, `a` and `b`, over the default layout and one `latest`
// (`shown` at NOW, null until `show`), added to one parts set; `logged` holds
// each instance's own log.
function setUp() {
  const parts = createUsageParts({
    defaultLayout,
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
      keys: recordingAnchors().keys,
      commands: { exists: () => true, run: () => undefined },
      platform: 'macos',
      state: noLayoutState,
    },
    log: () => undefined,
  });
  let shown: UsageSnapshot | null = null;
  const logged: Record<'a' | 'b', string[]> = { a: [], b: [] };
  const lineParts = createSessionLineParts();
  const instances = (['a', 'b'] as const).map((id): SessionLines => {
    const lines = createSessionLines({
      id,
      line: sessionLineKind(parts),
      log: (line) => logged[id].push(line),
      nameOf: (sessionId) => sessionId,
      latest: () => (shown === null ? null : { snapshot: shown, now: NOW }),
    });
    lineParts.add(lines);
    return lines;
  });
  const buildEach = () => {
    for (const lines of instances) {
      lines.part.build(asHtml(new FakeElement('div')), 's1');
    }
  };
  const show = (snapshot: UsageSnapshot) => {
    shown = snapshot;
  };
  return { lineParts, logged, buildEach, show };
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session line parts', () => {
  it.each([
    {
      case: 'Redraw_RedrawsEveryInstanceAndEachLogsOnce',
      act: ({ lineParts, buildEach, show }: ReturnType<typeof setUp>) => {
        buildEach();
        show(SNAPSHOT);
        lineParts.redraw();
        lineParts.redraw();
      },
      expected: [LINE_TEXT],
    },
    {
      case: 'Forget_ForgetsInEveryInstanceSoTheNextDrawLogsAgain',
      act: ({ lineParts, buildEach, show }: ReturnType<typeof setUp>) => {
        show(SNAPSHOT);
        buildEach();
        lineParts.forget('s1');
        buildEach();
      },
      expected: [LINE_TEXT, LINE_TEXT],
    },
  ])('parts_$case', ({ act, expected }) => {
    const setup = setUp();

    act(setup);

    expect(setup.logged).toEqual({ a: expected, b: expected });
  });

  it('add_Disposed_RedrawAndForgetSkipIt', () => {
    const lineSet = () => ({
      part: { id: 'set', build: () => ({ dispose: () => undefined }) },
      redraw: vi.fn(),
      forget: vi.fn(),
    });
    const first = lineSet();
    const second = lineSet();
    const lineParts = createSessionLineParts();
    const firstHandle = lineParts.add(first);
    lineParts.add(second);

    firstHandle.dispose();
    firstHandle.dispose();
    lineParts.redraw();
    lineParts.forget('s1');

    expect(first.redraw).toHaveBeenCalledTimes(0);
    expect(first.forget).toHaveBeenCalledTimes(0);
    expect(second.redraw).toHaveBeenCalledTimes(1);
    expect(second.forget).toHaveBeenCalledTimes(1);
  });
});
