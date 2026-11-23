import type {
  DrawnPickerRow,
  DrawRowInput,
  ListPicker,
  ListPickerRequest,
} from '../../../contracts/list-picker';
import type { PluginLog } from '../../../contracts/log';
import type { PageChannel, ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { shortRevision } from '../builds-model';
import type { BackendView, BuildsChannel, GameView } from '../contract';
import { type QueueChoice, queueChoices } from './builds-view-model';

// A game the picker queues for, with its backend.
export interface QueueTarget {
  backend: BackendView;
  view: GameView;
}

interface BranchHead {
  name: string;
  sha: string;
}

// `drawRow` draws one row of the picker titled `title` through the layout's `pickerRow`.
export interface QueuePickerDeps {
  picker: ListPicker;
  channel: PageChannel<BuildsChannel>;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
  drawRow(
    list: HTMLElement,
    title: string,
    input: DrawRowInput,
  ): DrawnPickerRow;
}

// The two-step queue picker over the shared list picker. Step 0 picks a game among `targets`; step 1 picks one of
// the game's kinds or sets; step 2, only when the backend chooses the branch and the game names a clone, picks a
// branch head on origin, `branches` read while a step-2 list waits empty under its title. Choosing queues: on the
// chosen branch, else on the game's default branch. A game whose backend has no instance toasts and opens nothing.
// Every press that opens or queues, a cancel and `dropPending` move a generation, and a `branches` answer that lands
// after the generation moved is dropped. While a `queue` waits for its answer, a further queue does nothing.
export interface QueuePicker {
  pickGame(targets: readonly QueueTarget[]): void;
  pickChoice(target: QueueTarget): void;
  // Queues `choice` for `target`, through step 2 when the backend chooses the branch.
  choose(target: QueueTarget, choice: QueueChoice): void;
  // Drops what a press still waits on, as the mode hides.
  dropPending(): void;
}

export function createQueuePicker(deps: QueuePickerDeps): QueuePicker {
  const { picker, channel, toast, log } = deps;
  let generation = 0;
  let isQueueing = false;

  const press = () => {
    generation += 1;
    return generation;
  };
  const cancelled = () => {
    press();
  };

  const open = <T>(
    title: string,
    request: Omit<ListPickerRequest<T>, 'title' | 'drawRow' | 'cancelled'>,
  ) =>
    picker.open<T>({
      ...request,
      title,
      drawRow: (list, _item, input) => deps.drawRow(list, title, input),
      cancelled,
    });

  const toastCannotQueue = (target: QueueTarget) =>
    toast(`${target.backend.label} cannot queue builds`, 'info');

  const queue = (target: QueueTarget, kind: string, branch: string) => {
    press();
    if (isQueueing) {
      return;
    }
    isQueueing = true;
    const backend = target.backend.id;
    const game = target.view.game.id;
    channel
      .invoke('queue', { backend, game, kind, branch, sessionId: null })
      .then(
        (answer) => {
          if ('problem' in answer) {
            toast(answer.problem, 'error');
            return;
          }
          log(`queued ${backend}/${game} ${kind} on ${branch}`);
        },
        (error: unknown) => toast(errorText(error), 'error'),
      )
      .finally(() => {
        isQueueing = false;
      });
  };

  const showHeads = (
    target: QueueTarget,
    choice: QueueChoice,
    title: string,
    heads: readonly BranchHead[],
  ) => {
    if (heads.length === 0) {
      picker.close();
      toast(
        choice.kind === 'set'
          ? `No branch on origin matches ${choice.set.branches}`
          : 'No branches on origin',
        'info',
      );
      return;
    }
    open<BranchHead>(title, {
      items: heads,
      label: (head) => `${head.name}  ${shortRevision(head.sha)}`,
      chosen: (head) => queue(target, choice.id, head.name),
    });
  };

  // Step 2: an empty list under the step's title until `branches` answers, so Esc drops the answer.
  const pickBranch = (target: QueueTarget, choice: QueueChoice) => {
    const pressed = press();
    const title = `${choice.label}: pick a branch`;
    open<BranchHead>(title, {
      items: [],
      label: (head) => head.name,
      chosen: () => undefined,
    });
    const isCurrent = () => pressed === generation;
    channel
      .invoke('branches', {
        backend: target.backend.id,
        game: target.view.game.id,
        set: choice.kind === 'set' ? choice.id : null,
      })
      .then(
        (answer) => {
          if (!isCurrent()) {
            return;
          }
          if ('problem' in answer) {
            picker.close();
            toast(answer.problem, 'error');
            return;
          }
          showHeads(target, choice, title, answer);
        },
        (error: unknown) => {
          if (isCurrent()) {
            picker.close();
            toast(errorText(error), 'error');
          }
        },
      );
  };

  const choose = (target: QueueTarget, choice: QueueChoice) => {
    const { capabilities } = target.backend;
    if (capabilities === null) {
      toastCannotQueue(target);
      return;
    }
    const { game } = target.view;
    if (capabilities.choosesBranch && game.clone !== null) {
      pickBranch(target, choice);
      return;
    }
    queue(target, choice.id, game.defaultBranch);
  };

  const pickChoice = (target: QueueTarget) => {
    press();
    if (target.backend.capabilities === null) {
      toastCannotQueue(target);
      return;
    }
    open<QueueChoice>(`Queue ${target.view.game.label}`, {
      items: queueChoices(target.view.game),
      label: (choice) => choice.label,
      section: (choice) => (choice.kind === 'kind' ? 'Kinds' : 'Sets'),
      chosen: (choice) => choose(target, choice),
    });
  };

  const pickGame = (targets: readonly QueueTarget[]) => {
    press();
    const queueable = targets.filter(
      (target) => target.backend.capabilities !== null,
    );
    if (queueable.length === 0) {
      toast('No tracked game can queue builds', 'info');
      return;
    }
    open<QueueTarget>('Queue a build', {
      items: queueable,
      label: (target) => `${target.backend.label} · ${target.view.game.label}`,
      chosen: (target) => pickChoice(target),
    });
  };

  return {
    pickGame,
    pickChoice,
    choose,
    dropPending: () => {
      press();
    },
  };
}
