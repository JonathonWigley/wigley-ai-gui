import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { PracticeKit } from '../../layouts/layout';
import { practiceManifest } from '../../manifest';

// The base scopes the view and the interviewer pane set; the filter box's,
// the confirm's and the import box's scopes are pushed over them.
export type PracticeBaseScope =
  | 'list'
  | 'problem'
  | 'editor'
  | 'console'
  | 'ask';

// The scopes a part's kit draws its keys in: a base scope, the confirm's or
// the import box's.
export type PracticeKitScope = PracticeBaseScope | 'confirm' | 'import';

// The kit one part draw builds with, its keys in `practice.<scope>`. Each key
// anchor it names is recorded through `rollback`, so the draw's dispose
// disposes it.
export function createPracticeKit(
  services: OwnerKitServices,
  scope: PracticeKitScope,
  rollback: RollbackDeps,
): PracticeKit {
  return createBaseKit(
    ownerBaseKitDeps(practiceManifest, services, scope, rollback),
  );
}
