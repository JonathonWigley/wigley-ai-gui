import type { SettingSection } from '../../../contracts/user-config';
import { matchesSetting } from './row-filter';
import { withoutSetting, withSetting } from './setting-edits';
import {
  boxText,
  parseBoxText,
  type SettingRow,
  settingRows,
  valueText,
} from './setting-rows';
import type {
  CommitVia,
  RowActions,
  RowContext,
  SectionDrawing,
  SettingsRow,
} from './settings-view';

// The value a picker offers for each item of a choice, boolean or theme row.
function pickerItems(row: SettingRow, ctx: RowContext): readonly unknown[] {
  const { control } = row.leaf;
  switch (control.kind) {
    case 'choice':
      return control.choices;
    case 'boolean':
      return [true, false];
    case 'theme':
      return ctx.read().themes;
    default:
      return [];
  }
}

function rowActions(row: SettingRow, ctx: RowContext): RowActions {
  const { leaf } = row;
  const { control } = leaf;
  // Commits a box's text; returns the problem when the text does not parse.
  const commitText = (text: string, via: CommitVia): string | null => {
    const parsed = parseBoxText(text, control);
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
  const edit = () => {
    if (
      control.kind === 'number' ||
      control.kind === 'string' ||
      control.kind === 'json'
    ) {
      ctx.openBox({
        key: leaf.path,
        file: 'settings',
        text: boxText(row),
        editor:
          control.kind === 'json'
            ? { type: 'document', fileName: `${leaf.path}.json` }
            : { type: 'line' },
        accept(box) {
          const problem = commitText(box.text(), { box });
          if (problem !== null) {
            ctx.boxProblem(box, problem);
          }
        },
      });
      return;
    }
    const items = pickerItems(row, ctx);
    ctx.openPicker({
      file: 'settings',
      title: leaf.label,
      items,
      label: (item) => String(item),
      selected: items.indexOf(row.value),
      chosen: (item, expectedText) =>
        ctx.commitSettings(withSetting(ctx.settingsLayer(), leaf, item), {
          expectedText,
        }),
    });
  };
  return {
    open: edit,
    edit,
    reset: () =>
      ctx.commitSettings(withoutSetting(ctx.settingsLayer(), leaf.path), null),
  };
}

// The rows of a settings section that match `query`, drawn from the last
// good settings layer.
export function settingSection(
  section: SettingSection,
  ctx: RowContext,
  query: string,
): SectionDrawing {
  const rows: SettingsRow[] = settingRows(section, ctx.settingsLayer())
    .filter((row) => matchesSetting(row, query))
    .map((row) => {
      const { leaf } = row;
      const fallback = leaf.fallback?.value;
      return {
        key: leaf.path,
        file: 'settings',
        draw: {
          part: 'settingRow',
          input: {
            path: leaf.path,
            label: leaf.label,
            description: leaf.description,
            value: valueText(row.value, leaf.control),
            isUnset: row.value === undefined || row.value === null,
            isSet: row.isSet,
            defaultText: valueText(fallback, leaf.control),
            control: leaf.control.kind,
          },
        },
        actions: rowActions(row, ctx),
      };
    });
  return { entries: rows.map((row) => ({ type: 'row', row })), rows };
}
