import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import { createPartStore } from '../../../shared/page/contributed-parts';
import {
  recordingAnchors,
  USER_LAYOUT,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { ChatComposerPart } from '../contract';
import { chatCommand } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout, ComposerInput } from '../layouts/layout';
import { createChatLayouts } from './chat-layouts';
import { createComposerSurface } from './composer-kit';
import { createSignInPart } from './dialog-kits';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

// The deps every surface takes, drawing with `user` as the user's layout,
// or with `default` alone when `user` is null, and no composer part until
// one is added to `deps.composerParts`; each anchor is kept in `anchors` and
// each log line in `logs`.
function surfaceDeps(user: ChatLayout | null) {
  const logs: string[] = [];
  const log = (_source: string, line: string) => logs.push(line);
  const layouts = createChatLayouts(log);
  if (user !== null) {
    layouts.set(withUser<ChatLayout>(defaultLayout, user));
  }
  const { anchors, keys } = recordingAnchors();
  const deps = {
    layouts,
    markdown: {
      block: (text: string) => text,
      inline: (text: string) => text,
      document: (text: string) => Promise.resolve(text),
      ...NO_FENCES,
    },
    keys,
    commands: { exists: () => true, run: () => undefined },
    platform: 'macos' as const,
    run: () => undefined,
    composerParts: createPartStore<ChatComposerPart>(),
    log,
  };
  return { deps, anchors, logs };
}

function composerInput(working: boolean): ComposerInput {
  return {
    session: 'repo',
    modeLabel: 'PAGE',
    isBoxFocused: false,
    running: true,
    working,
    controls: [{ id: 'mode', label: 'Mode', value: 'Auto', enabled: true }],
  };
}

// A part root appended to `parent`, as every part appends its root.
function rootIn(parent: HTMLElement): HTMLElement {
  const root = document.createElement('div');
  parent.append(root);
  return root;
}

// A composer part recording `build:<id>:<sessionId>` and
// `dispose:<id>:<sessionId>` into `record`.
function recordingPart(id: string, record: string[]): ChatComposerPart {
  return {
    id,
    build(_parent, sessionId) {
      record.push(`build:${id}:${sessionId}`);
      return { dispose: () => record.push(`dispose:${id}:${sessionId}`) };
    },
  };
}

// A box frame with an editor inside, as the app mounts one.
function boxWithEditor(): FakeElement {
  const box = new FakeElement('div');
  box.append(new FakeElement('div'));
  return box;
}

describe('composer surface parts', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Draws the composer with `user` into a fresh tab root, `parts` held.
  function drawComposer(user: ChatLayout, parts: ChatComposerPart[] = []) {
    const { deps, logs } = surfaceDeps(user);
    for (const part of parts) {
      deps.composerParts.add(part);
    }
    const box = boxWithEditor();
    const surface = createComposerSurface(deps, {
      sessionId: 'row-1',
      box: asHtml(box),
      removeImage: () => undefined,
    });
    const root = surface.drawComposer(
      asHtml(new FakeElement('div')),
      composerInput(false),
    );
    return { root: asFake(root), pieces: [box], logs };
  }

  // Draws the sign-in dialog's part with `user` into a fresh body.
  function drawSignIn(user: ChatLayout) {
    const { deps, logs } = surfaceDeps(user);
    const body = new FakeElement('div');
    const codeBox = boxWithEditor();
    const actions = new FakeElement('div');
    const part = createSignInPart(deps, asHtml(body), {
      codeBox: asHtml(codeBox),
      copy: asHtml(new FakeElement('button')) as HTMLButtonElement,
      actions: asHtml(actions),
    });
    part.draw({ profile: 'work', link: null });
    return { root: body.children[0], pieces: [codeBox, actions], logs };
  }

  it.each([
    {
      name: 'a composer that never calls kit.box',
      draw: () =>
        drawComposer({
          composer: (parent, _input, kit) => ({
            element: kit.floatingPanel(parent),
          }),
        }),
      layout: 'mine',
      endsWithPieces: true,
      startsWithParts: false,
      log: null,
    },
    {
      name: 'a signIn that calls neither codeBox nor actions',
      draw: () =>
        drawSignIn({ signIn: (parent) => ({ element: rootIn(parent) }) }),
      layout: 'mine',
      endsWithPieces: true,
      startsWithParts: false,
      log: null,
    },
    {
      name: 'a composer that calls kit.box twice',
      draw: () =>
        drawComposer({
          composer(parent, _input, kit) {
            const panel = kit.floatingPanel(parent);
            kit.box(panel);
            kit.box(panel);
            return { element: panel };
          },
        }),
      layout: 'default',
      endsWithPieces: false,
      startsWithParts: false,
      log: 'layout mine composer failed: box placed twice',
    },
    {
      name: 'a composer that never calls kit.contributedParts',
      draw: () =>
        drawComposer(
          {
            composer(parent, _input, kit) {
              const panel = kit.floatingPanel(parent);
              kit.box(panel);
              return { element: panel };
            },
          },
          [recordingPart('strip', [])],
        ),
      layout: 'mine',
      endsWithPieces: false,
      startsWithParts: true,
      log: null,
    },
    {
      name: 'a composer that calls kit.contributedParts twice',
      draw: () =>
        drawComposer({
          composer(parent, _input, kit) {
            const panel = kit.floatingPanel(parent);
            kit.contributedParts(panel);
            kit.contributedParts(panel);
            kit.box(panel);
            return { element: panel };
          },
        }),
      layout: 'default',
      endsWithPieces: false,
      startsWithParts: false,
      log: 'layout mine composer failed: composer placed contributed parts twice',
    },
  ])(
    'composerParts_PieceLeftOutOrPlacedTwice_KeysStillReachTheBox ($name)',
    ({ draw, layout, endsWithPieces, startsWithParts, log }) => {
      const { root, pieces, logs } = draw();

      expect(root.dataset.layout).toBe(layout);
      for (const piece of pieces) {
        expect(root.children.filter((child) => child === piece)).toEqual([
          piece,
        ]);
      }
      if (endsWithPieces) {
        expect(root.children.slice(-pieces.length)).toEqual(pieces);
      }
      if (startsWithParts) {
        expect(root.children[0]?.className).toBe('chat-composer-parts');
      }
      expect(logs.filter((line) => line.includes('failed'))).toEqual(
        log === null ? [] : [log],
      );
    },
  );

  it('composer_ContributedParts_BuiltInAddOrderAboveTheBox', () => {
    const { deps } = surfaceDeps(null);
    const record: string[] = [];
    deps.composerParts.add(recordingPart('first', record));
    deps.composerParts.add(recordingPart('second', record));
    const box = boxWithEditor();
    const surface = createComposerSurface(deps, {
      sessionId: 'row-1',
      box: asHtml(box),
      removeImage: () => undefined,
    });
    const tab = asHtml(new FakeElement('div'));
    const draw = () => asFake(surface.drawComposer(tab, composerInput(false)));

    draw();
    const firstDraw = [...record];
    const panel = draw();

    const holder = panel.children[0];
    expect(holder?.className).toBe('chat-composer-parts');
    expect(holder?.children.map((wrapper) => wrapper.dataset.part)).toEqual([
      'first',
      'second',
    ]);
    expect(panel.children.indexOf(box)).toBeGreaterThan(0);
    expect(firstDraw).toEqual(['build:first:row-1', 'build:second:row-1']);
    expect(record.slice(firstDraw.length)).toEqual([
      'dispose:first:row-1',
      'dispose:second:row-1',
      'build:first:row-1',
      'build:second:row-1',
    ]);
  });

  it('composerBar_Redraw_LeavesOneAnchorPerHint', () => {
    const { deps, anchors } = surfaceDeps({
      composerBar(parent, _input, kit) {
        const bar = rootIn(parent);
        kit.keyHint(bar, 'newSession');
        kit.sendButton(bar);
        return { element: bar };
      },
    });
    const surface = createComposerSurface(deps, {
      sessionId: 'row-1',
      box: asHtml(boxWithEditor()),
      removeImage: () => undefined,
    });

    for (const working of [false, true, false]) {
      surface.drawBar(composerInput(working));
    }

    const madeFor = (command: CommandId) =>
      anchors.filter((anchor) => anchor.command === command);
    expect(
      madeFor(chatCommand('newSession')).filter((anchor) => !anchor.isDisposed),
    ).toHaveLength(1);
    expect(madeFor(chatCommand('send'))).toHaveLength(1);
  });

  it('composer_UpdateThrows_DrawsWithDefaultUntilTheLayoutsChange', () => {
    const throwsOnUpdate: ChatLayout = {
      composer(parent, _input, kit) {
        const panel = kit.floatingPanel(parent);
        kit.box(panel);
        return {
          element: panel,
          update() {
            throw new Error('broken update');
          },
        };
      },
    };
    const { deps, logs } = surfaceDeps(throwsOnUpdate);
    const surface = createComposerSurface(deps, {
      sessionId: 'row-1',
      box: asHtml(boxWithEditor()),
      removeImage: () => undefined,
    });
    const tab = asHtml(new FakeElement('div'));
    const drawnWith = () =>
      asFake(surface.drawComposer(tab, composerInput(false))).dataset.layout;

    const firstLayout = drawnWith();
    const barOnThrow = surface.drawBar(composerInput(true));
    const afterThrow = drawnWith();
    const barsAfterThrow = [true, false].map((working) =>
      surface.drawBar(composerInput(working)),
    );
    deps.layouts.set(withUser<ChatLayout>(defaultLayout, throwsOnUpdate));
    const afterChange = drawnWith();

    expect([firstLayout, afterThrow, afterChange]).toEqual([
      USER_LAYOUT,
      'default',
      USER_LAYOUT,
    ]);
    expect([barOnThrow, ...barsAfterThrow]).toEqual([false, true, true]);
    expect(logs.filter((line) => line.includes('update failed'))).toEqual([
      `layout ${USER_LAYOUT} composer update failed: broken update`,
    ]);
  });

  it.each([
    {
      name: 'composer box',
      draw(deps: ReturnType<typeof surfaceDeps>['deps'], box: FakeElement) {
        const surface = createComposerSurface(deps, {
          sessionId: 'row-1',
          box: asHtml(box),
          removeImage: () => undefined,
        });
        const tab = asHtml(new FakeElement('div'));
        return () => asFake(surface.drawComposer(tab, composerInput(false)));
      },
    },
    {
      name: 'sign-in code box',
      draw(deps: ReturnType<typeof surfaceDeps>['deps'], box: FakeElement) {
        const body = new FakeElement('div');
        const part = createSignInPart(deps, asHtml(body), {
          codeBox: asHtml(box),
          copy: asHtml(new FakeElement('button')) as HTMLButtonElement,
          actions: asHtml(new FakeElement('div')),
        });
        part.draw({ profile: 'work', link: null });
        return () => {
          part.redraw();
          return body.children[0];
        };
      },
    },
  ])('layoutChange_MovesTheSameBoxIntoTheNewRoot ($name)', ({ draw }) => {
    const { deps } = surfaceDeps(null);
    const box = boxWithEditor();
    const redraw = draw(deps, box);
    const oldRoot = redraw();

    deps.layouts.set(
      withUser<ChatLayout>(defaultLayout, {
        composer: (parent, _input, kit) => ({
          element: kit.floatingPanel(parent),
        }),
        signIn: (parent) => ({ element: rootIn(parent) }),
      }),
    );
    const newRoot = redraw();

    expect(newRoot.dataset.layout).toBe(USER_LAYOUT);
    expect(newRoot.children.filter((child) => child === box)).toEqual([box]);
    expect(oldRoot.contains(box)).toBe(false);
  });
});
