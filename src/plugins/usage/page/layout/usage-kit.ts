import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { UsageKit } from '../../layouts/layout';
import { usageManifest } from '../../manifest';

// The kit one part draw builds with: the base kit with its keys in no scope,
// naming usage's own commands by their short names. Each anchor it names is
// recorded in `rollback`.
export function createUsageKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
): UsageKit {
  return createBaseKit(
    ownerBaseKitDeps(usageManifest, services, null, rollback),
  );
}
