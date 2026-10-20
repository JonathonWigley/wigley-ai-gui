import type {
  EditorBind,
  EditorKeymap,
  EditorMode,
} from '../../contracts/keymap';
import { withLeader } from '../../shared/key-hints';
import { exBindName } from './ex-command-name';

const MAP_PREFIX: Record<EditorMode, string> = { normal: 'n', insert: 'i' };

// The binds sharing one key sequence, `<Leader>` spelled as the leader.
export interface BindGroup {
  keys: string;
  binds: EditorBind[];
}

// The keymap's binds grouped by key sequence, groups in the order their keys
// first appear and binds in keymap order: one vim map per sequence.
export function bindGroups(keymap: EditorKeymap): BindGroup[] {
  const groups = new Map<string, EditorBind[]>();
  for (const bind of keymap.binds) {
    const keys = withLeader(bind.keys, keymap.leader);
    const group = groups.get(keys);
    if (group) {
      group.push(bind);
    } else {
      groups.set(keys, [bind]);
    }
  }
  return [...groups].map(([keys, binds]) => ({ keys, binds }));
}

// The engine runs a complete bind at once instead of waiting for a longer one,
// so the leader's own default bind is unmapped before the binds that use it. A
// bind to an ex command ends in <CR>, or its keys only type into the prompt.
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
    ...groups.map(
      (group, index) => `nnoremap ${group.keys} :${exBindName(index)}<CR>`,
    ),
  ];
}
