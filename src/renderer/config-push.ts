import type { CommandId } from '../contracts/commands';
import type { EditorHost } from '../contracts/editor';
import type { Keymap } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type { AppConfig, ConfigProblem } from '../contracts/settings';
import { errorText } from '../shared/error-text';
import { isSameJson } from '../shared/json';
import { requireUnambiguousEditorBinds } from '../shared/keymap-checks';
import { type AppliedKeys, installedConfig } from './installed-config';
import type { ThemeApplier } from './theme';

// What applying a pushed config changes outside the plugins.
export interface PushTargets {
  live: { current(): AppConfig; replace(next: AppConfig): void };
  applier: ThemeApplier;
  editor: Pick<EditorHost, 'setKeymap'>;
  commands: { requireRegistered(ids: Iterable<CommandId>): void };
  pageKeys: { setBinds(binds: Keymap['page'], timeoutMs: number): void };
  problems: { show(problems: readonly ConfigProblem[]): void };
  toasts: { show(text: string, tone: 'error'): void };
  log: Log;
}

function problemText(problem: ConfigProblem): string {
  return `${problem.file}: ${problem.message}`;
}

// Toasts and logs each problem in `problems` that `shown` does not hold, by
// file and message.
export function announceNewProblems(
  problems: readonly ConfigProblem[],
  shown: readonly ConfigProblem[],
  toasts: PushTargets['toasts'],
  log: Log,
) {
  const shownTexts = new Set(shown.map(problemText));
  for (const problem of problems) {
    const text = problemText(problem);
    if (!shownTexts.has(text)) {
      toasts.show(text, 'error');
      log('config', text);
    }
  }
}

// Installs the pushed editor keymap and page keys where they differ from
// `applied`, after the checks main also ran: the editor keymap first, then the
// page keys with the sequence timeout, recording each in `applied` once its
// target took it. Returns why the keys were refused, or null when they
// applied; a refusal leaves every target not yet reached on its applied keys,
// so the next push retries whatever still differs.
function applyKeys(
  next: AppConfig,
  applied: AppliedKeys,
  targets: PushTargets,
): string | null {
  const { keymap } = next;
  const timeoutMs = next.settings.keySequenceTimeoutMs;
  const isEditorSame = isSameJson(keymap.editor, applied.editor);
  const isPageSame =
    isSameJson(keymap.page, applied.page) && timeoutMs === applied.timeoutMs;
  if (isEditorSame && isPageSame) {
    return null;
  }
  try {
    requireUnambiguousEditorBinds(keymap.editor.binds, keymap.editor.leader);
    targets.commands.requireRegistered(
      [...keymap.editor.binds, ...keymap.page].map((bind) => bind.command),
    );
    if (!isEditorSame) {
      targets.editor.setKeymap(keymap.editor);
      applied.editor = keymap.editor;
    }
    if (!isPageSame) {
      targets.pageKeys.setBinds(keymap.page, timeoutMs);
      applied.page = keymap.page;
      applied.timeoutMs = timeoutMs;
    }
    return null;
  } catch (error) {
    return errorText(error);
  }
}

// Returns the function that applies each config main pushes, starting from the
// keys `installed` names as the ones the page and editor run on: the pushed
// keys (see applyKeys); then the theme; then the config as installed to the
// plugins' listeners, its editor keys, page keys and sequence timeout the ones
// the page and editor run on, so help, which-key and key hints show only
// installed binds; then the problems, a refusal of the keys among them,
// toasting each one not shown before.
export function createConfigPush(
  installed: AppliedKeys,
  targets: PushTargets,
): (next: AppConfig) => void {
  const applied: AppliedKeys = { ...installed };
  return (next) => {
    const { live, log } = targets;
    const previous = live.current();
    const refusal = applyKeys(next, applied, targets);
    targets.applier.apply(next.theme, next.settings);
    const config = installedConfig(next, applied, refusal);
    live.replace(config);
    targets.problems.show(config.problems);
    announceNewProblems(
      config.problems,
      previous.problems,
      targets.toasts,
      log,
    );
    log('config', 'applied a new config');
  };
}
