import type { Keymap } from '../contracts/keymap';
import type { AppConfig, ConfigProblem } from '../contracts/settings';

// The keys the page and the editor run on now, each field set only once its
// target took it, so a push is compared against what is installed rather than
// against the last config pushed.
export interface AppliedKeys {
  editor: Keymap['editor'];
  page: Keymap['page'];
  timeoutMs: number;
}

// The pushed config as the page runs it: its keymap's editor and page keys and
// its `keySequenceTimeoutMs` are the applied ones, the rest of its keymap and
// settings as pushed, since main applies those binds itself; and when the
// page refused the pushed keys, with `refusal` naming why, its problems carry
// that refusal after main's.
export function installedConfig(
  next: AppConfig,
  applied: AppliedKeys,
  refusal: string | null,
): AppConfig {
  const problems: ConfigProblem[] =
    refusal === null
      ? next.problems
      : [
          ...next.problems,
          { file: 'keymap.json', message: `Keys not applied: ${refusal}` },
        ];
  return {
    ...next,
    keymap: { ...next.keymap, editor: applied.editor, page: applied.page },
    settings: { ...next.settings, keySequenceTimeoutMs: applied.timeoutMs },
    problems,
  };
}
