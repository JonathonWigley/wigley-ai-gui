// The host-side seam over a pseudo-terminal library: one shell's pty, spawned by `PtySpawn`.

export interface PtyOptions {
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}
export interface PtyExit {
  exitCode: number;
  signal: number | null;
}
export interface Pty {
  readonly pid: number;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (exit: PtyExit) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
export type PtySpawn = (
  file: string,
  args: readonly string[],
  options: PtyOptions,
) => Pty;
