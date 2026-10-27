import type { RowActions } from './settings-view';

// An action the cursor prompt can show a key for.
export type PromptAction = 'edit' | 'reset' | 'addBind' | 'removeBind';

// A key row (one with `addBind`) runs add on `i`, so it shows add, remove and
// reset; any other row shows edit and reset.
const KEY_ROW_ACTIONS: readonly PromptAction[] = [
  'addBind',
  'removeBind',
  'reset',
];
const OTHER_ROW_ACTIONS: readonly PromptAction[] = ['edit', 'reset'];

// The actions the cursor prompt shows for a row with `actions`, in the order
// it shows them, each one the row has.
export function rowPromptActions(actions: RowActions): PromptAction[] {
  const shown =
    actions.addBind === undefined ? OTHER_ROW_ACTIONS : KEY_ROW_ACTIONS;
  return shown.filter((action) => actions[action] !== undefined);
}
