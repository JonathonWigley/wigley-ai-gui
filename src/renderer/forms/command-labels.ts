import type { CommandId } from '../../contracts/commands';

const CHOICE_LABEL = 'pick a choice (again clears)';

// What the status line and the help overlay call each command.
const COMMAND_LABELS: Partial<Record<CommandId, string>> = {
  'forms.nextItem': 'next item',
  'forms.prevItem': 'previous item',
  ...Object.fromEntries(
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => [
      `forms.choose${digit}`,
      CHOICE_LABEL,
    ]),
  ),
  'forms.clearChoice': 'clear the choice',
  'forms.toggleNotApplicable': 'not applicable',
  'forms.toggleDontAsk': "don't ask me this",
  'forms.editWhat': 'answer box',
  'forms.editWhy': 'why box',
  'forms.editNote': 'round note',
  'forms.nextBox': 'next box',
  'forms.prevBox': 'previous box',
  'forms.leaveBox': 'leave the box',
  'forms.nextRound': 'next round',
  'forms.prevRound': 'previous round',
  'forms.openReview': 'review',
  'forms.closeReview': 'back to the form',
  'forms.reviewNext': 'next row',
  'forms.reviewPrev': 'previous row',
  'forms.reviewJump': 'go to the question',
  'forms.submit': 'submit',
  'forms.askCancel': 'cancel the round',
  'forms.confirmCancel': 'yes, cancel the round',
  'forms.dismissConfirm': 'keep the round',
  'forms.toggleFold': 'fold the context',
  'forms.unfoldAll': 'unfold all',
  'forms.foldAll': 'fold all',
  'help.toggle': 'help',
  'help.close': 'close help',
  'window.summon': 'show the app',
};

// A command with no label shows its id.
export function commandLabel(command: CommandId): string {
  return COMMAND_LABELS[command] ?? command;
}
