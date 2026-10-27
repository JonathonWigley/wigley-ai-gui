import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asFake, asHtml, FakeElement, installFakeDom } from '../test-dom';
import {
  type DrawPartOptions,
  drawPart,
  type RollbackDeps,
  requireElementIn,
} from './draw-part';

// A rail part: draws into `parent` and returns the element it drew, or does
// what a broken layout does.
type Rail = (parent: HTMLElement, rollback: RollbackDeps) => Built;

interface Built {
  element: HTMLElement;
}

interface TestLayout {
  rail?: Rail;
}

// Draws an `article` tagged `name` into `parent`.
function drawsArticle(name: string): Rail {
  return (parent) => {
    const element = asHtml(new FakeElement('article'));
    element.textContent = name;
    parent.append(element);
    return { element };
  };
}

// What a part recorded: each box destroyed and each anchor disposed, by name.
function recorded() {
  const undone: string[] = [];
  return {
    undone,
    box: (name: string) => () => undone.push(`box ${name}`),
    anchor: (name: string) => ({
      dispose: () => undone.push(`anchor ${name}`),
    }),
  };
}

const DEFAULT_LAYOUT: TestLayout = { rail: drawsArticle('default') };

function drawRail(
  pick: { name: string; layout: TestLayout },
  overrides: Partial<DrawPartOptions<TestLayout, Rail, Built>> = {},
) {
  const parent = asHtml(new FakeElement('div'));
  const logLines: string[] = [];
  const build = vi.fn((rail: Rail, into: HTMLElement, rollback: RollbackDeps) =>
    rail(into, rollback),
  );
  const call = () =>
    drawPart<TestLayout, Rail, Built>({
      owner: 'forms',
      parent,
      pick,
      defaultLayout: DEFAULT_LAYOUT,
      part: (layout) => layout.rail,
      build,
      log: (source, message) => logLines.push(`[${source}] ${message}`),
      logSource: 'forms',
      partName: 'rail',
      ...overrides,
    });
  return { parent: asFake(parent), logLines, build, call };
}

describe('drawPart', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drawPart_PickedPartDraws_MarkedWithItsNameAndTheOwner', () => {
    const rail = drawRail({
      name: 'fancy',
      layout: { rail: drawsArticle('fancy') },
    });

    const drawn = rail.call();

    expect(drawn.layoutName).toBe('fancy');
    expect(asFake(drawn.built.element).textContent).toBe('fancy');
    expect(asFake(drawn.built.element).dataset).toEqual({
      layout: 'fancy',
      layoutOwner: 'forms',
    });
    expect(rail.logLines).toEqual([]);
  });

  it('drawPart_PickLacksThePart_DefaultDrawsWithNoLog', () => {
    const rail = drawRail({ name: 'bare', layout: {} });

    const drawn = rail.call();

    expect(drawn.layoutName).toBe('default');
    expect(asFake(drawn.built.element).dataset).toEqual({
      layout: 'default',
      layoutOwner: 'forms',
    });
    expect(rail.logLines).toEqual([]);
  });

  it('drawPart_PickedThrowsAfterMountingAnchoringAndAppending_RolledBackAndDefaultDraws', () => {
    const record = recorded();
    const rail = drawRail({
      name: 'fancy',
      layout: {
        rail: (parent, rollback) => {
          rollback.recordBox(record.box('notes'));
          rollback.recordAnchor(record.anchor('next'));
          parent.append(asHtml(new FakeElement('section')));
          throw new Error('boom');
        },
      },
    });

    const drawn = rail.call();

    expect(record.undone).toEqual(['box notes', 'anchor next']);
    expect(rail.parent.children).toEqual([asFake(drawn.built.element)]);
    expect(rail.logLines).toEqual(['[forms] layout fancy rail failed: boom']);
    expect(asFake(drawn.built.element).dataset).toEqual({
      layout: 'default',
      layoutOwner: 'forms',
    });
  });

  it('drawPart_PickedReturnsAnElementNotInParent_LoggedAndDefaultDraws', () => {
    const rail = drawRail({
      name: 'stray',
      layout: { rail: () => ({ element: asHtml(new FakeElement('div')) }) },
    });

    const drawn = rail.call();

    expect(rail.logLines).toEqual([
      "[forms] layout stray rail failed: rail's element is not appended to parent",
    ]);
    expect(drawn.layoutName).toBe('default');
  });

  it('drawPart_DefaultThrows_RolledBackAndRethrownWithNoLog', () => {
    const record = recorded();
    const rail = drawRail(
      { name: 'default', layout: {} },
      {
        defaultLayout: {
          rail: (parent, rollback) => {
            rollback.recordAnchor(record.anchor('next'));
            parent.append(asHtml(new FakeElement('section')));
            throw new Error('default broke');
          },
        },
      },
    );

    expect(() => rail.call()).toThrow('default broke');
    expect(record.undone).toEqual(['anchor next']);
    expect(rail.parent.children).toEqual([]);
    expect(rail.logLines).toEqual([]);
    expect(rail.build).toHaveBeenCalledOnce();
  });

  it('drawPart_DefaultLacksThePart_Throws', () => {
    const rail = drawRail({ name: 'bare', layout: {} }, { defaultLayout: {} });

    expect(() => rail.call()).toThrow('layout default has no rail');
  });

  it.each([
    {
      row: 'picked draws after recording one anchor and one box',
      picked:
        (record: ReturnType<typeof recorded>): Rail =>
        (parent, rollback) => {
          rollback.recordAnchor(record.anchor('picked'));
          rollback.recordBox(record.box('picked'));
          return drawsArticle('fancy')(parent, rollback);
        },
      defaultRail: drawsArticle('default'),
      undoneByDraw: [],
      undoneByDispose: ['box picked', 'anchor picked'],
    },
    {
      row: 'picked throws after recording, default records its own',
      picked:
        (record: ReturnType<typeof recorded>): Rail =>
        (_parent, rollback) => {
          rollback.recordAnchor(record.anchor('picked'));
          throw new Error('boom');
        },
      defaultRail: ((parent, rollback) => {
        rollback.recordAnchor({ dispose: () => undefined });
        return drawsArticle('default')(parent, rollback);
      }) satisfies Rail,
      undoneByDraw: ['anchor picked'],
      undoneByDispose: [],
    },
  ])(
    'drawPart_Dispose_DisposesOnlyTheSuccessfulAttempt: $row',
    ({ picked, defaultRail, undoneByDraw, undoneByDispose }) => {
      const record = recorded();
      const defaultLayout: TestLayout = {
        rail: (parent, rollback) =>
          defaultRail(parent, {
            ...rollback,
            recordAnchor: (anchor) =>
              rollback.recordAnchor({
                dispose: () => {
                  anchor.dispose();
                  record.undone.push('anchor default');
                },
              }),
          }),
      };
      const rail = drawRail(
        { name: 'fancy', layout: { rail: picked(record) } },
        { defaultLayout },
      );

      const drawn = rail.call();
      expect(record.undone).toEqual(undoneByDraw);
      record.undone.length = 0;
      drawn.dispose();
      drawn.dispose();

      const defaultDrew = drawn.layoutName === 'default';
      expect(record.undone).toEqual(
        defaultDrew ? ['anchor default'] : undoneByDispose,
      );
      expect(rail.parent.children).toEqual([asFake(drawn.built.element)]);
    },
  );

  it('drawPart_SameLayoutFailsTwice_LogsOnce', () => {
    const throwing: Rail = () => {
      throw new Error('boom');
    };
    const broken: TestLayout = { rail: throwing };
    const first = drawRail({ name: 'fancy', layout: broken });
    const second = drawRail({ name: 'fancy', layout: broken });
    const fixedThenBroken = drawRail({
      name: 'fancy',
      layout: { rail: throwing },
    });

    const drawnFirst = first.call();
    const drawnSecond = second.call();
    fixedThenBroken.call();

    expect(first.logLines).toEqual(['[forms] layout fancy rail failed: boom']);
    expect(second.logLines).toEqual([]);
    expect(fixedThenBroken.logLines).toEqual([
      '[forms] layout fancy rail failed: boom',
    ]);
    expect([drawnFirst.layoutName, drawnSecond.layoutName]).toEqual([
      'default',
      'default',
    ]);
  });
});

describe('requireElementIn', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      row: 'undefined',
      element: () => undefined,
      error: 'rail returned no element',
    },
    {
      row: 'a string',
      element: () => 'rail',
      error: 'rail returned no element',
    },
    {
      row: 'an element in another parent',
      element: () => {
        const other = new FakeElement('div');
        const child = new FakeElement('div');
        other.append(child);
        return child;
      },
      error: "rail's element is not appended to parent",
    },
  ])('requireElementIn_Rejects: $row', ({ element, error }) => {
    const parent = asHtml(new FakeElement('div'));

    expect(() => requireElementIn(parent, element(), 'rail')).toThrow(error);
  });
});
