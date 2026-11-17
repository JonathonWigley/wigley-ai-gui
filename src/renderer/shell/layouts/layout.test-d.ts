// Type tests, checked under `vitest --typecheck`.
import { describe, expectTypeOf, it } from 'vitest';
import type { ToastTone as PluginToastTone } from '../../../contracts/plugin';
import type { ToastTone } from './layout';

describe('ToastTone', () => {
  // Breaks if a tone is added to or removed from one declaration only.
  it('ToastTone_TwoDeclarations_AreMutuallyAssignable', () => {
    expectTypeOf<ToastTone>().toEqualTypeOf<PluginToastTone>();
    expectTypeOf<PluginToastTone>().toEqualTypeOf<ToastTone>();
  });
});
