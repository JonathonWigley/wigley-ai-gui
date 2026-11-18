import { describe, expect, it } from 'vitest';
import type { Keymap } from '../contracts/keymap';
import type { AppConfig, ConfigProblem } from '../contracts/settings';
import { createConfigPush, type PushTargets } from './config-push';

const REGISTERED = new Set(['known', 'other']);

// A config with one editor and one page bind on `command`, a sequence timeout
// of `timeoutMs`, and `problems` from main; nothing here reads the rest.
function config(
  command: string,
  timeoutMs = 500,
  problems: ConfigProblem[] = [],
): AppConfig {
  const keymap: Keymap = {
    editor: {
      leader: '<Space>',
      remaps: [],
      binds: [{ keys: 'x', scope: 'any', command }],
    },
    page: [{ keys: ['x'], scope: 'any', command }],
    app: [],
    intercept: [],
    global: [],
    groups: {},
  };
  return {
    keymap,
    settings: { keySequenceTimeoutMs: timeoutMs },
    problems,
  } as unknown as AppConfig;
}

// Fake targets recording each call in `calls`, in order; `requireRegistered`
// throws for a command outside REGISTERED, as the registry does, and the
// editor or page keys throw after recording their call while `failing` holds
// them.
function fakeTargets(initial: AppConfig) {
  const calls: string[] = [];
  const failing = new Set<'editor' | 'page'>();
  const toasted: string[] = [];
  const themeThenLive: string[] = [];
  const logged: string[] = [];
  let current = initial;
  const targets: PushTargets = {
    live: {
      current: () => current,
      replace(next) {
        current = next;
        themeThenLive.push('live');
      },
    },
    applier: {
      apply() {
        calls.push('theme');
        themeThenLive.push('theme');
      },
    },
    editor: {
      setKeymap() {
        calls.push('editor');
        if (failing.has('editor')) {
          throw new Error('editor broke');
        }
      },
    },
    commands: {
      requireRegistered(ids) {
        const missing = [...new Set(ids)].filter((id) => !REGISTERED.has(id));
        if (missing.length > 0) {
          throw new Error(`unknown ${missing.join(', ')}`);
        }
      },
    },
    pageKeys: {
      setBinds(_binds, ms) {
        calls.push(`page ${ms}`);
        if (failing.has('page')) {
          throw new Error('page broke');
        }
      },
    },
    problems: { show: () => undefined },
    toasts: { show: (text) => toasted.push(text) },
    log: (source, message) => {
      logged.push(`${source} ${message}`);
    },
  };
  return {
    targets,
    calls,
    failing,
    toasted,
    logged,
    themeThenLive,
    current: () => current,
  };
}

function start(initial: AppConfig) {
  const fake = fakeTargets(initial);
  const push = createConfigPush(
    {
      editor: initial.keymap.editor,
      page: initial.keymap.page,
      timeoutMs: initial.settings.keySequenceTimeoutMs,
    },
    fake.targets,
  );
  return { ...fake, push };
}

describe('createConfigPush', () => {
  it('keeps the applied keys and timeout and adds the refusal when the keys are refused', () => {
    const initial = config('known', 500);
    const { push, calls, current } = start(initial);

    push(config('missing', 900));

    expect(calls).toEqual(['theme']);
    expect(current().keymap.page).toEqual(initial.keymap.page);
    expect(current().keymap.editor).toEqual(initial.keymap.editor);
    expect(current().settings.keySequenceTimeoutMs).toBe(500);
    expect(current().problems).toEqual([
      {
        file: 'keymap.json',
        message: expect.stringContaining('unknown missing'),
      },
    ]);
  });

  it('clears the refusal when a later push applies', () => {
    const { push, current } = start(config('known'));
    push(config('missing'));

    push(config('other'));

    expect(current().problems).toEqual([]);
    expect(current().keymap.page).toEqual(config('other').keymap.page);
  });

  it('installs the editor keymap before the page keys', () => {
    const { push, calls } = start(config('known', 500));

    push(config('other', 700));

    expect(calls).toEqual(['editor', 'page 700', 'theme']);
  });

  it('re-installs nothing for a push equal to the applied keys', () => {
    const { push, calls } = start(config('known', 500));

    push(config('known', 500));

    expect(calls).toEqual(['theme']);
  });

  it('push_NewTheme_AppliesThemeBeforeLiveReplace', () => {
    const { push, themeThenLive } = start(config('known'));

    push(config('known'));

    expect(themeThenLive).toEqual(['theme', 'live']);
  });

  it('logs applied a new config only when the installed config changed', () => {
    const { push, logged } = start(config('known'));

    push(config('other'));
    push(config('other'));
    push(config('known'));

    expect(
      logged.filter((line) => line === 'config applied a new config'),
    ).toHaveLength(2);
  });

  it('toasts a new problem once across pushes that keep it', () => {
    const problem = { file: 'settings.json', message: 'bad' };
    const { push, toasted } = start(config('known'));

    push(config('known', 500, [problem]));
    push(config('known', 500, [problem]));

    expect(toasted).toEqual([expect.stringContaining('bad')]);
  });

  it('refuses the keys and skips the page when the editor throws, then retries both', () => {
    const { push, calls, failing, current } = start(config('known', 500));
    failing.add('editor');

    push(config('other', 700));

    expect(calls).toEqual(['editor', 'theme']);
    expect(current().problems).toEqual([
      { file: 'keymap.json', message: expect.stringContaining('editor broke') },
    ]);

    failing.clear();
    calls.length = 0;
    push(config('other', 700));

    expect(calls).toEqual(['editor', 'page 700', 'theme']);
    expect(current().problems).toEqual([]);
  });

  it('retries only the page keys when they threw after the editor took its keymap', () => {
    const { push, calls, failing, current } = start(config('known', 500));
    failing.add('page');

    push(config('other', 700));

    expect(calls).toEqual(['editor', 'page 700', 'theme']);
    expect(current().problems).toEqual([
      { file: 'keymap.json', message: expect.stringContaining('page broke') },
    ]);

    failing.clear();
    calls.length = 0;
    push(config('other', 700));

    expect(calls).toEqual(['page 700', 'theme']);
    expect(current().problems).toEqual([]);
  });
});
