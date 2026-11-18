import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asFake, asHtml, FakeElement, installFakeDom } from '../test-dom';
import {
  type DrawnPart,
  type DrawPartOptions,
  disposeDraws,
  drawPart,
  type RollbackDeps,
  requireDialogFrame,
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

// A rail that throws `boom` before drawing.
const throwsBoom: Rail = () => {
  throw new Error('boom');
};

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
      log: (message: string) => logLines.push(message),
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

  it.each([
    {
      row: 'user layout draws',
      pick: { name: 'fancy', layout: { rail: drawsArticle('fancy') } },
      drewBundled: false,
      layoutName: 'fancy',
      text: 'fancy',
      dataset: { layout: 'fancy', layoutOwner: 'forms' },
      logLines: [],
    },
    {
      row: 'user layout lacks the part',
      pick: { name: 'bare', layout: {} },
      drewBundled: true,
      layoutName: 'default',
      text: 'default',
      dataset: { layout: 'default', layoutOwner: 'forms' },
      logLines: [],
    },
    {
      row: 'user layout throws',
      pick: { name: 'fancy', layout: { rail: throwsBoom } },
      drewBundled: true,
      layoutName: 'default',
      text: 'default',
      dataset: { layout: 'default', layoutOwner: 'forms' },
      logLines: ['layout fancy rail failed: boom'],
    },
    {
      row: 'the bundled default picked as default',
      pick: { name: 'default', layout: DEFAULT_LAYOUT },
      drewBundled: true,
      layoutName: 'default',
      text: 'default',
      dataset: { layout: 'default', layoutOwner: 'forms' },
      logLines: [],
    },
    {
      row: 'a live default draws',
      pick: { name: 'default', layout: { rail: drawsArticle('live') } },
      drewBundled: false,
      layoutName: 'default',
      text: 'live',
      dataset: { layout: 'default', layoutOwner: 'forms' },
      logLines: [],
    },
    {
      row: 'a live default throws',
      pick: { name: 'default', layout: { rail: throwsBoom } },
      drewBundled: true,
      layoutName: 'default',
      text: 'default',
      dataset: { layout: 'default', layoutOwner: 'forms' },
      logLines: ['layout default rail failed: boom'],
    },
    {
      row: 'a live default lacks the part',
      pick: { name: 'default', layout: {} },
      drewBundled: true,
      layoutName: 'default',
      text: 'default',
      dataset: { layout: 'default', layoutOwner: 'forms' },
      logLines: [],
    },
  ])(
    'drewBundled is true only when the bundled default drew ($row)',
    ({ pick, drewBundled, layoutName, text, dataset, logLines }) => {
      const rail = drawRail(pick);

      const drawn = rail.call();

      expect({
        drewBundled: drawn.drewBundled,
        layoutName: drawn.layoutName,
        text: asFake(drawn.built.element).textContent,
        dataset: asFake(drawn.built.element).dataset,
      }).toEqual({ drewBundled, layoutName, text, dataset });
      expect(rail.logLines).toEqual(logLines);
    },
  );

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
    expect(rail.logLines).toEqual(['layout fancy rail failed: boom']);
    expect(asFake(drawn.built.element).dataset).toEqual({
      layout: 'default',
      layoutOwner: 'forms',
    });
  });

  it('drawPart_PickedAddsANodeBesideItsElement_RemovedLoggedAndDefaultDraws', () => {
    const rail = drawRail({
      name: 'spill',
      layout: {
        rail: (parent, rollback) => {
          parent.append(asHtml(new FakeElement('aside')));
          return drawsArticle('spill')(parent, rollback);
        },
      },
    });

    const drawn = rail.call();

    expect(rail.logLines).toEqual([
      'layout spill rail failed: rail added nodes beside its element',
    ]);
    expect(rail.parent.children).toEqual([asFake(drawn.built.element)]);
    expect(drawn.layoutName).toBe('default');
  });

  it('drawPart_RollbackUndoThrows_UndoesTheRestAndRemovesTheAppended', () => {
    const record = recorded();
    const rail = drawRail({
      name: 'fancy',
      layout: {
        rail: (parent, rollback) => {
          rollback.recordBox(() => {
            throw new Error('stuck');
          });
          rollback.recordAnchor(record.anchor('next'));
          parent.append(asHtml(new FakeElement('section')));
          throw new Error('boom');
        },
      },
    });

    const drawn = rail.call();

    expect(record.undone).toEqual(['anchor next']);
    expect(rail.parent.children).toEqual([asFake(drawn.built.element)]);
    expect(rail.logLines).toEqual([
      'layout fancy rail failed: boom; rollback failed: stuck',
    ]);
  });

  it('drawPart_PickedReturnsAnElementNotInParent_LoggedAndDefaultDraws', () => {
    const rail = drawRail({
      name: 'stray',
      layout: { rail: () => ({ element: asHtml(new FakeElement('div')) }) },
    });

    const drawn = rail.call();

    expect(rail.logLines).toEqual([
      "layout stray rail failed: rail's element is not appended to parent",
    ]);
    expect(drawn.layoutName).toBe('default');
  });

  it.each([
    {
      row: 'default throws',
      defaultRail:
        (record: ReturnType<typeof recorded>): Rail =>
        (parent, rollback) => {
          rollback.recordAnchor(record.anchor('next'));
          parent.append(asHtml(new FakeElement('section')));
          throw new Error('default broke');
        },
      error: 'default broke',
    },
    {
      row: 'default adds a node beside its element',
      defaultRail:
        (record: ReturnType<typeof recorded>): Rail =>
        (parent, rollback) => {
          rollback.recordAnchor(record.anchor('next'));
          parent.append(asHtml(new FakeElement('aside')));
          return drawsArticle('default')(parent, rollback);
        },
      error: 'rail added nodes beside its element',
    },
  ])(
    'drawPart_DefaultFails_RolledBackAndRethrownWithNoLog: $row',
    ({ defaultRail, error }) => {
      const record = recorded();
      const rail = drawRail(
        { name: 'default', layout: {} },
        { defaultLayout: { rail: defaultRail(record) } },
      );

      expect(() => rail.call()).toThrow(error);
      expect(record.undone).toEqual(['anchor next']);
      expect(rail.parent.children).toEqual([]);
      expect(rail.logLines).toEqual([]);
      expect(rail.build).toHaveBeenCalledOnce();
    },
  );

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
      undoneByDispose: ['anchor default'],
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

      expect(record.undone).toEqual(undoneByDispose);
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

    expect(first.logLines).toEqual(['layout fancy rail failed: boom']);
    expect(second.logLines).toEqual([]);
    expect(fixedThenBroken.logLines).toEqual([
      'layout fancy rail failed: boom',
    ]);
    expect([drawnFirst.layoutName, drawnSecond.layoutName]).toEqual([
      'default',
      'default',
    ]);
  });
});

describe('disposeDraws', () => {
  // Breaks if a throwing dispose skips the draws after it, or swallows the
  // error.
  it.each<{ row: string; throwing: string[]; error: string | null }>([
    { row: 'none throws', throwing: [], error: null },
    { row: 'the first throws', throwing: ['a'], error: 'a failed' },
    { row: 'two throw', throwing: ['a', 'c'], error: 'a failed' },
  ])(
    'disposes every draw and throws the first error after ($row)',
    ({ throwing, error }) => {
      const disposed: string[] = [];
      const draws = ['a', 'b', 'c'].map((name): DrawnPart<null> => ({
        built: null,
        layoutName: 'default',
        drewBundled: true,
        dispose() {
          disposed.push(name);
          if (throwing.includes(name)) {
            throw new Error(`${name} failed`);
          }
        },
      }));

      const run = () => disposeDraws(draws);

      if (error === null) {
        run();
      } else {
        expect(run).toThrow(error);
      }
      expect(disposed).toEqual(['a', 'b', 'c']);
    },
  );
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

// A panel holding a body and an actions row.
function panelFrame() {
  const element = new FakeElement('section');
  const body = new FakeElement('div');
  const actions = new FakeElement('div');
  element.append(body, actions);
  return {
    element: asHtml(element),
    body: asHtml(body),
    actions: asHtml(actions),
  };
}

describe('requireDialogFrame', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      row: 'frame is null',
      frame: () => null,
      hasActions: true,
      error: 'dialogFrame returned no frame',
    },
    {
      row: 'body outside the element',
      frame: () => ({
        ...panelFrame(),
        body: asHtml(new FakeElement('div')),
      }),
      hasActions: true,
      error: 'dialogFrame body is not inside its element',
    },
    {
      row: 'body not an element',
      frame: () => ({ ...panelFrame(), body: 'body' }),
      hasActions: true,
      error: 'dialogFrame body is not inside its element',
    },
    {
      row: 'body is the element',
      frame: () => {
        const frame = panelFrame();
        return { ...frame, body: frame.element };
      },
      hasActions: true,
      error: 'dialogFrame body is not inside its element',
    },
    {
      row: 'actions drawn for a dialog with none',
      frame: panelFrame,
      hasActions: false,
      error: 'dialogFrame drew actions for a dialog with none',
    },
    {
      row: 'actions undefined for a dialog with none',
      frame: () => ({ ...panelFrame(), actions: undefined }),
      hasActions: false,
      error: 'dialogFrame drew actions for a dialog with none',
    },
    {
      row: 'actions missing',
      frame: () => ({ ...panelFrame(), actions: null }),
      hasActions: true,
      error: 'dialogFrame actions is not inside its element',
    },
    {
      row: 'actions outside the element',
      frame: () => ({
        ...panelFrame(),
        actions: asHtml(new FakeElement('div')),
      }),
      hasActions: true,
      error: 'dialogFrame actions is not inside its element',
    },
    {
      row: 'actions is the element',
      frame: () => {
        const frame = panelFrame();
        return { ...frame, actions: frame.element };
      },
      hasActions: true,
      error: 'dialogFrame actions is not inside its element',
    },
    {
      row: 'actions inside body',
      frame: () => {
        const frame = panelFrame();
        frame.body.append(frame.actions);
        return frame;
      },
      hasActions: true,
      error: 'dialogFrame body and actions overlap',
    },
    {
      row: 'body inside actions',
      frame: () => {
        const frame = panelFrame();
        frame.actions.append(frame.body);
        return frame;
      },
      hasActions: true,
      error: 'dialogFrame body and actions overlap',
    },
  ])('requireDialogFrame_Rejects: $row', ({ frame, hasActions, error }) => {
    expect(() =>
      requireDialogFrame(
        frame(),
        { title: 'Rename', hasActions },
        'dialogFrame',
      ),
    ).toThrow(error);
  });

  it('requireDialogFrame_NonElementElement_ReturnsTheFrameUnchecked', () => {
    const frame = { element: 'panel', body: 'body', actions: 'actions' };

    expect(
      requireDialogFrame(
        frame,
        { title: 'Rename', hasActions: true },
        'dialogFrame',
      ),
    ).toBe(frame);
  });

  it('requireDialogFrame_ValidFrame_ReturnsIt', () => {
    const withActions = panelFrame();
    const bodyOnly = panelFrame();
    bodyOnly.actions.remove();

    const checked = requireDialogFrame(
      withActions,
      { title: 'Rename', hasActions: true },
      'dialogFrame',
    );
    const checkedBodyOnly = requireDialogFrame(
      { element: bodyOnly.element, body: bodyOnly.body, actions: null },
      { title: 'Rename', hasActions: false },
      'dialogFrame',
    );

    expect(checked.element).toBe(withActions.element);
    expect(checked.body).toBe(withActions.body);
    expect(checked.actions).toBe(withActions.actions);
    expect(checkedBodyOnly.element).toBe(bodyOnly.element);
    expect(checkedBodyOnly.body).toBe(bodyOnly.body);
    expect(checkedBodyOnly.actions).toBeNull();
  });
});
