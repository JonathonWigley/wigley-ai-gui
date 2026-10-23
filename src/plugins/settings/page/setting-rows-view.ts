import type { SettingSection } from '../../../contracts/user-config';
import { element } from '../../../shared/page/dom';
import { tag } from '../../../shared/page/ui/tag';
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

export interface RowLines {
  label: string;
  description: string;
  // What the row's end shows: its value, or its binds.
  end: HTMLElement;
  // Whether the user set the row, which shows a `Set` tag and, when not
  // null, `defaultText` after it.
  isSet: boolean;
  defaultText: string | null;
}

// A settings row: the label and its end on the first line, the description
// under it, wrapping; a box opens under them.
export function settingsRowElement(lines: RowLines): HTMLElement {
  const node = element('li', 'settings-row');
  const head = element('div', 'settings-row-head');
  const end = element('div', 'settings-row-end');
  if (lines.isSet) {
    end.append(tag('Set'));
  }
  if (lines.isSet && lines.defaultText !== null) {
    end.append(
      element('span', 'settings-row-default', `Default: ${lines.defaultText}`),
    );
  }
  end.append(lines.end);
  head.append(element('span', 'settings-row-label', lines.label), end);
  node.append(head);
  if (lines.description !== '') {
    node.append(element('div', 'settings-row-description', lines.description));
  }
  return node;
}

// A row's value as its end shows it, tertiary when unset.
export function valueElement(text: string, isUnset: boolean): HTMLElement {
  const node = element('span', 'settings-row-value', text);
  node.classList.toggle('is-unset', isUnset);
  return node;
}

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
      const node = settingsRowElement({
        label: leaf.label,
        description: leaf.description,
        end: valueElement(
          valueText(row.value, leaf.control),
          row.value === undefined || row.value === null,
        ),
        isSet: row.isSet,
        defaultText: valueText(fallback, leaf.control),
      });
      return {
        key: leaf.path,
        file: 'settings',
        element: node,
        actions: rowActions(row, ctx),
      };
    });
  return { items: rows.map((row) => row.element), rows };
}
