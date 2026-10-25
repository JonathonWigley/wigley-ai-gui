import { describe, expect, it, vi } from 'vitest';
import type { LayoutEntry, LayoutSet } from '../../contracts/layouts';
import {
  createLayoutLoader,
  type LayoutLoad,
  type LayoutLoader,
  layoutUrls,
  type ShownLayouts,
  showLayouts,
} from './layout-loader';

interface TestLayout {
  tag: string;
}

function readTestLayout(module: unknown): TestLayout {
  return (module as { default: TestLayout }).default;
}

function entry(name: string, revision: number, hasCss = false): LayoutEntry {
  return { name, revision, hasCss, builtIn: false };
}

const DEFAULT_ENTRY: LayoutEntry = {
  name: 'default',
  revision: 1,
  hasCss: false,
  builtIn: true,
};

// A set holding the built-in `default` and `users`.
function setOf(...users: LayoutEntry[]): LayoutSet {
  return { layouts: [DEFAULT_ENTRY, ...users], changed: null };
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

    const urls = layoutUrls(entry('mine', 4, true), dataUrl);

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

    expect(layoutUrls(entry('mine', 4), dataUrl)).toEqual({
      script: 'url:layouts/mine/layout.js@4',
      style: null,
    });
  });
});

interface FakeLink {
  rel: string;
  href: string;
  dataset: Record<string, string>;
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
        dataset: {},
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

const BUILT_IN: TestLayout = { tag: 'built-in' };

// A loader whose imports go to `importModule` (by default a module whose
// layout is tagged with the script URL), recording every URL imported.
function loaderWith(
  importModule: (url: string) => Promise<unknown> = async (url) => ({
    default: { tag: url },
  }),
  read: (module: unknown, name: string) => TestLayout = readTestLayout,
) {
  const { head, appended } = fakeHead();
  const imports: string[] = [];
  const loader = createLayoutLoader<TestLayout>({
    importModule: (url) => {
      imports.push(url);
      return importModule(url);
    },
    dataUrl: (path, revision) => `url:${path}@${revision}`,
    defaultLayout: BUILT_IN,
    head,
    read,
  });
  return { loader, appended, imports };
}

function shownLinks(appended: FakeLink[]) {
  return appended
    .filter((link) => !link.removed)
    .map((link) => ({ layout: link.dataset.layout, href: link.href }));
}

describe('createLayoutLoader', () => {
  it('load_TwoUserLayoutsWithCss_OneLinkEach', async () => {
    const { loader, appended } = loaderWith();

    await loader.load(setOf(entry('a', 4, true), entry('b', 7, true)), [
      'a',
      'b',
    ]);

    expect(shownLinks(appended)).toEqual([
      { layout: 'a', href: 'url:layouts/a/layout.css@4' },
      { layout: 'b', href: 'url:layouts/b/layout.css@7' },
    ]);
    expect(appended.map((link) => link.rel)).toEqual([
      'stylesheet',
      'stylesheet',
    ]);
  });

  it('load_WithCss_AddsStylesheetOnlyAfterScriptLoads', async () => {
    const script = Promise.withResolvers<unknown>();
    const { loader, appended } = loaderWith(() => script.promise);

    const loading = loader.load(setOf(entry('mine', 4, true)), ['mine']);
    await Promise.resolve();
    expect(appended).toEqual([]);
    script.resolve({ default: { tag: 'mine' } });
    await loading;

    expect(shownLinks(appended)).toEqual([
      { layout: 'mine', href: 'url:layouts/mine/layout.css@4' },
    ]);
  });

  it('load_SameRevision_ImportsOnce', async () => {
    const { loader, imports } = loaderWith();
    const set = setOf(entry('a', 4));

    const first = await loader.load(set, ['a']);
    const second = await loader.load(set, ['a']);

    expect(imports).toEqual(['url:layouts/a/layout.js@4']);
    expect(second.layouts.get('a')).toBe(first.layouts.get('a'));
  });

  it('load_NewRevision_ImportsAgainAndMovesLink', async () => {
    const { loader, appended, imports } = loaderWith();

    await loader.load(setOf(entry('a', 4, true)), ['a']);
    await loader.load(setOf(entry('a', 5, true)), ['a']);

    expect(imports).toEqual([
      'url:layouts/a/layout.js@4',
      'url:layouts/a/layout.js@5',
    ]);
    expect(shownLinks(appended)).toEqual([
      { layout: 'a', href: 'url:layouts/a/layout.css@5' },
    ]);
  });

  it('load_ScriptFails_KeepsLastGoodAndItsLink', async () => {
    const broken = new Error('syntax');
    const { loader, appended } = loaderWith(async (url) => {
      if (url.endsWith('@5')) {
        throw broken;
      }
      return { default: { tag: url } };
    });
    const good = await loader.load(setOf(entry('a', 4, true)), ['a']);

    const failing = await loader.load(setOf(entry('a', 5, true)), ['a']);

    expect(failing.layouts.get('a')).toBe(good.layouts.get('a'));
    expect(failing.failed).toEqual([
      { entry: entry('a', 5, true), error: broken },
    ]);
    expect(failing.loaded).toEqual([]);
    expect(shownLinks(appended)).toEqual([
      { layout: 'a', href: 'url:layouts/a/layout.css@4' },
    ]);
  });

  it('load_FailedRevision_NotImportedAgain', async () => {
    const { loader, imports } = loaderWith(async (url) => {
      if (url.endsWith('@5')) {
        throw new Error('syntax');
      }
      return { default: { tag: url } };
    });
    await loader.load(setOf(entry('a', 4)), ['a']);
    await loader.load(setOf(entry('a', 5)), ['a']);

    const again = await loader.load(setOf(entry('a', 5)), ['a']);

    expect(imports).toEqual([
      'url:layouts/a/layout.js@4',
      'url:layouts/a/layout.js@5',
    ]);
    expect(again.failed).toEqual([]);
  });

  it('load_NameLeavesNames_RemovesItsLink', async () => {
    const { loader, appended } = loaderWith();
    const set = setOf(entry('a', 4, true));
    await loader.load(set, ['a']);

    const after = await loader.load(set, []);

    expect(shownLinks(appended)).toEqual([]);
    expect(appended).toHaveLength(1);
    expect(after.layouts.has('a')).toBe(false);
  });

  it('load_NameNotInSet_Skipped', async () => {
    const { loader, imports } = loaderWith();

    const result = await loader.load(setOf(), ['ghost']);

    expect(imports).toEqual([]);
    expect([...result.layouts.keys()]).toEqual(['default']);
  });

  it('load_AlwaysHoldsDefault_NoLinkForBuiltIn', async () => {
    const { loader, appended, imports } = loaderWith();

    const result = await loader.load(
      { layouts: [{ ...DEFAULT_ENTRY, hasCss: true }], changed: null },
      ['default'],
    );

    expect(result.layouts.get('default')).toBe(BUILT_IN);
    expect(imports).toEqual([]);
    expect(appended).toEqual([]);
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

    const result = await loader.load(setOf(entry('mine', 4)), ['mine']);

    expect(reads).toEqual([[{ default: { tag: 'mine' } }, 'mine']]);
    expect(result.layouts.get('mine')).toEqual({ tag: 'read' });
    expect(result.loaded).toEqual([entry('mine', 4)]);
  });
});

// A loader recording each `(set, names)` it is handed. By default it answers
// with `default` and every name the set lists, one layout object per name and
// revision; `respond` replaces that answer.
function recordingLoader() {
  const calls: { set: LayoutSet; names: readonly string[] }[] = [];
  const objects = new Map<string, TestLayout>();
  const layoutAt = (listed: LayoutEntry) => {
    const key = `${listed.name}@${listed.revision}`;
    const existing = objects.get(key) ?? { tag: key };
    objects.set(key, existing);
    return existing;
  };
  const answer = (set: LayoutSet, names: readonly string[]) => {
    const layouts = new Map<string, TestLayout>([['default', BUILT_IN]]);
    for (const listed of set.layouts) {
      if (!listed.builtIn && names.includes(listed.name)) {
        layouts.set(listed.name, layoutAt(listed));
      }
    }
    return layouts;
  };
  const recorder: {
    calls: typeof calls;
    respond(set: LayoutSet, names: readonly string[]): LayoutLoad<TestLayout>;
    loader: LayoutLoader<TestLayout>;
    answer: typeof answer;
  } = {
    calls,
    respond: (set, names) => ({
      layouts: answer(set, names),
      loaded: [],
      failed: [],
    }),
    loader: {
      load: async (set, names) => {
        calls.push({ set, names });
        return recorder.respond(set, names);
      },
    },
    answer,
  };
  return recorder;
}

function showing(
  loader: LayoutLoader<TestLayout>,
  setting: string,
  setLayouts: (shown: ShownLayouts<TestLayout>) => void = () => undefined,
) {
  const answer = Promise.withResolvers<LayoutSet>();
  let listener: (changed: LayoutSet) => void = () => undefined;
  const page = {
    setting,
    namesInUse: [] as string[],
    shown: [] as ShownLayouts<TestLayout>[],
    logLines: [] as string[],
    toasts: [] as string[],
    answer,
    change: (changed: LayoutSet) => listener(changed),
    refresh: (): void => undefined,
  };
  const show = showLayouts<TestLayout>({
    channel: {
      onLayoutChanged: (heard) => {
        listener = heard;
      },
      readLayout: () => answer.promise,
    },
    loader,
    userLayout: () => page.setting,
    namesInUse: () => page.namesInUse,
    setLayouts: (shown) => {
      setLayouts(shown);
      page.shown.push(shown);
    },
    log: (source, message) => page.logLines.push(`[${source}] ${message}`),
    logSource: 'demo',
    toast: (text, tone) => page.toasts.push(`${tone}: ${text}`),
  });
  page.refresh = () => show.refresh();
  return page;
}

// Lets every queued load and its promise callbacks run.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('showLayouts', () => {
  it('showLayouts_Answer_LoadsSettingAndNamesInUse', async () => {
    const recorder = recordingLoader();
    const page = showing(recorder.loader, 'mine');
    page.namesInUse = ['r'];

    page.answer.resolve(setOf(entry('mine', 3), entry('r', 1)));

    await vi.waitFor(() => expect(page.shown).toHaveLength(1));
    expect(recorder.calls.map((call) => call.names)).toEqual([['mine', 'r']]);
    expect(page.shown[0].user).toBe('mine');
  });

  it('showLayouts_SettingMissing_DrawsDefaultAndLogsOnce', async () => {
    const recorder = recordingLoader();
    const page = showing(recorder.loader, 'gone');

    page.answer.resolve(setOf(entry('mine', 3)));
    await vi.waitFor(() => expect(page.shown).toHaveLength(1));
    page.refresh();
    page.refresh();
    await settle();

    expect(page.shown[0].user).toBe('default');
    const missing = page.logLines.filter(
      (line) => line === '[demo] layout gone not found, drawing default',
    );
    expect(missing).toHaveLength(1);
  });

  it('showLayouts_SettingMovesToAnotherMissingName_LogsItWithNoLoad', async () => {
    const recorder = recordingLoader();
    const page = showing(recorder.loader, 'gone1');
    page.answer.resolve(setOf(entry('mine', 3)));
    await vi.waitFor(() => expect(page.shown).toHaveLength(1));

    page.setting = 'gone2';
    page.refresh();
    await settle();

    expect(page.logLines).toContain(
      '[demo] layout gone2 not found, drawing default',
    );
    expect(recorder.calls).toHaveLength(1);
  });

  it('showLayouts_Loaded_LogsShownWithRevision', async () => {
    const recorder = recordingLoader();
    recorder.respond = (set, names) => ({
      layouts: recorder.answer(set, names),
      loaded: [entry('mine', 3)],
      failed: [],
    });
    const page = showing(recorder.loader, 'mine');

    page.answer.resolve(setOf(entry('mine', 3)));

    await vi.waitFor(() =>
      expect(page.logLines).toEqual(['[demo] layout mine shown (revision 3)']),
    );
  });

  it('showLayouts_ChangeHeardBeforeAnswer_DropsAnswer', async () => {
    const recorder = recordingLoader();
    const page = showing(recorder.loader, 'mine');
    const changed = setOf(entry('mine', 3));

    page.change(changed);
    page.answer.resolve(setOf(entry('mine', 2)));
    await settle();

    expect(recorder.calls.map((call) => call.set)).toEqual([changed]);
    expect(page.shown).toHaveLength(1);
  });

  it('showLayouts_LoadFails_LogsAndToasts', async () => {
    const recorder = recordingLoader();
    recorder.respond = (set) => ({
      layouts: recorder.answer(set, []),
      loaded: [],
      failed: [{ entry: entry('mine', 2), error: new Error('broken') }],
    });
    const page = showing(recorder.loader, 'mine');

    page.change(setOf(entry('mine', 2)));

    await vi.waitFor(() =>
      expect(page.logLines).toEqual(['[demo] layout mine failed: broken']),
    );
    expect(page.toasts).toEqual(['error: Layout mine failed: broken']);
    expect(page.shown[0].user).toBe('default');
  });

  it('showLayouts_RefreshUnchanged_QueuesNothing', async () => {
    const recorder = recordingLoader();
    const page = showing(recorder.loader, 'mine');
    page.answer.resolve(setOf(entry('mine', 3)));
    await vi.waitFor(() => expect(page.shown).toHaveLength(1));

    page.refresh();
    await settle();

    expect(recorder.calls).toHaveLength(1);
    expect(page.shown).toHaveLength(1);
  });

  it('showLayouts_SettingLeavesListedLayoutStillInUse_ShowsDefault', async () => {
    const recorder = recordingLoader();
    const page = showing(recorder.loader, 'mine');
    page.namesInUse = ['mine'];
    page.answer.resolve(setOf(entry('mine', 3)));
    await vi.waitFor(() => expect(page.shown).toHaveLength(1));

    page.setting = 'gone';
    page.refresh();

    await vi.waitFor(() => expect(page.shown).toHaveLength(2));
    expect(page.shown[1].user).toBe('default');
    expect(page.logLines).toContain(
      '[demo] layout gone not found, drawing default',
    );
  });

  it('showLayouts_NamesInUseGainsListedLayout_QueuesLoad', async () => {
    const recorder = recordingLoader();
    const page = showing(recorder.loader, 'mine');
    page.answer.resolve(setOf(entry('mine', 3), entry('r', 1)));
    await vi.waitFor(() => expect(page.shown).toHaveLength(1));

    page.namesInUse = ['r'];
    page.refresh();

    await vi.waitFor(() => expect(recorder.calls).toHaveLength(2));
    expect(recorder.calls[1].names).toEqual(['mine', 'r']);
  });

  it('showLayouts_SetLayoutsThrows_LaterSetsStillShown', async () => {
    const recorder = recordingLoader();
    let calls = 0;
    const page = showing(recorder.loader, 'mine', () => {
      calls++;
      if (calls === 1) {
        throw new Error('rebuild failed');
      }
    });

    page.change(setOf(entry('mine', 2)));
    await vi.waitFor(() =>
      expect(page.logLines).toContain(
        '[demo] layouts not shown: rebuild failed',
      ),
    );
    page.change(setOf(entry('mine', 3)));

    await vi.waitFor(() => expect(page.shown).toHaveLength(1));
    expect(page.shown[0].layouts.get('mine')).toEqual({ tag: 'mine@3' });
  });

  it('showLayouts_AnswerRejects_LogsNotRead', async () => {
    const page = showing(recordingLoader().loader, 'mine');

    page.answer.reject(new Error('not started'));

    await vi.waitFor(() =>
      expect(page.logLines).toEqual(['[demo] layout not read: not started']),
    );
  });
});
