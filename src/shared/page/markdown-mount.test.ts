import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FenceContribution } from '../../contracts/markdown';
import { createMarkdownMount, type MarkdownMount } from './markdown-mount';
import {
  fencePlaceholder,
  installMarkdownDom,
  localVideo,
  plainCode,
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
  return { fences, registered, mounts, views };
}

const html = (source: string, closed = true) =>
  fencePlaceholder('html', closed, source);

function newElement(): HTMLElement {
  return document.createElement('div');
}

// A new element appended to `target`'s parent.
function siblingOf(target: HTMLElement): HTMLElement {
  const sibling = newElement();
  (target.parentNode as HTMLElement).append(sibling);
  return sibling;
}

function placeholdersIn(target: HTMLElement): FakeElement[] {
  return asFake(target).querySelectorAll('.md-fence');
}

// The index in `views` of the view each placeholder in `target` holds; -1
// for a placeholder still holding its code, null for an empty one.
function viewsIn(target: HTMLElement, views: FakeView[]): (number | null)[] {
  return placeholdersIn(target).map((placeholder) => {
    const held = placeholder.childNodes[0];
    if (held === undefined) {
      return null;
    }
    return views.findIndex((view) => asFake(view.element) === held);
  });
}

describe('createMarkdownMount', () => {
  let logs: string[];
  let dom: ReturnType<typeof installMarkdownDom>;
  let fake: ReturnType<typeof fakeFences>;
  let mount: MarkdownMount;
  let parent: HTMLElement;
  let target: HTMLElement;

  beforeEach(() => {
    dom = installMarkdownDom((name, value) => vi.stubGlobal(name, value));
    logs = [];
    fake = fakeFences();
    mount = createMarkdownMount(fake.fences, (message: string) =>
      logs.push(message),
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

  it('puts one copy button on each plain code block and none in a fence', () => {
    mount.draw(
      target,
      `${plainCode('a')}${fencePlaceholder('zzz', true, 'b')}${plainCode('c')}`,
    );

    const blocks = asFake(target).querySelectorAll('pre');
    expect(
      blocks.map((pre) => pre.children.map((child) => child.tagName)),
    ).toEqual([['BUTTON', 'CODE'], ['CODE'], ['BUTTON', 'CODE']]);
    expect(asFake(target).querySelectorAll('.md-copy')).toHaveLength(2);
  });

  it.each([
    { name: 'no fence', fence: '' },
    { name: 'a kept fence view', fence: html('a') },
  ])(
    'keeps a shown video of the same source across a redraw, with $name',
    ({ fence }) => {
      const videos = () => asFake(target).querySelectorAll('video');
      mount.draw(
        target,
        `${fence}${localVideo('/a.mp4', 'old')}${localVideo('/b.mp4', 'b')}`,
      );
      const [shownA, shownB] = videos();

      mount.draw(
        target,
        `${fence}<p>more</p>${localVideo('/a.mp4', 'new')}${localVideo('/c.mp4', 'c')}`,
      );

      const [keptA, drawnC] = videos();
      expect(keptA).toBe(shownA);
      expect(keptA.getAttribute('title')).toBe('new');
      expect(drawnC).not.toBe(shownB);
      expect(drawnC.getAttribute('src')).toBe('/c.mp4');
    },
  );

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

  // `connected` puts `parent` in the page; `moved` lists each `moveBefore`
  // as the view it moved and the index in `shown` of the element whose
  // placeholder it moved into, none when left out.
  it.each<{
    name: string;
    first: string;
    redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => HTMLElement[];
    mounts: { source: string; closed: boolean }[];
    disposals: number[];
    holds: (number | null)[][];
    connected?: true;
    moved?: { view: number; into: number }[];
  }>([
    {
      name: 'a redraw of the same fence into its target keeps its view',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        draw(old, html('a'));
        return [old];
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [[0]],
    },
    {
      name: 'a changed source mounts a new view and disposes the old',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        draw(old, html('b'));
        return [old];
      },
      mounts: [
        { source: 'a', closed: true },
        { source: 'b', closed: true },
      ],
      disposals: [1, 0],
      holds: [[1]],
    },
    {
      name: 'a block that closes mounts a new view and disposes the open one',
      first: html('a', false),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        draw(old, html('a'));
        return [old];
      },
      mounts: [
        { source: 'a', closed: false },
        { source: 'a', closed: true },
      ],
      disposals: [1, 0],
      holds: [[1]],
    },
    {
      name: 'a new target drawn before the old one is removed keeps the view',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const next = newElement();
        (old.parentNode as HTMLElement).append(next);
        draw(next, html('a'));
        old.remove();
        return [next];
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [[0]],
    },
    {
      name: 'a view kept for a new target in the page moves through moveBefore',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const next = siblingOf(old);
        draw(next, html('a'));
        old.remove();
        return [next];
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [[0]],
      connected: true,
      moved: [{ view: 0, into: 0 }],
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
        return [next];
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [[0]],
    },
    {
      name: 'two equal fences keep a view each',
      first: html('a') + html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        draw(old, html('a') + html('a'));
        return [old];
      },
      mounts: [
        { source: 'a', closed: true },
        { source: 'a', closed: true },
      ],
      disposals: [0, 0],
      holds: [[0, 1]],
    },
    {
      name: 'a staying sibling gets its view back and the new target a new one',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const next = siblingOf(old);
        draw(next, html('a'));
        return [old, next];
      },
      mounts: [
        { source: 'a', closed: true },
        { source: 'a', closed: true },
      ],
      disposals: [0, 0],
      holds: [[0], [1]],
    },
    {
      name: 'a new target takes the view of a sibling that redrew without it',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        draw(old, '<p>none</p>');
        const next = siblingOf(old);
        draw(next, html('a'));
        return [old, next];
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [[], [0]],
    },
    {
      name: 'two new targets beside a staying sibling get a view each',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const first = siblingOf(old);
        const second = siblingOf(old);
        draw(first, html('a'));
        draw(second, html('a'));
        return [old, first, second];
      },
      mounts: [
        { source: 'a', closed: true },
        { source: 'a', closed: true },
        { source: 'a', closed: true },
      ],
      disposals: [0, 0, 0],
      holds: [[0], [2], [1]],
    },
    {
      name: 'a target moved to another parent keeps its view',
      first: html('a'),
      redraw: (_draw: MarkdownMount['draw'], old: HTMLElement) => {
        newElement().append(old);
        return [old];
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [[0]],
    },
    {
      name: 'a target removed with no draw taking its view disposes it',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const next = siblingOf(old);
        draw(next, '<p>none</p>');
        old.remove();
        return [next];
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [1],
      holds: [[]],
    },
    {
      name: 'a lent view stays with its borrower once its target redraws without it',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const next = siblingOf(old);
        draw(next, html('a'));
        draw(old, '<p>none</p>');
        return [old, next];
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [[], [0]],
    },
    {
      name: 'a lent view is disposed once its borrower redrew and its target left',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const next = siblingOf(old);
        draw(next, html('a'));
        draw(next, html('a'));
        old.remove();
        return [next];
      },
      mounts: [
        { source: 'a', closed: true },
        { source: 'a', closed: true },
      ],
      disposals: [1, 0],
      holds: [[1]],
    },
    {
      name: 'a lent view stays with its borrower once its target redrew and left',
      first: html('a') + html('b'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const next = siblingOf(old);
        draw(next, html('a'));
        draw(old, html('b'));
        old.remove();
        return [next];
      },
      mounts: [
        { source: 'a', closed: true },
        { source: 'b', closed: true },
      ],
      disposals: [0, 1],
      holds: [[0]],
    },
    {
      name: 'a view given back leaves its borrower its code when nothing mounts there',
      first: html('a'),
      redraw: (draw: MarkdownMount['draw'], old: HTMLElement) => {
        const next = siblingOf(old);
        draw(next, html('a'));
        delete fake.registered.html;
        return [old, next];
      },
      mounts: [{ source: 'a', closed: true }],
      disposals: [0],
      holds: [[0], [-1]],
    },
  ])(
    '$name',
    async ({ first, redraw, mounts, disposals, holds, connected, moved }) => {
      asFake(parent).isPageRoot = connected === true;
      mount.draw(target, first);
      const shown = redraw((...args) => mount.draw(...args), target);
      await Promise.resolve();

      expect(
        fake.mounts.map(({ source, closed }) => ({ source, closed })),
      ).toEqual(mounts);
      expect(fake.views.map((view) => view.disposals)).toEqual(disposals);
      expect(shown.map((each) => viewsIn(each, fake.views))).toEqual(holds);
      expect(
        dom.moves.map(({ element, to }) => ({
          view: fake.views.findIndex(
            (view) => asFake(view.element) === element,
          ),
          into: shown.findIndex((each) =>
            placeholdersIn(each).includes(to as FakeElement),
          ),
        })),
      ).toEqual(moved ?? []);
    },
  );

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

    expect(logs).toEqual([line]);
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
