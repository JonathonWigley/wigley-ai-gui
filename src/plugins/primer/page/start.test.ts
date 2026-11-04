import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageCommandContext } from '../../../contracts/plugin';
import { PLAIN_MARKDOWN } from '../../../shared/page/markdown-mount.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  countingEditors,
  dataEmitted,
  deferred,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { keysPagePart } from '../../keys/page/start';
import { sessionsPagePart } from '../../sessions/page/start';
import type { PresentedPrimer } from '../contract';
import { primerPagePart } from './start';
import { presentedPrimer } from './test-primers';

// Lets a settled read's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('primer page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops with nothing live and starts again', async () => {
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [sessionsPagePart, keysPagePart],
      services: { editor: editors.host, markdown: PLAIN_MARKDOWN },
    });
    harness.send('formShown', presentedPrimer('p1'));
    expect(editors.live()).toBeGreaterThan(0);

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    await harness.restart();
    await harness.stop();
  });

  it('an open-primers read that lands after stop shows nothing', async () => {
    const read = deferred<PresentedPrimer[]>();
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [sessionsPagePart, keysPagePart],
      invoke: () => read.promise,
      services: { editor: editors.host, markdown: PLAIN_MARKDOWN },
    });

    await harness.stop();
    read.resolve([presentedPrimer('p1')]);
    await settle();

    expect(dataEmitted(harness, 'primer.primerShown')).toEqual([]);
  });

  it('a draft reply that lands after stop draws nothing', async () => {
    const saved = deferred<void>();
    const drafts: unknown[] = [];
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [sessionsPagePart, keysPagePart],
      invoke: (method, ...args) => {
        if (method === 'draft') {
          drafts.push(args);
          return saved.promise;
        }
        return new Promise(() => undefined);
      },
      services: { editor: editors.host, markdown: PLAIN_MARKDOWN },
    });
    harness.send('formShown', presentedPrimer('p1'));
    editors.type('typed');
    harness.advance(primerPagePart.manifest.settings.autosaveDelayMs);
    expect(drafts).toHaveLength(1);

    await harness.stop();
    const made = editors.made();
    const logged = harness.logs.length;
    saved.resolve();
    await settle();

    expect(editors.made()).toBe(made);
    expect(harness.logs).toHaveLength(logged);
  });

  it('a finish that rejects after stop draws nothing', async () => {
    const finishing = deferred<void>();
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [sessionsPagePart, keysPagePart],
      invoke: (method) =>
        method === 'finish' ? finishing.promise : new Promise(() => undefined),
      services: { editor: editors.host, markdown: PLAIN_MARKDOWN },
    });
    const primer = presentedPrimer('p1');
    harness.send('formShown', primer);
    harness.emit('sessions.activeChanged', { sessionId: primer.sessionId });
    const { commands } = harness.started();
    commands.openReview({} as PageCommandContext);
    commands.askCancel({} as PageCommandContext);
    commands.confirmCancel({} as PageCommandContext);

    await harness.stop();
    const made = editors.made();
    finishing.reject(new Error('main is gone'));
    await settle();

    expect(harness.logs.map((line) => line.message)).toContainEqual(
      expect.stringContaining('not finished'),
    );
    expect(editors.made()).toBe(made);
  });

  it('an open-primers read that lands before stop shows its primer', async () => {
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [sessionsPagePart, keysPagePart],
      invoke: async () => [presentedPrimer('p1')],
      services: { editor: editors.host, markdown: PLAIN_MARKDOWN },
    });

    await settle();

    expect(dataEmitted(harness, 'primer.primerShown')).toHaveLength(1);
    expect(editors.live()).toBeGreaterThan(0);
    await harness.stop();
  });
});
