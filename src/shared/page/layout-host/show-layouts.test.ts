import { describe, expect, it, vi } from 'vitest';
import type { LayoutEntry, LayoutSet } from '../../../contracts/layouts';
import type { ShownLayouts } from '../../../contracts/plugin';
import { layoutUrl } from '../../layout-url';
import { createPageLayouts } from './show-layouts';

interface TestLayout {
  tag: string;
}

const BUILT_IN: TestLayout = { tag: 'built-in' };

const DEFAULT_ENTRY: LayoutEntry = {
  name: 'default',
  revision: 1,
  hasCss: false,
  builtIn: true,
};

function entry(name: string, revision: number, hasCss = false): LayoutEntry {
  return { name, revision, hasCss, builtIn: false };
}

// A set holding the built-in `default` and `users`.
function setOf(...users: LayoutEntry[]): LayoutSet {
  return { layouts: [DEFAULT_ENTRY, ...users], changed: null };
}

// The URL the page imports for `demo`'s layout `name` at `revision`.
function script(name: string, revision: number): string {
  return layoutUrl('demo', name, revision, 'layout.js');
}

interface FakeLink {
  href: string;
  dataset: Record<string, string>;
  removed: boolean;
}

// A `head` recording the links appended to it; each link records its removal.
function fakeHead() {
  const appended: FakeLink[] = [];
  const head = {
    ownerDocument: {
      createElement: () => ({
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

// Page layouts over a fake bridge whose `layouts` answer for each owner waits
// on `answers`, and whose imports go to `importModule` (by default a module
// whose layout is tagged `<name>@<revision>`), recording every URL imported,
// each log line and each toast. `changeConfig` tells each config listener.
function pageLayoutsWith(
  importModule: (url: string) => Promise<unknown> = async (url) => ({
    default: { tag: tagOf(url) },
  }),
) {
  const answers = new Map<string, PromiseWithResolvers<LayoutSet | null>>();
  const answerFor = (owner: string) => {
    const answer = answers.get(owner) ?? Promise.withResolvers();
    answers.set(owner, answer);
    return answer;
  };
  let listener: (owner: string, set: LayoutSet) => void = () => undefined;
  const configListeners = new Set<() => void>();
  const { head, appended } = fakeHead();
  const page = {
    configListeners,
    changeConfig: () => configListeners.forEach((heard) => heard()),
    imports: [] as string[],
    logLines: [] as string[],
    toasts: [] as string[],
    appended,
    answerFor,
    change: (owner: string, set: LayoutSet) => listener(owner, set),
    layouts: createPageLayouts({
      bridge: {
        layouts: (owner) => answerFor(owner).promise,
        onLayouts: (heard) => {
          listener = heard;
        },
      },
      importModule: (url) => {
        page.imports.push(url);
        return importModule(url);
      },
      head,
      log: (source, message) => page.logLines.push(`[${source}] ${message}`),
      toast: (text, tone) => page.toasts.push(`${tone}: ${text}`),
      onConfigChanged: (heard) => {
        configListeners.add(heard);
        return { dispose: () => configListeners.delete(heard) };
      },
    }),
  };
  return page;
}

// `name@revision` for a layout script URL.
function tagOf(url: string): string {
  const [, name, revision] = new URL(url).pathname.split('/');
  return `${name}@${revision.slice(1)}`;
}

// A show of owner `demo` on `page`, its setting and names in use held on the
// returned object, recording each set of layouts it is handed.
function showing(
  page: ReturnType<typeof pageLayoutsWith>,
  setting: string,
  setLayouts: (shown: ShownLayouts<TestLayout>) => void = () => undefined,
  defaultStylesheet: string | null = null,
) {
  const show = {
    setting,
    namesInUse: [] as string[],
    shown: [] as ShownLayouts<TestLayout>[],
    answer: page.answerFor('demo'),
    change: (set: LayoutSet) => page.change('demo', set),
    refresh: (): void => undefined,
    dispose: (): void => undefined,
  };
  const live = page.layouts.show<TestLayout>('demo', {
    defaultLayout: BUILT_IN,
    defaultStylesheet,
    read: (module) => (module as { default: TestLayout }).default,
    userLayout: () => show.setting,
    namesInUse: () => show.namesInUse,
    setLayouts: (shown) => {
      setLayouts(shown);
      show.shown.push(shown);
    },
  });
  show.refresh = () => live.refresh();
  show.dispose = () => live.dispose();
  return show;
}

// Lets every queued load and its promise callbacks run.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createPageLayouts', () => {
  it('showLayouts_Answer_LoadsSettingAndNamesInUse', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'mine');
    show.namesInUse = ['r'];

    show.answer.resolve(setOf(entry('mine', 3), entry('r', 1)));

    await vi.waitFor(() => expect(show.shown).toHaveLength(1));
    expect(page.imports).toEqual([script('mine', 3), script('r', 1)]);
    expect(show.shown[0].user).toBe('mine');
  });

  it('showLayouts_SettingMissing_DrawsDefaultAndLogsOnce', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'gone');

    show.answer.resolve(setOf(entry('mine', 3)));
    await vi.waitFor(() => expect(show.shown).toHaveLength(1));
    show.refresh();
    show.refresh();
    await settle();

    expect(show.shown[0].user).toBe('default');
    const missing = page.logLines.filter(
      (line) => line === '[demo] layout gone not found, drawing default',
    );
    expect(missing).toHaveLength(1);
  });

  it('showLayouts_SettingMovesToAnotherMissingName_LogsItWithNoLoad', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'gone1');
    show.answer.resolve(setOf(entry('mine', 3)));
    await vi.waitFor(() => expect(show.shown).toHaveLength(1));

    show.setting = 'gone2';
    show.refresh();
    await settle();

    expect(page.logLines).toContain(
      '[demo] layout gone2 not found, drawing default',
    );
    expect(page.imports).toEqual([]);
    expect(show.shown).toHaveLength(1);
  });

  it('showLayouts_ConfigChange_ReadsTheSettingAgain', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'default');
    show.answer.resolve(setOf(entry('mine', 3)));
    await vi.waitFor(() => expect(show.shown).toHaveLength(1));

    show.setting = 'mine';
    page.changeConfig();

    await vi.waitFor(() => expect(show.shown).toHaveLength(2));
    expect(show.shown[1].user).toBe('mine');
    expect(page.imports).toEqual([script('mine', 3)]);
  });

  it('showLayouts_ChangeHeardBeforeAnswer_DropsAnswer', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'mine');

    show.change(setOf(entry('mine', 3)));
    show.answer.resolve(setOf(entry('mine', 2)));
    await settle();

    expect(page.imports).toEqual([script('mine', 3)]);
    expect(show.shown).toHaveLength(1);
  });

  it.each([
    { row: 'a user layout', setting: 'mine', set: setOf(entry('mine', 2)) },
    {
      row: 'a live default',
      setting: 'default',
      set: { layouts: [entry('default', 2)], changed: null },
    },
  ])('showLayouts_LoadFails_LogsAndToasts: $row', async ({ setting, set }) => {
    const page = pageLayoutsWith(async () => {
      throw new Error('broken');
    });
    const show = showing(page, setting);

    show.change(set);

    await vi.waitFor(() =>
      expect(page.logLines).toEqual([
        `[demo] layout ${setting} failed: broken`,
      ]),
    );
    expect(page.toasts).toEqual([`error: Layout ${setting} failed: broken`]);
    expect(show.shown[0].user).toBe('default');
    expect(show.shown[0].layouts.get('default')).toBe(BUILT_IN);
  });

  it('show_DefaultStylesheet_HandedToTheLoader', () => {
    const page = pageLayoutsWith();

    showing(page, 'default', undefined, 'bundled.css');

    expect(
      page.appended.map((link) => [link.dataset.layout, link.href]),
    ).toEqual([['default', 'bundled.css']]);
  });

  it('showLayouts_RefreshUnchanged_ShowsNothingNew', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'mine');
    show.answer.resolve(setOf(entry('mine', 3)));
    await vi.waitFor(() => expect(show.shown).toHaveLength(1));

    show.refresh();
    await settle();

    expect(page.imports).toHaveLength(1);
    expect(show.shown).toHaveLength(1);
  });

  it('showLayouts_SettingLeavesListedLayoutStillInUse_ShowsDefault', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'mine');
    show.namesInUse = ['mine'];
    show.answer.resolve(setOf(entry('mine', 3)));
    await vi.waitFor(() => expect(show.shown).toHaveLength(1));

    show.setting = 'gone';
    show.refresh();

    await vi.waitFor(() => expect(show.shown).toHaveLength(2));
    expect(show.shown[1].user).toBe('default');
    expect(page.logLines).toContain(
      '[demo] layout gone not found, drawing default',
    );
  });

  it('showLayouts_NamesInUseGainsListedLayout_QueuesLoad', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'mine');
    show.answer.resolve(setOf(entry('mine', 3), entry('r', 1)));
    await vi.waitFor(() => expect(show.shown).toHaveLength(1));

    show.namesInUse = ['r'];
    show.refresh();

    await vi.waitFor(() =>
      expect(page.imports).toEqual([script('mine', 3), script('r', 1)]),
    );
  });

  it('showLayouts_SetLayoutsThrows_LaterSetsStillShown', async () => {
    const page = pageLayoutsWith();
    let calls = 0;
    const show = showing(page, 'mine', () => {
      calls++;
      if (calls === 1) {
        throw new Error('rebuild failed');
      }
    });

    show.change(setOf(entry('mine', 2)));
    await vi.waitFor(() =>
      expect(page.logLines).toContainEqual(
        expect.stringMatching(/^\[demo\] .*rebuild failed/),
      ),
    );
    show.change(setOf(entry('mine', 3)));

    await vi.waitFor(() => expect(show.shown).toHaveLength(1));
    expect(show.shown[0].layouts.get('mine')).toEqual({ tag: 'mine@3' });
  });

  it('showLayouts_NameLeavesUse_LastShownStillHoldsItsLayout', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'default');
    show.namesInUse = ['r'];
    show.answer.resolve(setOf(entry('r', 1)));
    await vi.waitFor(() => expect(show.shown).toHaveLength(1));
    const loaded = show.shown[0].layouts.get('r');

    show.namesInUse = [];
    show.refresh();
    await settle();

    const lastShown = show.shown.at(-1);
    expect(loaded).toBeDefined();
    expect(lastShown?.layouts.get('r')).toBe(loaded);
  });

  it('showLayouts_AnswerRejects_LogsNotRead', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'mine');

    show.answer.reject(new Error('not started'));

    await vi.waitFor(() =>
      expect(page.logLines).toEqual([
        expect.stringMatching(/^\[demo\] .*not started/),
      ]),
    );
  });

  it('show_ReadNull_WaitsForFirstSet', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'mine');

    show.answer.resolve(null);
    await settle();
    expect(show.shown).toEqual([]);
    show.change(setOf(entry('mine', 3)));

    await vi.waitFor(() => expect(show.shown).toHaveLength(1));
    expect(show.shown[0].user).toBe('mine');
  });

  it('show_OtherOwnersSet_Ignored', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'mine');

    page.change('chat', setOf(entry('mine', 3)));
    await settle();

    expect(page.imports).toEqual([]);
    expect(show.shown).toEqual([]);
  });

  it('show_Dispose_StopsSetsAndRemovesLinks', async () => {
    const page = pageLayoutsWith();
    const show = showing(page, 'mine');
    show.change(setOf(entry('mine', 3, true)));
    await vi.waitFor(() => expect(show.shown).toHaveLength(1));
    expect(page.appended.map((link) => link.removed)).toEqual([false]);

    show.dispose();
    show.change(setOf(entry('mine', 4, true)));
    show.refresh();
    await settle();

    expect(page.configListeners.size).toBe(0);
    expect(page.appended.map((link) => link.removed)).toEqual([true]);
    expect(page.imports).toEqual([script('mine', 3)]);
    expect(show.shown).toHaveLength(1);
  });

  it('show_DisposedWhileLoading_LinksNothingAndShowsNothing', async () => {
    const script3 = Promise.withResolvers<unknown>();
    const page = pageLayoutsWith(() => script3.promise);
    const show = showing(page, 'mine');
    show.change(setOf(entry('mine', 3, true)));
    await settle();

    show.dispose();
    script3.resolve({ default: { tag: 'mine@3' } });
    await settle();

    expect(page.appended.filter((link) => !link.removed)).toEqual([]);
    expect(show.shown).toEqual([]);
  });
});
