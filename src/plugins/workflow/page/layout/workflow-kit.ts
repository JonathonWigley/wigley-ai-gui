import type { Clock } from '../../../../contracts/ambient';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { appended, element } from '../../../../shared/page/dom';
import { qualify } from '../../../../shared/plugin-manifests';
import { textButton } from '../../../../shared/page/ui/button';
import type { MarkState, WorkflowKit } from '../../layouts/layout';
import { workflowManifest } from '../../manifest';

// The command the main action's button runs.
export const MAIN_ACTION = 'mainAction';
// The command the fold runs, which only changes what the side pane shows.
export const TOGGLE_FINISHED_WAVES = 'toggleFinishedWaves';
// The class of the list whose scroll the view keeps across a draw.
export const SIDE_LIST_CLASS = 'workflow-side-list';

const MARK_ICONS: Record<MarkState, string> = {
  pending: 'circle-large',
  running: 'loading',
  ready: 'play-circle',
  paused: 'debug-pause',
  done: 'pass-filled',
};

// The kit one part draw builds with: the base kit with no key scope, naming
// workflow's own commands by their short names, plus the action button, the
// stepper, the countdown, the status mark, the finished waves' fold and the
// side pane's list. `run` runs a workflow command for the session the part draws; the main action's button runs `mainAction`, as
// `<Leader>ww` does. Each anchor it names is recorded in `rollback`. Each status
// mark carries `clock`'s time, which places its pulse.
export function createWorkflowKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
  run: (command: string) => void,
  clock: Clock,
): WorkflowKit {
  const base = createBaseKit(
    ownerBaseKitDeps(workflowManifest, services, null, rollback),
  );
  const kit: WorkflowKit = {
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
        const item = appended(stepper, element('li', 'workflow-step'));
        item.dataset.state = step.state;
        kit.statusMark(item, step.state);
        appended(item, element('span', 'workflow-step-label', step.label));
        appended(item, element('span', 'workflow-step-status', step.state));
      }
      return stepper;
    },
    countdown: (parent, text) =>
      appended(parent, element('span', 'workflow-countdown', text)),
    statusMark(parent, state) {
      const mark = appended(parent, element('span', 'workflow-mark'));
      mark.dataset.state = state;
      mark.style.setProperty('--workflow-mark-clock', `${clock.now()}ms`);
      base.icon(mark, MARK_ICONS[state]);
      return mark;
    },
    finishedFold(parent, text, open) {
      const fold = appended(
        parent,
        textButton(
          `${open ? '▾' : '▸'} ${text}`,
          () => run(TOGGLE_FINISHED_WAVES),
          { variant: 'ghost' },
        ),
      );
      fold.classList.add('workflow-finished-fold');
      fold.setAttribute('aria-expanded', String(open));
      base.keyHint(fold, qualify(workflowManifest.id, TOGGLE_FINISHED_WAVES));
      return fold;
    },
    sideList: (parent) => appended(parent, element('div', SIDE_LIST_CLASS)),
  };
  return kit;
}
