import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
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

function startBacklogPage() {
  installFakeDom(vi.stubGlobal);
  return startPagePart(backlogPagePart, {
    dependencies: [fakeDocs],
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
    invoke: async (method) => (method === 'load' ? READ : undefined),
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
});
