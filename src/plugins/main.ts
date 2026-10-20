import type { MainPart } from '../contracts/plugin';
import { chatMainPart } from './chat/main/start';
import { formsMainPart } from './forms/main/start';
import { sessionsMainPart } from './sessions/main/start';

// Every built-in plugin's main part, in start order where no dependency says
// otherwise.
export const mainParts: readonly MainPart[] = [
  sessionsMainPart,
  formsMainPart,
  chatMainPart,
];
