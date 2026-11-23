import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import type { BoardKit } from '../../layouts/layout';
import { workBoardManifest } from '../../manifest';

// The one scope every Board part draws in.
export const BOARD_SCOPE = 'board';

// The kit one part draw builds with, its keys in `work-board.board`. Each key anchor it names is recorded through
// `rollback`, so the draw's dispose disposes it.
export function createBoardKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
): BoardKit {
  return createBaseKit(
    ownerBaseKitDeps(workBoardManifest, services, BOARD_SCOPE, rollback),
  );
}
