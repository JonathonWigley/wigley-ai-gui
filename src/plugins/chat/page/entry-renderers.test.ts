import { describe, expect, it } from 'vitest';
import type { HarnessEntryKind } from '../../../contracts/agent';
import type { ChatEntryRenderer } from '../contract';
import type { EntryBuilder, HarnessEntryInput } from '../layouts/layout';
import { createEntryRenderers, ENTRY_RENDERER_NAME } from './entry-renderers';

const harnessInput = (kind: HarnessEntryKind): HarnessEntryInput => ({
  kind,
  id: 'e1',
  at: 1000,
  raw: [],
});

// A renderer for `kind` whose build is told apart by `label` in `labels`.
function labelled(
  labels: Map<unknown, string>,
  label: string,
  match?: () => boolean,
): ChatEntryRenderer<HarnessEntryKind> {
  const build: EntryBuilder<HarnessEntryKind> = () => {
    throw new Error(`${label} is not drawn here`);
  };
  labels.set(build, label);
  return { kind: 'fake:card', match, build };
}

describe('entry renderers', () => {
  it.each<{
    name: string;
    // Each added in order: a label, and its `match` when given.
    added: { label: string; match?: () => boolean }[];
    disposeAll?: boolean;
    kind: HarnessEntryKind;
    expected: string | null;
    logs: string[];
  }>([
    {
      name: 'none added',
      added: [],
      kind: 'fake:card',
      expected: null,
      logs: [],
    },
    {
      name: 'one renderer of the kind',
      added: [{ label: 'a' }],
      kind: 'fake:card',
      expected: 'a',
      logs: [],
    },
    {
      name: 'two renderers of the kind',
      added: [{ label: 'a' }, { label: 'b' }],
      kind: 'fake:card',
      expected: 'b',
      logs: [],
    },
    {
      name: 'the later does not match',
      added: [{ label: 'a' }, { label: 'b', match: () => false }],
      kind: 'fake:card',
      expected: 'a',
      logs: [],
    },
    {
      name: "the later's match throws",
      added: [
        { label: 'a' },
        {
          label: 'b',
          match: () => {
            throw new Error('boom');
          },
        },
      ],
      kind: 'fake:card',
      expected: 'a',
      logs: ['entry renderer fake:card match failed: boom'],
    },
    {
      name: 'a renderer of another kind',
      added: [{ label: 'a' }],
      kind: 'fake:other',
      expected: null,
      logs: [],
    },
    {
      name: 'the only renderer disposed',
      added: [{ label: 'a' }],
      disposeAll: true,
      kind: 'fake:card',
      expected: null,
      logs: [],
    },
  ])(
    'pick_Renderers_LatestMatchingFirst: $name',
    ({ added, disposeAll, kind, expected, logs }) => {
      const logged: string[] = [];
      const renderers = createEntryRenderers((text) => logged.push(text));
      const labels = new Map<unknown, string>();
      const handles = added.map(({ label, match }) =>
        renderers.add(labelled(labels, label, match)),
      );
      if (disposeAll === true) {
        handles.forEach((handle) => handle.dispose());
      }

      const picked = renderers.pick(harnessInput(kind));

      const build = picked?.layout.entries?.[kind];
      expect(picked === null ? null : labels.get(build)).toEqual(expected);
      expect(logged).toEqual(logs);
    },
  );

  it('pick_Renderer_LayoutNamedEntryRenderer', () => {
    const renderers = createEntryRenderers(() => undefined);
    renderers.add(labelled(new Map(), 'a'));

    const first = renderers.pick(harnessInput('fake:card'));
    const second = renderers.pick(harnessInput('fake:card'));

    expect(first?.name).toBe(ENTRY_RENDERER_NAME);
    expect(ENTRY_RENDERER_NAME).toBe('entry renderer');
    expect(second?.layout).toBe(first?.layout);
  });

  it('onChanged_AddAndDispose_TellsEachOnce', () => {
    const renderers = createEntryRenderers(() => undefined);
    let calls = 0;
    renderers.onChanged(() => calls++);

    const handle = renderers.add(labelled(new Map(), 'a'));
    handle.dispose();
    handle.dispose();

    expect(calls).toBe(2);
  });
});
