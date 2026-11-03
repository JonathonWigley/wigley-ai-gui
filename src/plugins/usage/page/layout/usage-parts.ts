import type { Log } from '../../../../contracts/log';
import type { ShownLayouts } from '../../../../contracts/plugin';
import type { OwnerKitServices } from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../../shared/page/layout-host/layout-parts';
import type {
  CompleteLayout,
  DetailsInput,
  Layout,
  RowLineInput,
  SessionLineInput,
  StatusLineInput,
} from '../../layouts/layout';
import { usageManifest } from '../../manifest';
import { createUsageKit } from './usage-kit';

// A drawn part. `dispose` removes the element and disposes every anchor the
// part named.
export interface Drawn {
  element: HTMLElement;
  dispose(): void;
}

export interface UsagePartsDeps {
  defaultLayout: CompleteLayout;
  kit: OwnerKitServices;
  log: Log;
}

// Draws each usage surface's part into `parent` with the layouts last set,
// `default` alone until the first `setLayouts`. Each part picks its own layout
// and falls back to `default` on a throw. `setLayouts` only stores the set;
// the page draws again.
export interface UsageParts {
  statusLine(parent: HTMLElement, input: StatusLineInput): Drawn;
  sessionLine(parent: HTMLElement, input: SessionLineInput): Drawn;
  rowLine(parent: HTMLElement, input: RowLineInput): Drawn;
  details(parent: HTMLElement, input: DetailsInput): Drawn;
  setLayouts(shown: ShownLayouts<Layout>): void;
}

type PartName = keyof CompleteLayout;

export function createUsageParts(deps: UsagePartsDeps): UsageParts {
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: usageManifest.id,
    defaultLayout: deps.defaultLayout,
    log: deps.log,
  });

  // Draws `part` into `parent` with its own pick; `call` runs the builder
  // with a kit whose anchors `rollback` records.
  const draw = <P extends PartName>(
    part: P,
    parent: HTMLElement,
    call: (
      builder: CompleteLayout[P],
      slot: HTMLElement,
      rollback: RollbackDeps,
    ) => HTMLElement,
  ): Drawn => {
    const drawn = layoutParts.draw(part, parent, (builder, slot, rollback) => ({
      element: call(builder, slot, rollback),
    }));
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
    statusLine(parent, input) {
      return draw('statusLine', parent, (statusLine, slot, rollback) =>
        statusLine(slot, input, createUsageKit(deps.kit, rollback)),
      );
    },
    sessionLine(parent, input) {
      return draw('sessionLine', parent, (sessionLine, slot, rollback) =>
        sessionLine(slot, input, createUsageKit(deps.kit, rollback)),
      );
    },
    rowLine(parent, input) {
      return draw('rowLine', parent, (rowLine, slot, rollback) =>
        rowLine(slot, input, createUsageKit(deps.kit, rollback)),
      );
    },
    details(parent, input) {
      return draw('details', parent, (details, slot, rollback) =>
        details(slot, input, createUsageKit(deps.kit, rollback)),
      );
    },
    setLayouts: layoutParts.setLayouts,
  };
}
