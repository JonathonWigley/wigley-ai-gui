import type {
  SettingSection,
  UserConfigRead,
} from '../../../contracts/user-config';
import type { SettingControlKind, SettingKindEditor } from '../contract';
import { PLUGIN_LIST_PATH } from './plugin-rows';
import { matchesSetting } from './row-filter';
import { withoutSetting, withSetting } from './setting-edits';
import { type SettingRow, settingRows, valueText } from './setting-rows';
import type {
  CommitVia,
  RowActions,
  RowContext,
  SectionDrawing,
  SettingsRow,
} from './settings-view';

type BoxKindEditor = Extract<SettingKindEditor, { type: 'box' }>;
type PickerKindEditor = Extract<SettingKindEditor, { type: 'picker' }>;

// Opens the kind's box under the row, empty for an unset or null value; a
// document box takes the JSON language from its `<path>.json` file name.
function openKindBox(row: SettingRow, editor: BoxKindEditor, ctx: RowContext) {
  const { leaf } = row;
  // Commits a box's text; returns the problem when the text does not parse.
  const commitText = (text: string, via: CommitVia): string | null => {
    const parsed = editor.parse(text);
    if (parsed.type === 'problem') {
      return parsed.problem;
    }
    const layer = ctx.settingsLayer();
    ctx.commitSettings(
      parsed.type === 'unset'
        ? withoutSetting(layer, leaf.path)
        : withSetting(layer, leaf, parsed.value),
      via,
    );
    return null;
  };
  const isUnset = row.value === undefined || row.value === null;
  ctx.openBox({
    key: leaf.path,
    file: 'settings',
    text: isUnset ? '' : editor.text(row.value),
    editor:
      editor.box === 'document'
        ? { type: 'document', fileName: `${leaf.path}.json` }
        : { type: 'line' },
    accept(box) {
      const problem = commitText(box.text(), { box });
      if (problem !== null) {
        ctx.boxProblem(box, problem);
      }
    },
  });
}

// Opens the list picker on the kind's items, the cursor on the row's value;
// the open list follows the kind's items in each newer read.
function openKindPicker(
  row: SettingRow,
  editor: PickerKindEditor,
  ctx: RowContext,
) {
  const { leaf } = row;
  const itemsOf = (config: UserConfigRead) => editor.items({ leaf, config });
  const items = itemsOf(ctx.read());
  ctx.openPicker({
    file: 'settings',
    title: leaf.label,
    items,
    itemsOf,
    label: (item) => editor.label(item),
    selected: items.indexOf(row.value),
    chosen: (item, expectedText) =>
      ctx.commitSettings(withSetting(ctx.settingsLayer(), leaf, item), {
        expectedText,
      }),
  });
}

// A row whose kind no registration holds only resets.
function rowActions(
  row: SettingRow,
  kind: SettingControlKind | undefined,
  ctx: RowContext,
): RowActions {
  const reset = () =>
    ctx.commitSettings(
      withoutSetting(ctx.settingsLayer(), row.leaf.path),
      null,
    );
  if (kind === undefined) {
    return { reset };
  }
  const editor = kind.edit;
  const edit =
    editor.type === 'box'
      ? () => openKindBox(row, editor, ctx)
      : () => openKindPicker(row, editor, ctx);
  return { open: edit, edit, reset };
}

// The rows of a settings section that match `query`, drawn from the last
// good settings layer, each with the control kind its leaf names. The
// `plugins.disabled` leaf draws no row: the Plugins section switches each
// plugin, asking the plugin switch before it writes.
export function settingSection(
  section: SettingSection,
  ctx: RowContext,
  query: string,
): SectionDrawing {
  const rows: SettingsRow[] = settingRows(section, ctx.settingsLayer())
    .filter((row) => row.leaf.path !== PLUGIN_LIST_PATH)
    .filter((row) => matchesSetting(row, query, ctx.matcher))
    .map((row) => {
      const { leaf } = row;
      const fallback = leaf.fallback?.value;
      const kind = ctx.controlKind(leaf.control.kind);
      return {
        key: leaf.path,
        file: 'settings',
        draw: {
          part: 'settingRow',
          input: {
            path: leaf.path,
            label: leaf.label,
            description: leaf.description,
            value: valueText(row.value, kind),
            isUnset: row.value === undefined || row.value === null,
            isSet: row.isSet,
            defaultText: valueText(fallback, kind),
            control: leaf.control.kind,
          },
        },
        actions: rowActions(row, kind, ctx),
      };
    });
  return { entries: rows.map((row) => ({ type: 'row', row })), rows };
}
