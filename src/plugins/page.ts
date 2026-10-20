import type { PagePart } from '../contracts/plugin';
import { chatPagePart } from './chat/page/start';
import { formsPagePart } from './forms/page/start';
import { keysPagePart } from './keys/page/start';
import { sessionsPagePart } from './sessions/page/start';

// Every built-in plugin's page part, in start order where no dependency says
// otherwise.
export const pageParts: readonly PagePart[] = [
  sessionsPagePart,
  formsPagePart,
  keysPagePart,
  chatPagePart,
];
