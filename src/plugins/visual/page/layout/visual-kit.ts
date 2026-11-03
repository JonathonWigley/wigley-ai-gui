import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../../shared/page/layout-host/kit';
import type { VisualKit } from '../../layouts/layout';
import { visualManifest } from '../../manifest';

// The kit one `card` draw builds with: the base kit with its keys in no
// scope. Each anchor it names is recorded in `rollback`.
export function createVisualBaseKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
): BaseKit {
  return createBaseKit(
    ownerBaseKitDeps(visualManifest, services, null, rollback),
  );
}

// The kit one `visual` draw builds with: the base kit plus `frame`, which
// places the frame through `placeFrame`.
export function createVisualKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
  placeFrame: (parent: HTMLElement) => HTMLElement,
): VisualKit {
  return {
    ...createVisualBaseKit(services, rollback),
    frame: placeFrame,
  };
}
