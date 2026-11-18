import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asFake, asHtml, FakeElement, installFakeDom } from '../test-dom';
import type { RollbackDeps } from './draw-part';
import { createLayoutParts } from './layout-parts';
import { withUser } from './test-layouts';

type Part = (parent: HTMLElement, rollback: RollbackDeps) => HTMLElement;

interface TestLayout {
  rail?: Part;
  head?: Part;
}

// Draws an `article` reading `text`, recording one anchor that pushes
// `<text> disposed` to `undone` on its dispose.
function drawsArticle(text: string, undone: string[] = []): Part {
  return (parent, rollback) => {
    const article = new FakeElement('article');
    article.textContent = text;
    parent.append(asHtml(article));
    rollback.recordAnchor({ dispose: () => undone.push(`${text} disposed`) });
    return asHtml(article);
  };
}

function partsSetup(undone: string[] = []) {
  const logLines: string[] = [];
  const defaultLayout: Required<TestLayout> = {
    rail: drawsArticle('default rail', undone),
    head: drawsArticle('default head', undone),
  };
  const parts = createLayoutParts<TestLayout, Required<TestLayout>>({
    owner: 'docs',
    defaultLayout,
    log: (line: string) => logLines.push(line),
  });
  return { parts, defaultLayout, logLines };
}

const build = (part: Part, parent: HTMLElement, rollback: RollbackDeps) => ({
  element: part(parent, rollback),
});

describe('createLayoutParts', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { row: 'before setLayouts', user: null, rail: 'default rail' },
    {
      row: 'the user layout defines the part',
      user: { rail: drawsArticle('mine rail') },
      rail: 'mine rail',
    },
    {
      row: 'the user layout lacks the part',
      user: { head: drawsArticle('mine head') },
      rail: 'default rail',
    },
  ])('draw_PicksTheUsersPartElseDefault: $row', ({ user, rail }) => {
    const { parts, defaultLayout } = partsSetup();
    if (user !== null) {
      parts.setLayouts(withUser<TestLayout>(defaultLayout, user));
    }
    const parent = asHtml(new FakeElement('div'));

    const drawn = parts.draw('rail', parent, build);

    expect(asFake(drawn.built.element).textContent).toBe(rail);
    expect(asFake(drawn.built.element).dataset.layoutOwner).toBe('docs');
  });

  it('draw_UserPartThrows_LoggedUnderTheOwnerAndDefaultDraws', () => {
    const { parts, defaultLayout, logLines } = partsSetup();
    parts.setLayouts(
      withUser<TestLayout>(defaultLayout, {
        rail: () => {
          throw new Error('boom');
        },
      }),
    );

    const drawn = parts.draw('rail', asHtml(new FakeElement('div')), build);

    expect(drawn.layoutName).toBe('default');
    expect(logLines).toEqual(['layout mine rail failed: boom']);
  });

  it('redraw_SameSlot_DisposesAndRemovesTheLastDrawOnly', () => {
    const undone: string[] = [];
    const { parts } = partsSetup(undone);
    const parent = new FakeElement('div');

    const firstRail = parts.redraw('rail', asHtml(parent), build);
    const head = parts.redraw('head', asHtml(parent), build);
    const otherRail = parts.redraw('rail', asHtml(parent), build, 'rail 2');
    expect(undone).toEqual([]);
    const secondRail = parts.redraw('rail', asHtml(parent), build);

    expect(undone).toEqual(['default rail disposed']);
    expect(parent.children).toEqual(
      [head, otherRail, secondRail].map((drawn) => asFake(drawn.built.element)),
    );
    expect(firstRail.built.element).not.toBe(secondRail.built.element);
    parts.dispose();
    parts.dispose();
    expect(undone).toEqual([
      'default rail disposed',
      'default head disposed',
      'default rail disposed',
      'default rail disposed',
    ]);
  });

  it('dispose still disposes every other draw when one throws, then rethrows', () => {
    const undone: string[] = [];
    const { parts } = partsSetup(undone);
    const parent = asHtml(new FakeElement('div'));
    parts.redraw('rail', parent, (part, host, rollback) => {
      const element = part(host, rollback);
      rollback.recordAnchor({
        dispose: () => {
          throw new Error('stuck');
        },
      });
      return { element };
    });
    parts.redraw('head', parent, build);

    expect(() => parts.dispose()).toThrow('stuck');

    expect(undone).toEqual(['default rail disposed', 'default head disposed']);
  });

  it('redraw_LastDrawsDisposeThrows_ItsElementRemovedAndRethrown', () => {
    const { parts, defaultLayout } = partsSetup();
    parts.setLayouts(
      withUser<TestLayout>(defaultLayout, {
        rail: (parent, rollback) => {
          rollback.recordAnchor({
            dispose: () => {
              throw new Error('stuck');
            },
          });
          return drawsArticle('mine rail')(parent, rollback);
        },
      }),
    );
    const parent = new FakeElement('div');
    parts.redraw('rail', asHtml(parent), build);

    expect(() => parts.redraw('rail', asHtml(parent), build)).toThrow('stuck');
    expect(parent.children).toEqual([]);
  });
});
