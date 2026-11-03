import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FenceContribution } from '../../contracts/markdown';
import { createMarkdownMount, type MarkdownMount } from './markdown-mount';
import {
  fencePlaceholder,
  installMarkdownDom,
} from './markdown-mount.test-support';
import { asFake, type FakeElement } from './test-dom';

// A view a fake contribution mounted, counting its disposals.
interface FakeView {
  element: HTMLElement;
  source: string;
  disposals: number;
  dispose(): void;
}

// `html` (live) and `fmt` (formats only), recording each mount and view. A
// source `boom` makes `mount` throw `boom`; a view of source `bad` throws
// `boom` from `dispose`.
function fakeFences() {
  const mounts: { language: string; source: string; closed: boolean }[] = [];
  const views: FakeView[] = [];
  const contribution = (
    language: string,
    live: boolean,
  ): FenceContribution => ({
    language,
    live,
    mount(source, closed) {
      if (source === 'boom') {
        throw new Error('boom');
      }
      mounts.push({ language, source, closed });
      const view: FakeView = {
        element: document.createElement('div'),
        source,
        disposals: 0,
        dispose() {
          view.disposals += 1;
          if (source === 'bad') {
            throw new Error('boom');
          }
        },
      };
      views.push(view);
      return view;
    },
  });
  const registered: Record<string, FenceContribution> = {
    html: contribution('html', true),
    fmt: contribution('fmt', false),
  };
  const fences = { fence: (language: string) => registered[language] };
  return { fences, mounts, views };
}

const html = (source: string, closed = true) =>
  fencePlaceholder('html', closed, source);

function newElement(): HTMLElement {
  return document.createElement('div');
}

function placeholdersIn(target: HTMLElement): FakeElement[] {
  return asFake(target).querySelectorAll('.md-fence');
}

// The index in `views` of the view each placeholder in `target` holds; -1
// for a placeholder still holding its code.
function viewsIn(target: HTMLElement, views: FakeView[]): number[] {
  return placeholdersIn(target).map((placeholder) =>
    views.findIndex(
      (view) => asFake(view.element) === placeholder.childNodes[0],
    ),
  );
}

describe('createMarkdownMount', () => {
  let moves: { element: unknown; to: unknown }[];
  let logs: [string, string][];
  let fake: ReturnType<typeof fakeFences>;
  let mount: MarkdownMount;
  let parent: HTMLElement;
  let target: HTMLElement;

  beforeEach(() => {
    ({ moves } = installMarkdownDom((name, value) =>
      vi.stubGlobal(name, value),
    ));
    logs = [];
    fake = fakeFences();
    mount = createMarkdownMount(fake.fences, (source, message) =>
      logs.push([source, message]),
    );
    parent = newElement();
    target = newElement();
    parent.append(target);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hydrates registered placeholders and leaves the rest as code', () => {
    mount.draw(
      target,
      `<p>intro</p>${html('a')}${html('b', false)}${fencePlaceholder('zzz', true, 'c')}`,
    );

    expect(fake.mounts).toEqual([
      { language: 'html', source: 'a', closed: true },
      { language: 'html', source: 'b', closed: false },
    ]);
    expect(viewsIn(target, fake.views)).toEqual([0, 1, -1]);
    expect(placeholdersIn(target)[2].children[0].tagName).toBe('PRE');
  });

  it.each([
    { language: 'html', liveFences: true, result: 'mounted', mounts: 1 },
    { language: 'html', liveFences: false, result: 'code', mounts: 0 },
    { language: 'fmt', liveFences: false, result: 'mounted', mounts: 1 },
  ])(
    'with live fences $liveFences, a $language fence is $result',
    ({ language, liveFences, mounts }) => {
      mount.draw(target, fencePlaceholder(language, true, 'a'), { liveFences });

      expect(fake.mounts).toHaveLength(mounts);
      const held = placeholdersIn(target)[0].children[0];
      expect(held.tagName).toBe(mounts === 0 ? 'PRE' : 'DIV');
    },
  );

  it.each([
    {
      name: 'a redraw of the same fence into its target keeps its view',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        draw(old, html('a'));
        return old;
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [0],
    },
    {
      name: 'a changed source mounts a new view and disposes the old',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        draw(old, html('b'));
        return old;
      },
      mounts: [
        { source: 'a', closed: true },
        { source: 'b', closed: true },
      ],
      disposals: [1, 0],
      holds: [1],
    },
    {
      name: 'a block that closes mounts a new view and disposes the open one',
      first: html('a', false),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        draw(old, html('a'));
        return old;
      },
      mounts: [
        { source: 'a', closed: false },
        { source: 'a', closed: true },
      ],
      disposals: [1, 0],
      holds: [1],
    },
    {
      name: 'a new target drawn before the old one is removed keeps the view',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const next = newElement();
        (old.parentNode as HTMLElement).append(next);
        draw(next, html('a'));
        old.remove();
        return next;
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [0],
    },
    {
      name: 'a new target drawn after the parent was emptied keeps the view',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const host = old.parentNode as HTMLElement;
        host.replaceChildren();
        const next = newElement();
        host.append(next);
        draw(next, html('a'));
        return next;
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [0],
    },
    {
      name: 'two equal fences keep a view each',
      first: html('a') + html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        draw(old, html('a') + html('a'));
        return old;
      },
      mounts: [
        { source: 'a', closed: true },
        { source: 'a', closed: true },
      ],
      disposals: [0, 0],
      holds: [0, 1],
    },
  ])('$name', async ({ first, redraw, mounts, disposals, holds }) => {
    mount.draw(target, first);
    const shown = redraw((...args) => mount.draw(...args), target);
    await Promise.resolve();

    expect(
      fake.mounts.map(({ source, closed }) => ({ source, closed })),
    ).toEqual(mounts);
    expect(fake.views.map((view) => view.disposals)).toEqual(disposals);
    expect(viewsIn(shown, fake.views)).toEqual(holds);
  });

  it('gives a staying sibling its view back and mounts a new one', async () => {
    mount.draw(target, html('a'));
    const next = newElement();
    parent.append(next);
    mount.draw(next, html('a'));
    await Promise.resolve();

    expect(fake.mounts).toHaveLength(2);
    expect(fake.views.map((view) => view.disposals)).toEqual([0, 0]);
    expect(viewsIn(target, fake.views)).toEqual([0]);
    expect(viewsIn(next, fake.views)).toEqual([1]);
  });

  it.each([
    { rule: 'moveBefore', case: 'both targets are connected', connected: true },
    {
      rule: 'replaceChildren',
      case: 'the parent is not connected',
      connected: false,
    },
  ])('moves a kept view with $rule when $case', async ({ connected }) => {
    asFake(parent).isPageRoot = connected;
    mount.draw(target, html('a'));
    const next = newElement();
    parent.append(next);
    mount.draw(next, html('a'));
    target.remove();
    await Promise.resolve();

    const placeholder = placeholdersIn(next)[0];
    expect(placeholder.childNodes).toEqual([asFake(fake.views[0].element)]);
    expect(moves).toEqual(
      connected
        ? [{ element: asFake(fake.views[0].element), to: placeholder }]
        : [],
    );
  });

  it.each([
    {
      part: 'a contribution’s mount',
      run: async () => {
        mount.draw(target, html('boom'));
        expect(placeholdersIn(target)[0].children[0].tagName).toBe('PRE');
      },
      line: 'fence html not mounted: boom',
    },
    {
      part: 'a view’s dispose during dispose',
      run: async () => {
        mount.draw(target, html('bad') + html('ok'));
        mount.dispose();
        expect(fake.views.map((view) => view.disposals)).toEqual([1, 1]);
      },
      line: 'fence html view dispose failed: boom',
    },
    {
      part: 'a view’s dispose during the sweep',
      run: async () => {
        mount.draw(target, html('bad') + html('ok'));
        mount.draw(target, '<p>none</p>');
        await Promise.resolve();
        expect(fake.views.map((view) => view.disposals)).toEqual([1, 1]);
      },
      line: 'fence html view dispose failed: boom',
    },
  ])('logs and goes on when $part throws', async ({ run, line }) => {
    await run();

    expect(logs).toEqual([['markdown', line]]);
  });

  it('leaves a view in another parent alone', async () => {
    const otherParent = newElement();
    const otherTarget = newElement();
    otherParent.append(otherTarget);
    mount.draw(target, html('a'));
    mount.draw(otherTarget, html('b'));
    const next = newElement();
    parent.append(next);
    mount.draw(next, '<p>none</p>');
    await Promise.resolve();

    expect(fake.views.map((view) => view.disposals)).toEqual([0, 0]);
    expect(viewsIn(otherTarget, fake.views)).toEqual([1]);
  });

  it('disposes every view once and mounts nothing after dispose', () => {
    mount.draw(target, html('a') + html('b'));
    mount.dispose();
    mount.dispose();
    mount.draw(newElement(), html('c'));

    expect(fake.views.map((view) => view.disposals)).toEqual([1, 1]);
    expect(fake.mounts).toHaveLength(2);
  });
});
