import { vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import type { PluginManifest } from '../../../contracts/plugin';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import { fakeKitCommandsOf } from '../../../shared/page/layout-host/fake-kit-commands.test-support';
import {
  type RecordedAnchor,
  recordingAnchors,
} from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  fakeDependency,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { type ChatPageExports, chatPageKey } from '../../chat/contract';
import {
  type SessionsPageExports,
  sessionsPageKey,
} from '../../sessions/contract';
import {
  type WorkflowKit,
  type WorkflowPageExports,
  workflowPageKey,
} from '../contract';
import { workflowManifest } from '../manifest';
import { createWorkflowKit } from './layout/workflow-kit';
import { workflowPagePart } from './start';

// The real engine page part over a fake DOM and fakes of sessions and chat, and its
// exports as the dependency a workflow plugin's part under test takes.
export function startEnginePagePart() {
  installFakeDom((name, value) => vi.stubGlobal(name, value));
  const untracked = () => ({ dispose: () => undefined });
  const engine = startPagePart(workflowPagePart, {
    dependencies: [
      fakeDependency(
        sessionsPageKey,
        () =>
          ({
            addRowPart: untracked,
            addTab: untracked,
          }) as unknown as SessionsPageExports,
      ),
      fakeDependency(
        chatPageKey,
        () =>
          ({
            addComposerPart: untracked,
            addSidePart: untracked,
          }) as unknown as ChatPageExports,
      ),
    ],
  });
  const dependency = fakeDependency(
    workflowPageKey,
    (consumer) => engine.started().exports?.(consumer) as WorkflowPageExports,
  );
  return { engine, dependency };
}

// The engine's real kit under `manifest`, with no-op services, at the clock `now`,
// for the part of `sessionId`; `anchors` holds each key anchor it names, and `runs`
// each command a click ran.
export function testWorkflowKit(
  manifest: Pick<PluginManifest, 'id' | 'commands'>,
  now = 0,
  sessionId = 's1',
  badgeColor?: string,
): {
  kit: WorkflowKit;
  anchors: RecordedAnchor[];
  runs: { id: CommandId; arg: unknown }[];
} {
  const { anchors, keys } = recordingAnchors();
  const runs: { id: CommandId; arg: unknown }[] = [];
  const kit = createWorkflowKit(
    {
      markdown: {
        block: (text: string) => text,
        inline: (text: string) => text,
        document: async (text: string) => text,
        ...NO_FENCES,
      },
      keys,
      commands: fakeKitCommandsOf(workflowManifest, (id, arg) => {
        runs.push({ id, arg });
      }),
      platform: 'macos',
      state: noLayoutState,
    },
    { recordBox: () => undefined, recordAnchor: () => undefined },
    sessionId,
    { now: () => now },
    manifest,
    badgeColor,
  );
  return { kit, anchors, runs };
}
