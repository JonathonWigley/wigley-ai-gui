import { pathToFileURL } from 'node:url';

// Imports the ES module at the absolute `filePath` and resolves to its
// namespace. A missing file, a syntax error or a throw at the module's top
// level rejects with Node's error. Node keeps every imported module until
// quit, so call it once per file path.
export function importModuleFrom(
  filePath: string,
): Promise<Record<string, unknown>> {
  const url = pathToFileURL(filePath).href;
  return import(/* @vite-ignore */ url);
}
