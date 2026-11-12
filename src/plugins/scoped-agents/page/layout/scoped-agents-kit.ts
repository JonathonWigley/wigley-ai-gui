import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { ScopedAgentsKit } from '../../layouts/layout';
import { scopedAgentsManifest } from '../../manifest';

// The kit one part draw builds with, its keys in `scoped-agents.ask`. Each key
// anchor it names is recorded through `rollback`, so the draw's dispose
// disposes it.
export function createScopedAgentsKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
): ScopedAgentsKit {
  return createBaseKit(
    ownerBaseKitDeps(scopedAgentsManifest, services, 'ask', rollback),
  );
}
