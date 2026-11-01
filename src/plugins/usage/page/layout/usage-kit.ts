import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { appended } from '../../../../shared/page/dom';
import { meter } from '../../../../shared/page/ui/meter';
import type { UsageKit } from '../../layouts/layout';
import { usageManifest } from '../../manifest';

// The kit one part draw builds with: the base kit with its keys in no scope,
// naming usage's own commands by their short names, plus `meter`. Each anchor
// it names is recorded in `rollback`.
export function createUsageKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
): UsageKit {
  const base = createBaseKit(
    ownerBaseKitDeps(usageManifest, services, null, rollback),
  );
  return {
    ...base,
    meter: (parent, percent, tone) => appended(parent, meter(percent, tone)),
  };
}
