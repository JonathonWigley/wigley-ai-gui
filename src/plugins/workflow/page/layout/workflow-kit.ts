import {
  createBaseKit,
  type OwnerKitServices,
  type OwnerScope,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { appended, element } from '../../../../shared/page/dom';
import { qualify } from '../../../../shared/plugin-manifests';
import { textButton } from '../../../../shared/page/ui/button';
import type { WorkflowKit } from '../../layouts/layout';
import { workflowManifest } from '../../manifest';

const MAIN_ACTION = 'mainAction';

// The kit one part draw builds with: the base kit with its keys in `scope`
// (null for none), naming workflow's own commands by their short names, plus
// the action button, the stepper and the countdown. `run` runs a workflow
// command for the session the part draws; the main action's button runs
// `mainAction`, as `<Leader>ww` does. Each anchor it names is recorded in
// `rollback`.
export function createWorkflowKit(
  services: OwnerKitServices,
  scope: OwnerScope | null,
  rollback: RollbackDeps,
  run: (command: string) => void,
): WorkflowKit {
  const base = createBaseKit(
    ownerBaseKitDeps(workflowManifest, services, scope, rollback),
  );
  return {
    ...base,
    actionButton(parent, action, options = {}) {
      const command = action.main ? MAIN_ACTION : action.command;
      const button = appended(
        parent,
        textButton(action.label, () => run(command), {
          variant: options.variant ?? (action.main ? 'primary' : 'secondary'),
        }),
      );
      button.addEventListener('click', (event) => event.stopPropagation());
      button.disabled = !action.enabled;
      if (options.anchor !== false) {
        base.keyHint(button, qualify(workflowManifest.id, command));
      }
      return button;
    },
    stepper(parent, steps) {
      const stepper = appended(parent, element('ol', 'workflow-stepper'));
      for (const step of steps) {
        const item = appended(
          stepper,
          element('li', 'workflow-step', step.label),
        );
        item.dataset.state = step.state;
      }
      return stepper;
    },
    countdown: (parent, text) =>
      appended(parent, element('span', 'workflow-countdown', text)),
  };
}
