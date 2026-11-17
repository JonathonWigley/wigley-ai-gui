// What the answer-result builder reads of an item the user answers.
export interface AnswerSubject {
  title: string;
  choiceTexts: string[];
  // 1-based; 0 when no choice is recommended.
  recommend: number;
}
