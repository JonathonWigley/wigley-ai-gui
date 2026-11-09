import type { ContextBreakdownAgentEvent } from '../../../contracts/agent';
import { formatTokens } from '../../../shared/format-tokens';
import type {
  BreakdownInput,
  ContextSourceRow,
  ContextWindowFill,
} from '../layouts/layout';

// `isOpen` says whether the user has a source open; `showsAll` whether the user asked for every source; `showPath`
// shows a full path as the view does (home as `~`).
export interface BreakdownReaders {
  isOpen(sourceId: string): boolean;
  showsAll: boolean;
  showPath(path: string): string;
}

// What a click on the breakdown changes: one source's opening, or whether every source shows.
export interface BreakdownToggles {
  toggle(sourceId: string): void;
  toggleShowsAll(): void;
}

const percentText = (share: number) => `${Math.round(share * 100)}%`;

const shareOf = (tokens: number, of: number) => (of > 0 ? tokens / of : 0);

// The section's summary: the context's size and, when the window is known, its share of it (`128k · 13%`).
export function breakdownSummary(event: ContextBreakdownAgentEvent): string {
  const total = formatTokens(event.totalTokens);
  return event.contextWindow === null
    ? total
    : `${total} · ${percentText(shareOf(event.totalTokens, event.contextWindow))}`;
}

function windowFill(
  event: ContextBreakdownAgentEvent,
): ContextWindowFill | null {
  const { contextWindow, autocompactAt, totalTokens } = event;
  if (contextWindow === null) {
    return null;
  }
  return {
    share: Math.min(1, shareOf(totalTokens, contextWindow)),
    text: `${formatTokens(totalTokens)} of ${formatTokens(contextWindow)}`,
    autocompactShare:
      autocompactAt === null
        ? null
        : Math.min(1, shareOf(autocompactAt, contextWindow)),
    autocompactText:
      autocompactAt === null
        ? null
        : `compacts at ${formatTokens(autocompactAt)}`,
  };
}

// The layout's input for a session's breakdown; each source's share is of what is in context.
export function breakdownInput(
  event: ContextBreakdownAgentEvent,
  readers: BreakdownReaders,
  toggles: BreakdownToggles,
): BreakdownInput {
  const sources: ContextSourceRow[] = event.sources.map((source, index) => {
    const share = shareOf(source.tokens, event.totalTokens);
    return {
      id: source.id,
      label: source.label,
      tokens: formatTokens(source.tokens),
      share,
      shareText: percentText(share),
      position: index + 1,
      items: source.items.map((item) => ({
        label: item.isPath ? readers.showPath(item.label) : item.label,
        tokens: formatTokens(item.tokens),
      })),
      isOpen: readers.isOpen(source.id),
    };
  });
  return {
    sources,
    window: windowFill(event),
    deferred:
      event.deferredTokens > 0 ? formatTokens(event.deferredTokens) : null,
    toggle: toggles.toggle,
    showsAll: readers.showsAll,
    toggleShowsAll: toggles.toggleShowsAll,
  };
}
