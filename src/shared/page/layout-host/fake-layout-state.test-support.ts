import type { LayoutState } from '../../../contracts/state';

// The layout state of a kit under test that reads no slot: every id reads
// undefined and every listener hears nothing.
export const noLayoutState: LayoutState = {
  read: () => ({
    get: () => undefined,
    on: () => ({ dispose: () => undefined }),
  }),
};
