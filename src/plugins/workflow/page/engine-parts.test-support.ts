import { vi } from 'vitest';
import type { PluginManifest } from '../../../contracts/plugin';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
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
import { type WorkflowPageExports, workflowPageKey } from '../contract';
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

// The engine's real kit under `manifest`, with no-op services, at the clock `now`;
// `anchors` holds each key anchor it names.
export function testWorkflowKit(
  manifest: Pick<PluginManifest, 'id' | 'commands'>,
  now = 0,
) {
  const { anchors, keys } = recordingAnchors();
  const kit = createWorkflowKit(
    {
      markdown: {
        block: (text: string) => text,
        inline: (text: string) => text,
        document: async (text: string) => text,
        ...NO_FENCES,
      },
      keys,
      commands: {
        exists: () => true,
        argShape: () => undefined,
        run: () => undefined,
      },
      platform: 'macos',
      state: noLayoutState,
    },
    { recordBox: () => undefined, recordAnchor: () => undefined },
    () => undefined,
    { now: () => now },
    manifest,
  );
  return { kit, anchors };
}
