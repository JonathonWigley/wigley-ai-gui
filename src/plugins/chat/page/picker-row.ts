import type { ControlChoice, SessionControl } from '../../../contracts/agent';
import type { Paths } from '../../../contracts/paths';
import type { ChatProfile } from '../contract';
import type { PickerItemInput } from '../layouts/layout';
import { valueLabel } from './chat-state';
import { type SessionItem, sessionTime, withNote } from './resume-items';
import {
  type FolderItem,
  folderSectionDetail,
  type ProjectItem,
} from './start-prompt-items';

// Each list's row input for the `pickerRow` part, spelled as the row shows
// it.

export function folderRowInput(
  item: FolderItem,
  paths: Paths,
): PickerItemInput {
  if (item.kind === 'choose') {
    return { list: 'folder', kind: 'choose' };
  }
  if (item.kind === 'section') {
    return {
      list: 'folder',
      kind: 'section',
      title: item.row.title,
      detail: folderSectionDetail(item.row, paths),
      at: item.row.at,
    };
  }
  return {
    list: 'folder',
    kind: 'recent',
    path: item.label,
    profile: item.folder.profile,
    lastUsed: item.folder.lastUsed,
  };
}

// A section row draws as the folder step's; a project and the other-folder
// line draw as a `choices` row of their label.
export function projectRowInput(
  item: ProjectItem,
  paths: Paths,
): PickerItemInput {
  if (item.kind === 'section') {
    return folderRowInput(item, paths);
  }
  return { list: 'choices', label: item.label, isCurrent: false };
}

export function profileRowInput(profile: ChatProfile): PickerItemInput {
  return { list: 'profile', name: profile.name, configDir: profile.configDir };
}

export function sessionRowInput(item: SessionItem): PickerItemInput {
  if (item.kind === 'new') {
    return { list: 'session', kind: 'new' };
  }
  if (item.kind === 'section') {
    return {
      list: 'session',
      kind: 'section',
      title: item.closed.title,
      detail: withNote(item.closed, sessionTime(item.closed.at)),
      at: item.closed.at,
    };
  }
  return {
    list: 'session',
    kind: 'past',
    title: item.row.title,
    modified: item.row.modified,
    archived: item.row.archived,
  };
}

export function controlRowInput(control: SessionControl): PickerItemInput {
  return { list: 'controls', label: control.label, value: valueLabel(control) };
}

export function choiceRowInput(
  choice: ControlChoice,
  control: SessionControl,
): PickerItemInput {
  return {
    list: 'choices',
    label: choice.label,
    isCurrent: choice.value === control.value,
  };
}
