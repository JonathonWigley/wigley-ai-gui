import { PICKER_CANCEL, PICKER_CHOOSE_ROW } from '../contracts/commands';
import type { Disposable } from '../contracts/disposable';
import type { ListPicker } from '../contracts/list-picker';
import type { PageCommandContext } from '../contracts/plugin';
import type { CommandRegistry } from '../shared/command-registry';

// The live list picker of each owner, which `picker.chooseRow` and
// `picker.cancel` reach by the owner their arg names. A second live picker for
// one owner throws `picker owner <owner> is taken`; disposing the handle frees
// the owner.
export interface PickerCommands {
  track(owner: string, picker: ListPicker): Disposable;
}

// Registers `picker.chooseRow` and `picker.cancel` under `core`. A run naming an
// owner with no live picker throws `no picker for owner <owner>`, which the
// registry logs.
export function registerPickerCommands(
  commands: Pick<CommandRegistry<PageCommandContext<any>>, 'register'>,
): PickerCommands {
  const pickers = new Map<string, ListPicker>();
  const pickerOf = (owner: string): ListPicker => {
    const picker = pickers.get(owner);
    if (picker === undefined) {
      throw new Error(`no picker for owner ${owner}`);
    }
    return picker;
  };
  commands.register(
    PICKER_CHOOSE_ROW.id,
    ({ arg }: PageCommandContext<{ owner: string; index: number }>) =>
      pickerOf(arg.owner).chooseAt(arg.index),
    'core',
  );
  commands.register(
    PICKER_CANCEL.id,
    ({ arg }: PageCommandContext<string>) => pickerOf(arg).cancel(),
    'core',
  );
  return {
    track(owner, picker) {
      if (pickers.has(owner)) {
        throw new Error(`picker owner ${owner} is taken`);
      }
      pickers.set(owner, picker);
      return {
        dispose() {
          if (pickers.get(owner) === picker) {
            pickers.delete(owner);
          }
        },
      };
    },
  };
}
