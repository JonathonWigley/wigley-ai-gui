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
import { tag, type TagTone } from '../../../../shared/page/ui/tag';
import type { PluginManifest } from '../../../../contracts/plugin';
import type { MarkState, StageStatus, WorkflowKit } from '../../layouts/layout';
import { workflowManifest } from '../../manifest';

// The command the main action's button runs.
export const MAIN_ACTION = 'mainAction';
// The command the fold runs, which only changes what the side pane shows.
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

const STAGE_TAG_TONES: Record<StageStatus, TagTone> = {
  running: 'running',
  paused: 'neutral',
  ready: 'neutral',
  done: 'success',
};

// Sets the time an element's pulse animation starts from.
function placePulse(pulsing: HTMLElement, clock: Clock): void {
  pulsing.style.setProperty('--workflow-mark-clock', `${clock.now()}ms`);
}

// `span.ui-tag.workflow-stage-tag` reading `label`, in the tone of `status`
// (neutral for none) and carrying it as `data-state`; a running one pulses from
// `clock`'s time.
export function stageTagElement(
  label: string,
  status: StageStatus | null,
  clock: Clock,
): HTMLElement {
  const stageTag = tag(
    label,
    status === null ? 'neutral' : STAGE_TAG_TONES[status],
  );
  stageTag.classList.add('workflow-stage-tag');
  if (status !== null) {
    stageTag.dataset.state = status;
  }
  placePulse(stageTag, clock);
  return stageTag;
}

// The kit one part draw builds with: the base kit with no key scope, naming the
// commands of the drawing plugin of `manifest` by their short names, plus the action
// button, the stepper, the countdown, the badge, the stage tag, the status mark, the finished
// groups' fold and the side pane's list. `run` runs a command for the session the
// part draws; the main action's button runs `mainAction`, as `<Leader>ww` does. The
// main action's and the fold's key hints name the engine's commands, every other
// action's its plugin's. Each anchor it names is recorded in `rollback`. Each status
// mark, stage tag and running step carries `clock`'s time, which places its pulse.
export function createWorkflowKit(
  services: OwnerKitServices,
  rollback: RollbackDeps,
  run: (command: string) => void,
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
      const button = appended(
        parent,
        textButton(action.label, () => run(command), {
          variant: options.variant ?? (action.main ? 'primary' : 'secondary'),
        }),
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
    stageTag(parent, label, status) {
      const stageTag = appended(parent, stageTagElement(label, status, clock));
      if (status === 'done') {
        stageTag.prepend(
          base.icon(stageTag, 'check', 'workflow-stage-tag-check'),
        );
      }
      return stageTag;
    },
    statusMark(parent, state) {
      const mark = appended(parent, element('span', 'workflow-mark'));
      mark.dataset.state = state;
      placePulse(mark, clock);
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
