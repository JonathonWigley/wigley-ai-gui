import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { InboxKit } from '../../layouts/layout';
import { workInboxManifest } from '../../manifest';
import type { InboxFocus } from '../inbox-state';

// The kit one part draw builds with, its keys in `work-inbox.<scope>`: the side bar's parts in `sections`, every
// other part in `list`. Each key anchor it names is recorded through `rollback`, so the draw's dispose disposes it.
export function createInboxKit(
  services: OwnerKitServices,
  scope: InboxFocus,
  rollback: RollbackDeps,
): InboxKit {
  return createBaseKit(
    ownerBaseKitDeps(workInboxManifest, services, scope, rollback),
  );
}
