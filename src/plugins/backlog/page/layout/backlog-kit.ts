import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { BacklogKit } from '../../layouts/layout';
import { backlogManifest } from '../../manifest';

// The base scopes the view sets; the box and picker scopes are pushed over
// them.
export type BacklogBaseScope = 'table' | 'review' | 'strip';

// The scopes a part's keys fire in: a base scope for the panes, their rows
// and cards, a pushed one for the picker's rows.
export type BacklogKitScope = BacklogBaseScope | 'picker';

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
