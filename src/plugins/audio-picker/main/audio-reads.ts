import type {
  AgentFormPresenter,
  AgentFormToolResult,
  AgentFormToolSession,
} from '../../../contracts/agent-forms';
import type { Files } from '../../../contracts/files';
import { errorText } from '../../../shared/error-text';
import {
  AUDIO_PICKER_ERROR_NAME,
  type AudioPickerBody,
  type AudioPickerForm,
  type AudioPosition,
  OPEN_AUDIO_PICKER_TOOL,
  type PresentedAudioPicker,
} from '../contract';

// The page's one way to read sound bytes: only a file the session's open
// picker lists, at most `maxBytes` long.
export interface AudioReads {
  // `inner` with each form it shows kept until its close.
  watch(
    inner: AgentFormPresenter<AudioPickerForm, AudioPickerBody>,
  ): AgentFormPresenter<AudioPickerForm, AudioPickerBody>;
  // `sessionId` is the app's. Null, reading nothing, when the session has no
  // open picker; rejects, reading nothing, when the picker lists no file at
  // `at`, and when the file is longer than `maxBytes`.
  readAudio(sessionId: string, at: AudioPosition): Promise<Uint8Array | null>;
}

function listedPath(
  picker: PresentedAudioPicker,
  sessionId: string,
  at: AudioPosition,
): string {
  const path =
    picker.form.moments[at.moment]?.candidates[at.candidate]?.files[at.file];
  if (path === undefined) {
    throw new Error(
      `The audio picker of session ${sessionId} lists no moment ` +
        `${at.moment + 1}, candidate ${at.candidate + 1}, file ${at.file + 1}.`,
    );
  }
  return path;
}

// `files` has no size query, so the size is checked on the bytes read.
export function createAudioReads(deps: {
  files: Pick<Files, 'readBytes'>;
  maxBytes: number;
}): AudioReads {
  const open = new Map<string, PresentedAudioPicker>();
  return {
    watch: (inner) => ({
      show(form, listener) {
        open.set(form.formId, form);
        inner.show(form, listener);
      },
      close(formId) {
        open.delete(formId);
        inner.close(formId);
      },
    }),
    async readAudio(sessionId, at) {
      const picker = [...open.values()].find(
        (each) => each.sessionId === sessionId,
      );
      if (picker === undefined) {
        return null;
      }
      const path = listedPath(picker, sessionId, at);
      const bytes = await deps.files.readBytes(path);
      if (bytes.length > deps.maxBytes) {
        throw new Error(
          `${path} is ${bytes.length} bytes; the limit is ${deps.maxBytes}.`,
        );
      }
      return bytes;
    },
  };
}

interface ListedFile {
  // `moments[m].candidates[c].files[f]`, 1-based as parse's messages.
  where: string;
  path: string;
}

function listedFiles(form: AudioPickerForm): ListedFile[] {
  return form.moments.flatMap((moment, m) =>
    moment.candidates.flatMap((candidate, c) =>
      candidate.files.map((path, f) => ({
        where: `moments[${m + 1}].candidates[${c + 1}].files[${f + 1}]`,
        path,
      })),
    ),
  );
}

// Null when a file is at `path`, else why not.
async function fileProblem(
  files: Pick<Files, 'stat'>,
  path: string,
): Promise<string | null> {
  try {
    const stat = await files.stat(path);
    return stat === null || stat.isFolder ? 'is not a file' : null;
  } catch (error) {
    return `is not a file: ${errorText(error)}`;
  }
}

// The open call's first listed file that is missing, a folder or unreadable,
// as an error text; null when every file is there, the args are malformed
// (`inner` reports those), or the call was aborted.
async function firstFileProblem(
  args: unknown,
  parse: (args: unknown) => AudioPickerForm,
  files: Pick<Files, 'stat'>,
  signal: AbortSignal,
): Promise<string | null> {
  let form: AudioPickerForm;
  try {
    form = parse(args);
  } catch (error) {
    if (error instanceof Error && error.name === AUDIO_PICKER_ERROR_NAME) {
      return null;
    }
    throw error;
  }
  for (const { where, path } of listedFiles(form)) {
    if (signal.aborted) {
      return null;
    }
    const problem = await fileProblem(files, path);
    if (problem !== null) {
      return `${where} '${path}' ${problem}.`;
    }
  }
  return null;
}

function errorResult(text: string): AgentFormToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

// `inner` with each open_audio_picker call's files checked first: a file
// missing, a folder or unreadable returns an error result naming it and opens
// nothing. Parse is synchronous and `stat` is not, so the check lives here
// rather than in the form type. Calls reach `inner` in the order they arrive,
// each after the one before it was handed over or refused, so a later call
// never overtakes an open still being checked.
export function withAudioFileCheck(
  inner: AgentFormToolSession,
  parse: (args: unknown) => AudioPickerForm,
  files: Pick<Files, 'stat'>,
): AgentFormToolSession {
  // Settles once the last call so far was handed to `inner` or refused; the
  // result rides in an object so the chain never waits on `inner`'s answer.
  let handedOver: Promise<unknown> = Promise.resolve();
  return {
    call(name, args, context) {
      const turn = handedOver.then(async () => {
        const problem =
          name === OPEN_AUDIO_PICKER_TOOL
            ? await firstFileProblem(args, parse, files, context.signal)
            : null;
        return {
          result:
            problem === null
              ? inner.call(name, args, context)
              : Promise.resolve(errorResult(problem)),
        };
      });
      handedOver = turn.catch(() => undefined);
      return turn.then((handed) => handed.result);
    },
    end: () => inner.end(),
  };
}
