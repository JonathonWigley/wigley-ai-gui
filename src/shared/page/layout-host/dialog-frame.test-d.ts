// Type tests, checked under `vitest --typecheck`. The layer check keeps
// `ui/dialog.ts` and `confirm-prompt.ts` from importing `kit.d.ts`, so each
// declares its own copy of the frame types; these fail when a copy drifts.
import { describe, expectTypeOf, it } from 'vitest';
import type { ConfirmBodyParts } from '../confirm-prompt';
import type {
  DialogFrameInput as AppDialogFrameInput,
  DialogFramePart as AppDialogFramePart,
} from '../ui/dialog';
import type {
  ConfirmButtonsKit,
  DialogFrameInput,
  DialogFramePart,
} from './kit';

describe('dialog frame kit types', () => {
  it('kitFrameTypes_EqualTheAppCopies', () => {
    expectTypeOf<DialogFrameInput>().toEqualTypeOf<AppDialogFrameInput>();
    expectTypeOf<DialogFramePart>().toEqualTypeOf<AppDialogFramePart>();
    expectTypeOf<ConfirmButtonsKit>().toEqualTypeOf<
      Pick<ConfirmBodyParts, 'keepButton' | 'confirmButton'>
    >();
  });
});
