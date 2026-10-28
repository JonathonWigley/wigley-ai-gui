import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { Platform } from '../../../../contracts/platform';
import {
  type BaseKitDeps,
  createBaseKit,
  type KitCommands,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { element } from '../../../../shared/page/dom';
import { keyChevron, keyEdge } from '../../../../shared/page/ui/key-anchors';
import { qualify } from '../../../../shared/plugin-manifests';
import type { BacklogKit } from '../../layouts/layout';
import { backlogManifest } from '../../manifest';
import type { BacklogBaseScope } from '../backlog-view';

const PLUGIN_ID = 'backlog';

// The scopes a part's keys fire in: a base scope for the panes and their rows,
// a pushed one for the picker's rows and the prompts' bodies.
export type BacklogKitScope = BacklogBaseScope | 'picker' | 'confirm';

// What every Backlog kit reads: the page services and the keys export.
export interface BacklogKitDeps {
  markdown: MarkdownRenderer;
  keys: BaseKitDeps['keys'];
  commands: KitCommands;
  platform: Platform;
}

// The kit one part draw builds with, its keys in `backlog.<scope>`. Each key
// anchor it names is recorded through `rollback`, so the draw's dispose
// disposes it.
export function createBacklogKit(
  deps: BacklogKitDeps,
  scope: BacklogKitScope,
  rollback: RollbackDeps,
): BacklogKit {
  const base = createBaseKit({
    markdown: deps.markdown,
    keys: {
      anchor(target, command, options) {
        const anchor = deps.keys.anchor(target, command, options);
        rollback.recordAnchor(anchor);
        return anchor;
      },
      keysFor: (command, keysScope) => deps.keys.keysFor(command, keysScope),
    },
    commands: deps.commands,
    scope: qualify(PLUGIN_ID, scope),
    commandNamed: (short) =>
      Object.hasOwn(backlogManifest.commands, short)
        ? qualify(PLUGIN_ID, short)
        : null,
    platform: deps.platform,
  });
  return {
    ...base,
    rowTrailing(row) {
      const trailing = element('span', 'ui-row-trailing');
      row.append(trailing);
      return trailing;
    },
    edgePrompt(parent, side, command, label) {
      const edge = keyEdge(`backlog-edge backlog-edge--${side}`, []);
      parent.append(edge);
      if (side === 'end') {
        base.keyHint(edge, command, { className: 'backlog-hint', label });
        edge.append(keyChevron('›'));
      } else {
        edge.append(keyChevron(`‹ ${label}`));
        base.keyHint(edge, command, { className: 'backlog-hint' });
      }
      return edge;
    },
  };
}
