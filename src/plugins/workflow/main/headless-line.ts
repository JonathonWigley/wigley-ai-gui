import { HEADLESS_NOTE, HEADLESS_OFF_NOTE } from '../../chat/contract';

// One tool session's results, each with a line telling the agent the session
// is headless: `HEADLESS_NOTE` on every result while `isHeadless()` holds, and
// `HEADLESS_OFF_NOTE` on the first result after it stops holding.
export function createHeadlessLines(isHeadless: () => boolean): {
  append(text: string): string;
} {
  let wasHeadless = isHeadless();
  return {
    append(text) {
      const headless = isHeadless();
      const turnedOff = wasHeadless && !headless;
      wasHeadless = headless;
      if (headless) {
        return `${text}\n${HEADLESS_NOTE}`;
      }
      return turnedOff ? `${text}\n${HEADLESS_OFF_NOTE}` : text;
    },
  };
}
