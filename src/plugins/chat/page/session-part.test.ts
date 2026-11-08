import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
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
const FOLDER = { label: 'Folder', value: '~/dev/app' };
const HARNESS = { label: 'Harness', value: 'claude' };

function control(id: string, value: string) {
  return { id, label: id, value, enabled: true };
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
    facts: [
      { label: 'Project', value: 'app-repo' },
      { label: 'Branch', value: branch },
    ],
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
    facts: SessionFactsInput['facts'];
  }>([
    {
      case: 'BranchNull_NoBranchRow',
      input: composerInput(null, WITH_EFFORT),
      facts: [
        { label: 'Project', value: 'app-repo' },
        FOLDER,
        HARNESS,
        { label: 'Model', value: 'Opus 5 · high' },
      ],
    },
    {
      case: 'ModelEffortNull_NoModelRow',
      input: composerInput('main', null),
      facts: [
        { label: 'Project', value: 'app-repo' },
        { label: 'Branch', value: 'main' },
        FOLDER,
        HARNESS,
      ],
    },
    {
      case: 'EffortNull_ModelAlone',
      input: composerInput('main', NO_EFFORT),
      facts: [
        { label: 'Project', value: 'app-repo' },
        { label: 'Branch', value: 'main' },
        FOLDER,
        HARNESS,
        { label: 'Model', value: 'Opus 5' },
      ],
    },
    {
      case: 'ModelAndEffort_EveryRowInOrder',
      input: composerInput('main', WITH_EFFORT),
      facts: [
        { label: 'Project', value: 'app-repo' },
        { label: 'Branch', value: 'main' },
        FOLDER,
        HARNESS,
        { label: 'Model', value: 'Opus 5 · high' },
      ],
    },
    {
      case: 'OneWorktree_WorktreeRowAfterFolder',
      input: composerInput('main', null),
      worktrees: ['app-fix'],
      facts: [
        { label: 'Project', value: 'app-repo' },
        { label: 'Branch', value: 'main' },
        FOLDER,
        { label: 'Worktree', value: 'app-fix' },
        HARNESS,
      ],
    },
    {
      case: 'TwoWorktrees_PluralRowListsBoth',
      input: composerInput('main', null),
      worktrees: ['app-fix', 'docs-fix'],
      facts: [
        { label: 'Project', value: 'app-repo' },
        { label: 'Branch', value: 'main' },
        FOLDER,
        { label: 'Worktrees', value: 'app-fix, docs-fix' },
        HARNESS,
      ],
    },
  ])('sessionFactsOf_$case', ({ input, worktrees = [], facts }) => {
    expect(
      sessionFactsOf(
        input,
        { projectDir: `${HOME}/dev/app`, worktrees },
        {
          homeDir: HOME,
          paths: posixPaths,
        },
      ),
    ).toEqual({ facts });
  });
});

describe('Session part', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('build_BranchChanges_ValueUpdatesInTheSameElement', () => {
    const { source, change, listeners } = fakeSource(factsWithBranch('main'));
    const { parent, part } = partOver(source);

    const built = part.build(asHtml(parent), 'row-1', NO_SECTION);
    const rowBefore = findAll(parent, 'chat-session-fact')[1];
    change(factsWithBranch('feature'));

    expect(findAll(parent, 'chat-session-fact')[1]).toBe(rowBefore);
    expect(findAll(parent, 'chat-session-fact-value')[1].textContent).toBe(
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
    expect(findAll(parent, 'chat-session-fact-value')[1].textContent).toBe(
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
