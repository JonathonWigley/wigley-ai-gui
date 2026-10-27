import type { Disposable } from '../../../contracts/disposable';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import {
  createListPicker,
  type ListPicker,
} from '../../../shared/page/list-picker';
import { textButton } from '../../../shared/page/ui/button';
import { createDialog } from '../../../shared/page/ui/dialog';
import { inputFrame } from '../../../shared/page/ui/input-frame';
import { disposeAnchors } from '../../../shared/page/ui/key-anchors';
import { row } from '../../../shared/page/ui/row';
import type {
  CreateKind,
  CreatePlace,
  DocsChannel,
  FolderEntry,
  IndexEntry,
} from '../contract';
import { CREATE_KINDS, nameProblem, placesFor } from '../kinds';
import {
  COMPLETION_LIMIT,
  completeTyped,
  completionQuery,
  completions,
} from '../path-completion';
import {
  type DocChangeRecord,
  type DocsAnchor,
  noPlaceText,
  provisionalEntry,
  renameRecord,
  trashQuestion,
} from './docs-state';
import { textBoxInput } from '../../../shared/page/text-box';

// The scopes the dialogs push over the view's pane scope.
export type DialogScope = 'picker' | 'box' | 'confirm';

interface BoxRequest {
  label: string;
  text: string;
  // Lists the typed folder's matches under the box, and Tab completes them.
  completes: boolean;
  // Enter: the box stays open until the request closes it.
  accept(text: string): Promise<void>;
  cancelled(): void;
}

// A one-line text box in a dialog, scope `docs.box` pushed while it shows,
// with the `⇥ complete` hint and the completion list under it for a path.
interface TextBox {
  element: HTMLElement;
  open(request: BoxRequest): void;
  isOpen(): boolean;
  complete(): void;
  accept(): void;
  cancel(): void;
  // Closes the box without hearing a cancel.
  close(): void;
}

interface TextBoxDeps {
  channel: PageChannel<DocsChannel>;
  homeDir: string;
  paths: Paths;
  log: Log;
  pushScope(): PushedScope;
  closed(): void;
  anchor: DocsAnchor;
  // Receives the anchor the box names.
  anchors: Disposable[];
}

function createTextBox(deps: TextBoxDeps): TextBox {
  const dialog = createDialog('');
  const frame = inputFrame();
  const input = textBoxInput('docs-box');
  frame.append(input);
  const completeHint = element('span', 'docs-box-hint');
  deps.anchors.push(
    deps.anchor(completeHint, 'boxComplete', {
      scope: 'box',
      label: 'complete',
    }),
  );
  completeHint.hidden = true;
  const list = element('ol', 'docs-completion');
  dialog.body.append(frame, completeHint, list);
  list.hidden = true;

  let request: BoxRequest | null = null;
  let pushed: PushedScope | null = null;
  let isAccepting = false;
  // Each folder is listed once per open box.
  let listings = new Map<string, Promise<FolderEntry[]>>();

  const listing = (folder: string): Promise<FolderEntry[]> => {
    const known = listings.get(folder);
    if (known !== undefined) {
      return known;
    }
    const listed = deps.channel
      .invoke('listFolder', folder)
      .catch((error: unknown) => {
        deps.log('docs', `not listed ${folder}: ${errorText(error)}`);
        return [];
      });
    listings.set(folder, listed);
    return listed;
  };

  // The matches for `typed`, once its folder is listed.
  const matchesFor = async (typed: string) => {
    const query = completionQuery(typed, deps.homeDir, deps.paths);
    return completions(await listing(query.folder), query.prefix, deps.paths);
  };

  // Draws the matches for the box's text, unless it changed meanwhile.
  const refresh = async () => {
    const shown = request;
    const typed = input.value;
    const matches = await matchesFor(typed);
    if (request !== shown || input.value !== typed) {
      return;
    }
    const texts = matches.slice(0, COMPLETION_LIMIT).map((match) => match.text);
    list.replaceChildren(
      ...texts.map((text) => row({ density: 'list', tag: 'li', label: text })),
    );
    list.hidden = texts.length === 0;
  };

  const refreshQuietly = () => {
    if (request?.completes === true) {
      refresh().catch((error) =>
        deps.log('docs', `completion failed: ${errorText(error)}`),
      );
    }
  };

  const hide = () => {
    dialog.hide();
    list.hidden = true;
    list.replaceChildren();
    request = null;
    pushed?.pop();
    pushed = null;
    deps.closed();
  };

  const cursorToEnd = () =>
    input.setSelectionRange(input.value.length, input.value.length);

  input.addEventListener('input', refreshQuietly);

  const box: TextBox = {
    element: dialog.element,
    open(next) {
      if (pushed === null) {
        const scope = deps.pushScope();
        scope.onBaseChanged(() => {
          if (pushed === scope) {
            box.cancel();
          }
        });
        pushed = scope;
      }
      request = next;
      listings = new Map();
      isAccepting = false;
      dialog.setTitle(next.label);
      completeHint.hidden = !next.completes;
      input.value = next.text;
      dialog.show();
      list.hidden = true;
      input.focus();
      cursorToEnd();
      refreshQuietly();
    },
    isOpen: () => request !== null,
    complete() {
      const shown = request;
      if (shown === null || !shown.completes) {
        return;
      }
      const typed = input.value;
      matchesFor(typed)
        .then(async (matches) => {
          if (request !== shown || input.value !== typed) {
            return;
          }
          input.value = completeTyped(typed, matches, deps.paths);
          cursorToEnd();
          await refresh();
          deps.log('docs', `completed to ${input.value}`);
        })
        .catch((error) =>
          deps.log('docs', `completion failed: ${errorText(error)}`),
        );
    },
    accept() {
      const shown = request;
      if (shown === null || isAccepting) {
        return;
      }
      isAccepting = true;
      shown.accept(input.value).finally(() => {
        if (request === shown) {
          isAccepting = false;
        }
      });
    },
    cancel() {
      const shown = request;
      if (shown === null) {
        return;
      }
      hide();
      shown.cancelled();
    },
    close() {
      if (request !== null) {
        hide();
      }
    },
  };
  return box;
}

// A yes/no prompt in a dialog, scope `docs.confirm` pushed while it shows,
// its Keep it and Move to the Trash buttons each holding its key; a click
// answers as the key does, and the base scope changing under it answers no.
interface Confirm {
  element: HTMLElement;
  open(question: string, yes: () => void, no: () => void): void;
  yes(): void;
  no(): void;
  // Closes the prompt without an answer.
  close(): void;
}

function createConfirm(
  pushScope: () => PushedScope,
  closed: () => void,
  anchor: DocsAnchor,
  anchors: Disposable[],
): Confirm {
  const dialog = createDialog('Move to the Trash');
  const text = element('p', 'docs-confirm-text');
  dialog.body.append(text);

  let answers: { yes(): void; no(): void } | null = null;
  let pushed: PushedScope | null = null;

  const hide = () => {
    answers = null;
    dialog.hide();
    pushed?.pop();
    pushed = null;
    closed();
  };

  const answer = (pick: 'yes' | 'no') => {
    const held = answers;
    if (held !== null) {
      hide();
      held[pick]();
    }
  };

  const answerButton = (
    label: string,
    pick: 'yes' | 'no',
    variant: 'secondary' | 'danger',
  ) => {
    const hint = element('span');
    anchors.push(
      anchor(hint, pick === 'yes' ? 'confirmYes' : 'confirmNo', {
        scope: 'confirm',
      }),
    );
    return textButton(label, () => answer(pick), { variant, hint });
  };
  dialog.actions.append(
    answerButton('Keep it', 'no', 'secondary'),
    answerButton('Move to the Trash', 'yes', 'danger'),
  );

  const confirm: Confirm = {
    element: dialog.element,
    open(question, yes, no) {
      confirm.close();
      const scope = pushScope();
      scope.onBaseChanged(() => {
        if (pushed === scope) {
          answer('no');
        }
      });
      pushed = scope;
      answers = { yes, no };
      text.textContent = question;
      dialog.show();
    },
    yes: () => answer('yes'),
    no: () => answer('no'),
    close() {
      if (answers !== null) {
        hide();
      }
    },
  };
  return confirm;
}

const CREATE_KIND_TITLES: Record<CreateKind, string> = {
  instructions: 'instructions',
  rule: 'rule',
  skill: 'skill',
  subagent: 'subagent',
  command: 'command',
  learning: 'learning',
  reference: 'reference',
  'feature-doc': 'feature doc',
  followup: 'follow-up',
};

export interface DocsDialogsDeps {
  channel: PageChannel<DocsChannel>;
  homeDir: string;
  paths: Paths;
  toast(text: string, tone: ToastTone): void;
  log: Log;
  anchor: DocsAnchor;
  pushScope(scope: DialogScope): PushedScope;
  // The view's entries now.
  entries(): readonly IndexEntry[];
  // Applies a change main made; `selectPath` names the doc to select after
  // a rename.
  changed(record: DocChangeRecord, selectPath: string | null): void;
  // Opens the entry's file in the view's document editor at `line`.
  openInEditor(entry: IndexEntry, line: number): Promise<void>;
  // Focus goes back to the view's pane once a dialog closes.
  dialogClosed(): void;
}

// The view's dialogs: the list picker, the name and path boxes and the Trash
// confirm, and the create, rename and trash flows that run through them and
// main. Each flow's refusals before a dialog opens are the view's.
export interface DocsDialogs {
  elements: HTMLElement[];
  picker: ListPicker;
  createByKind(): void;
  // The path box prefilled with `folder`, the home folder when null.
  createByPath(folder: string | null): void;
  rename(entry: IndexEntry): void;
  trash(entry: IndexEntry): void;
  isBoxOpen(): boolean;
  boxComplete(): void;
  boxAccept(): void;
  boxCancel(): void;
  confirmYes(): void;
  confirmNo(): void;
  // Closes every dialog without hearing a cancel.
  close(): void;
  // Disposes the dialogs' anchors.
  dispose(): void;
}

export function createDocsDialogs(deps: DocsDialogsDeps): DocsDialogs {
  const { channel, log, paths, toast } = deps;
  const picker = createListPicker({
    pushScope: () => deps.pushScope('picker'),
    log,
    logSource: 'docs',
  });
  // The anchors the box and the confirm name, for the view's life.
  const anchors: Disposable[] = [];
  const box = createTextBox({
    channel,
    homeDir: deps.homeDir,
    paths,
    log,
    pushScope: () => deps.pushScope('box'),
    closed: deps.dialogClosed,
    anchor: deps.anchor,
    anchors,
  });
  const confirm = createConfirm(
    () => deps.pushScope('confirm'),
    deps.dialogClosed,
    deps.anchor,
    anchors,
  );

  const createCancelled = () => log('docs', 'create cancelled');

  const failed = (error: unknown) => toast(errorText(error), 'error');

  // Whether a delete is waiting on main to name what it moves.
  let isTrashAsking = false;

  const pickPlace = (kind: CreateKind) => {
    const kindTitle = CREATE_KIND_TITLES[kind];
    const places = placesFor(kind, deps.entries(), deps.homeDir, paths);
    if (places.length === 0) {
      toast(noPlaceText(kindTitle), 'info');
      createCancelled();
      deps.dialogClosed();
      return;
    }
    picker.open({
      title: `Place for the ${kindTitle}`,
      items: places,
      label: (place) => place.title,
      selected: 0,
      chosen: (place) => nameDoc(kind, place),
      cancelled: () => {
        createCancelled();
        deps.dialogClosed();
      },
    });
    log('docs', `create ${kindTitle}: pick a place`);
  };

  const nameDoc = (kind: CreateKind, place: CreatePlace) => {
    const kindTitle = CREATE_KIND_TITLES[kind];
    box.open({
      label: kind === 'followup' ? 'Title' : 'Name',
      text: '',
      completes: false,
      accept: async (name) => {
        const problem = nameProblem(kind, name);
        if (problem !== null) {
          toast(problem, 'error');
          return;
        }
        try {
          const created = await channel.invoke('createDoc', {
            type: 'kind',
            kind,
            place,
            name,
          });
          box.close();
          const entry =
            kind === 'followup'
              ? followupEntry(
                  created.path,
                  created.line,
                  name.trim(),
                  deps.entries(),
                  paths,
                )
              : provisionalEntry(created.path, kind, deps.entries(), paths);
          deps.changed({ type: 'created', entry }, null);
          await deps.openInEditor(entry, created.line);
          log(
            'docs',
            kind === 'followup'
              ? `created follow-up ${name.trim()}`
              : `created ${paths.base(created.path)}`,
          );
        } catch (error) {
          failed(error);
        }
      },
      cancelled: createCancelled,
    });
    log('docs', `create ${kindTitle}: name it`);
  };

  const dialogs: DocsDialogs = {
    elements: [picker.element, box.element, confirm.element],
    picker,
    createByKind() {
      picker.open({
        title: 'New doc by kind',
        items: CREATE_KINDS,
        label: (kind) => CREATE_KIND_TITLES[kind],
        selected: 0,
        chosen: (kind) => {
          try {
            pickPlace(kind);
          } catch (error) {
            failed(error);
          }
        },
        cancelled: () => {
          createCancelled();
          deps.dialogClosed();
        },
      });
      log('docs', 'create: pick a kind');
    },
    createByPath(folder) {
      const { homeDir } = deps;
      box.open({
        label: 'New file',
        text: `${paths.tilde(folder ?? homeDir, homeDir)}${paths.separator}`,
        completes: true,
        accept: async (path) => {
          try {
            const created = await channel.invoke('createDoc', {
              type: 'path',
              path,
            });
            box.close();
            const entry = provisionalEntry(
              created.path,
              null,
              deps.entries(),
              paths,
            );
            deps.changed({ type: 'created', entry }, null);
            await deps.openInEditor(entry, created.line);
            log('docs', `created ${paths.base(created.path)}`);
          } catch (error) {
            failed(error);
          }
        },
        cancelled: createCancelled,
      });
      log('docs', 'create by path: type the path');
    },
    rename(entry) {
      box.open({
        label: 'Rename to',
        text: paths.tilde(entry.path, deps.homeDir),
        completes: true,
        accept: async (typed) => {
          try {
            const renamed = await channel.invoke(
              'renameDoc',
              entry.path,
              typed,
            );
            box.close();
            const record = renameRecord(entry.path, renamed, paths);
            deps.changed(record, renamed);
            log(
              'docs',
              `renamed ${paths.base(record.from)} to ${paths.base(record.to)}`,
            );
          } catch (error) {
            failed(error);
          }
        },
        cancelled: () => log('docs', 'rename cancelled'),
      });
      log('docs', 'rename: type the new path');
    },
    // Main names what goes before the question, so a link's target is named
    // beside the link; a delete while that is asked is ignored. A trash that
    // fails partway still applies what moved, and toasts the failure.
    trash(entry) {
      if (isTrashAsking) {
        log('docs', 'delete ignored: one is already being asked');
        return;
      }
      isTrashAsking = true;
      channel
        .invoke('trashTargets', entry.path)
        .finally(() => {
          isTrashAsking = false;
        })
        .then((targets) => {
          const name = paths.base(targets[targets.length - 1]);
          confirm.open(
            trashQuestion(targets, deps.homeDir, paths),
            () => {
              channel
                .invoke('trashDoc', entry.path)
                .then((result) => {
                  deps.changed(
                    { type: 'trashed', paths: result.trashed },
                    null,
                  );
                  if (result.error === null) {
                    log('docs', `moved ${name} to the Trash`);
                  } else {
                    failed(result.error);
                    log(
                      'docs',
                      `moved ${result.trashed.map((path) => paths.base(path)).join(', ')} to the Trash, then failed: ${result.error}`,
                    );
                  }
                })
                .catch(failed);
            },
            () => log('docs', `kept ${name}`),
          );
          log('docs', `asked to move ${name} to the Trash`);
        })
        .catch(failed);
    },
    isBoxOpen: () => box.isOpen(),
    boxComplete: () => box.complete(),
    boxAccept: () => box.accept(),
    boxCancel: () => box.cancel(),
    confirmYes: () => confirm.yes(),
    confirmNo: () => confirm.no(),
    close() {
      picker.close();
      box.close();
      confirm.close();
    },
    dispose() {
      disposeAnchors(anchors);
    },
  };
  return dialogs;
}

// The entry a follow-up appended at `line` of `path` gets until a build
// lists it.
function followupEntry(
  path: string,
  line: number,
  title: string,
  entries: readonly IndexEntry[],
  paths: Paths,
): IndexEntry {
  return {
    ...provisionalEntry(path, 'followup', entries, paths),
    id: `${path}#L${line}`,
    line,
    title,
    meta: { status: 'open', gist: '', section: null },
  };
}
