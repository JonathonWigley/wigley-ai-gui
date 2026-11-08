import type {
  AnswerableKind,
  Finding,
  ItemKind,
  Notice,
  Question,
} from '../../contract';

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

// One kind of ask_round item: its part of the tool schema, its validation and
// what a re-sent round is matched on.
export interface ItemFormat<Item> {
  // The ask_round field: 'notices' | 'findings' | 'questions'.
  readonly argsKey: string;
  // Singular, lower case: 'notice' | 'finding' | 'question'.
  readonly noun: string;
  // The JSON Schema of the argsKey field.
  readonly arraySchema: Record<string, unknown>;
  // Throws a RoundError whose message starts with `where`.
  parse(raw: unknown, where: string): Item;
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
