const INCLUDE_LINE = 'In file included from ';

/** Compiler output with the solution's path cut to its base name and the driver's include lines dropped. */
export function mapCompileErrors(output: string, solutionPath: string): string {
  const baseName = solutionPath.slice(
    Math.max(solutionPath.lastIndexOf('/'), solutionPath.lastIndexOf('\\')) + 1,
  );
  return output
    .split('\n')
    .filter((line) => !line.startsWith(INCLUDE_LINE))
    .map((line) => line.replaceAll(`${solutionPath}:`, `${baseName}:`))
    .join('\n');
}
