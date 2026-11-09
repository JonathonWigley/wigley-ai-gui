import type { Clock } from '../../../../contracts/ambient';
import type { PluginLog } from '../../../../contracts/log';
import type { OwnerKitServices } from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../../shared/page/layout-host/layout-parts';
import type {
  CompleteLayout,
  Drawn,
  Layout,
  PagePluginApi,
  WorkflowDraw,
  WorkflowDrawOptions,
} from '../../contract';
import { readWorkflowLayout } from './read-workflow-layout';
import { createWorkflowKit } from './workflow-kit';

// `redraw` draws every held part again.
export interface WorkflowDrawDeps {
  kit: OwnerKitServices;
  log: PluginLog;
  clock: Clock;
  redraw(): void;
}

// One workflow plugin's parts over its own layouts: `api` is that plugin's, so the
// show loads its `layouts/<owner>/` folder and owns the show's life, and each part
// root carries its `data-layout-owner`. Each new set of layouts is stored, then
// `redraw` runs. `default` alone draws until the first set.
export function createWorkflowDraw(
  deps: WorkflowDrawDeps,
  api: PagePluginApi,
  options: WorkflowDrawOptions,
): WorkflowDraw {
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: options.manifest.id,
    defaultLayout: options.defaultLayout,
    log: deps.log,
  });
  api.layouts.show<Layout>({
    defaultLayout: options.defaultLayout,
    defaultStylesheet: options.defaultStylesheet,
    read: readWorkflowLayout,
    userLayout: () => options.userLayout(),
    setLayouts(shown) {
      layoutParts.setLayouts(shown);
      deps.redraw();
    },
  });

  const kitFor = (rollback: RollbackDeps, sessionId: string) =>
    createWorkflowKit(
      deps.kit,
      rollback,
      sessionId,
      deps.clock,
      options.manifest,
    );

  return {
    sideTitle: options.sideTitle,
    chip: (parent, input, sessionId) =>
      toDrawn(
        layoutParts.draw('chip', parent, (chip, slot, rollback) =>
          chip(slot, input, kitFor(rollback, sessionId)),
        ),
      ),
    strip: (parent, input, sessionId) =>
      toDrawn(
        layoutParts.draw('strip', parent, (strip, slot, rollback) =>
          strip(slot, input, kitFor(rollback, sessionId)),
        ),
      ),
    sidePane: (parent, input, sessionId) =>
      toDrawn(
        layoutParts.draw('sidePane', parent, (sidePane, slot, rollback) =>
          sidePane(slot, input, kitFor(rollback, sessionId)),
        ),
      ),
  };
}

function toDrawn(drawn: {
  built: { element: HTMLElement };
  dispose(): void;
}): Drawn {
  const { element } = drawn.built;
  return {
    element,
    dispose() {
      element.remove();
      drawn.dispose();
    },
  };
}
