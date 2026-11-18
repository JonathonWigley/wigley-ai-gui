import { describe, expect, it } from 'vitest';
import type { ItemKindSpec, MainItemKind } from '../../contract';
import { BUILT_IN_KINDS } from './formats';
import { pollKind } from './poll-kind.test-support';
import { createKindRegistry } from './registry';

// A registry holding the built-ins, as forms' main start leaves it.
function builtInRegistry() {
  const registry = createKindRegistry();
  for (const kind of BUILT_IN_KINDS) {
    registry.register(kind);
  }
  return registry;
}

// `pollKind` with its spec changed.
function poll(spec: Partial<ItemKindSpec>): MainItemKind {
  return { ...pollKind, spec: { ...pollKind.spec, ...spec } } as MainItemKind;
}

function ids(kinds: readonly MainItemKind[]): string[] {
  return kinds.map((kind) => kind.spec.id);
}

describe('createKindRegistry', () => {
  it.each([
    { case: 'a held id', kind: poll({ id: 'question' }) },
    { case: 'a held argsKey', kind: poll({ argsKey: 'questions' }) },
    { case: 'a held bodyKey', kind: poll({ bodyKey: 'answers' }) },
    { case: 'a held resultKey', kind: poll({ resultKey: 'findings' }) },
    { case: 'argsKey heading', kind: poll({ argsKey: 'heading' }) },
    { case: 'argsKey overview', kind: poll({ argsKey: 'overview' }) },
    { case: 'argsKey layout', kind: poll({ argsKey: 'layout' }) },
    { case: 'bodyKey note', kind: poll({ bodyKey: 'note' }) },
    { case: 'resultKey outcome', kind: poll({ resultKey: 'outcome' }) },
    { case: 'resultKey summary', kind: poll({ resultKey: 'summary' }) },
    { case: 'resultKey next', kind: poll({ resultKey: 'next' }) },
    { case: 'resultKey note', kind: poll({ resultKey: 'note' }) },
    {
      case: 'resultKey earlier_heading',
      kind: poll({ resultKey: 'earlier_heading' }),
    },
    {
      case: 'an answerable kind with no status',
      kind: { ...pollKind, status: undefined } as MainItemKind,
    },
    {
      case: 'a status on a kind that takes no answer',
      kind: poll({ answerable: false }),
    },
    {
      case: 'a registered kind joining the fingerprint when empty',
      kind: poll({ fingerprintJoinsWhenEmpty: true }),
    },
  ])('refuses $case, registering nothing', ({ kind }) => {
    const registry = builtInRegistry();
    let changes = 0;
    registry.onChanged(() => changes++);

    expect(() => registry.register(kind)).toThrow(
      new RegExp(`^Item kind "${kind.spec.id}": `),
    );
    expect(ids(registry.kinds())).toEqual(['notice', 'finding', 'question']);
    expect(changes).toBe(0);
  });

  it('registers nothing and rethrows when a listener throws', () => {
    const registry = builtInRegistry();
    registry.onChanged(() => {
      throw new Error('listener broke');
    });

    expect(() => registry.register(pollKind)).toThrow('listener broke');
    expect(ids(registry.kinds())).toEqual(['notice', 'finding', 'question']);
  });

  it('lists the kinds in registration order', () => {
    const registry = builtInRegistry();

    registry.register(pollKind);

    expect(ids(registry.kinds())).toEqual([
      'notice',
      'finding',
      'question',
      'poll',
    ]);
  });

  it('removes a kind on its first dispose, and a second does nothing', () => {
    const registry = builtInRegistry();
    let changes = 0;
    registry.onChanged(() => changes++);

    const handle = registry.register(pollKind);
    handle.dispose();
    handle.dispose();

    expect(ids(registry.kinds())).toEqual(['notice', 'finding', 'question']);
    expect(changes).toBe(2);
  });

  it('takes a kind again once its holder is disposed', () => {
    const registry = builtInRegistry();
    registry.register(pollKind).dispose();

    expect(() => registry.register(pollKind)).not.toThrow();
  });

  it('stops telling a listener once its handle is disposed', () => {
    const registry = builtInRegistry();
    let changes = 0;
    registry.onChanged(() => changes++).dispose();

    registry.register(pollKind);

    expect(changes).toBe(0);
  });
});
