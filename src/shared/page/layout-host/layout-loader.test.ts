import { describe, expect, it } from 'vitest';
import type { LayoutEntry, LayoutSet } from '../../../contracts/layouts';
import { createLayoutLoader, type LayoutLoad } from './layout-loader';

interface TestLayout {
  tag: string;
  card?: () => void;
  entries?: { row?: () => void };
}

function readTestLayout(module: unknown): TestLayout {
  return (module as { default: TestLayout }).default;
}

function entry(
  name: string,
  revision: number,
  hasCss = false,
  styleRevision = revision,
): LayoutEntry {
  return { name, revision, styleRevision, hasCss, builtIn: false };
}

// A `default` entry read from the repo clone, not built in.
function liveDefault(
  revision: number,
  hasCss = false,
  styleRevision = revision,
): LayoutEntry {
  return entry('default', revision, hasCss, styleRevision);
}

const DEFAULT_ENTRY: LayoutEntry = {
  name: 'default',
  revision: 1,
  styleRevision: 1,
  hasCss: false,
  builtIn: true,
};

// A set holding the built-in `default` and `users`.
function setOf(...users: LayoutEntry[]): LayoutSet {
  return { layouts: [DEFAULT_ENTRY, ...users] };
}

function layoutUrl(name: string, revision: number, path: string): string {
  return `url:${name}/${path}@${revision}`;
}

interface FakeLink {
  rel: string;
  href: string;
  dataset: Record<string, string>;
  removed: boolean;
  remove(): void;
}

// A `head` holding its links in order in `inHead`, and recording in
// `appended` each link it was ever handed, once; each link records whether it
// was last removed.
function fakeHead() {
  const appended: FakeLink[] = [];
  const inHead: FakeLink[] = [];
  const put = (link: FakeLink, index: number) => {
    if (!appended.includes(link)) {
      appended.push(link);
    }
    link.removed = false;
    inHead.splice(index, 0, link);
  };
  const head = {
    ownerDocument: {
      createElement: (): FakeLink => {
        const link: FakeLink = {
          rel: '',
          href: '',
          dataset: {},
          removed: false,
          remove() {
            link.removed = true;
            const index = inHead.indexOf(link);
            if (index !== -1) {
              inHead.splice(index, 1);
            }
          },
        };
        return link;
      },
    },
    append: (link: FakeLink) => put(link, inHead.length),
    insertBefore: (link: FakeLink, before: FakeLink) =>
      put(link, inHead.indexOf(before)),
  };
  return { head: head as unknown as HTMLElement, appended, inHead };
}

const BUILT_IN: TestLayout = { tag: 'built-in' };

// A loader whose imports go to `importModule` (by default a module whose
// layout is tagged with the script URL), recording every URL imported.
function loaderWith(
  importModule: (url: string) => Promise<unknown> = async (url) => ({
    default: { tag: url },
  }),
  read: (module: unknown, name: string) => TestLayout = readTestLayout,
  defaultStylesheet: string | null = null,
  defaultLayout: TestLayout = BUILT_IN,
) {
  const { head, appended, inHead } = fakeHead();
  const imports: string[] = [];
  const loader = createLayoutLoader<TestLayout>({
    importModule: (url) => {
      imports.push(url);
      return importModule(url);
    },
    owner: 'forms',
    layoutUrl,
    defaultLayout,
    defaultStylesheet,
    head,
    read,
  });
  return { loader, appended, inHead, imports };
}

// An import whose module's layout is tagged with the script URL, throwing for
// each URL in `failing`.
function importFailing(...failing: string[]) {
  return async (url: string): Promise<unknown> => {
    if (failing.includes(url)) {
      throw new Error(`broken ${url}`);
    }
    return { default: { tag: url } };
  };
}

// Each link in `head`, in order.
function shownLinks(inHead: FakeLink[]) {
  return inHead.map((link) => ({
    layout: link.dataset.layout,
    href: link.href,
  }));
}

describe('createLayoutLoader', () => {
  it('load_TwoUserLayoutsWithCss_OneLinkEach', async () => {
    const { loader, appended, inHead } = loaderWith();

    await loader.load(setOf(entry('a', 4, true), entry('b', 7, true)), [
      'a',
      'b',
    ]);

    expect(shownLinks(inHead)).toEqual([
      { layout: 'a', href: 'url:a/layout.css@4' },
      { layout: 'b', href: 'url:b/layout.css@7' },
    ]);
    expect(appended.map((link) => link.rel)).toEqual([
      'stylesheet',
      'stylesheet',
    ]);
  });

  it('load_WithoutCss_ImportsScriptAndAddsNoStylesheet', async () => {
    const { loader, appended, imports } = loaderWith();

    await loader.load(setOf(entry('mine', 4)), ['mine']);

    expect(imports).toEqual(['url:mine/layout.js@4']);
    expect(appended).toEqual([]);
  });

  it('load_WithCss_AddsStylesheetOnlyAfterScriptLoads', async () => {
    const script = Promise.withResolvers<unknown>();
    const { loader, appended, inHead } = loaderWith(() => script.promise);

    const loading = loader.load(setOf(entry('mine', 4, true)), ['mine']);
    await Promise.resolve();
    expect(appended).toEqual([]);
    script.resolve({ default: { tag: 'mine' } });
    await loading;

    expect(shownLinks(inHead)).toEqual([
      { layout: 'mine', href: 'url:mine/layout.css@4' },
    ]);
  });

  it('load_SameRevision_ImportsOnce', async () => {
    const { loader, imports } = loaderWith();
    const set = setOf(entry('a', 4));

    const first = await loader.load(set, ['a']);
    const second = await loader.load(set, ['a']);

    expect(imports).toEqual(['url:a/layout.js@4']);
    expect(second.layouts.get('a')).toBe(first.layouts.get('a'));
  });

  it('load_NewRevision_ImportsAgainAndKeepsTheLink', async () => {
    const { loader, inHead, imports } = loaderWith();

    await loader.load(setOf(entry('a', 4, true, 1)), ['a']);
    await loader.load(setOf(entry('a', 5, true, 1)), ['a']);

    expect(imports).toEqual(['url:a/layout.js@4', 'url:a/layout.js@5']);
    expect(shownLinks(inHead)).toEqual([
      { layout: 'a', href: 'url:a/layout.css@1' },
    ]);
  });

  // Each row loads a set holding `first`, then one holding `second`, asking for
  // its name both times; `failing` lists the script URLs whose import throws.
  it.each<{
    row: string;
    first: LayoutEntry;
    second: LayoutEntry;
    failing: string[];
    imports: string[];
    isSameLayout: boolean;
    links: { layout: string; href: string }[];
    restyled: string[];
  }>([
    {
      row: "a user layout's css saved",
      first: entry('mine', 2, true, 1),
      second: entry('mine', 2, true, 2),
      failing: [],
      imports: [],
      isSameLayout: true,
      links: [{ layout: 'mine', href: 'url:mine/layout.css@2' }],
      restyled: ['mine'],
    },
    {
      row: 'a user layout gains css',
      first: entry('mine', 2, false, 1),
      second: entry('mine', 2, true, 2),
      failing: [],
      imports: [],
      isSameLayout: true,
      links: [{ layout: 'mine', href: 'url:mine/layout.css@2' }],
      restyled: ['mine'],
    },
    {
      row: 'a user layout loses css',
      first: entry('mine', 2, true, 3),
      second: entry('mine', 2, false, 4),
      failing: [],
      imports: [],
      isSameLayout: true,
      links: [],
      restyled: ['mine'],
    },
    {
      row: "the live default's css saved",
      first: liveDefault(3, true, 1),
      second: liveDefault(3, true, 2),
      failing: [],
      imports: [],
      isSameLayout: true,
      links: [{ layout: 'default', href: 'url:default/layout.css@2' }],
      restyled: ['default'],
    },
    {
      row: 'a newer revision failed',
      first: entry('mine', 2, true, 1),
      second: entry('mine', 3, true, 2),
      failing: ['url:mine/layout.js@3'],
      imports: ['url:mine/layout.js@3'],
      isSameLayout: true,
      links: [{ layout: 'mine', href: 'url:mine/layout.css@1' }],
      restyled: [],
    },
    {
      row: 'a code and css save',
      first: entry('mine', 2, true, 1),
      second: entry('mine', 3, true, 2),
      failing: [],
      imports: ['url:mine/layout.js@3'],
      isSameLayout: false,
      links: [{ layout: 'mine', href: 'url:mine/layout.css@2' }],
      restyled: [],
    },
  ])(
    'load_StyleOnlyChange_RelinksWithNoImport ($row)',
    async ({
      first,
      second,
      failing,
      imports: secondImports,
      isSameLayout,
      links,
      restyled,
    }) => {
      const { loader, inHead, imports } = loaderWith(importFailing(...failing));
      const setHolding = (held: LayoutEntry): LayoutSet =>
        held.name === 'default' ? { layouts: [held] } : setOf(held);
      const before = await loader.load(setHolding(first), [first.name]);
      const importedBefore = imports.length;

      const after = await loader.load(setHolding(second), [second.name]);

      expect(imports.slice(importedBefore)).toEqual(secondImports);
      expect(
        after.layouts.get(second.name) === before.layouts.get(first.name),
      ).toBe(isSameLayout);
      expect(shownLinks(inHead)).toEqual(links);
      expect(after.restyled.map(({ name }) => name)).toEqual(restyled);
    },
  );

  it('load_ScriptFails_KeepsLastGoodAndItsLink', async () => {
    const broken = new Error('syntax');
    const { loader, inHead } = loaderWith(async (url) => {
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
    expect(shownLinks(inHead)).toEqual([
      { layout: 'a', href: 'url:a/layout.css@4' },
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

    expect(imports).toEqual(['url:a/layout.js@4', 'url:a/layout.js@5']);
    expect(again.failed).toEqual([]);
  });

  it('load_NameLeavesNamesAtSameRevision_KeepsLayoutAndLink', async () => {
    const { loader, inHead, imports } = loaderWith();
    const set = setOf(entry('a', 4, true));
    const first = await loader.load(set, ['a']);

    const after = await loader.load(set, []);

    expect(after.layouts.get('a')).toBe(first.layouts.get('a'));
    expect(shownLinks(inHead)).toEqual([
      { layout: 'a', href: 'url:a/layout.css@4' },
    ]);
    expect(imports).toEqual(['url:a/layout.js@4']);
  });

  it('load_NameLeftOutAtNewRevision_DropsLayoutAndLink', async () => {
    const { loader, inHead, imports } = loaderWith();
    await loader.load(setOf(entry('a', 4, true)), ['a']);

    const after = await loader.load(setOf(entry('a', 5, true)), []);

    expect(after.layouts.has('a')).toBe(false);
    expect(shownLinks(inHead)).toEqual([]);
    expect(imports).toEqual(['url:a/layout.js@4']);
  });

  it('load_NameLeavesTheSet_DropsLayoutAndLink', async () => {
    const { loader, inHead } = loaderWith();
    await loader.load(setOf(entry('a', 4, true)), ['a']);

    const after = await loader.load(setOf(), []);

    expect(after.layouts.has('a')).toBe(false);
    expect(shownLinks(inHead)).toEqual([]);
  });

  it('load_NeverLoadedName_NotInLayouts', async () => {
    const { loader, imports } = loaderWith();

    const result = await loader.load(setOf(entry('a', 4)), []);

    expect(imports).toEqual([]);
    expect([...result.layouts.keys()]).toEqual(['default']);
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
      { layouts: [{ ...DEFAULT_ENTRY, hasCss: true }] },
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

  it('load_StylesheetLink_NamesOwner', async () => {
    const { loader, appended } = loaderWith();

    await loader.load(setOf(entry('a', 4, true)), ['a']);

    expect(appended.map((link) => link.dataset)).toEqual([
      { layout: 'a', layoutOwner: 'forms' },
    ]);
  });

  it.each([
    { row: 'live at 3', defaults: [liveDefault(3)], shows: 'read' },
    {
      row: 'live at 3, then built in',
      defaults: [liveDefault(3), DEFAULT_ENTRY],
      shows: 'bundled',
    },
  ])(
    'load_LiveDefault_ImportedAndReadAsDefault: $row',
    async ({ defaults, shows }) => {
      const reads: [unknown, string][] = [];
      const readLayout: TestLayout = { tag: 'read' };
      const { loader, imports } = loaderWith(
        async () => ({ default: { tag: 'live' } }),
        (module, name) => {
          reads.push([module, name]);
          return readLayout;
        },
      );

      let result: LayoutLoad<TestLayout> | null = null;
      for (const defaultEntry of defaults) {
        result = await loader.load({ layouts: [defaultEntry] }, []);
      }

      expect(imports).toEqual(['url:default/layout.js@3']);
      expect(reads).toEqual([[{ default: { tag: 'live' } }, 'default']]);
      expect(result?.layouts.get('default')).toBe(
        shows === 'read' ? readLayout : BUILT_IN,
      );
    },
  );

  it.each<{ row: string; live: TestLayout; error: string }>([
    {
      row: 'live lacks a part',
      live: { tag: 'live', entries: { row: () => undefined } },
      error: 'layout default has no card',
    },
    {
      row: 'live lacks a nested part',
      live: { tag: 'live', card: () => undefined, entries: {} },
      error: 'layout default has no entries.row',
    },
    {
      row: 'live lacks the whole nested object',
      live: { tag: 'live', card: () => undefined },
      error: 'layout default has no entries.row',
    },
  ])(
    'load_LiveDefaultLacksAPart_FailsNamingIt: $row',
    async ({ live, error }) => {
      const bundled: TestLayout = {
        tag: 'bundled',
        card: () => undefined,
        entries: { row: () => undefined },
      };
      const { loader } = loaderWith(
        async () => ({ default: live }),
        readTestLayout,
        null,
        bundled,
      );

      const result = await loader.load({ layouts: [liveDefault(3)] }, []);

      expect(result.failed).toEqual([
        {
          entry: liveDefault(3),
          error: expect.objectContaining({ message: error }),
        },
      ]);
      expect(result.layouts.get('default')).toBe(bundled);
    },
  );

  it.each([
    { row: 'first revision fails', revisions: [4], shows: BUILT_IN },
    {
      row: 'revision 3 good, revision 4 fails',
      revisions: [3, 4],
      shows: { tag: 'url:default/layout.js@3' },
    },
  ])(
    'load_LiveDefaultFails_KeepsLastGoodElseBundled: $row',
    async ({ revisions, shows }) => {
      const { loader } = loaderWith(importFailing('url:default/layout.js@4'));

      let result: LayoutLoad<TestLayout> | null = null;
      for (const revision of revisions) {
        result = await loader.load({ layouts: [liveDefault(revision)] }, []);
      }

      expect(result?.failed.map((failure) => failure.entry)).toEqual([
        liveDefault(4),
      ]);
      expect(result?.layouts.get('default')).toEqual(shows);
    },
  );

  it.each<{
    row: string;
    defaultStylesheet: string | null;
    defaults: LayoutEntry[];
    users: LayoutEntry[];
    links: { layout: string; href: string }[];
  }>([
    {
      row: 'built in with bundled CSS',
      defaultStylesheet: 'bundled.css',
      defaults: [DEFAULT_ENTRY],
      users: [],
      links: [{ layout: 'default', href: 'bundled.css' }],
    },
    {
      row: 'built in with no bundled CSS',
      defaultStylesheet: null,
      defaults: [DEFAULT_ENTRY],
      users: [],
      links: [],
    },
    {
      row: 'live with CSS',
      defaultStylesheet: null,
      defaults: [liveDefault(3, true)],
      users: [],
      links: [{ layout: 'default', href: 'url:default/layout.css@3' }],
    },
    {
      row: 'live without CSS',
      defaultStylesheet: 'bundled.css',
      defaults: [liveDefault(3)],
      users: [],
      links: [],
    },
    {
      row: 'live never loaded good',
      defaultStylesheet: 'bundled.css',
      defaults: [liveDefault(4, true)],
      users: [],
      links: [{ layout: 'default', href: 'bundled.css' }],
    },
    {
      row: 'live good at 3 with CSS, then 4 fails',
      defaultStylesheet: 'bundled.css',
      defaults: [liveDefault(3, true), liveDefault(4, true)],
      users: [],
      links: [{ layout: 'default', href: 'url:default/layout.css@3' }],
    },
    {
      row: 'live with CSS, then built in',
      defaultStylesheet: 'bundled.css',
      defaults: [liveDefault(3, true), DEFAULT_ENTRY],
      users: [],
      links: [{ layout: 'default', href: 'bundled.css' }],
    },
    {
      row: 'live with CSS, without, then with again beside a user link',
      defaultStylesheet: null,
      defaults: [liveDefault(3, true), liveDefault(5), liveDefault(6, true)],
      users: [entry('a', 2, true)],
      links: [
        { layout: 'default', href: 'url:default/layout.css@6' },
        { layout: 'a', href: 'url:a/layout.css@2' },
      ],
    },
  ])(
    'load_DefaultStylesheetLink_FollowsTheShownDefault: $row',
    async ({ defaultStylesheet, defaults, users, links }) => {
      const { loader, inHead } = loaderWith(
        importFailing('url:default/layout.js@4'),
        readTestLayout,
        defaultStylesheet,
      );
      const names = users.map((user) => user.name);

      for (const defaultEntry of defaults) {
        await loader.load({ layouts: [defaultEntry, ...users] }, names);
      }

      expect(shownLinks(inHead)).toEqual(links);
    },
  );

  it('create_DefaultStylesheet_LinkedBeforeAnyLoad', async () => {
    const { loader, appended, inHead } = loaderWith(
      undefined,
      readTestLayout,
      'bundled.css',
    );
    const beforeLoad = shownLinks(inHead);

    await loader.load({ layouts: [liveDefault(3, true)] }, []);

    expect(beforeLoad).toEqual([{ layout: 'default', href: 'bundled.css' }]);
    expect(shownLinks(inHead)).toEqual([
      { layout: 'default', href: 'url:default/layout.css@3' },
    ]);
    expect(appended).toHaveLength(1);
    expect(appended[0].dataset).toEqual({
      layout: 'default',
      layoutOwner: 'forms',
    });
  });

  it('dispose_DefaultLink_DetachedThenReattached', async () => {
    const { loader, appended, inHead } = loaderWith(
      undefined,
      readTestLayout,
      'bundled.css',
    );

    loader.dispose();
    const afterDispose = shownLinks(inHead);
    await loader.load(setOf(), []);

    expect(afterDispose).toEqual([]);
    expect(shownLinks(inHead)).toEqual([
      { layout: 'default', href: 'bundled.css' },
    ]);
    expect(appended).toHaveLength(1);
  });
});
