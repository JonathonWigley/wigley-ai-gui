import {
  createBaseKit,
  type OwnerKitServices,
  type OwnerScope,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../../shared/page/layout-host/kit';
import type { OverlayKit, VisualKit } from '../../layouts/layout';
import { visualManifest } from '../../manifest';

// The base kit one draw builds with, its keys in `scope` (null for none).
// Each anchor it names is recorded in `rollback`.
export function createVisualBaseKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
  scope: OwnerScope | null,
): BaseKit {
  return createBaseKit(
    ownerBaseKitDeps(visualManifest, services, scope, rollback),
  );
}

// The kit one `visual` draw builds with: the base kit, its keys in chat's
// scope, plus `frame` and `expand`, which place the frame and the expand
// control through `placeFrame` and `placeExpand`.
export function createVisualKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
  placeFrame: (parent: HTMLElement) => HTMLElement,
  placeExpand: (parent: HTMLElement) => HTMLButtonElement,
): VisualKit {
  return {
    ...createVisualBaseKit(services, rollback, { qualified: 'chat.chat' }),
    frame: placeFrame,
    expand: placeExpand,
  };
}

// The kit one `overlay` draw builds with: the base kit, its keys in the
// overlay's scope, plus `frame`, which places the frame through `placeFrame`.
export function createOverlayKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
  placeFrame: (parent: HTMLElement) => HTMLElement,
): OverlayKit {
  return {
    ...createVisualBaseKit(services, rollback, 'overlay'),
    frame: placeFrame,
  };
}
