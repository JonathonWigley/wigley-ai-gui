import type { CommandId } from '../../../../contracts/commands';
import type { ViewScope } from '../../../../contracts/keymap';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { Platform } from '../../../../contracts/platform';
import {
  type BaseKitDeps,
  createBaseKit,
  type KitCommands,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { iconButton } from '../../../../shared/page/ui/icon-button';
import { qualify } from '../../../../shared/plugin-manifests';
import type { KeysKit } from '../../layouts/layout';
import { keysManifest } from '../../manifest';

// What a keys kit reads: the plugin's own anchor registry and keys lookup,
// and the commands its `command` reaches.
export interface KeysKitDeps {
  markdown: MarkdownRenderer;
  keys: BaseKitDeps['keys'];
  commands: KitCommands;
  platform: Platform;
}

// `keys.<short>` when the keys manifest declares the command `short`, else
// null.
export function keysCommandNamed(short: string): CommandId | null {
  return Object.hasOwn(keysManifest.commands, short)
    ? qualify(keysManifest.id, short)
    : null;
}

// The kit one part draw builds with: the base kit with its keys in `scope`
// (null anchors with no scope), naming keys's own commands by their short
// names, plus `iconButton`. Each anchor it names is recorded in `rollback`.
export function createKeysKit(
  deps: KeysKitDeps,
  scope: ViewScope | null,
  rollback: RollbackDeps,
): KeysKit {
  const base = createBaseKit({
    markdown: deps.markdown,
    keys: {
      anchor(node, command, options) {
        const anchor = deps.keys.anchor(node, command, options);
        rollback.recordAnchor(anchor);
        return anchor;
      },
      keysFor: (command, keysScope) => deps.keys.keysFor(command, keysScope),
    },
    commands: deps.commands,
    scope,
    commandNamed: keysCommandNamed,
    platform: deps.platform,
  });
  return {
    ...base,
    iconButton(parent, icon, label, onClick) {
      const button = iconButton(icon, label, onClick, 'sm');
      parent.append(button);
      return button;
    },
  };
}
