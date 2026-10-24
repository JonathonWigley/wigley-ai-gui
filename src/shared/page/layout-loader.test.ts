import { describe, expect, it, vi } from 'vitest';
import type { LayoutEntry, LayoutSet } from '../../contracts/layouts';
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

function choice(hasCss: boolean): LayoutEntry {
  return { name: 'mine', revision: 4, hasCss, builtIn: false };
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

// A loader whose every load waits for `finish(key)` or `fail(key)`, each
// load keyed `<name>@<revision>`; `loads` lists every key in load order.
function heldLoader() {
  const pending = new Map<string, PromiseWithResolvers<TestLayout>>();
  const loads: string[] = [];
  const loader: LayoutLoader<TestLayout> = {
    load: (entry) => {
      const key = `${entry.name}@${entry.revision}`;
      const held = Promise.withResolvers<TestLayout>();
      pending.set(key, held);
      loads.push(key);
      return held.promise;
    },
  };
  return {
    loader,
    loads,
    finish: (key: string) => pending.get(key)?.resolve(userLayout()),
    fail: (key: string) => pending.get(key)?.reject(new Error('broken')),
    isLoading: (key: string) => pending.has(key),
  };
}

function showing(
  loader: LayoutLoader<TestLayout>,
  chosen: string,
  setLayout: (layout: TestLayout, name: string) => void = () => undefined,
) {
  const answer = Promise.withResolvers<LayoutSet>();
  let listener: (changed: LayoutSet) => void = () => undefined;
  let chosenListener: () => void = () => undefined;
  let chosenName = chosen;
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
    chosen: () => chosenName,
    onChosenChanged: (heard) => {
      chosenListener = heard;
    },
    setLayout: (layout, name) => {
      setLayout(layout, name);
      shown.push(name);
    },
    log: (source, message) => logLines.push(`[${source}] ${message}`),
    logSource: 'demo',
    toast: (text, tone) => toasts.push(`${tone}: ${text}`),
  });
  return {
    answer,
    change: (changed: LayoutSet) => listener(changed),
    choose: (name: string) => {
      chosenName = name;
      chosenListener();
    },
    shown,
    logLines,
    toasts,
  };
}

function entry(name: string, revision: number): LayoutEntry {
  return { name, revision, hasCss: false, builtIn: false };
}

// A set holding the built-in `default` and `users`.
function setOf(changed: string | null, ...users: LayoutEntry[]): LayoutSet {
  return {
    layouts: [
      { name: 'default', revision: 1, hasCss: false, builtIn: true },
      ...users,
    ],
    changed,
  };
}

describe('showLayouts', () => {
  it('showLayouts_AnswerSet_ShowsTheChosenLayout', async () => {
    const held = heldLoader();
    const page = showing(held.loader, 'mine');

    page.answer.resolve(setOf(null, entry('mine', 3)));
    await vi.waitFor(() => expect(held.isLoading('mine@3')).toBe(true));
    held.finish('mine@3');

    await vi.waitFor(() => expect(page.shown).toEqual(['mine']));
    expect(page.logLines).toEqual(['[demo] layout mine shown (revision 3)']);
  });

  it('showLayouts_ChosenMissing_ShowsDefaultAndLogs', async () => {
    const held = heldLoader();
    const page = showing(held.loader, 'gone');

    page.answer.resolve(setOf(null, entry('mine', 3)));
    await vi.waitFor(() => expect(held.isLoading('default@1')).toBe(true));
    held.finish('default@1');
    await vi.waitFor(() => expect(page.shown).toEqual(['default']));
    page.change(setOf('mine', entry('mine', 4)));

    const missing = page.logLines.filter(
      (line) => line === '[demo] layout gone not found, drawing default',
    );
    expect(missing).toHaveLength(1);
    expect(held.loads).toEqual(['default@1']);
  });

  it('showLayouts_ChangeToAnotherLayout_LoadsNothing', async () => {
    const held = heldLoader();
    const page = showing(held.loader, 'mine');
    page.answer.resolve(setOf(null, entry('mine', 3), entry('other', 1)));
    await vi.waitFor(() => expect(held.isLoading('mine@3')).toBe(true));
    held.finish('mine@3');
    await vi.waitFor(() => expect(page.shown).toEqual(['mine']));

    page.change(setOf('other', entry('mine', 3), entry('other', 2)));
    page.change(setOf('mine', entry('mine', 4), entry('other', 2)));
    await vi.waitFor(() => expect(held.isLoading('mine@4')).toBe(true));

    expect(held.loads).toEqual(['mine@3', 'mine@4']);
  });

  it('showLayouts_ChosenLayoutReloaded_LoadsItAgain', async () => {
    const held = heldLoader();
    const page = showing(held.loader, 'mine');
    page.answer.resolve(setOf(null, entry('mine', 3)));
    await vi.waitFor(() => expect(held.isLoading('mine@3')).toBe(true));
    held.finish('mine@3');

    page.change(setOf('mine', entry('mine', 4)));
    await vi.waitFor(() => expect(held.isLoading('mine@4')).toBe(true));
    held.finish('mine@4');

    await vi.waitFor(() => expect(page.shown).toEqual(['mine', 'mine']));
    expect(page.logLines).toContain('[demo] layout mine shown (revision 4)');
  });

  it('showLayouts_SettingChanged_LoadsTheNewChoice', async () => {
    const held = heldLoader();
    const page = showing(held.loader, 'mine');
    page.answer.resolve(setOf(null, entry('mine', 3), entry('other', 2)));
    await vi.waitFor(() => expect(held.isLoading('mine@3')).toBe(true));
    held.finish('mine@3');

    page.choose('other');
    await vi.waitFor(() => expect(held.isLoading('other@2')).toBe(true));
    held.finish('other@2');

    await vi.waitFor(() => expect(page.shown).toEqual(['mine', 'other']));
  });

  it('showLayouts_Changes_ShownOneAtATimeInArrivalOrder', async () => {
    const held = heldLoader();
    const page = showing(held.loader, 'mine');

    page.change(setOf('mine', entry('mine', 2)));
    page.change(setOf('mine', entry('mine', 3)));
    await vi.waitFor(() => expect(held.isLoading('mine@2')).toBe(true));
    expect(held.isLoading('mine@3')).toBe(false);
    held.finish('mine@2');
    await vi.waitFor(() => expect(held.isLoading('mine@3')).toBe(true));
    held.finish('mine@3');

    await vi.waitFor(() => expect(page.shown).toEqual(['mine', 'mine']));
    expect(page.logLines).toEqual([
      '[demo] layout mine shown (revision 2)',
      '[demo] layout mine shown (revision 3)',
    ]);
    expect(page.toasts).toEqual([]);
  });

  it('showLayouts_ChangeHeardBeforeAnswer_DropsAnswer', async () => {
    const held = heldLoader();
    const page = showing(held.loader, 'mine');

    page.change(setOf('mine', entry('mine', 3)));
    page.answer.resolve(setOf(null, entry('mine', 2)));
    await vi.waitFor(() => expect(held.isLoading('mine@3')).toBe(true));
    held.finish('mine@3');

    await vi.waitFor(() => expect(page.shown).toEqual(['mine']));
    expect(held.isLoading('mine@2')).toBe(false);
  });

  it('showLayouts_LoadFails_LogsAndToasts', async () => {
    const held = heldLoader();
    const page = showing(held.loader, 'mine');

    page.change(setOf('mine', entry('mine', 2)));
    await vi.waitFor(() => expect(held.isLoading('mine@2')).toBe(true));
    held.fail('mine@2');

    await vi.waitFor(() =>
      expect(page.logLines).toEqual(['[demo] layout mine failed: broken']),
    );
    expect(page.toasts).toEqual(['error: Layout mine failed: broken']);
    expect(page.shown).toEqual([]);

    page.change(setOf('mine', entry('mine', 3)));
    await vi.waitFor(() => expect(held.isLoading('mine@3')).toBe(true));
    held.finish('mine@3');
    await vi.waitFor(() => expect(page.shown).toEqual(['mine']));
  });

  it('showLayouts_SetLayoutThrows_LaterChangesStillShown', async () => {
    const held = heldLoader();
    let calls = 0;
    const page = showing(held.loader, 'mine', () => {
      calls++;
      if (calls === 1) {
        throw new Error('rebuild failed');
      }
    });

    page.change(setOf('mine', entry('mine', 2)));
    page.change(setOf('mine', entry('mine', 3)));
    await vi.waitFor(() => expect(held.isLoading('mine@2')).toBe(true));
    held.finish('mine@2');
    await vi.waitFor(() => expect(held.isLoading('mine@3')).toBe(true));
    held.finish('mine@3');

    await vi.waitFor(() => expect(page.shown).toEqual(['mine']));
    expect(page.logLines).toContain(
      '[demo] layout mine not shown: rebuild failed',
    );
  });

  it('showLayouts_AnswerRejects_LogsNotRead', async () => {
    const page = showing(heldLoader().loader, 'mine');

    page.answer.reject(new Error('not started'));

    await vi.waitFor(() =>
      expect(page.logLines).toEqual(['[demo] layout not read: not started']),
    );
  });
});
