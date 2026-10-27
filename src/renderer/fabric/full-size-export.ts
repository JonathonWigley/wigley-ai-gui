// The `toCanvasElement` arguments that render a scene shown at `zoom` back at
// `image`'s own pixel size. Fabric sizes the output canvas `width × multiplier`
// by `height × multiplier`, and a canvas truncates a fractional size, so each
// side carries half a pixel the truncation drops.
export function fullSizeExport(
  image: { width: number; height: number },
  zoom: number,
): { multiplier: number; width: number; height: number } {
  return {
    multiplier: 1 / zoom,
    width: (image.width + 0.5) * zoom,
    height: (image.height + 0.5) * zoom,
  };
}
