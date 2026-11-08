import type { Clock } from '../../../../contracts/ambient';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import type { RollbackDeps } from '../../../../shared/page/layout-host/draw-part';
import { appended, element } from '../../../../shared/page/dom';
import { qualify } from '../../../../shared/plugin-manifests';
import type { PluginManifest } from '../../../../contracts/plugin';
import { workflowStageActionCommand } from '../../contract';
import type { MarkState, WorkflowKit } from '../../layouts/layout';
import { workflowManifest } from '../../manifest';

// The action the main action's button sends `workflow.stageAction`, as
// `<Leader>ww` does.
export const MAIN_ACTION = 'mainAction';
// The action the fold sends `workflow.stageAction`, which only changes what the
// side pane shows.
export const TOGGLE_FINISHED_WAVES = 'toggleFinishedWaves';
// The class of the list whose scroll the view keeps across a draw.
export const SIDE_LIST_CLASS = 'workflow-side-list';

const MARK_ICONS: Record<MarkState, string> = {
  pending: 'circle-large',
  running: 'circle-filled',
  ready: 'play-circle',
  paused: 'debug-pause',
  done: 'pass-filled',
};

// Sets the time an element's pulse animation starts from.
function placePulse(pulsing: HTMLElement, clock: Clock): void {
  pulsing.style.setProperty('--workflow-mark-clock', `${clock.now()}ms`);
}

// The kit one part draw builds with: the base kit with no key scope, naming the
// commands of the drawing plugin of `manifest` by their short names, plus the action
// button, the stepper, the countdown, the badge, the status mark, the finished
// groups' fold and the side pane's list. `sessionId` is the session each button
// runs `workflow.stageAction` for; the main action's button sends `mainAction`, as
// `<Leader>ww` does. The main action's and the fold's key hints name the engine's
// commands, every other action's its plugin's. Each anchor it names is recorded in
// `rollback`. Each status mark and running step carries `clock`'s time, which
// places its pulse.
export function createWorkflowKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
  sessionId: string,
  clock: Clock,
  manifest: Pick<PluginManifest, 'id' | 'commands'>,
): WorkflowKit {
  const base = createBaseKit(
    ownerBaseKitDeps(manifest, services, null, rollback),
  );
  const kit: WorkflowKit = {
    ...base,
    actionButton(parent, action, options = {}) {
      const command = action.main ? MAIN_ACTION : action.command;
      const button = base.button(
        parent,
        action.label,
        workflowStageActionCommand.id,
        {
          arg: { sessionId, action: command },
          variant: options.variant ?? (action.main ? 'primary' : 'secondary'),
        },
      );
      button.addEventListener('click', (event) => event.stopPropagation());
      button.disabled = !action.enabled;
      if (options.anchor !== false) {
        const hintOwner = action.main ? workflowManifest.id : manifest.id;
        base.keyHint(button, qualify(hintOwner, command));
      }
      return button;
    },
    stepper(parent, steps) {
      const stepper = appended(parent, element('ol', 'workflow-stepper'));
      for (const step of steps) {
        const item = appended(stepper, element('li', 'workflow-step'));
        item.dataset.state = step.state;
        placePulse(item, clock);
        appended(
          item,
          element(
            'span',
            'workflow-step-label',
            `${step.label}${step.progress}`,
          ),
        );
      }
      return stepper;
    },
    countdown: (parent, text) =>
      appended(parent, element('span', 'workflow-countdown', text)),
    badge(parent, letter, label) {
      const badge = appended(parent, element('span', 'workflow-badge', letter));
      badge.title = label;
      badge.style.setProperty(
        '--workflow-badge-color',
        `var(--wg-${manifest.id}-badge)`,
      );
      return badge;
    },
    statusMark(parent, state) {
      const mark = appended(parent, element('span', 'workflow-mark'));
      mark.dataset.state = state;
      placePulse(mark, clock);
      base.icon(mark, MARK_ICONS[state]);
      return mark;
    },
    finishedFold(parent, text, open) {
      const fold = base.button(
        parent,
        `${open ? '▾' : '▸'} ${text}`,
        workflowStageActionCommand.id,
        {
          arg: { sessionId, action: TOGGLE_FINISHED_WAVES },
          variant: 'ghost',
        },
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
