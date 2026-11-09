import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { PracticeKit } from '../../layouts/layout';
import { practiceManifest } from '../../manifest';

// The base scopes the view sets; the filter box's scope is pushed over them.
export type PracticeBaseScope = 'list' | 'problem';

// The kit one part draw builds with, its keys in `practice.<scope>`. Each key
// anchor it names is recorded through `rollback`, so the draw's dispose
// disposes it.
export function createPracticeKit(
  services: OwnerKitServices,
  scope: PracticeBaseScope,
  rollback: RollbackDeps,
): PracticeKit {
  return createBaseKit(
    ownerBaseKitDeps(practiceManifest, services, scope, rollback),
  );
}
