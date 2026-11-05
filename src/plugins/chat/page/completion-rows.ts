import type { Disposable } from '../../../contracts/disposable';
import { errorText } from '../../../shared/error-text';
import type { CompletionCommand, CompletionRowDraw } from '../contract';

// The draws of the `/` completion's rows. `draw` runs them newest first over
// one row and stops at the first that returns true, so a row no draw takes
// shows the name alone. A draw that throws is logged and counts as false, and
// what it put in the row before throwing stays. `dispose` removes only the draw
// `add` returned it for.
export interface CompletionRows {
  add(draw: CompletionRowDraw): Disposable;
  draw(command: CompletionCommand, row: HTMLElement): void;
}

export function createCompletionRows(
  log: (text: string) => void,
): CompletionRows {
  // Newest first. Each add is its own holder, so one function added twice is
  // two draws.
  let holders: readonly { draw: CompletionRowDraw }[] = [];
  return {
    add(draw) {
      const holder = { draw };
      holders = [holder, ...holders];
      return {
        dispose() {
          holders = holders.filter((held) => held !== holder);
        },
      };
    },
    draw(command, row) {
      for (const { draw } of holders) {
        if (tookRow(draw, command, row, log)) {
          return;
        }
      }
    },
  };
}

function tookRow(
  draw: CompletionRowDraw,
  command: CompletionCommand,
  row: HTMLElement,
  log: (text: string) => void,
): boolean {
  try {
    return draw(command, row);
  } catch (error) {
    log(`completion row draw failed for /${command.name}: ${errorText(error)}`);
    return false;
  }
}

// Chat's own draw: the command's description, through `drawPart`, while
// `isEnabled` holds and the command has one. Reads `isEnabled` on each row.
export function descriptionDraw(deps: {
  isEnabled(): boolean;
  drawPart(row: HTMLElement, description: string): void;
}): CompletionRowDraw {
  return (command, row) => {
    if (!deps.isEnabled() || command.description === '') {
      return false;
    }
    deps.drawPart(row, command.description);
    return true;
  };
}
