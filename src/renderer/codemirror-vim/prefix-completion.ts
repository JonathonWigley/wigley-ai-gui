import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  completionStatus,
  insertCompletionText,
  moveCompletionSelection,
  pickedCompletion,
} from '@codemirror/autocomplete';
import { type EditorState, Prec } from '@codemirror/state';
import type { Command } from '@codemirror/view';
import { EditorView } from 'codemirror';
import { getCM } from '@replit/codemirror-vim';
import type { CompletionItem, EditorCompletions } from '../../contracts/editor';
import type { FuzzyMatcher } from '../../contracts/fuzzy';

// The document range a completion replaces and the words it offers there.
export interface PrefixMatch {
  from: number;
  to: number;
  words: string[];
}

const WHITESPACE = /\s/;

function shortestTextLength(item: CompletionItem): number {
  return Math.min(
    item.word.length,
    ...item.aliases.map(({ length }) => length),
  );
}

// The words of the items that `matcher` matches, by word or alias, against
// what follows `prefix` in `textBeforeCursor`, best first and each once, the
// item with the shorter text first among equal matches; every item in input
// order with nothing typed. Null when the text does not start with `prefix`,
// holds whitespace after it, or no item matches.
export function prefixMatch(
  textBeforeCursor: string,
  prefix: string,
  items: readonly CompletionItem[],
  matcher: FuzzyMatcher,
): PrefixMatch | null {
  if (!textBeforeCursor.startsWith(prefix)) {
    return null;
  }
  const typed = textBeforeCursor.slice(prefix.length);
  if (WHITESPACE.test(typed)) {
    return null;
  }
  const candidates =
    typed === ''
      ? items
      : [...items].sort(
          (a, b) => shortestTextLength(a) - shortestTextLength(b),
        );
  const ranked = matcher.rank(candidates, typed, (item) => [
    [item.word, ...item.aliases],
  ]);
  if (ranked.length === 0) {
    return null;
  }
  return {
    from: 0,
    to: textBeforeCursor.length,
    words: [...new Set(ranked.map((item) => item.word))],
  };
}

function sameWords(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((word, index) => word === right[index])
  );
}

// The popup row for `word`: its label is `completions.prefix` plus the word,
// and accepting it inserts that text and a space, then reports the word.
function completionOf(
  completions: EditorCompletions,
  word: string,
): Completion {
  const text = completions.prefix + word;
  return {
    label: text,
    apply: (view, completion, from, to) => {
      view.dispatch({
        ...insertCompletionText(view.state, `${text} `, from, to),
        annotations: pickedCompletion.of(completion),
      });
      completions.accepted(word);
    },
  };
}

// What fills a row's `drawRow` element: the row's word is the completion's label
// with `completions.prefix` cut off, and each call draws into a new element from
// `createElement`. Null with no `drawRow`, so the row holds its label alone.
export function completionRowRender(
  completions: EditorCompletions,
  createElement: () => HTMLElement,
) {
  return (completion: Completion): HTMLElement | null => {
    if (completions.drawRow === undefined) {
      return null;
    }
    const row = createElement();
    completions.drawRow(completion.label.slice(completions.prefix.length), row);
    return row;
  };
}

export type PopupAction = 'accept' | 'down' | 'up';

const POPUP_COMMANDS: Record<PopupAction, Command> = {
  accept: acceptCompletion,
  down: moveCompletionSelection(true),
  up: moveCompletionSelection(false),
};

// What `event` does to an open popup: Tab accepts, Ctrl+n and ArrowDown move
// down, Ctrl+p and ArrowUp move up. The Ctrl forms read the physical key and
// exact modifiers, as the page's chords do.
export function popupActionOf(
  event: Pick<
    KeyboardEvent,
    'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
  >,
): PopupAction | null {
  const isCtrlAlone =
    event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  if (event.key === 'Tab') {
    return 'accept';
  }
  if (event.key === 'ArrowDown' || (isCtrlAlone && event.code === 'KeyN')) {
    return 'down';
  }
  if (event.key === 'ArrowUp' || (isCtrlAlone && event.code === 'KeyP')) {
    return 'up';
  }
  return null;
}

// Whether `state`'s popup is open and takes `event`, which the page's chord
// binds then leave to the editor.
export function popupTakesKey(
  event: KeyboardEvent,
  state: EditorState,
): boolean {
  return completionStatus(state) === 'active' && popupActionOf(event) !== null;
}

// Highest precedence runs the popup's keys ahead of vim's and CodeMirror's
// keymap's keydown handlers wherever the extension sits.
function popupKeys() {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown: (event, view) => {
        const action = popupActionOf(event);
        if (action === null || !popupTakesKey(event, view.state)) {
          return false;
        }
        const isHandled = POPUP_COMMANDS[action](view);
        if (isHandled) {
          event.preventDefault();
        }
        return isHandled;
      },
    }),
  );
}

// Completion of `completions.items()` after `completions.prefix` in vim's
// insert mode (not replace mode), ranked by `matcher`, reporting each newly
// offered list once until the popup closes. `filter: false` keeps the ranked
// order. Each word keeps one `Completion` for the life of the extension, so a
// word selected below the first row stays selected while it is listed; otherwise
// the first row is. The result's `update` reruns the match on every keystroke, so the
// open popup never waits on the source and Tab accepts at once. Placed after
// `vim(...)`: `autocompletion` brings in the keymap facet, whose keydown
// handler runs ahead of vim's when it is first met ahead of `vim(...)`. With
// no interaction delay, Tab accepts as soon as the popup shows. A row's
// `drawRow` element sits at position 60: CodeMirror's label is 50, its detail
// 80.
export function prefixCompletion(
  completions: EditorCompletions,
  matcher: FuzzyMatcher,
) {
  let lastOffered: readonly string[] | null = null;
  const completionsByWord = new Map<string, Completion>();
  const completionFor = (word: string): Completion => {
    let completion = completionsByWord.get(word);
    if (completion === undefined) {
      completion = completionOf(completions, word);
      completionsByWord.set(word, completion);
    }
    return completion;
  };
  // The match for the text before `context.pos`, reporting its list through
  // `completions.offered` when it differs from the last list reported.
  const offeredMatch = (context: CompletionContext): PrefixMatch | null => {
    const match = prefixMatch(
      context.state.sliceDoc(0, context.pos),
      completions.prefix,
      completions.items(),
      matcher,
    );
    if (match === null) {
      return null;
    }
    if (lastOffered === null || !sameWords(lastOffered, match.words)) {
      lastOffered = match.words;
      completions.offered([...match.words]);
    }
    return match;
  };
  const resultOf = (match: PrefixMatch): CompletionResult => ({
    from: match.from,
    to: match.to,
    filter: false,
    options: match.words.map(completionFor),
    update: (_current, _from, _to, context) => {
      const next = offeredMatch(context);
      return next === null ? null : resultOf(next);
    },
  });
  const source = (context: CompletionContext): CompletionResult | null => {
    const cm = context.view ? getCM(context.view) : null;
    if (cm?.state.vim?.mode !== 'insert') {
      return null;
    }
    const match = offeredMatch(context);
    return match === null ? null : resultOf(match);
  };
  return [
    autocompletion({
      override: [source],
      defaultKeymap: false,
      icons: false,
      interactionDelay: 0,
      addToOptions: [
        {
          render: completionRowRender(completions, () => {
            const row = document.createElement('span');
            row.className = 'wg-completion-row';
            return row;
          }),
          position: 60,
        },
      ],
      tooltipClass: () => 'material-floating',
    }),
    popupKeys(),
    EditorView.updateListener.of((update) => {
      if (completionStatus(update.state) === null) {
        lastOffered = null;
      }
    }),
  ];
}
