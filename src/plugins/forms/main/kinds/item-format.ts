import type {
  AnswerableKind,
  Finding,
  ItemKind,
  Notice,
  Question,
} from '../../contract';
import type { RoundItemPath } from '../round-error';

// The values Python's json.dumps writes for a fingerprint.
export type PythonJsonValue =
  | string
  | number
  | PythonJsonValue[]
  | { [key: string]: PythonJsonValue };

export interface ItemOf {
  notice: Notice;
  finding: Finding;
  question: Question;
}

// One kind of round item: its part of the tool schema, its validation and
// what a re-sent round is matched on.
export interface ItemFormat<Item> {
  // The round's field: 'notices' | 'findings' | 'questions'.
  readonly argsKey: string;
  // Singular, lower case: 'notice' | 'finding' | 'question'.
  readonly noun: string;
  // The JSON Schema of the argsKey field.
  describe(): Record<string, unknown>;
  // Throws a RoundError whose path is `at`.
  parse(raw: unknown, at: RoundItemPath): Item;
  fingerprintContent(item: Item): PythonJsonValue;
}

// What the answer-result builder reads of an item the user answers.
export interface AnswerSubject {
  title: string;
  choiceTexts: string[];
  // 1-based; 0 when no choice is recommended.
  recommend: number;
}

export interface AnswerableFormat<Item> extends ItemFormat<Item> {
  answerSubject(item: Item): AnswerSubject;
}

export type FormatTable = {
  readonly [Kind in ItemKind]: Kind extends AnswerableKind
    ? AnswerableFormat<ItemOf[Kind]>
    : ItemFormat<ItemOf[Kind]>;
};
