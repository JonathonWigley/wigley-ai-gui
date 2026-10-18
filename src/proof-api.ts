export const LOG_CHANNEL = 'proof:log';
export const PROMPT_CHANNEL = 'proof:prompt';

export type LogSource = 'menu' | 'input' | 'global' | 'vim' | 'page' | 'acp';

export interface ProofApi {
  onLog(listener: (source: LogSource, message: string) => void): void;
  promptAgent(text: string): Promise<string>;
}
