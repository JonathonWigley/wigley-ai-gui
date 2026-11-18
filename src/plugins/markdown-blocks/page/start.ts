import '../../../shared/page/markdown.css';
import './markdown-blocks.css';
import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { markdownBlocksManifest } from '../manifest';
import { changesBlock, treeBlock } from './change-blocks';
import { detailsBlock } from './details-block';

type MarkdownBlocksApi = PageApi<typeof markdownBlocksManifest, ChannelShape>;

// Adds the `:::changes`, `:::tree` and `:::details` blocks to the markdown
// service while it runs; its view of the service removes them at the stop.
export const markdownBlocksPagePart: PagePart<typeof markdownBlocksManifest> = {
  manifest: markdownBlocksManifest,
  start(api: MarkdownBlocksApi) {
    const { markdown } = api.services;
    markdown.addBlock(changesBlock);
    markdown.addBlock(treeBlock);
    markdown.addBlock(detailsBlock);
    return { commands: {} };
  },
};
