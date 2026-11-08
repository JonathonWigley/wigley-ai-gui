import type { PluginStatus } from '../../../contracts/core-state';
import type { SettingLeaf } from '../../../contracts/user-config';
import { settingsManifest } from '../manifest';
import {
  lockedText,
  matchesPlugin,
  PLUGIN_LIST_PATH,
  withPluginSwitched,
} from './plugin-rows';
import type { RowContext, SectionDrawing, SettingsRow } from './settings-view';

const SELF_OFF_REFUSAL =
  'Settings cannot switch itself off: edit settings.json';

// The boolean picker's items, as a boolean setting's picker offers them.
const PICKER_ITEMS: readonly boolean[] = [true, false];

// The leaf at `PLUGIN_LIST_PATH` in the schema's core section.
function pluginListLeaf(ctx: RowContext): SettingLeaf {
  const leaf = ctx.schema.sections
    .find((section) => section.id === 'core')
    ?.leaves.find((each) => each.path === PLUGIN_LIST_PATH);
  if (leaf === undefined) {
    throw new Error(`The core settings hold no ${PLUGIN_LIST_PATH} leaf`);
  }
  return leaf;
}

// Writes `status`'s plugin off. A running plugin asks the switch first, and a
// reason refuses with nothing written; Settings' own row refuses without
// asking.
async function switchOff(
  status: PluginStatus,
  ctx: RowContext,
  expectedText: string | null,
): Promise<void> {
  if (status.on) {
    if (status.id === settingsManifest.id) {
      ctx.refuse(SELF_OFF_REFUSAL);
      return;
    }
    const reason = await ctx.mayDisable(status.id);
    if (reason !== null) {
      ctx.refuse(reason);
      return;
    }
  }
  const layer = withPluginSwitched(
    ctx.settingsLayer(),
    pluginListLeaf(ctx),
    status.id,
    false,
  );
  ctx.commitSettings(layer, { expectedText });
}

function pluginRow(
  status: PluginStatus,
  statuses: readonly PluginStatus[],
  ctx: RowContext,
): SettingsRow {
  const edit = () =>
    ctx.openPicker({
      file: 'settings',
      title: status.label,
      items: PICKER_ITEMS,
      label: (item) => String(item),
      selected: status.on ? 0 : 1,
      chosen(isOn, expectedText) {
        if (!isOn) {
          // A rejected ask was logged and toasted by `ctx.mayDisable`.
          switchOff(status, ctx, expectedText).catch(() => undefined);
          return;
        }
        const layer = withPluginSwitched(
          ctx.settingsLayer(),
          pluginListLeaf(ctx),
          status.id,
          true,
        );
        ctx.commitSettings(layer, { expectedText });
      },
    });
  return {
    key: `plugin:${status.id}`,
    file: 'settings',
    draw: {
      part: 'pluginRow',
      input: {
        id: status.id,
        label: status.label,
        description: status.description,
        value: status.on ? 'true' : 'false',
        lockedText: lockedText(status, statuses),
      },
    },
    actions: { open: edit, edit },
  };
}

// The Plugins section: one row per plugin `ctx.plugins()` lists, in its
// order, that matches `query`.
export function pluginSection(ctx: RowContext, query: string): SectionDrawing {
  const statuses = ctx.plugins();
  const rows = statuses
    .filter((status) => matchesPlugin(status, query, ctx.matcher))
    .map((status) => pluginRow(status, statuses, ctx));
  return { entries: rows.map((row) => ({ type: 'row', row })), rows };
}
