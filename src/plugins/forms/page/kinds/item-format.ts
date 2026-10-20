import type { CommandId } from '../../../../contracts/commands';
import type { MarkdownRenderer } from '../../../../contracts/markdown';
import type { AnswerableKind, ItemKind, Round } from '../../contract';
import type { FormsAction, RoundState, TextTarget } from '../form-state';

// One item's pane, built once; `update` shows the round's current answers.
export interface ItemCard {
  element: HTMLElement;
  update(round: RoundState): void;
}

// What a card reaches outside itself: the round's boxes, its actions, the
// Don't-ask command, which also focuses the reason box, and the keys that run
// a qualified command in the forms view, null when none is bound.
export interface CardDeps {
  markdown: MarkdownRenderer;
  mountBox(parent: HTMLElement, target: TextTarget, text: string): void;
  dispatch(action: FormsAction): void;
  toggleDontAsk(): void;
  keysFor(command: CommandId): string | null;
}

// How the page shows one kind of item. `index` is 1-based within the kind;
// `position` is the item's place in railItems(round).
export interface ItemFormat {
  railPrefix: string;
  title(round: Round, index: number): string;
  buildCard(
    parent: HTMLElement,
    round: RoundState,
    index: number,
    position: number,
    deps: CardDeps,
  ): ItemCard;
}

export interface AnswerableFormat extends ItemFormat {
  choiceTexts(round: Round, index: number): string[];
  // 1-based.
  recommend(round: Round, index: number): number;
}

export type PageFormats = {
  [K in ItemKind]: K extends AnswerableKind ? AnswerableFormat : ItemFormat;
};
