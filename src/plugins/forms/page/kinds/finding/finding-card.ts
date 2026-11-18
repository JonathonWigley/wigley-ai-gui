import {
  FINDING_ACTIONS,
  type Finding,
  type FindingAction,
  type FindingAnswerEntry,
  type PageKind,
} from '../../../contract';
import {
  findingEntries,
  findingEntryNumber,
  findingPickIsComplete,
  findingSolution,
  isFindingAction,
} from '../../../finding-pick';
import { BUILT_IN_KIND_SPECS } from '../../../item-kinds';
import type { FindingAnswer } from '../../round-model';
import { labelFor, roundInfo } from '../card-parts';
import {
  ANSWER_BOXES,
  answerEntry,
  answerText,
  entryAt,
  restoreAnswer,
  UNTOUCHED_ANSWER,
  withAnswerText,
} from '../item-answer';
import type { CardInputs } from '../item-format';
import {
  chooseEntry,
  clearFindingPick,
  type FindingPick,
  holdsPick,
  NO_PICK,
} from './finding-answer';
import { drawnOriginSpec, verdictOf } from './verdict';

const RAIL_PREFIX = 'F';

const UNTOUCHED_FINDING: FindingAnswer = { ...UNTOUCHED_ANSWER, ...NO_PICK };

// A finding with no draft entry starts with no pick. A draft's pick restores
// only when it is one of the finding's entries; any other restores as no
// pick, keeping the entry's notes, Not applicable and Don't ask.
function restoreFindingAnswer(
  entry: FindingAnswerEntry | undefined,
  finding: Finding,
): FindingAnswer {
  if (entry === undefined) {
    return UNTOUCHED_FINDING;
  }
  const answer = restoreAnswer(entry, finding.choices.length);
  const action = isFindingAction(entry.action) ? entry.action : '';
  const isEntry = findingEntryNumber(finding, entry.choice, action) > 0;
  return isEntry
    ? { ...answer, choice: entry.choice, action }
    : { ...answer, choice: 0, action: '' };
}

// The saved entry the page writes; main adds the action labels when it reads
// the body.
type PageFindingEntry = Omit<
  FindingAnswerEntry,
  'action_label' | 'recommend_action_label'
>;

// `i` is the answer's 0-based position.
function findingAnswerEntry(
  answer: FindingAnswer,
  i: number,
): PageFindingEntry {
  return { ...answerEntry(answer, i), action: answer.action };
}

// A finding's pick is one of its numbered entries (`findingEntries`), choice
// and action together; its recommended pick is its recommend_action with its
// recommend, or that action's header when recommend is null.
export const findingPageKind: PageKind<
  Finding,
  FindingAnswer,
  CardInputs['finding']
> = {
  spec: BUILT_IN_KIND_SPECS.finding,
  restore: {
    decode: (findings, entries) =>
      findings.map((finding, i) =>
        restoreFindingAnswer(
          entryAt<FindingAnswerEntry>(entries, i + 1),
          finding,
        ),
      ),
    encode: (answers) => answers.map(findingAnswerEntry),
  },
  reduce: {
    untouched: () => UNTOUCHED_FINDING,
    text: answerText,
    withText: withAnswerText,
    pick: {
      choose: (finding, answer, number) => chooseEntry(answer, finding, number),
      clear: (_finding, answer) => clearFindingPick(answer),
      recommended(finding, answer) {
        const recommended: FindingPick = {
          choice: finding.recommend ?? 0,
          action: finding.recommend_action,
        };
        return holdsPick(answer, recommended)
          ? answer
          : { ...answer, ...recommended };
      },
      isComplete: (finding, answer) =>
        findingPickIsComplete(finding, answer.choice, answer.action),
      number: (finding, answer) =>
        findingEntryNumber(finding, answer.choice, answer.action),
      choice: (finding, answer) =>
        findingSolution(finding, answer.choice, answer.action),
      choiceText: (finding, choice) => finding.choices[choice - 1].text,
      recommend: (finding) => finding.recommend ?? 0,
      isRecommended: (finding, answer) =>
        answer.action === finding.recommend_action &&
        findingSolution(finding, answer.choice, answer.action) ===
          (finding.recommend ?? 0),
    },
  },
  boxes: ANSWER_BOXES,
  cardInput: {
    railPrefix: RAIL_PREFIX,
    title: (finding) => finding.title,
    layout: (finding) => finding.layout,
    input(finding, index, round) {
      const spec = drawnOriginSpec(finding.origin);
      const verdict = verdictOf(finding);
      return {
        label: labelFor(RAIL_PREFIX, index),
        title: finding.title,
        card: verdict.card,
        origin: finding.origin,
        originToken: verdict.originToken,
        severity: finding.severity,
        words: { ...spec.words },
        originChip: verdict.origin,
        severityChip: verdict.severity,
        impact: verdict.impact,
        finding: finding.finding,
        proof: finding.proof,
        choices: finding.choices.map(({ text, reason, action }) => ({
          text,
          reason,
          action,
        })),
        entries: findingEntries(finding).map((entry, i) => ({
          number: i + 1,
          ...entry,
        })),
        recommend: finding.recommend,
        recommendAction: finding.recommend_action,
        actionReasons: { ...finding.actionReasons },
        actions: FINDING_ACTIONS.flatMap((action: FindingAction) => {
          const label = spec.actions[action];
          return label === undefined ? [] : [{ action, label }];
        }),
        round: roundInfo(round),
      };
    },
  },
  railOrder: 10,
};
