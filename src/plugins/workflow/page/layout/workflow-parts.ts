import type { Log } from '../../../../contracts/log';
import type { ShownLayouts } from '../../../../contracts/plugin';
import type { OwnerKitServices } from '../../../../shared/page/layout-host/base-kit';
import { createLayoutParts } from '../../../../shared/page/layout-host/layout-parts';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  ChipInput,
  CompleteLayout,
  Layout,
  SidePaneInput,
  StripInput,
} from '../../layouts/layout';
import { workflowManifest } from '../../manifest';
import { createWorkflowKit } from './workflow-kit';

// A drawn part. `dispose` removes the element and disposes every anchor the
// part named.
export interface Drawn {
  element: HTMLElement;
  dispose(): void;
}

// `run` runs a workflow command for the session the part draws.
export type RunCommand = (command: string) => void;

// Draws each workflow part into `parent` with the layouts last set, `default`
// alone until the first `setLayouts`. Each part picks its own layout and
// falls back to `default` on a throw. No part takes a key scope, so its hints
// show in every scope. `setLayouts` only stores the set; the view draws again.
export interface WorkflowParts {
  chip(parent: HTMLElement, input: ChipInput, run: RunCommand): Drawn;
  strip(parent: HTMLElement, input: StripInput, run: RunCommand): Drawn;
  sidePane(parent: HTMLElement, input: SidePaneInput, run: RunCommand): Drawn;
  setLayouts(shown: ShownLayouts<Layout>): void;
}

export function createWorkflowParts(deps: {
  kit: OwnerKitServices;
  log: Log;
}): WorkflowParts {
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: workflowManifest.id,
    defaultLayout,
    log: deps.log,
  });

  const toDrawn = (drawn: {
    built: { element: HTMLElement };
    dispose(): void;
  }): Drawn => {
    const element = drawn.built.element;
    return {
      element,
      dispose() {
        element.remove();
        drawn.dispose();
      },
    };
  };

  return {
    chip: (parent, input, run) =>
      toDrawn(
        layoutParts.draw('chip', parent, (chip, slot, rollback) =>
          chip(slot, input, createWorkflowKit(deps.kit, null, rollback, run)),
        ),
      ),
    strip: (parent, input, run) =>
      toDrawn(
        layoutParts.draw('strip', parent, (strip, slot, rollback) =>
          strip(slot, input, createWorkflowKit(deps.kit, null, rollback, run)),
        ),
      ),
    sidePane: (parent, input, run) =>
      toDrawn(
        layoutParts.draw('sidePane', parent, (sidePane, slot, rollback) =>
          sidePane(
            slot,
            input,
            createWorkflowKit(deps.kit, null, rollback, run),
          ),
        ),
      ),
    setLayouts: (shown) => layoutParts.setLayouts(shown),
  };
}
