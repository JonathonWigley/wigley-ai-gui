// The agent plugin the app's sample data is named under: the sample workflows
// (`src/plugins/workflow/declared/fixtures/sample-auri.json`), the fake
// harness's workflow turns and subagents, the sample self-tests and the
// previews. The one place its name is written, so every sample agrees on it.
export const SAMPLE_PLUGIN_NAME = 'wigley';

// `name` qualified under the sample plugin, as a skill or an agent type:
// `<SAMPLE_PLUGIN_NAME>:<name>`.
export function sampleQualified(name: string): string {
  return `${SAMPLE_PLUGIN_NAME}:${name}`;
}
