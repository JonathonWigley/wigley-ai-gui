import { describe, expect, it } from 'vitest';
import { readEditorRemap } from './keymap-entries';

describe('readEditorRemap', () => {
  const remap = { mode: 'normal', keys: 'Y', to: 'y$' };

  it.each<{ value: unknown; problem: string | null }>([
    { value: remap, problem: null },
    {
      value: [remap],
      problem: '"remaps[0]" must be an object, not an array.',
    },
    {
      value: { mode: 'normal', keys: 'Y' },
      problem: '"remaps[0].to" is missing.',
    },
    {
      value: { ...remap, scope: 'any' },
      problem: '"remaps[0].scope" is not a field of an editor remap.',
    },
    {
      value: { ...remap, mode: 'visual' },
      problem: '"remaps[0].mode" must be one of normal, insert, not "visual".',
    },
    {
      value: { ...remap, keys: '' },
      problem: '"remaps[0].keys" is empty.',
    },
    {
      value: { ...remap, to: 7 },
      problem: '"remaps[0].to" must be a string, not a number.',
    },
  ])(
    'readEditorRemap_Entry_ReadsOrNamesTheProblem: $problem',
    ({ value, problem }) => {
      const read = () => readEditorRemap('remaps[0]', value);

      if (problem === null) {
        expect(read()).toEqual(remap);
      } else {
        expect(read).toThrow(problem);
      }
    },
  );
});
