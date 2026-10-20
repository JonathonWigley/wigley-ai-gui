import { describe, expect, it, vi } from 'vitest';
import type { LayoutChoice } from '../../contracts/layouts';
import {
  createLayoutLoader,
  type LayoutLoader,
  layoutUrls,
  showLayouts,
} from './layout-loader';

interface TestLayout {
  tag: string;
}

function readTestLayout(module: unknown): TestLayout {
  return (module as { default: TestLayout }).default;
}

function choice(hasCss: boolean): LayoutChoice {
  return {
    name: 'mine',
    revision: 4,
    hasCss,
    builtIn: false,
    reason: 'cycled',
  };
}

function recordingDataUrl() {
  const calls: [string, number][] = [];
  const dataUrl = (path: string, revision: number) => {
    calls.push([path, revision]);
    return `url:${path}@${revision}`;
  };
  return { calls, dataUrl };
}

describe('layoutUrls', () => {
  it('layoutUrls_WithCss_BuildsBothWithRevision', () => {
    const { calls, dataUrl } = recordingDataUrl();

    const urls = layoutUrls(choice(true), dataUrl);

    expect(calls).toEqual([
      ['layouts/mine/layout.js', 4],
      ['layouts/mine/layout.css', 4],
    ]);
    expect(urls).toEqual({
      script: 'url:layouts/mine/layout.js@4',
      style: 'url:layouts/mine/layout.css@4',
    });
  });

  it('layoutUrls_WithoutCss_StyleNull', () => {
    const { dataUrl } = recordingDataUrl();

    expect(layoutUrls(choice(false), dataUrl)).toEqual({
      script: 'url:layouts/mine/layout.js@4',
      style: null,
    });
  });
});

function userLayout(): TestLayout {
  return { tag: 'mine' };
}

interface FakeLink {
  rel: string;
  href: string;
  removed: boolean;
  remove(): void;
}

// A `head` recording the links appended to it; each link records its removal.
function fakeHead() {
  const appended: FakeLink[] = [];
  const head = {
    ownerDocument: {
      createElement: (): FakeLink => ({
        rel: '',
        href: '',
        removed: false,
        remove() {
          this.removed = true;
        },
      }),
    },
    append: (link: FakeLink) => appended.push(link),
  };
  return { head: head as unknown as HTMLElement, appended };
}

function loaderWith(
  importModule: (url: string) => Promise<unknown>,
  read: (module: unknown, name: string) => TestLayout = readTestLayout,
) {
  const { head, appended } = fakeHead();
  const loader = createLayoutLoader<TestLayout>({
    importModule,
    dataUrl: (path, revision) => `url:${path}@${revision}`,
    defaultLayout: { tag: 'built-in' },
    head,
    read,
  });
  return { loader, appended };
}

describe('createLayoutLoader', () => {
  it('load_WithCss_AddsStylesheetOnlyAfterScriptLoads', async () => {
    const script = Promise.withResolvers<unknown>();
    const { loader, appended } = loaderWith(() => script.promise);

    const loading = loader.load(choice(true));
    await Promise.resolve();
    expect(appended).toEqual([]);
    script.resolve({ default: userLayout() });
    await loading;

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      rel: 'stylesheet',
      href: 'url:layouts/mine/layout.css@4',
    });
  });

  it('load_ScriptFails_KeepsLastStylesheet', async () => {
    let fail = false;
    const { loader, appended } = loaderWith(async () => {
      if (fail) {
        throw new Error('syntax');
      }
      return { default: userLayout() };
    });
    await loader.load(choice(true));

    fail = true;
    await expect(loader.load({ ...choice(true), revision: 5 })).rejects.toThrow(
      'syntax',
    );

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      href: 'url:layouts/mine/layout.css@4',
      removed: false,
    });
  });

  it('load_BuiltIn_RemovesStylesheet', async () => {
    const { loader, appended } = loaderWith(async () => ({
      default: userLayout(),
    }));
    await loader.load(choice(true));

    await loader.load({ ...choice(false), name: 'default', builtIn: true });

    expect(appended[0]).toMatchObject({ removed: true });
  });

  it('load_UserLayout_HandsReadTheModuleAndName', async () => {
    const reads: [unknown, string][] = [];
    const { loader } = loaderWith(
      async () => ({ default: { tag: 'mine' } }),
      (module, name) => {
        reads.push([module, name]);
        return { tag: 'read' };
      },
    );

    const loaded = await loader.load(choice(false));

    expect(reads).toEqual([[{ default: { tag: 'mine' } }, 'mine']]);
    expect(loaded).toEqual({ tag: 'read' });
  });

  it('load_ReadThrows_RejectsAndKeepsStylesheet', async () => {
    let fail = false;
    const { loader, appended } = loaderWith(
      async () => ({ default: userLayout() }),
      (module) => {
        if (fail) {
          throw new Error('layout mine: cards.notice is missing');
        }
        return readTestLayout(module);
      },
    );
    await loader.load(choice(true));

    fail = true;
    await expect(loader.load({ ...choice(true), revision: 5 })).rejects.toThrow(
      'layout mine: cards.notice is missing',
    );

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      href: 'url:layouts/mine/layout.css@4',
      removed: false,
    });
  });
});

// A loader whose every load waits for `finish(name)` or `fail(name)`.
function heldLoader() {
  const pending = new Map<string, PromiseWithResolvers<TestLayout>>();
  const loader: LayoutLoader<TestLayout> = {
    load: (layoutChoice) => {
      const held = Promise.withResolvers<TestLayout>();
      pending.set(layoutChoice.name, held);
      return held.promise;
    },
  };
  return {
    loader,
    finish: (name: string) => pending.get(name)?.resolve(userLayout()),
    fail: (name: string) => pending.get(name)?.reject(new Error('broken')),
    isLoading: (name: string) => pending.has(name),
  };
}

function showing(
  loader: LayoutLoader<TestLayout>,
  setLayout: (layout: TestLayout, name: string) => void = () => undefined,
) {
  const answer = Promise.withResolvers<LayoutChoice>();
  let listener: (changed: LayoutChoice) => void = () => undefined;
  const shown: string[] = [];
  const logLines: string[] = [];
  const toasts: string[] = [];
  showLayouts({
    channel: {
      onLayoutChanged: (heard) => {
        listener = heard;
      },
      readLayout: () => answer.promise,
    },
    loader,
    setLayout: (layout, name) => {
      setLayout(layout, name);
      shown.push(name);
    },
    log: (source, message) => logLines.push(`[${source}] ${message}`),
    logSource: 'demo',
    dataFolderLabel: "demo's data folder",
    toast: (text, tone) => toasts.push(`${tone}: ${text}`),
  });
  return {
    answer,
    change: (changed: LayoutChoice) => listener(changed),
    shown,
    logLines,
    toasts,
  };
}

function named(name: string, reason: LayoutChoice['reason']): LayoutChoice {
  return { name, revision: 2, hasCss: false, builtIn: false, reason };
}

describe('showLayouts', () => {
  it('showLayouts_Changes_ShownOneAtATimeInArrivalOrder', async () => {
    const held = heldLoader();
    const page = showing(held.loader);

    page.change(named('first', 'cycled'));
    page.change(named('second', 'reloaded'));
    await vi.waitFor(() => expect(held.isLoading('first')).toBe(true));
    expect(held.isLoading('second')).toBe(false);
    held.finish('first');
    await vi.waitFor(() => expect(held.isLoading('second')).toBe(true));
    held.finish('second');

    await vi.waitFor(() => expect(page.shown).toEqual(['first', 'second']));
    expect(page.logLines).toEqual([
      '[demo] layout first shown (cycled, revision 2)',
      '[demo] layout second shown (reloaded, revision 2)',
    ]);
    expect(page.toasts).toEqual(['info: Layout: first']);
  });

  it('showLayouts_ChangeHeardBeforeAnswer_DropsAnswer', async () => {
    const held = heldLoader();
    const page = showing(held.loader);

    page.change(named('changed', 'cycled'));
    page.answer.resolve(named('stale', 'start'));
    await vi.waitFor(() => expect(held.isLoading('changed')).toBe(true));
    held.finish('changed');

    await vi.waitFor(() => expect(page.shown).toEqual(['changed']));
    expect(held.isLoading('stale')).toBe(false);
  });

  it('showLayouts_LoadFails_LogsAndToasts', async () => {
    const held = heldLoader();
    const page = showing(held.loader);

    page.change(named('mine', 'reloaded'));
    await vi.waitFor(() => expect(held.isLoading('mine')).toBe(true));
    held.fail('mine');

    await vi.waitFor(() =>
      expect(page.logLines).toEqual(['[demo] layout mine failed: broken']),
    );
    expect(page.toasts).toEqual(['error: Layout mine failed: broken']);
    expect(page.shown).toEqual([]);
  });

  it('showLayouts_SetLayoutThrows_LaterChangesStillShown', async () => {
    const held = heldLoader();
    const page = showing(held.loader, (_layout, name) => {
      if (name === 'first') {
        throw new Error('rebuild failed');
      }
    });

    page.change(named('first', 'cycled'));
    page.change(named('second', 'cycled'));
    await vi.waitFor(() => expect(held.isLoading('first')).toBe(true));
    held.finish('first');
    await vi.waitFor(() => expect(held.isLoading('second')).toBe(true));
    held.finish('second');

    await vi.waitFor(() => expect(page.shown).toEqual(['second']));
    expect(page.logLines).toContain(
      '[demo] layout first not shown: rebuild failed',
    );
  });

  it('showLayouts_AnswerRejects_LogsNotRead', async () => {
    const page = showing(heldLoader().loader);

    page.answer.reject(new Error('not started'));

    await vi.waitFor(() =>
      expect(page.logLines).toEqual(['[demo] layout not read: not started']),
    );
  });

  it('showLayouts_Copied_ToastsTheDataFolderLabel', async () => {
    const held = heldLoader();
    const page = showing(held.loader);

    page.change(named('mine-2', 'copied'));
    await vi.waitFor(() => expect(held.isLoading('mine-2')).toBe(true));
    held.finish('mine-2');

    await vi.waitFor(() =>
      expect(page.toasts).toEqual([
        "success: Layout copied to layouts/mine-2 in demo's data folder",
      ]),
    );
  });
});
