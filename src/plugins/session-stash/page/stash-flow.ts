import type { ToastTone } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { StashRequest } from '../contract';

// `ask` hands main the stash and answers whether main kept it; `drop` tells
// main to forget it; `closeSession` is sessions' close, answering whether the
// row closed.
export interface StashFlowDeps {
  ask(request: StashRequest): Promise<boolean>;
  drop(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<boolean>;
  log(message: string): void;
  toast(text: string, tone: ToastTone): void;
}

export const REFUSED_TOAST = 'Only sessions the app started can be stashed';

// Stashes the session `name` names: main keeps the note first, so the close's
// event finds it, then the session closes the normal way. A close a tab, a
// guard or main keeps (chat's end-session confirm or forms' cancel prompt
// answered no) drops the note again; a session main refuses toasts and stays
// open. Resolves once settled; a failed ask or drop is logged.
export async function stashSession(
  deps: StashFlowDeps,
  request: StashRequest,
  name: string,
): Promise<void> {
  let isKept: boolean;
  try {
    isKept = await deps.ask(request);
  } catch (error) {
    deps.log(`stash not asked: ${errorText(error)}`);
    return;
  }
  if (!isKept) {
    deps.log(`stash refused: ${name} was not started in the app`);
    deps.toast(REFUSED_TOAST, 'error');
    return;
  }
  if (await deps.closeSession(request.sessionId)) {
    return;
  }
  try {
    await deps.drop(request.sessionId);
    deps.log(`stash dropped: ${name} stayed open`);
  } catch (error) {
    deps.log(`stash drop not sent for ${name}: ${errorText(error)}`);
  }
}
