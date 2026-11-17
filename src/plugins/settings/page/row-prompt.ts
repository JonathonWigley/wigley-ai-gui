import type { PromptActionInput } from '../../../shared/page/layout-host/kit';
import type { RowActions } from './settings-view';

// An action the cursor prompt can show a key for.
export type PromptAction = 'open' | 'edit' | 'reset' | 'addBind' | 'removeBind';

// A key row (one with `addBind`) shows reassign (`open`), add, clear and
// reset; any other row shows edit and reset.
const KEY_ROW_ACTIONS: readonly PromptAction[] = [
  'open',
  'addBind',
  'removeBind',
  'reset',
];
const OTHER_ROW_ACTIONS: readonly PromptAction[] = ['edit', 'reset'];

// The cursor prompt's label for each action it shows.
const PROMPT_LABELS: Record<PromptAction, string> = {
  open: 'reassign',
  edit: 'edit',
  addBind: 'add key',
  removeBind: 'clear',
  reset: 'reset',
};

// The actions the cursor prompt shows for a row with `actions`, in the order
// it shows them, each one the row has: the settings command and the word its
// hint draws.
export function rowPromptActions(actions: RowActions): PromptActionInput[] {
  const shown =
    actions.addBind === undefined ? OTHER_ROW_ACTIONS : KEY_ROW_ACTIONS;
  return shown
    .filter((action) => actions[action] !== undefined)
    .map((action) => ({
      command: `settings.${action}`,
      label: PROMPT_LABELS[action],
    }));
}

// Whether `next` shows the same actions as `drawn`, each with the same command
// and label in the same order: a prompt already drawn for them is not drawn
// again.
export function samePromptActions(
  drawn: readonly PromptActionInput[],
  next: readonly PromptActionInput[],
): boolean {
  return (
    drawn.length === next.length &&
    drawn.every(
      (action, index) =>
        action.command === next[index].command &&
        action.label === next[index].label,
    )
  );
}

// Draws a cursor prompt into the slot `draw` is handed and returns the dispose
// that takes it out again.
export type DrawPrompt = (
  slot: HTMLElement,
  actions: readonly PromptActionInput[],
) => () => void;

// The one cursor prompt a pane holds. `place` draws it into `slot` with
// `actions`, disposing the one held, and draws again only when the slot or
// the actions changed. `dispose` disposes the held prompt, if any.
export interface PromptHolder {
  place(slot: HTMLElement, actions: readonly PromptActionInput[]): void;
  dispose(): void;
}

// The drawn prompt: its slot, the actions it was drawn for and its dispose.
interface HeldPrompt {
  slot: HTMLElement;
  actions: readonly PromptActionInput[];
  dispose(): void;
}

export function createPromptHolder(draw: DrawPrompt): PromptHolder {
  let held: HeldPrompt | null = null;
  const dispose = () => {
    const drawn = held;
    held = null;
    drawn?.dispose();
  };
  return {
    place(slot, actions) {
      const isDrawn =
        held !== null &&
        held.slot === slot &&
        samePromptActions(held.actions, actions);
      if (isDrawn) {
        return;
      }
      dispose();
      held = { slot, actions, dispose: draw(slot, actions) };
    },
    dispose,
  };
}
