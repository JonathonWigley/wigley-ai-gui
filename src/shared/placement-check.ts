// The placement check the self-test runner and the keys plugin share.

// The page event that makes the keys plugin log each bind no anchor placed in a
// scope in force during the page load; the self-test runner dispatches it.
export const PLACEMENT_CHECK_EVENT = 'keys-check-placement';

// How the keys plugin's message for an unplaced bind starts.
export const UNPLACED_MESSAGE_START = 'unplaced ';

// How that message's line starts in the page log, under the `keys` source.
export const UNPLACED_PREFIX = `[keys] ${UNPLACED_MESSAGE_START}`;
