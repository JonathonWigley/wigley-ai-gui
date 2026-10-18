export type StopReason = string;

// An agent the app converses with, whatever protocol or process sits behind it.
export interface AgentClient {
  // Runs one turn: reports each text chunk the agent streams, and resolves on
  // the turn's stop reason.
  prompt(text: string, onChunk: (chunk: string) => void): Promise<StopReason>;
}
