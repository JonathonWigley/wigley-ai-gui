import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { type DocsPageExports, docsPageKey } from '../../docs/contract';
import { type KeysPageExports, keysPageKey } from '../../keys/contract';
import { backlogPagePart } from './start';

const fakeDocs = fakeDependency(
  docsPageKey,
  () => ({ openDoc: () => undefined }) as unknown as DocsPageExports,
);

function startBacklogPage() {
  installFakeDom(vi.stubGlobal);
  const keys = fakeDependency(keysPageKey, (consumer): KeysPageExports => ({
    keysFor: () => null,
    onChanged: () => consumer.track({ dispose: () => undefined }),
    anchor: () => consumer.track({ dispose: () => undefined }),
  }));
  return startPagePart(backlogPagePart, {
    dependencies: [keys, fakeDocs],
    firstModeTaken: true,
  });
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
});
