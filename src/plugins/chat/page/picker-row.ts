import type { ControlChoice, SessionControl } from '../../../contracts/agent';
import type { ChatProfile } from '../contract';
import type { PickerItemInput } from '../layouts/layout';
import { valueLabel } from './chat-state';
import type { SessionItem } from './resume-items';
import type { FolderItem } from './start-prompt-items';

// Each list's row input for the `pickerRow` part, spelled as the row shows
// it.

export function folderRowInput(item: FolderItem): PickerItemInput {
  if (item.kind === 'choose') {
    return { list: 'folder', kind: 'choose' };
  }
  return {
    list: 'folder',
    kind: 'recent',
    path: item.label,
    profile: item.folder.profile,
    lastUsed: item.folder.lastUsed,
  };
}

export function profileRowInput(profile: ChatProfile): PickerItemInput {
  return { list: 'profile', name: profile.name, configDir: profile.configDir };
}

export function sessionRowInput(item: SessionItem): PickerItemInput {
  if (item.kind === 'new') {
    return { list: 'session', kind: 'new' };
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
