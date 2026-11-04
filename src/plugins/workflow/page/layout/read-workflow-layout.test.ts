import { describe, expect, it } from 'vitest';
import { readWorkflowLayout } from './read-workflow-layout';

const part = () => null;

describe('readWorkflowLayout', () => {
  it.each([
    {
      module: { default: { banner: part } },
      error: 'banner is not a layout part',
    },
    {
      module: { default: { strip: 'wide' } },
      error: 'strip is not a function',
    },
    { module: { default: { flowTab: part, sidePane: part } }, error: null },
  ])(
    'readWorkflowLayout_Shapes_AcceptsOrNamesTheBadKey $error',
    ({ module, error }) => {
      const read = () => readWorkflowLayout(module, 'x');

      if (error === null) {
        expect(read().flowTab).toBe(part);
        expect(read().sidePane).toBe(part);
      } else {
        expect(read).toThrow(error);
      }
    },
  );
});
