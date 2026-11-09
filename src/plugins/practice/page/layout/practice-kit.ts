import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { PracticeKit } from '../../layouts/layout';
import { practiceManifest } from '../../manifest';

// The base scopes the view sets; the filter box's and the confirm's scopes
// are pushed over them.
export type PracticeBaseScope = 'list' | 'problem' | 'editor' | 'console';

// The scopes a part's kit draws its keys in: a base scope, or the confirm's.
export type PracticeKitScope = PracticeBaseScope | 'confirm';

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
