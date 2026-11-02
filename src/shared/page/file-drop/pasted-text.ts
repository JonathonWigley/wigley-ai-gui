// What a paste or a drop carries: its files, and whether its text is real
// text to paste rather than a stand-in for those files.

export function holdsPastedText(
  transfer: DataTransfer | null,
  files: File[],
): boolean {
  return transfer !== null && isRealText(transfer.getData('text/plain'), files);
}

// Plain text beside pasted files stands for them, and is no text to paste,
// when it is blank, the name of one of the files, or a single URL.
function isRealText(text: string, files: File[]): boolean {
  const trimmed = text.trim();
  const isBlank = trimmed === '';
  const isFileName = files.some((file) => file.name === trimmed);
  const isSingleUrl = /^(https?:\/\/|file:\/\/|data:)\S*$/.test(trimmed);
  return !isBlank && !isFileName && !isSingleUrl;
}

export function filesOf(transfer: DataTransfer | null): File[] {
  return transfer === null ? [] : [...transfer.files];
}
