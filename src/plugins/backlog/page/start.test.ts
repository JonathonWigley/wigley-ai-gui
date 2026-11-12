import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFocusFakeDom } from '../../../shared/page/test-dom';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { type DocsPageExports, docsPageKey } from '../../docs/contract';
import {
  type AgentPane,
  scopedAgentsPageKey,
} from '../../scoped-agents/contract';
import { type BacklogRead, backlogPlaceSlot } from '../contract';
import { rowKey } from '../row-key';
import { backlogPagePart } from './start';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';

const fakeDocs = fakeDependency(
  docsPageKey,
  () => ({ openDoc: () => undefined }) as unknown as DocsPageExports,
);

// Every call Backlog made on the assistant's pane, across restarts.
const paneCalls: string[] = [];

// The assistant's pane: hidden until toggled, its outer panes taking no move.
const fakeScopedAgents = fakeDependency(scopedAgentsPageKey, () => ({
  addAgentPane(): AgentPane {
    let isPaneShown = false;
    return {
      element: document.createElement('div'),
      isShown: () => isPaneShown,
      toggle() {
        paneCalls.push('toggle');
        isPaneShown = !isPaneShown;
      },
      scopeOpened: () => undefined,
      refresh: () => undefined,
      hostTookKeys: () => undefined,
      modeHidden() {
        paneCalls.push('modeHidden');
      },
      outerPanes: {
        focus: { move: () => false },
        resize: { nudge: () => false },
      },
      redraw: () => undefined,
      dispose: () => undefined,
    };
  },
}));

const ROOT = '/home/repo/docs/features';

// One home holding two follow-ups.
const READ: BacklogRead = {
  homes: [
    {
      repo: 'repo',
      root: ROOT,
      isCreateTarget: true,
      gitRoot: null,
      repoFolder: null,
      followupFiles: [
        {
          path: `${ROOT}/followups.md`,
          items: ['Alpha', 'Beta'].map((title) => ({
            title,
            oneLine: title,
            tags: [],
            body: '',
            line: 1,
            endLine: 1,
            done: false,
          })),
        },
      ],
    },
  ],
  message: null,
};

// Main's answers: `load` reads `READ`, `staleness` none, `chunks` none.
async function answer(method: string): Promise<unknown> {
  switch (method) {
    case 'load':
      return READ;
    case 'staleness':
      return {};
    case 'chunks':
      return [];
    default:
      return undefined;
  }
}

// A Backlog page over main's side `invoke`, by default `answer`.
function startBacklogPage(invoke = answer) {
  installFocusFakeDom(vi.stubGlobal);
  return startPagePart(backlogPagePart, {
    dependencies: [fakeDocs, fakeScopedAgents],
    firstModeTaken: true,
    services: {
      picker: fakeListPickerService(),
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
    },
    invoke,
  });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('backlog page part lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    paneCalls.length = 0;
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startBacklogPage();
    expect(harness.counts().observers).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startBacklogPage();

    await harness.restart();

    expect(harness.started().commands).toHaveProperty('showMode');
  });

  it('reload_RestoresFiltersMarksAndSelectedRow', async () => {
    const harness = startBacklogPage();
    await settle();
    const commands = harness.started().commands;
    commands.listDown({ arg: undefined });
    commands.mark({ arg: undefined });
    commands.toggleDone({ arg: undefined });
    commands.toggleStaleFirst({ arg: undefined });
    const logsBefore = harness.logs.length;

    await harness.restart();
    await settle();

    const beta = rowKey('repo', 'Beta');
    expect(harness.state.read(backlogPlaceSlot, 'test').get()).toEqual({
      selectedKey: beta,
      repo: null,
      filter: '',
      marked: [beta],
      isReadyOnly: false,
      isChunkedHidden: false,
      isStaleFirst: true,
      isDoneShown: true,
      isAssistantShown: false,
    });
    const logs = harness.logs.slice(logsBefore).map((line) => line.message);
    expect(logs).toContain('selected Beta');
  });

  it('reload_ChangeBeforeTheFirstLoad_KeepsTheLastPagesPlace', async () => {
    let isLoadHeld = false;
    const harness = startBacklogPage(async (method) =>
      method === 'load' && isLoadHeld
        ? new Promise(() => undefined)
        : answer(method),
    );
    await settle();
    harness.started().commands.listDown({ arg: undefined });
    const placeSlot = harness.state.read(backlogPlaceSlot, 'test');
    const saved = placeSlot.get();
    isLoadHeld = true;

    await harness.restart();
    harness.started().commands.toggleAgentReadyOnly({ arg: undefined });
    await settle();

    expect(placeSlot.get()).toEqual(saved);
  });

  it('showMode_WhileShown_DoesNothing', async () => {
    const harness = startBacklogPage();
    await settle();
    const commands = harness.started().commands;
    commands.showMode({ arg: undefined });
    await settle();

    commands.showMode({ arg: undefined });
    await settle();

    const messages = harness.logs.map((line) => line.message);
    expect(messages.filter((message) => message === 'shown')).toHaveLength(1);
    expect(paneCalls).not.toContain('modeHidden');
  });
});
