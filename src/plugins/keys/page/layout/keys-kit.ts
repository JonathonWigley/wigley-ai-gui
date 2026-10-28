import type { ViewScope } from '../../../../contracts/keymap';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { iconButton } from '../../../../shared/page/ui/icon-button';
import type { KeysKit } from '../../layouts/layout';
import { keysManifest } from '../../manifest';

// The kit one part draw builds with: the base kit with its keys in `scope`,
// a qualified scope (null anchors with no scope), naming keys's own commands
// by their short names, plus `iconButton`. Each anchor it names is recorded
// in `rollback`.
export function createKeysKit(
  services: OwnerKitServices,
  scope: ViewScope | null,
  rollback: RollbackDeps,
): KeysKit {
  const base = createBaseKit(
    ownerBaseKitDeps(
      keysManifest,
      services,
      scope === null ? null : { qualified: scope },
      rollback,
    ),
  );
  return {
    ...base,
    iconButton(parent, icon, label, onClick) {
      const button = iconButton(icon, label, onClick, 'sm');
      parent.append(button);
      return button;
    },
  };
}
