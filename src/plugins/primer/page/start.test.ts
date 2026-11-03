import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorHost } from '../../../contracts/editor';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { PageCommandContext, PagePart } from '../../../contracts/plugin';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import { startPagePart } from '../../../shared/plugin-part-harness.test-support';
import { keysPagePart } from '../../keys/page/start';
import { sessionsPagePart } from '../../sessions/page/start';
import type { PresentedPrimer } from '../contract';
import { primerPagePart } from './start';
import { presentedPrimer } from './test-primers';

// Lets a settled read's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((settled, failed) => {
    resolve = settled;
    reject = failed;
  });
  return { promise, resolve, reject };
}

const MARKDOWN: MarkdownRenderer = {
  block: (text) => text,
  inline: (text) => text,
  document: async (text) => text,
  ...NO_FENCES,
};

// An editor host that counts the editors it holds live and every one it made;
// `type` edits the last one made.
function countingEditors() {
  let live = 0;
  let made = 0;
  let type: (text: string) => void = () => undefined;
  const host: EditorHost = {
    create(_parent, doc, events) {
      live += 1;
      made += 1;
      type = (text) => events.changed(text);
      return {
        text: () => doc,
        setText() {},
        insert() {},
        charBeforeCursor: () => '',
        focus() {},
        blur() {},
        destroy() {
          live -= 1;
        },
      };
    },
    createDocument() {
      throw new Error('not used by primer');
    },
    contains: () => false,
    typeInto() {},
    onPendingKeys: () => ({ dispose() {} }),
    cancelPendingKeys() {},
    setKeymap() {},
  };
  return {
    host,
    live: () => live,
    made: () => made,
    type: (text: string) => type(text),
  };
}

// A part started first, so stopped last, which hears `primer.primerShown`. Its
// `dispose` holds its stop until `release`, so its listener outlives the primer
// part's stop, where a late read would emit.
function primerShownProbe() {
  const heard: unknown[] = [];
  const held = deferred<void>();
  const part: PagePart = {
    manifest: {
      id: 'probe',
      dependsOn: { main: [], page: [] },
      commands: {},
      scopes: {},
      settings: {},
      settingInfo: {},
      themeTokens: {},
    },
    start(api) {
      (api.events as unknown as { on: typeof api.events.on }).on(
        'primer.primerShown' as never,
        (data: unknown) => heard.push(data),
      );
      return { commands: {}, dispose: () => held.promise };
    },
  };
  return { part, heard, release: () => held.resolve() };
}

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
      services: { editor: editors.host, markdown: MARKDOWN },
    });
    harness.send('formShown', presentedPrimer('p1'));
    expect(editors.live()).toBeGreaterThan(0);

    await harness.stop();
    expect(harness.counts()).toEqual({
      registrations: 0,
      timers: 0,
      listeners: 0,
      observers: 0,
      frames: 0,
    });
    expect(editors.live()).toBe(0);

    await harness.restart();
    await harness.stop();
  });

  it('an open-primers read that lands after stop shows nothing', async () => {
    const read = deferred<PresentedPrimer[]>();
    const probe = primerShownProbe();
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [probe.part, sessionsPagePart, keysPagePart],
      invoke: () => read.promise,
      services: { editor: editors.host, markdown: MARKDOWN },
    });

    const stopping = harness.stop();
    await settle();
    read.resolve([presentedPrimer('p1')]);
    await settle();

    expect(probe.heard).toEqual([]);
    expect(editors.live()).toBe(0);
    probe.release();
    await stopping;
  });

  it('a draft reply that lands after stop dispatches and draws nothing', async () => {
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
      services: { editor: editors.host, markdown: MARKDOWN },
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
    expect(editors.live()).toBe(0);
    expect(harness.logs).toHaveLength(logged);
  });

  it('a finish that rejects after stop draws nothing', async () => {
    const finishing = deferred<void>();
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [sessionsPagePart, keysPagePart],
      invoke: (method) =>
        method === 'finish' ? finishing.promise : new Promise(() => undefined),
      services: { editor: editors.host, markdown: MARKDOWN },
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
    expect(editors.live()).toBe(0);
  });

  it('an open-primers read that lands before stop shows its primer', async () => {
    const probe = primerShownProbe();
    probe.release();
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [probe.part, sessionsPagePart, keysPagePart],
      invoke: async () => [presentedPrimer('p1')],
      services: { editor: editors.host, markdown: MARKDOWN },
    });

    await settle();

    expect(probe.heard).toHaveLength(1);
    expect(editors.live()).toBeGreaterThan(0);
    await harness.stop();
  });
});
