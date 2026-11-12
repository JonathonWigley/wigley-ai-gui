import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  countingEditors,
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { type DocsPageExports, docsPageKey } from '../../docs/contract';
import { type BacklogRead, backlogPlaceSlot } from '../contract';
import { backlogPagePart } from './start';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';

const fakeDocs = fakeDependency(
  docsPageKey,
  () => ({ openDoc: () => undefined }) as unknown as DocsPageExports,
);

const ROOT = '/home/repo/docs/features';

// One home holding two follow-ups.
const READ: BacklogRead = {
  homes: [
    {
      repo: 'repo',
      root: ROOT,
      isCreateTarget: true,
      gitRoot: null,
      uncommitted: false,
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
      plans: [],
      features: [],
    },
  ],
  message: null,
};

// A Backlog page over main's side `invoke`, by default one whose `load` reads
// `READ` at once, its editor boxes made by `editor` when given.
function startBacklogPage(
  invoke = async (method: string): Promise<unknown> =>
    method === 'load' ? READ : undefined,
  editor?: ReturnType<typeof countingEditors>['host'],
) {
  installFakeDom(vi.stubGlobal);
  return startPagePart(backlogPagePart, {
    dependencies: [fakeDocs],
    firstModeTaken: true,
    services: {
      ...(editor === undefined ? {} : { editor }),
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
  });

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startBacklogPage();
    expect(harness.counts().observers).toBe(1);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startBacklogPage();

    await harness.restart();

    expect(harness.started().commands).toHaveProperty('showMode');
  });

  it('reload_restores_the_open_home_and_selected_row', async () => {
    const harness = startBacklogPage();
    await settle();
    const commands = harness.started().commands;
    commands.openHomeRow({ arg: ROOT });
    commands.listDown({ arg: undefined });
    const logsBefore = harness.logs.length;

    await harness.restart();
    await settle();

    const place = harness.state.read(backlogPlaceSlot, 'test').get();
    expect(place).toMatchObject({
      openRoot: ROOT,
      selectedKey: `followup:${ROOT}/followups.md#Beta`,
    });
    const logs = harness.logs.slice(logsBefore).map((line) => line.message);
    expect(logs).toContain('selected Beta');
  });

  it('reload_ChangeBeforeTheFirstLoad_KeepsTheLastPagesPlace', async () => {
    let isLoadHeld = false;
    const harness = startBacklogPage(async (method) => {
      if (method !== 'load') {
        return undefined;
      }
      return isLoadHeld ? new Promise(() => undefined) : READ;
    });
    await settle();
    harness.started().commands.openHomeRow({ arg: ROOT });
    harness.started().commands.listDown({ arg: undefined });
    const placeSlot = harness.state.read(backlogPlaceSlot, 'test');
    const saved = placeSlot.get();
    isLoadHeld = true;

    await harness.restart();
    harness.started().commands.toggleAgentReadyOnly({ arg: undefined });
    await settle();

    expect(placeSlot.get()).toEqual(saved);
  });
  it.each([
    { case: 'nothing typed', opensEditor: false, text: null, expected: null },
    {
      case: 'editor open, unchanged',
      opensEditor: true,
      text: null,
      expected: null,
    },
    {
      case: 'typed and not kept',
      opensEditor: true,
      text: 'typed',
      expected: 'Save or close the follow-up you are editing first',
    },
  ])('mayStop_$case', async ({ opensEditor, text, expected }) => {
    const editors = countingEditors();
    const harness = startBacklogPage(undefined, editors.host);
    await settle();
    const commands = harness.started().commands;
    commands.openHomeRow({ arg: ROOT });

    if (opensEditor) {
      commands.edit({ arg: undefined });
      expect(editors.live()).toBeGreaterThan(0);
    }
    if (text !== null) {
      editors.type(text);
    }

    expect(harness.started().mayStop?.()).toBe(expected);
    await harness.stop();
  });
});
