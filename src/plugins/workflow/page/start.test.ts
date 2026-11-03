import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Registrations } from '../../../contracts/disposable';
import { createRegistrations } from '../../../shared/registrations';
import {
  fakeDependency,
  type PartCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import { type ChatPageExports, chatPageKey } from '../../chat/contract';
import { type DocsPageExports, docsPageKey } from '../../docs/contract';
import { type KeysPageExports, keysPageKey } from '../../keys/contract';
import {
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import type { PageStage, WorkflowPageExports } from '../contract';
import { workflowPagePart } from './start';

const NONE_LIVE: PartCounts = {
  registrations: 0,
  timers: 0,
  listeners: 0,
  observers: 0,
  frames: 0,
};

const EXTRA_STAGE = {
  id: 'extra',
  label: 'Extra',
  inStepper: false,
  order: 70,
  actions: () => [],
} as unknown as PageStage;

const noHandle = (consumer: Registrations) => () =>
  consumer.track({ dispose: () => undefined });

// Workflow's page part over fakes that file each part they take under it, as
// sessions' and chat's views do.
function startWorkflow() {
  installFakeDom((name, value) => vi.stubGlobal(name, value));
  return startPagePart(workflowPagePart, {
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        (consumer) =>
          ({
            addRowPart: noHandle(consumer),
            addTab: noHandle(consumer),
            selectedSessionId: () => null,
          }) as unknown as SessionsPageExports,
      ),
      fakeDependency(
        chatPageKey,
        (consumer) =>
          ({
            addComposerPart: noHandle(consumer),
          }) as unknown as ChatPageExports,
      ),
      fakeDependency(
        docsPageKey,
        () => ({ openDoc: () => undefined }) as unknown as DocsPageExports,
      ),
      fakeDependency(
        keysPageKey,
        (consumer) =>
          ({
            anchor: noHandle(consumer),
            keysFor: () => null,
          }) as unknown as KeysPageExports,
      ),
    ],
    invoke: () => Promise.resolve([]),
  });
}

describe('workflow page part', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stop_LeavesNoLiveRegistration', async () => {
    const harness = startWorkflow();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(NONE_LIVE);
  });

  it('stopThenStart_StartsAgain', async () => {
    const harness = startWorkflow();

    await harness.restart();

    expect(Object.keys(harness.started().commands)).toContain('mainAction');
    await harness.stop();
    expect(harness.counts()).toEqual(NONE_LIVE);
  });

  it('exports_ConsumerDisposed_FreesTheStageId', () => {
    const harness = startWorkflow();
    const exportsFor = (consumer: Registrations) =>
      harness.started().exports?.(consumer) as WorkflowPageExports;
    const consumerA = createRegistrations();
    exportsFor(consumerA).addStage(EXTRA_STAGE);

    consumerA.dispose();

    expect(() =>
      exportsFor(createRegistrations()).addStage(EXTRA_STAGE),
    ).not.toThrow();
  });
});
