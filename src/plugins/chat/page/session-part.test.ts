import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { harnessInfo } from '../../../shared/agent-harness-registry.test-support';
import { posixPaths } from '../../../shared/paths/posix-paths';
import defaultLayout from '../layouts/default/layout.js';
import type {
  ChatLayout,
  ComposerInput,
  ModelEffortInput,
  SessionFactsInput,
} from '../layouts/layout';
import { createChatLayouts } from './chat-layouts';
import { createSessionPart, sessionFactsOf } from './session-part';

const HOME = '/Users/u';

function control(id: string, value: string) {
  return { id, label: id, value, enabled: true, role: null };
}

function composerInput(
  branch: string | null,
  modelEffort: ModelEffortInput | null,
): ComposerInput {
  return {
    session: 'app',
    repo: 'app-repo',
    branch,
    isBoxFocused: false,
    running: true,
    working: false,
    modelEffort,
    controls: [],
  };
}

const NO_EFFORT: ModelEffortInput = {
  model: control('model', 'Opus 5'),
  effort: null,
};
const WITH_EFFORT: ModelEffortInput = {
  model: control('model', 'Opus 5'),
  effort: control('effort', 'high'),
};

function factsWithBranch(branch: string): SessionFactsInput {
  return {
    repo: 'app-repo',
    branch,
    folder: '~/dev/app',
    worktrees: [],
    harness: 'claude',
    harnessLabel: 'Claude Code',
    modelEffort: null,
  };
}

// A source the test changes: `change` sets what `input` reads and tells each
// listener still subscribed.
function fakeSource(shown: SessionFactsInput) {
  const listeners = new Set<() => void>();
  return {
    listeners,
    source: {
      input: () => shown,
      onChanged(listener: () => void) {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    change(next: SessionFactsInput) {
      shown = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function partOver(source: ReturnType<typeof fakeSource>['source'] | null) {
  const log = () => undefined;
  const layouts = createChatLayouts(log);
  const part = createSessionPart({
    markdown: {},
    keys: { anchor: () => ({ dispose: log }), keysFor: () => null },
    commands: { exists: () => true, argShape: () => undefined, run: log },
    platform: 'macos',
    layouts,
    log,
    sourceOf: () => source,
  } as unknown as Parameters<typeof createSessionPart>[0]);
  const parent = new FakeElement('div');
  return { layouts, parent, part };
}

const NO_SECTION = { setSummary: () => undefined };

describe('sessionFactsOf', () => {
  it.each<{
    case: string;
    input: ComposerInput;
    worktrees?: string[];
    harness?: string;
    expected: Partial<SessionFactsInput>;
  }>([
    {
      case: 'BranchNull_BranchNull',
      input: composerInput(null, WITH_EFFORT),
      expected: { branch: null, modelEffort: 'Opus 5 · high' },
    },
    {
      case: 'ModelEffortNull_ModelEffortNull',
      input: composerInput('main', null),
      expected: { branch: 'main', modelEffort: null },
    },
    {
      case: 'EffortNull_ModelAlone',
      input: composerInput('main', NO_EFFORT),
      expected: { modelEffort: 'Opus 5' },
    },
    {
      case: 'TwoWorktrees_BothInOrder',
      input: composerInput('main', null),
      worktrees: ['app-fix', 'docs-fix'],
      expected: { worktrees: ['app-fix', 'docs-fix'] },
    },
    {
      case: 'HarnessNotRegistered_LabelIsTheId',
      input: composerInput('main', null),
      harness: 'gone',
      expected: { harness: 'gone', harnessLabel: 'gone' },
    },
  ])(
    'sessionFactsOf_$case',
    ({ input, worktrees = [], harness = 'fake', expected }) => {
      expect(
        sessionFactsOf(
          input,
          { projectDir: `${HOME}/dev/app`, worktrees, harness },
          {
            homeDir: HOME,
            paths: posixPaths,
            harnesses: new Map([['fake', harnessInfo({ label: 'Fake' })]]),
          },
        ),
      ).toEqual({
        repo: 'app-repo',
        branch: 'main',
        folder: '~/dev/app',
        worktrees: [],
        harness: 'fake',
        harnessLabel: 'Fake',
        modelEffort: null,
        ...expected,
      });
    },
  );
});

describe('Session part', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('build_BranchChanges_BranchUpdatesInTheSameHeader', () => {
    const { source, change, listeners } = fakeSource(factsWithBranch('main'));
    const { parent, part } = partOver(source);

    const built = part.build(asHtml(parent), 'row-1', NO_SECTION);
    const headerBefore = findAll(parent, 'chat-session-header')[0];
    change(factsWithBranch('feature'));

    expect(findAll(parent, 'chat-session-header')[0]).toBe(headerBefore);
    expect(findAll(parent, 'chat-session-branch-name')[0].textContent).toBe(
      'feature',
    );

    built.dispose?.();

    expect(listeners.size).toBe(0);
    expect(parent.children).toEqual([]);
  });

  it.each<{
    case: string;
    update: (() => void) | undefined;
    drawnBy: string;
  }>([
    {
      case: 'Throws_DrawsTheNewFactsWithDefault',
      update: () => {
        throw new Error('update failed');
      },
      drawnBy: 'default',
    },
    {
      case: 'Missing_DrawsTheNewFactsWithTheSameLayout',
      update: undefined,
      drawnBy: 'user',
    },
  ])('build_LayoutUpdate$case', ({ update, drawnBy }) => {
    const { source, change } = fakeSource(factsWithBranch('main'));
    const { layouts, parent, part } = partOver(source);
    const userLayout: ChatLayout = {
      sessionFacts(at, input, kit) {
        const view = defaultLayout.sessionFacts(at, input, kit);
        return { element: view.element, update };
      },
    };
    layouts.set({
      user: 'user',
      layouts: new Map([
        ['user', userLayout],
        ['default', defaultLayout],
      ]),
    });

    part.build(asHtml(parent), 'row-1', NO_SECTION);
    const drawnFirst = parent.children[0];
    change(factsWithBranch('feature'));

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).not.toBe(drawnFirst);
    expect(parent.children[0].dataset.layout).toBe(drawnBy);
    expect(findAll(parent, 'chat-session-branch-name')[0].textContent).toBe(
      'feature',
    );
  });

  it('build_NoSource_DrawsNothing', () => {
    const { parent, part } = partOver(null);

    const built = part.build(asHtml(parent), 'row-1', NO_SECTION);

    expect(parent.children).toEqual([]);
    expect(built.dispose).toBeUndefined();
  });
});
