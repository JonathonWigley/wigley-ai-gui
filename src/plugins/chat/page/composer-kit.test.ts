import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import {
  asFake,
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { chatCommand } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout, ComposerInput } from '../layouts/layout';
import { createChatLayouts } from './chat-layouts';
import { createComposerSurface } from './composer-kit';
import { createSignInPart } from './dialog-kits';

// A key anchor the double made, live until disposed.
interface MadeAnchor {
  command: CommandId;
  isLive: boolean;
}

// The deps every surface takes, drawing with `user` as the user's layout;
// each anchor is kept in `anchors` and each log line in `logs`.
function surfaceDeps(user: Partial<ChatLayout>) {
  const layouts = createChatLayouts();
  layouts.set({
    layouts: new Map<string, ChatLayout>([
      ['default', defaultLayout],
      ['mine', { entries: defaultLayout.entries, ...user }],
    ]),
    user: 'mine',
  });
  const anchors: MadeAnchor[] = [];
  const logs: string[] = [];
  const deps = {
    layouts,
    markdown: {
      block: (text: string) => text,
      inline: (text: string) => text,
      document: (text: string) => Promise.resolve(text),
    },
    keys: {
      anchor(_node: HTMLElement, command: CommandId) {
        const made = { command, isLive: true };
        anchors.push(made);
        return { dispose: () => (made.isLive = false) };
      },
      keysFor: () => null,
    },
    commands: { exists: () => true, run: () => undefined },
    platform: 'macos' as const,
    run: () => undefined,
    log: (_source: string, line: string) => logs.push(line),
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

  // Draws the composer with `user` into a fresh tab root.
  function drawComposer(user: Partial<ChatLayout>) {
    const { deps, logs } = surfaceDeps(user);
    const box = boxWithEditor();
    const surface = createComposerSurface(deps, {
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
  function drawSignIn(user: Partial<ChatLayout>) {
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
      log: null,
    },
    {
      name: 'a signIn that calls neither codeBox nor actions',
      draw: () =>
        drawSignIn({ signIn: (parent) => ({ element: rootIn(parent) }) }),
      layout: 'mine',
      endsWithPieces: true,
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
      log: 'layout mine composer failed: box placed twice',
    },
  ])(
    'composerParts_PieceLeftOutOrPlacedTwice_KeysStillReachTheBox ($name)',
    ({ draw, layout, endsWithPieces, log }) => {
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
      expect(logs.filter((line) => line.includes('failed'))).toEqual(
        log === null ? [] : [log],
      );
    },
  );

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
      box: asHtml(boxWithEditor()),
      removeImage: () => undefined,
    });

    for (const working of [false, true, false]) {
      surface.drawBar(composerInput(working));
    }

    const madeFor = (command: CommandId) =>
      anchors.filter((anchor) => anchor.command === command);
    expect(
      madeFor(chatCommand('newSession')).filter((anchor) => anchor.isLive),
    ).toHaveLength(1);
    expect(madeFor(chatCommand('send'))).toHaveLength(1);
  });
});
