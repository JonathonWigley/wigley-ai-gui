import { describe, expect, it } from 'vitest';
import type { LayoutEntry, LayoutSet } from '../../../contracts/layouts';
import { createLayoutLoader } from './layout-loader';

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
    owner: 'forms',
    layoutUrl,
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
    const { loader, appended } = loaderWith(() => script.promise);

    const loading = loader.load(setOf(entry('mine', 4, true)), ['mine']);
    await Promise.resolve();
    expect(appended).toEqual([]);
    script.resolve({ default: { tag: 'mine' } });
    await loading;

    expect(shownLinks(appended)).toEqual([
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

  it('load_NewRevision_ImportsAgainAndMovesLink', async () => {
    const { loader, appended, imports } = loaderWith();

    await loader.load(setOf(entry('a', 4, true)), ['a']);
    await loader.load(setOf(entry('a', 5, true)), ['a']);

    expect(imports).toEqual(['url:a/layout.js@4', 'url:a/layout.js@5']);
    expect(shownLinks(appended)).toEqual([
      { layout: 'a', href: 'url:a/layout.css@5' },
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
    const { loader, appended, imports } = loaderWith();
    const set = setOf(entry('a', 4, true));
    const first = await loader.load(set, ['a']);

    const after = await loader.load(set, []);

    expect(after.layouts.get('a')).toBe(first.layouts.get('a'));
    expect(shownLinks(appended)).toEqual([
      { layout: 'a', href: 'url:a/layout.css@4' },
    ]);
    expect(imports).toEqual(['url:a/layout.js@4']);
  });

  it('load_NameLeftOutAtNewRevision_DropsLayoutAndLink', async () => {
    const { loader, appended, imports } = loaderWith();
    await loader.load(setOf(entry('a', 4, true)), ['a']);

    const after = await loader.load(setOf(entry('a', 5, true)), []);

    expect(after.layouts.has('a')).toBe(false);
    expect(shownLinks(appended)).toEqual([]);
    expect(imports).toEqual(['url:a/layout.js@4']);
  });

  it('load_NameLeavesTheSet_DropsLayoutAndLink', async () => {
    const { loader, appended } = loaderWith();
    await loader.load(setOf(entry('a', 4, true)), ['a']);

    const after = await loader.load(setOf(), []);

    expect(after.layouts.has('a')).toBe(false);
    expect(shownLinks(appended)).toEqual([]);
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

  it('load_StylesheetLink_NamesOwner', async () => {
    const { loader, appended } = loaderWith();

    await loader.load(setOf(entry('a', 4, true)), ['a']);

    expect(appended.map((link) => link.dataset)).toEqual([
      { layout: 'a', layoutOwner: 'forms' },
    ]);
  });
});
