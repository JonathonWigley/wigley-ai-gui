import type { VisualFrames } from '../../contracts/visual-frames';

export interface FakeVisualFrame {
  readonly source: string;
  readonly element: HTMLElement;
  disposed: boolean;
}

// A `VisualFrames` for plugin tests: `opened` holds each frame opened, in
// order, with its source and whether it was disposed; a frame's `dispose`
// removes its element, as the contract's does.
export function fakeVisualFrames(): {
  frames: VisualFrames;
  opened: FakeVisualFrame[];
} {
  const opened: FakeVisualFrame[] = [];
  const frames: VisualFrames = {
    open(source) {
      const element = document.createElement('div');
      element.className = 'visual-frame';
      element.dataset.visualSource = source;
      const record: FakeVisualFrame = { source, element, disposed: false };
      opened.push(record);
      return {
        element,
        dispose: () => {
          record.disposed = true;
          element.remove();
        },
      };
    },
  };
  return { frames, opened };
}
