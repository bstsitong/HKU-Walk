export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type CropPosition = Point & { zoom: number };

export const MAX_CROP_ZOOM = 6;
export const centeredCrop: CropPosition = { x: 0, y: 0, zoom: 1 };
export const routeOverviewAspect = 16 / 9;
export const routeStepAspect = 88 / 80;
export const placePhotoAspect = 16 / 9;

export function cropScale(image: Size, frame: Size, zoom: number) {
  return Math.max(frame.width / image.width, frame.height / image.height) * zoom;
}

export function moveCrop(position: CropPosition, image: Size, frame: Size, zoom: number, from: Point, to: Point): CropPosition {
  zoom = Math.min(MAX_CROP_ZOOM, Math.max(1, zoom));
  const scale = cropScale(image, frame, zoom);
  const factor = zoom / position.zoom;
  const xLimit = Math.max(0, (image.width * scale - frame.width) / 2);
  const yLimit = Math.max(0, (image.height * scale - frame.height) / 2);
  const x = to.x - (from.x - position.x) * factor;
  const y = to.y - (from.y - position.y) * factor;
  return { zoom, x: Math.min(xLimit, Math.max(-xLimit, x)), y: Math.min(yLimit, Math.max(-yLimit, y)) };
}

export function cropPixels(position: CropPosition, image: Size, frame: Size) {
  const scale = cropScale(image, frame, position.zoom);
  const width = Math.min(image.width, Math.max(1, Math.round(frame.width / scale)));
  const height = Math.min(image.height, Math.max(1, Math.round(frame.height / scale)));
  return {
    width, height,
    originX: Math.min(image.width - width, Math.max(0, Math.round((image.width - width) / 2 - position.x / scale))),
    originY: Math.min(image.height - height, Math.max(0, Math.round((image.height - height) / 2 - position.y / scale))),
  };
}
