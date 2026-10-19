import type { PagePart } from '../contracts/plugin';
import { formsPagePart } from './forms/page/start';

// Every built-in plugin's page part, in start order where no dependency says
// otherwise.
export const pageParts: readonly PagePart[] = [formsPagePart];
