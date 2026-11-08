import type { ShownLayouts } from '../../../contracts/plugin';
import {
  createBaseKit,
  type KitCommands,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import type { CommandArgShape, CommandId } from '../../../contracts/commands';
import { docsManifest } from '../manifest';
import { createDocsParts } from './layout/docs-parts';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

// A part drawer over the layouts `layouts` returns, its base kits built as
// the page builds them, each kit command run going to `run`. `anchors` holds
// each anchor a draw named and `logs` each line logged.
export function fakeDocsParts(
  layouts: () => ShownLayouts<Layout>,
  run: KitCommands['run'] = () => undefined,
) {
  const { anchors, keys } = recordingAnchors();
  const logs: string[] = [];
  const parts = createDocsParts({
    layouts,
    defaultLayout,
    baseKit: (scope, rollback) =>
      createBaseKit(
        ownerBaseKitDeps(
          docsManifest,
          {
            markdown: {
              block: (text) => text,
              inline: (text) => text,
              document: async (text) => text,
              ...NO_FENCES,
            },
            keys,
            commands: {
              exists: () => true,
              argShape: (id) => docsArgShape(id),
              run,
            },
            platform: 'macos',
            state: noLayoutState,
          },
          scope,
          rollback,
        ),
      ),
    log: (message: string) => logs.push(message),
  });
  return { parts, anchors, logs };
}

const DOCS_COMMANDS: Readonly<
  Record<string, { label: string; arg?: CommandArgShape }>
> = docsManifest.commands;

// The arg shape the docs manifest declares for `id`, as the registry reads it.
export function docsArgShape(id: CommandId): CommandArgShape | undefined {
  const short = id.startsWith('docs.') ? id.slice('docs.'.length) : '';
  return Object.hasOwn(DOCS_COMMANDS, short)
    ? DOCS_COMMANDS[short].arg
    : undefined;
}

// A view anchor that names nothing.
export const noAnchor = () => ({ dispose: () => undefined });

// A scope push that pops and hears nothing.
export const fakePushedScope = () => ({
  pop: () => undefined,
  dispose: () => undefined,
  onBaseChanged: () => ({ dispose: () => undefined }),
});
