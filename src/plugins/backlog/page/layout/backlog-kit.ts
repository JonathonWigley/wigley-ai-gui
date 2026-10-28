import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { BacklogKit } from '../../layouts/layout';
import { backlogManifest } from '../../manifest';

// The base scopes the view sets; the box, confirm and picker scopes are
// pushed over them.
export type BacklogBaseScope = 'list' | 'detail' | 'editor';

// The scopes a part's keys fire in: a base scope for the panes and their rows,
// a pushed one for the picker's rows and the prompts' bodies.
export type BacklogKitScope = BacklogBaseScope | 'picker' | 'confirm';

// The kit one part draw builds with, its keys in `backlog.<scope>`. Each key
// anchor it names is recorded through `rollback`, so the draw's dispose
// disposes it.
export function createBacklogKit(
  services: OwnerKitServices,
  scope: BacklogKitScope,
  rollback: RollbackDeps,
): BacklogKit {
  return createBaseKit(
    ownerBaseKitDeps(backlogManifest, services, scope, rollback),
  );
}
