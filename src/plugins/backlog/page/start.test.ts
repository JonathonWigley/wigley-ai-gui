import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  fakeDependency,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { type DocsPageExports, docsPageKey } from '../../docs/contract';
import { backlogPagePart } from './start';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';

const fakeDocs = fakeDependency(
  docsPageKey,
  () => ({ openDoc: () => undefined }) as unknown as DocsPageExports,
);

function startBacklogPage() {
  installFakeDom(vi.stubGlobal);
  return startPagePart(backlogPagePart, {
    dependencies: [fakeDocs],
    firstModeTaken: true,
    services: { picker: fakeListPickerService() },
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
