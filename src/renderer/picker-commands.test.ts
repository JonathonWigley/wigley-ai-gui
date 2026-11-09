import { describe, expect, it, vi } from 'vitest';
import type { ListPicker } from '../contracts/list-picker';
import type { PageCommandContext } from '../contracts/plugin';
import { CommandRegistry } from '../shared/command-registry';
import { registerPickerCommands } from './picker-commands';

function fakePicker(): ListPicker {
  return { chooseAt: vi.fn(), cancel: vi.fn() } as unknown as ListPicker;
}

describe('registerPickerCommands', () => {
  it('chooseRow_TwoOwners_ReachesTheOwnersPicker', async () => {
    const registry = new CommandRegistry<PageCommandContext<any>>(() => {});
    const pickers = registerPickerCommands(registry);
    const [first, second] = [fakePicker(), fakePicker()];
    pickers.track('a', first);
    pickers.track('b', second);

    await registry.run('picker.chooseRow', { arg: { owner: 'b', index: 3 } });
    await registry.run('picker.cancel', { arg: 'a' });

    expect(second.chooseAt).toHaveBeenCalledWith(3);
    expect(first.chooseAt).not.toHaveBeenCalled();
    expect(first.cancel).toHaveBeenCalled();
    expect(second.cancel).not.toHaveBeenCalled();
  });

  it('track_SecondPickerForOwner_Throws', () => {
    const registry = new CommandRegistry<PageCommandContext<any>>(() => {});
    const pickers = registerPickerCommands(registry);
    pickers.track('a', fakePicker());

    expect(() => pickers.track('a', fakePicker())).toThrow(
      'picker owner a is taken',
    );
  });
});
