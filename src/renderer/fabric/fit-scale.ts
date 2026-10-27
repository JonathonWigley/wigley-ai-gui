// The scale that fits `image` inside `host`, never above 1.
export function fitScale(
  image: { width: number; height: number },
  host: { width: number; height: number },
): number {
  if (host.width === 0 || host.height === 0) {
    throw new Error('Markup host has no size');
  }
  return Math.min(host.width / image.width, host.height / image.height, 1);
}
