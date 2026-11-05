import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEntry } from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
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
import type { ChatComposerPart, ChatStatusPart } from '../contract';
import { type ChatCommandName, chatCommand } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type {
  ChatLayout,
  ComposerInput,
  ModelEffortInput,
  WorkingInput,
} from '../layouts/layout';
import { createChatLayouts } from './chat-layouts';
import { createComposerSurface } from './composer-kit';
import { createSignInPart } from './dialog-kits';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';

// Timers that run only when the test fires them, each armed one kept in
// `armed`.
function fakeTimers() {
  let nextHandle = 1;
  const armed = new Map<number, () => void>();
  const timers: Timers = {
    set: (run) => {
      armed.set(nextHandle, run);
      return nextHandle++;
    },
    clear: (handle) => {
      armed.delete(handle);
    },
  };
  return { timers, armed };
}

// The deps every surface takes, drawing with `user` as the user's layout,
// or with `default` alone when `user` is null, and no composer or status part
// until one is added to `deps.composerParts` or `deps.statusParts`; each
// anchor is kept in `anchors`, each command run in `ran`, each log line in
// `logs` and each armed timer in `armed`, over a clock fixed at 5000.
function surfaceDeps(user: ChatLayout | null) {
  const logs: string[] = [];
  const log = (_source: string, line: string) => logs.push(line);
  const layouts = createChatLayouts(log);
  if (user !== null) {
    layouts.set(withUser<ChatLayout>(defaultLayout, user));
  }
  const { anchors, keys } = recordingAnchors();
  const ran: CommandId[] = [];
  const { timers, armed } = fakeTimers();
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
    run: (command: CommandId) => {
      ran.push(command);
    },
    composerParts: createPartStore<ChatComposerPart>(),
    statusParts: createPartStore<ChatStatusPart>(),
    log,
    clock: { now: () => 5000 },
    timers,
  };
  return { deps, anchors, ran, logs, armed };
}

function composerInput(
  working: boolean,
  modelEffort: ModelEffortInput | null = null,
): ComposerInput {
  return {
    session: 'tab',
    repo: 'repo',
    branch: 'main',
    isBoxFocused: false,
    running: true,
    working,
    modelEffort,
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
      expectsWorkingBeforeBox: false,
      log: null,
    },
    {
      name: 'a signIn that calls neither codeBox nor actions',
      draw: () =>
        drawSignIn({ signIn: (parent) => ({ element: rootIn(parent) }) }),
      layout: 'mine',
      endsWithPieces: true,
      startsWithParts: false,
      expectsWorkingBeforeBox: false,
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
      expectsWorkingBeforeBox: false,
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
      expectsWorkingBeforeBox: false,
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
      expectsWorkingBeforeBox: false,
      log: 'layout mine composer failed: composer placed contributed parts twice',
    },
    {
      name: 'a composer that never calls kit.working',
      draw: () =>
        drawComposer({
          composer(parent, _input, kit) {
            const panel = kit.floatingPanel(parent);
            kit.box(panel);
            kit.statusLine(panel);
            return { element: panel };
          },
        }),
      layout: 'mine',
      endsWithPieces: false,
      startsWithParts: false,
      expectsWorkingBeforeBox: true,
      log: null,
    },
    {
      name: 'a composer that calls kit.working twice',
      draw: () =>
        drawComposer({
          composer(parent, _input, kit) {
            const panel = kit.floatingPanel(parent);
            kit.working(panel);
            kit.working(panel);
            kit.box(panel);
            return { element: panel };
          },
        }),
      layout: 'default',
      endsWithPieces: false,
      startsWithParts: false,
      expectsWorkingBeforeBox: false,
      log: 'layout mine composer failed: working placed twice',
    },
  ])(
    'composerParts_PieceLeftOutOrPlacedTwice_KeysStillReachTheBox ($name)',
    ({
      draw,
      layout,
      endsWithPieces,
      startsWithParts,
      expectsWorkingBeforeBox,
      log,
    }) => {
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
      if (expectsWorkingBeforeBox) {
        const [box] = pieces;
        expect(root.children[root.children.indexOf(box) - 1]?.className).toBe(
          'chat-working-slot',
        );
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
    const workingSlot = panel.querySelector('.chat-working-slot');
    const slotAt =
      workingSlot === null ? -1 : panel.children.indexOf(workingSlot);
    expect(slotAt).toBeGreaterThan(0);
    expect(panel.children.indexOf(box)).toBeGreaterThan(slotAt);
    expect(workingSlot?.hidden).toBe(true);
    expect(firstDraw).toEqual(['build:first:row-1', 'build:second:row-1']);
    expect(record.slice(firstDraw.length)).toEqual([
      'dispose:first:row-1',
      'dispose:second:row-1',
      'build:first:row-1',
      'build:second:row-1',
    ]);
  });

  it('statusLine_Redraw_LeavesOneAnchorPerHint', () => {
    const { deps, anchors } = surfaceDeps({
      statusLine(parent, _input, kit) {
        const line = rootIn(parent);
        kit.keyHint(line, 'newSession');
        kit.sendButton(line);
        return { element: line };
      },
    });
    const surface = createComposerSurface(deps, {
      sessionId: 'row-1',
      box: asHtml(boxWithEditor()),
      removeImage: () => undefined,
    });

    for (const working of [false, true, false]) {
      surface.drawStatusLine(composerInput(working));
    }

    const madeFor = (command: CommandId) =>
      anchors.filter((anchor) => anchor.command === command);
    expect(
      madeFor(chatCommand('newSession')).filter((anchor) => !anchor.isDisposed),
    ).toHaveLength(1);
    expect(madeFor(chatCommand('send'))).toHaveLength(1);
  });

  it.each<{ case: string; next: Partial<ComposerInput>; isRebuilt: boolean }>([
    { case: 'same input', next: {}, isRebuilt: false },
    { case: 'box focus', next: { isBoxFocused: true }, isRebuilt: false },
    { case: 'branch', next: { branch: 'feature' }, isRebuilt: true },
    { case: 'repo', next: { repo: 'other' }, isRebuilt: true },
    { case: 'running', next: { running: false }, isRebuilt: true },
    { case: 'working', next: { working: true }, isRebuilt: true },
    {
      case: 'control value',
      next: {
        controls: [{ id: 'mode', label: 'Mode', value: 'Plan', enabled: true }],
      },
      isRebuilt: true,
    },
    {
      case: 'model and effort',
      next: {
        modelEffort: {
          model: { id: 'model', label: 'Model', value: 'Big', enabled: true },
          effort: null,
        },
      },
      isRebuilt: true,
    },
  ])(
    'statusLine_InputChange_RebuildsOnlyWhatItDraws ($case)',
    ({ next, isRebuilt }) => {
      const { deps, ran } = surfaceDeps(null);
      const surface = createComposerSurface(deps, {
        sessionId: 'row-1',
        box: asHtml(boxWithEditor()),
        removeImage: () => undefined,
      });
      const panel = asFake(
        surface.drawComposer(
          asHtml(new FakeElement('div')),
          composerInput(false),
        ),
      );
      const pressed = panel.querySelector('.chat-status-line');
      const send = panel.querySelector('.chat-status-end')?.children.at(-1);

      surface.drawStatusLine({ ...composerInput(false), ...next });
      send?.click();

      const isKept = panel.querySelector('.chat-status-line') === pressed;
      expect(isKept).toBe(!isRebuilt);
      expect(ran).toEqual([chatCommand('send')]);
      expect(
        panel
          .querySelector('.chat-type-hint')
          ?.classList.contains('is-box-focused'),
      ).toBe(next.isBoxFocused === true);
    },
  );

  it('statusLine_StatusParts_BuiltAtComposerDrawOnly', () => {
    const { deps } = surfaceDeps(null);
    const record: string[] = [];
    deps.statusParts.add(recordingPart('usage', record));
    const surface = createComposerSurface(deps, {
      sessionId: 'row-1',
      box: asHtml(boxWithEditor()),
      removeImage: () => undefined,
    });
    const panel = asFake(
      surface.drawComposer(
        asHtml(new FakeElement('div')),
        composerInput(false),
      ),
    );
    const holderInLine = () =>
      panel
        .querySelector('.chat-status-line')
        ?.querySelector('.chat-status-parts');

    const holders = [holderInLine()];
    for (const working of [true, false]) {
      surface.drawStatusLine(composerInput(working));
      holders.push(holderInLine());
    }

    expect(record).toEqual(['build:usage:row-1']);
    expect(holders.map((holder) => holder?.children[0]?.dataset.part)).toEqual([
      'usage',
      'usage',
      'usage',
    ]);
  });

  it('statusLine_StatusPartsPlacedTwice_DrawsWithDefault', () => {
    const { deps, logs } = surfaceDeps({
      statusLine(parent, _input, kit) {
        const line = rootIn(parent);
        kit.statusParts(line);
        kit.statusParts(line);
        return { element: line };
      },
    });
    const surface = createComposerSurface(deps, {
      sessionId: 'row-1',
      box: asHtml(boxWithEditor()),
      removeImage: () => undefined,
    });

    const panel = asFake(
      surface.drawComposer(
        asHtml(new FakeElement('div')),
        composerInput(false),
      ),
    );

    const line = panel.querySelector('.chat-status-line');
    expect(line?.dataset.layout).toBe('default');
    expect(line?.querySelectorAll('.chat-status-parts-slot')).toHaveLength(1);
    expect(logs.filter((log) => log.includes('failed'))).toEqual([
      `layout ${USER_LAYOUT} statusLine failed: status line placed status parts twice`,
    ]);
  });

  it.each([
    {
      case: 'model and effort',
      effort: { id: 'effort', label: 'Effort', value: 'Medium', enabled: true },
      enabled: true,
      value: 'Small · Medium',
      keys: ['pickModel', 'pickEffort'] as ChatCommandName[],
    },
    {
      case: 'no effort',
      effort: null,
      enabled: true,
      value: 'Small',
      keys: ['pickModel'] as ChatCommandName[],
    },
    {
      case: 'model not enabled',
      effort: {
        id: 'effort',
        label: 'Effort',
        value: 'Medium',
        enabled: false,
      },
      enabled: false,
      value: 'Small · Medium',
      keys: ['pickModel', 'pickEffort'] as ChatCommandName[],
    },
  ])(
    'statusLine_ModelEffortChip_RunsPickModelAndHoldsBothKeys ($case)',
    ({ effort, enabled, value, keys }) => {
      let drawn: HTMLButtonElement | null = null;
      const { deps, anchors, ran } = surfaceDeps({
        statusLine(parent, input, kit) {
          const line = rootIn(parent);
          if (input.modelEffort !== null) {
            drawn = kit.modelEffortChip(line, input.modelEffort);
          }
          return { element: line };
        },
      });
      const surface = createComposerSurface(deps, {
        sessionId: 'row-1',
        box: asHtml(boxWithEditor()),
        removeImage: () => undefined,
      });
      const model = { id: 'model', label: 'Model', value: 'Small', enabled };
      surface.drawStatusLine(composerInput(false, { model, effort }));
      const modelEffortChip = drawn as HTMLButtonElement | null;
      if (modelEffortChip === null) {
        throw new Error('the status line drew no model · effort chip');
      }
      const chipElement = asFake(modelEffortChip);
      chipElement.click();

      const keySpans = keys.map(
        (command) =>
          anchors.find((anchor) => anchor.command === chatCommand(command))
            ?.element,
      );
      expect(ran).toEqual([chatCommand('pickModel')]);
      expect(chipElement.textContent).toBe(`Model${value}`);
      expect(chipElement.children.slice(2)).toEqual(keySpans);
      expect(modelEffortChip.disabled).toBe(!enabled);
    },
  );

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
    const lineOnThrow = surface.drawStatusLine(composerInput(true));
    const afterThrow = drawnWith();
    const linesAfterThrow = [true, false].map((working) =>
      surface.drawStatusLine(composerInput(working)),
    );
    deps.layouts.set(withUser<ChatLayout>(defaultLayout, throwsOnUpdate));
    const afterChange = drawnWith();

    expect([firstLayout, afterThrow, afterChange]).toEqual([
      USER_LAYOUT,
      'default',
      USER_LAYOUT,
    ]);
    expect([lineOnThrow, ...linesAfterThrow]).toEqual([false, true, true]);
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

const userEntry = (id: string, at: number): ChatEntry => ({
  kind: 'user',
  id,
  at,
  text: 'ask',
  images: [],
  raw: [],
});

const readEntry = (id: string, at: number, running = false): ChatEntry => ({
  kind: 'tool',
  id,
  at,
  agentId: 'main',
  toolUseId: `use-${id}`,
  name: 'Read',
  input: { file_path: `/repo/${id}.ts` },
  summary: 'Read a file',
  result: running ? null : { text: 'done', isError: false },
  raw: [],
});

const resultEntry = (id: string, at: number): ChatEntry => ({
  kind: 'result',
  id,
  at,
  stopReason: 'end_turn',
  costUsd: null,
  durationMs: null,
  raw: [],
});

describe('composer surface activity dock', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // A surface over `user` whose composer is drawn into a fresh tab, its dock slot
  // and its working slot, and each part's slot by name.
  function setUpSurface(user: ChatLayout | null) {
    const setUp = surfaceDeps(user);
    const surface = createComposerSurface(setUp.deps, {
      sessionId: 'row-1',
      box: asHtml(boxWithEditor()),
      removeImage: () => undefined,
    });
    const tab = asHtml(new FakeElement('div'));
    const drawComposer = () => surface.drawComposer(tab, composerInput(true));
    const panel = asFake(drawComposer());
    const lineSlot = panel.querySelector('.chat-working-slot');
    if (lineSlot === null) {
      throw new Error('the composer placed no working slot');
    }
    const slot = asFake(surface.dockSlot);
    const slotOf = { working: slot, workingLine: lineSlot };
    return { ...setUp, surface, slot, lineSlot, slotOf, drawComposer };
  }

  // A user part anchoring the `newSession` hint in its root, so its draw's dispose
  // shows on that anchor; its update throws when `throwsOnUpdate`.
  function userPart(throwsOnUpdate = false): ChatLayout['working'] {
    return (parent, _input, kit) => {
      const root = rootIn(parent);
      kit.keyHint(root, 'newSession');
      return {
        element: root,
        update: throwsOnUpdate
          ? () => {
              throw new Error('broken update');
            }
          : undefined,
      };
    };
  }

  const LIVE_TURN = [userEntry('u1', 1000), readEntry('t1', 2000, true)];

  // Each row is one of the dock's two parts; `other` is the part beside it, `slots`
  // the slots the part draws in.
  const DOCK_PARTS = [
    { part: 'working', other: 'workingLine', slots: 1 },
    { part: 'workingLine', other: 'working', slots: 2 },
  ] as const;

  it('working_SetTurn_LiveThenDoneThenHidden', () => {
    const { surface, slot, lineSlot } = setUpSurface(null);
    const asked = [userEntry('u1', 1000), readEntry('t1', 2000, true)];
    const answered = [
      userEntry('u1', 1000),
      readEntry('t1', 2000),
      resultEntry('r1', 66000),
    ];
    const read = () => ({
      hidden: slot.hidden,
      lineHidden: lineSlot.hidden,
      classes: slot.children.map((child) => child.className),
      lineClasses: lineSlot.children.map((child) => child.className),
      action: slot.querySelector('.chat-working-action')?.textContent ?? null,
      done: [slot, lineSlot].map(
        (held) => held.querySelector('.chat-working-done')?.textContent ?? null,
      ),
    });

    surface.setTurn(asked, true, null);
    const live = read();
    surface.setTurn(answered, false, null);
    const done = read();
    surface.setTurn([...answered, userEntry('u2', 70000)], false, null);
    const hidden = read();

    const doneLine = 'Done · 1m 05s · Read 1';
    expect([live, done, hidden]).toEqual([
      {
        hidden: false,
        lineHidden: false,
        classes: ['chat-working'],
        lineClasses: ['chat-working-line'],
        action: 'Read t1.ts',
        done: [null, null],
      },
      {
        hidden: false,
        lineHidden: false,
        classes: ['chat-working is-done'],
        lineClasses: ['chat-working-line is-done'],
        action: null,
        done: [doneLine, doneLine],
      },
      {
        hidden: true,
        lineHidden: true,
        classes: [],
        lineClasses: [],
        action: null,
        done: [null, null],
      },
    ]);
  });

  it('turnLine_SetTurn_ShowsTheLiveTurnAndHidesOnceDone', () => {
    const { surface } = setUpSurface(null);
    const line = asFake(surface.turnLineSlot);
    const read = () => ({
      hidden: line.hidden,
      state: line.querySelector('.chat-working-state')?.textContent ?? null,
      done: line.querySelector('.chat-working-done')?.textContent ?? null,
    });

    surface.setTurn(LIVE_TURN, true, null);
    const live = read();
    surface.setTurn(
      [userEntry('u1', 1000), readEntry('t1', 2000), resultEntry('r1', 66000)],
      false,
      null,
    );

    expect([live, read()]).toEqual([
      { hidden: false, state: 'Working…', done: null },
      { hidden: true, state: null, done: null },
    ]);
  });

  it('dock_Tick_UpdatesEveryPartWithOneInputThenTheListeners', () => {
    const calls: [string, WorkingInput | null][] = [];
    const recordingPart =
      (name: string): ChatLayout['working'] =>
      (parent) => ({
        element: rootIn(parent),
        update: (input) => calls.push([name, input]),
      });
    const { deps, surface, armed } = setUpSurface({
      working: recordingPart('working'),
      workingLine: recordingPart('workingLine'),
    });
    surface.setTurn(LIVE_TURN, true, null);
    surface.onDockChanged((input) => calls.push(['listener', input]));
    deps.clock.now = () => 7000;

    [...armed.values()].forEach((run) => run());

    expect(calls.map(([name]) => name)).toEqual([
      'working',
      'workingLine',
      'workingLine',
      'listener',
    ]);
    expect(calls.map(([, input]) => input)).toEqual([
      surface.dockInput(),
      surface.dockInput(),
      surface.dockInput(),
      surface.dockInput(),
    ]);
    expect(calls[0][1]).toMatchObject({ now: 7000 });
  });

  it('dock_ListenerThrows_TheOtherListenersAndBothPartsStillRun', () => {
    const { surface, slot, lineSlot } = setUpSurface(null);
    const heard: (WorkingInput | null)[] = [];
    surface.onDockChanged(() => {
      throw new Error('broken listener');
    });
    surface.onDockChanged((input) => heard.push(input));

    expect(() => surface.setTurn(LIVE_TURN, true, null)).toThrow(
      'broken listener',
    );

    expect(heard).toEqual([surface.dockInput()]);
    expect([slot.children.length, lineSlot.children.length]).toEqual([1, 1]);
  });

  it('dock_ListenerDisposed_HearsNoMore', () => {
    const { surface } = setUpSurface(null);
    const heard: (WorkingInput | null)[] = [];
    const subscription = surface.onDockChanged((input) => heard.push(input));

    subscription.dispose();
    surface.setTurn(LIVE_TURN, true, null);

    expect(heard).toEqual([]);
  });

  it.each(DOCK_PARTS)(
    'dockPart_UserUpdateThrows_RedrawsWithDefault ($part)',
    ({ part }) => {
      const { surface, slotOf, logs } = setUpSurface({
        [part]: userPart(true),
      });
      const slot = slotOf[part];

      surface.setTurn(LIVE_TURN, true, null);
      const firstLayout = slot.children[0]?.dataset.layout;
      surface.setTurn(
        [
          userEntry('u1', 1000),
          readEntry('t1', 2000),
          readEntry('t2', 3000, true),
        ],
        true,
        null,
      );

      expect(firstLayout).toBe(USER_LAYOUT);
      expect(slot.children.map((child) => child.dataset.layout)).toEqual([
        'default',
      ]);
      expect(logs).toContain(
        `layout ${USER_LAYOUT} ${part} update failed: broken update`,
      );
    },
  );

  it.each(DOCK_PARTS)(
    'dockPart_LayoutChange_RedrawsFreshWithTheNewLayout ($part)',
    ({ part }) => {
      const { deps, surface, slotOf, drawComposer } = setUpSurface(null);
      const slot = slotOf[part];
      surface.setTurn(LIVE_TURN, true, null);
      const firstLayout = slot.children[0]?.dataset.layout;

      deps.layouts.set(
        withUser<ChatLayout>(defaultLayout, { [part]: userPart() }),
      );
      drawComposer();

      expect(firstLayout).toBe('default');
      expect(slot.children.map((child) => child.dataset.layout)).toEqual([
        USER_LAYOUT,
      ]);
    },
  );

  it.each(DOCK_PARTS)(
    'dockPart_DefaultDrawThrows_HidesItsSlotAndLogs ($part)',
    ({ part, other, slots }) => {
      vi.spyOn(defaultLayout, part).mockImplementation(() => {
        throw new Error('broken default');
      });
      const { surface, slotOf, logs, armed, drawComposer } = setUpSurface(null);
      const failures = () =>
        logs.filter(
          (line) => line === `default layout ${part} failed: broken default`,
        ).length;

      surface.setTurn(LIVE_TURN, true, null);
      [...armed.values()].forEach((run) => run());
      const failuresBeforeComposerDraw = failures();
      drawComposer();

      expect(slotOf[part].hidden).toBe(true);
      expect(slotOf[part].children).toEqual([]);
      expect(slotOf[other].hidden).toBe(false);
      expect(slotOf[other].children).toHaveLength(1);
      expect([failuresBeforeComposerDraw, failures()]).toEqual([
        slots,
        slots * 2,
      ]);
    },
  );

  it.each(DOCK_PARTS)(
    'dockPart_DefaultDrawFailedOnce_TheNextComposerDrawDrawsItAgain ($part)',
    ({ part }) => {
      vi.spyOn(defaultLayout, part).mockImplementationOnce(() => {
        throw new Error('broken default');
      });
      const { surface, slotOf, drawComposer } = setUpSurface(null);

      surface.setTurn(LIVE_TURN, true, null);
      const hiddenAfterFailure = slotOf[part].hidden;
      drawComposer();

      expect(hiddenAfterFailure).toBe(true);
      expect(slotOf[part].hidden).toBe(false);
      expect(slotOf[part].children).toHaveLength(1);
    },
  );

  it.each(DOCK_PARTS)(
    'dockPart_Dispose_DisposesThePartAndClearsTheTick ($part)',
    ({ part }) => {
      const { surface, armed, anchors } = setUpSurface({ [part]: userPart() });
      surface.setTurn(LIVE_TURN, true, null);
      const armedWhileLive = armed.size;
      const partAnchor = () =>
        anchors.find((anchor) => anchor.command === chatCommand('newSession'));
      const disposedWhileLive = partAnchor()?.isDisposed;

      surface.dispose();

      expect([armedWhileLive, disposedWhileLive]).toEqual([1, false]);
      expect(partAnchor()?.isDisposed).toBe(true);
      expect(armed.size).toBe(0);
    },
  );
});
