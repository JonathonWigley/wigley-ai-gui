import {
  Canvas,
  FabricImage,
  type FabricObject,
  IText,
  Path,
  PencilBrush,
  Point,
  Rect,
} from 'fabric';
import type { Disposable } from '../../contracts/disposable';
import type {
  MarkupEditor,
  MarkupSession,
  MarkupTool,
} from '../../contracts/markup';
import { dataUrlBytes, pngDataUrl } from '../../shared/png-data-url';
import { fitScale } from './fit-scale';
import { fullSizeExport } from './full-size-export';
import { createMarkupHistory } from './markup-history';

// Sizes in screen pixels at open; marks store them in image pixels.
const STROKE_WIDTH = 3;
const FONT_SIZE = 20;
const ARROW_HEAD_LENGTH_PER_STROKE = 4;
const ARROW_HEAD_HALF_ANGLE = Math.PI / 6;
// A drag shorter than this in both axes adds no arrow or box.
const MIN_DRAG = 4;

// Every mark the adapter creates is placed by its top-left corner; Fabric 7
// defaults origins to the centre.
const CORNER_ORIGIN = { originX: 'left', originY: 'top' } as const;

type DrawTool = 'arrow' | 'box';

interface Drag {
  tool: DrawTool;
  start: Point;
  preview: FabricObject | null;
}

// The scene-space sizes of marks drawn at scale `s`.
interface MarkSizes {
  strokeWidth: number;
  fontSize: number;
  fontFamily: string;
  // Below this, a drag's length in image pixels adds nothing.
  minDrag: number;
}

export function createFabricMarkupEditor(): MarkupEditor {
  return {
    async open(host, image, saved) {
      const background = await loadImage(image);
      const scale = fitScale(
        { width: background.width, height: background.height },
        { width: host.clientWidth, height: host.clientHeight },
      );
      const element = document.createElement('canvas');
      host.append(element);
      const canvas = new Canvas(element);
      canvas.setDimensions({
        width: Math.round(background.width * scale),
        height: Math.round(background.height * scale),
      });
      canvas.setViewportTransform([scale, 0, 0, scale, 0, 0]);
      if (saved !== null) {
        try {
          await canvas.loadFromJSON(saved);
        } catch (error) {
          void canvas.dispose();
          element.remove();
          throw error;
        }
      }
      setBackground(canvas, background);
      const hostStyle = getComputedStyle(host);
      return startSession(canvas, element, background, hostStyle.color, {
        strokeWidth: STROKE_WIDTH / scale,
        fontSize: FONT_SIZE / scale,
        fontFamily: hostStyle.fontFamily,
        minDrag: MIN_DRAG / scale,
      });
    },
  };
}

async function loadImage(image: Uint8Array): Promise<FabricImage> {
  try {
    return await FabricImage.fromURL(
      pngDataUrl(image),
      {},
      { left: 0, top: 0, ...CORNER_ORIGIN },
    );
  } catch {
    throw new Error('Markup image did not load');
  }
}

// A JSON load replaces the background, so each load sets it again.
function setBackground(canvas: Canvas, background: FabricImage) {
  canvas.backgroundImage = background;
  canvas.renderAll();
}

function markupJson(canvas: Canvas): string {
  const json = canvas.toJSON();
  delete json.backgroundImage;
  return JSON.stringify(json);
}

function startSession(
  canvas: Canvas,
  element: HTMLCanvasElement,
  background: FabricImage,
  initialColour: string,
  sizes: MarkSizes,
): MarkupSession {
  const history = createMarkupHistory(markupJson(canvas));
  const listeners = new Set<() => void>();
  const brush = new PencilBrush(canvas);
  brush.width = sizes.strokeWidth;
  brush.color = initialColour;
  canvas.freeDrawingBrush = brush;
  let tool: MarkupTool = 'select';
  let colour = initialColour;
  let drag: Drag | null = null;
  let pendingText: IText | null = null;
  let loads: Promise<void> = Promise.resolve();
  let runningLoads = 0;
  let isDisposed = false;

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  const record = () => {
    if (runningLoads > 0 || isDisposed) {
      return;
    }
    history.push(markupJson(canvas));
    notify();
  };
  const load = (snapshot: string | null) => {
    if (snapshot === null) {
      return;
    }
    runningLoads += 1;
    loads = loads
      .then(async () => {
        await canvas.loadFromJSON(snapshot);
        setBackground(canvas, background);
        notify();
      })
      .finally(() => {
        runningLoads -= 1;
      });
  };
  // Exiting fires `text:editing:exited`, which records the text or removes a
  // blank one.
  const finishEdit = () => {
    const active = canvas.getActiveObject();
    if (active instanceof IText && active.isEditing) {
      active.exitEditing();
    }
  };
  const applyTool = () => {
    const isSelect = tool === 'select';
    canvas.isDrawingMode = tool === 'pen';
    canvas.selection = isSelect;
    canvas.skipTargetFind = !isSelect;
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  };
  const finishDrag = (finished: Drag, end: Point) => {
    drag = null;
    if (finished.preview !== null) {
      canvas.remove(finished.preview);
    }
    const isTooShort =
      Math.abs(end.x - finished.start.x) < sizes.minDrag &&
      Math.abs(end.y - finished.start.y) < sizes.minDrag;
    if (isTooShort) {
      canvas.requestRenderAll();
      return;
    }
    canvas.add(markFor(finished.tool, finished.start, end, colour, sizes));
    record();
  };

  canvas.on('path:created', record);
  canvas.on('object:modified', record);
  canvas.on('text:editing:entered', ({ target }) => {
    // Editing has just made the text's hidden textarea.
    keepTextKeysFromPage(target.hiddenTextarea as HTMLTextAreaElement);
  });
  canvas.on('text:editing:exited', ({ target }) => {
    if (target.text.trim() === '') {
      canvas.remove(target);
      canvas.requestRenderAll();
      return;
    }
    record();
  });
  canvas.on('mouse:down', ({ scenePoint }) => {
    if (tool === 'text') {
      pendingText = new IText('', {
        left: scenePoint.x,
        top: scenePoint.y,
        ...CORNER_ORIGIN,
        fill: colour,
        fontSize: sizes.fontSize,
        fontFamily: sizes.fontFamily,
      });
      canvas.add(pendingText);
      canvas.setActiveObject(pendingText);
    } else if (tool === 'arrow' || tool === 'box') {
      drag = { tool, start: scenePoint, preview: null };
    }
  });
  canvas.on('mouse:move', ({ scenePoint }) => {
    if (drag === null) {
      return;
    }
    if (drag.preview !== null) {
      canvas.remove(drag.preview);
    }
    drag.preview = markFor(drag.tool, drag.start, scenePoint, colour, sizes);
    canvas.add(drag.preview);
  });
  canvas.on('mouse:up', ({ scenePoint }) => {
    // Editing starts on release: the press's own focus change would blur
    // Fabric's text box.
    if (pendingText !== null) {
      pendingText.enterEditing();
      pendingText = null;
    }
    if (drag !== null) {
      finishDrag(drag, scenePoint);
    }
  });

  return {
    setTool(next) {
      tool = next;
      applyTool();
    },
    setColour(next) {
      colour = next;
      brush.color = next;
      const selected = tool === 'select' ? canvas.getActiveObjects() : [];
      if (selected.length === 0) {
        return;
      }
      for (const mark of selected) {
        recolour(mark, next);
      }
      canvas.requestRenderAll();
      record();
    },
    undo: () => load(history.undo()),
    redo: () => load(history.redo()),
    finishEdit,
    toJson() {
      finishEdit();
      return markupJson(canvas);
    },
    toPng() {
      finishEdit();
      const { multiplier, ...area } = fullSizeExport(
        background,
        canvas.getZoom(),
      );
      const url = canvas.toDataURL({ format: 'png', multiplier, ...area });
      return Promise.resolve(dataUrlBytes(url));
    },
    onChange(listener): Disposable {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    dispose() {
      isDisposed = true;
      listeners.clear();
      // Disposed, the session records nothing: an unfinished edit is dropped.
      finishEdit();
      void canvas.dispose();
      // Fabric's dispose puts the canvas element back in its wrapper's place.
      element.remove();
    },
  };
}

// Typed keys stay in the text being edited instead of reaching the page's
// keys; chords still reach them. Fabric's own listener ends the edit on Escape
// and stops it there, so only a second Escape reaches the page.
function keepTextKeysFromPage(textarea: HTMLTextAreaElement) {
  textarea.addEventListener(
    'keydown',
    (event) => {
      const isChord = event.ctrlKey || event.altKey || event.metaKey;
      if (!isChord) {
        event.stopPropagation();
      }
    },
    // At its target, a capture listener runs before Fabric's own listener.
    { capture: true },
  );
}

function recolour(mark: FabricObject, colour: string) {
  if (mark instanceof IText) {
    mark.set('fill', colour);
  } else if (mark instanceof Path || mark instanceof Rect) {
    mark.set('stroke', colour);
  }
}

function markFor(
  tool: DrawTool,
  start: Point,
  end: Point,
  colour: string,
  sizes: MarkSizes,
): FabricObject {
  return tool === 'arrow'
    ? arrowPath(start, end, colour, sizes.strokeWidth)
    : boxRect(start, end, colour, sizes.strokeWidth);
}

// The shaft, then the two head strokes ending at its tip.
function arrowPath(
  start: Point,
  end: Point,
  colour: string,
  strokeWidth: number,
): Path {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = ARROW_HEAD_LENGTH_PER_STROKE * strokeWidth;
  const head = (side: number) =>
    new Point(
      end.x - headLength * Math.cos(angle + side * ARROW_HEAD_HALF_ANGLE),
      end.y - headLength * Math.sin(angle + side * ARROW_HEAD_HALF_ANGLE),
    );
  const left = head(-1);
  const right = head(1);
  const data =
    `M ${start.x} ${start.y} L ${end.x} ${end.y} ` +
    `M ${left.x} ${left.y} L ${end.x} ${end.y} L ${right.x} ${right.y}`;
  return new Path(data, {
    ...CORNER_ORIGIN,
    stroke: colour,
    strokeWidth,
    fill: '',
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  });
}

function boxRect(
  start: Point,
  end: Point,
  colour: string,
  strokeWidth: number,
): Rect {
  return new Rect({
    ...CORNER_ORIGIN,
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    fill: 'transparent',
    stroke: colour,
    strokeWidth,
  });
}
