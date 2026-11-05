import type { EventShape } from '../../contracts/plugin';

// `helpOpened`: the help overlay opened; closing it fires nothing.
export interface KeysPageEvents extends EventShape {
  helpOpened: null;
}
