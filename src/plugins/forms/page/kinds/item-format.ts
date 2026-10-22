import type { CommandId } from '../../../../contracts/commands';
import type { Log } from '../../../../contracts/log';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { Platform } from '../../../../contracts/platform';
import type { AnswerableKind, ItemKind, Round } from '../../contract';
import type { Layout } from '../../layouts/layout';
import type { FormsAction, RoundState, TextTarget } from '../form-state';

// One item's pane, built once; `update` shows the round's current answers.
export interface ItemCard {
  element: HTMLElement;
  update(round: RoundState): void;
}

// What a card reaches outside itself: the round's boxes, its actions, the
// Don't-ask command, which also focuses the reason box, the keys that run a
// qualified command in the forms view, null when none is bound, the platform
// key hints are drawn for, and the log.
export interface CardDeps {
  markdown: MarkdownRenderer;
  mountBox(parent: HTMLElement, target: TextTarget, text: string): void;
  destroyBox(target: TextTarget): void;
  dispatch(action: FormsAction): void;
  toggleDontAsk(): void;
  keysFor(command: CommandId): string | null;
  platform: Platform;
  log: Log;
}

type CardBuilders = Layout['cards'];

// Each kind's card input and kit, as the layout's card builder takes them.
export type CardInputs = {
  [K in keyof CardBuilders]: Parameters<CardBuilders[K]>[1];
};
export type CardKits = {
  [K in keyof CardBuilders]: Parameters<CardBuilders[K]>[2];
};

// How the page shows one kind of item. `index` is 1-based within the kind.
export interface ItemFormat<Input> {
  railPrefix: string;
  title(round: Round, index: number): string;
  // The data a layout builds the item's card from.
  cardInput(round: Round, index: number): Input;
}

export interface AnswerableFormat<Input> extends ItemFormat<Input> {
  choiceTexts(round: Round, index: number): string[];
  // 1-based.
  recommend(round: Round, index: number): number;
}

// Indexing CardInputs by ItemKind stops compiling when a kind has no card in
// the Layout contract.
export type PageFormats = {
  [K in ItemKind]: K extends AnswerableKind
    ? AnswerableFormat<CardInputs[K]>
    : ItemFormat<CardInputs[K]>;
};
