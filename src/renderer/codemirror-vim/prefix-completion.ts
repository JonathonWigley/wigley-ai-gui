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
import { EditorView } from 'codemirror';
import { getCM } from '@replit/codemirror-vim';
import type { EditorCompletions } from '../../contracts/editor';

// The document range a completion replaces and the words it offers there.
export interface PrefixMatch {
  from: number;
  to: number;
  words: string[];
}

const WHITESPACE = /\s/;

// The words starting with what follows `prefix` in `textBeforeCursor`,
// compared lower-cased, in input order and each once; null when the text does
// not start with `prefix`, holds whitespace after it, or no word matches.
export function prefixMatch(
  textBeforeCursor: string,
  prefix: string,
  words: readonly string[],
): PrefixMatch | null {
  if (!textBeforeCursor.startsWith(prefix)) {
    return null;
  }
  const typed = textBeforeCursor.slice(prefix.length);
  if (WHITESPACE.test(typed)) {
    return null;
  }
  const typedLower = typed.toLowerCase();
  const matches = [
    ...new Set(
      words.filter((word) => word.toLowerCase().startsWith(typedLower)),
    ),
  ];
  if (matches.length === 0) {
    return null;
  }
  return { from: 0, to: textBeforeCursor.length, words: matches };
}

function sameWords(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((word, index) => word === right[index])
  );
}

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

// The popup's keys run only while it is open: Tab accepts, Ctrl+n and
// ArrowDown move down, Ctrl+p and ArrowUp move up.
function popupKeys() {
  return EditorView.domEventHandlers({
    keydown: (event, view) => {
      if (completionStatus(view.state) !== 'active') {
        return false;
      }
      const isDown =
        event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n');
      const isUp =
        event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p');
      let isHandled = false;
      if (event.key === 'Tab') {
        isHandled = acceptCompletion(view);
      } else if (isDown) {
        isHandled = moveCompletionSelection(true)(view);
      } else if (isUp) {
        isHandled = moveCompletionSelection(false)(view);
      }
      if (isHandled) {
        event.preventDefault();
      }
      return isHandled;
    },
  });
}

// Completion of `completions.words()` after `completions.prefix` in insert
// mode, reporting each newly offered list once until the popup closes. Placed
// ahead of `vim(...)`, so the popup's keys run before vim's.
export function prefixCompletion(completions: EditorCompletions) {
  let lastOffered: readonly string[] | null = null;
  const source = (context: CompletionContext): CompletionResult | null => {
    const cm = context.view ? getCM(context.view) : null;
    if (!cm?.state.vim?.insertMode) {
      return null;
    }
    const textBeforeCursor = context.state.sliceDoc(0, context.pos);
    const match = prefixMatch(
      textBeforeCursor,
      completions.prefix,
      completions.words(),
    );
    if (match === null) {
      return null;
    }
    if (lastOffered === null || !sameWords(lastOffered, match.words)) {
      lastOffered = match.words;
      completions.offered([...match.words]);
    }
    return {
      from: match.from,
      to: match.to,
      filter: false,
      options: match.words.map((word) => completionOf(completions, word)),
    };
  };
  return [
    autocompletion({ override: [source], defaultKeymap: false, icons: false }),
    popupKeys(),
    EditorView.updateListener.of((update) => {
      if (completionStatus(update.state) === null) {
        lastOffered = null;
      }
    }),
  ];
}
