import type { MainPart } from '../contracts/plugin';
import { backlogMainPart } from './backlog/main/start';
import { chatMainPart } from './chat/main/start';
import { docsMainPart } from './docs/main/start';
import { formsMainPart } from './forms/main/start';
import { primerMainPart } from './primer/main/start';
import { sessionsMainPart } from './sessions/main/start';
import { settingsMainPart } from './settings/main/start';

// Every built-in plugin's main part, in start order where no dependency says
// otherwise.
export const mainParts: readonly MainPart[] = [
  sessionsMainPart,
  formsMainPart,
  primerMainPart,
  chatMainPart,
  docsMainPart,
  settingsMainPart,
  backlogMainPart,
];
