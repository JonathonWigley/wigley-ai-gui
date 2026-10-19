import type { MainPart } from '../contracts/plugin';
import { formsMainPart } from './forms/main/start';

// Every built-in plugin's main part, in start order where no dependency says
// otherwise.
export const mainParts: readonly MainPart[] = [formsMainPart];
