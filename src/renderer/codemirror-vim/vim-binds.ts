import type {
  EditorBind,
  EditorKeymap,
  EditorMode,
} from '../../contracts/keymap';
import { editorBindMode, withLeader } from '../../shared/key-hints';
import { exBindName } from './ex-command-name';

const MAP_PREFIX: Record<EditorMode, string> = { normal: 'n', insert: 'i' };

// The binds sharing one key sequence in one mode, `<Leader>` spelled as the
// leader.
export interface BindGroup {
  mode: EditorMode;
  keys: string;
  binds: EditorBind[];
}

// The keymap's binds grouped by mode and key sequence, groups in the order
// they first appear and binds in keymap order: one vim map per group.
export function bindGroups(keymap: EditorKeymap): BindGroup[] {
  const groups = new Map<string, BindGroup>();
  for (const bind of keymap.binds) {
    const mode = editorBindMode(bind);
    const keys = withLeader(bind.keys, keymap.leader);
    const id = `${mode} ${keys}`;
    const group = groups.get(id);
    if (group) {
      group.binds.push(bind);
    } else {
      groups.set(id, { mode, keys, binds: [bind] });
    }
  }
  return [...groups.values()];
}

// The engine runs a complete bind at once instead of waiting for a longer one,
// so the leader's own default bind is unmapped before the binds that use it. A
// bind to an ex command ends in <CR>, or its keys only type into the prompt.
// Insert-mode groups get no line: in insert mode an ex command's keys would
// type themselves, so the host maps those groups to vim actions instead.
export function vimrcLines(
  keymap: EditorKeymap,
  groups: BindGroup[],
): string[] {
  return [
    `unmap ${keymap.leader}`,
    ...keymap.remaps.map(
      (remap) =>
        `${MAP_PREFIX[remap.mode]}noremap ${withLeader(remap.keys, keymap.leader)} ${remap.to}`,
    ),
    ...groups.flatMap((group, index) =>
      group.mode === 'normal'
        ? [`nnoremap ${group.keys} :${exBindName(index)}<CR>`]
        : [],
    ),
  ];
}
