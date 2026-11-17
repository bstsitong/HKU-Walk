import { MAP_HEIGHT, MAP_WIDTH, MAP_Y_MAX } from './MapArtwork';
import type { Category, Place } from './campus';
import type { MapPoint } from './campusLocation';
import { placeDisplayLevel, visibleMapLevel } from './mapDisplay';

export const MIN_MAP_ZOOM = 1;
export const MAX_MAP_ZOOM = 4;
export type MapViewport = { width: number; height: number; fullHeight?: boolean };
export type MapCamera = MapPoint & { zoom: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function toMapView(point: MapPoint): MapPoint {
  return { x: MAP_WIDTH - point.x, y: MAP_HEIGHT * (1 - point.y / MAP_Y_MAX) };
}

export function fromMapView(point: MapPoint): MapPoint {
  return {
    x: Math.round(clamp(MAP_WIDTH - point.x, 0, MAP_WIDTH)),
    y: Math.round(clamp((1 - point.y / MAP_HEIGHT) * MAP_Y_MAX, 0, MAP_Y_MAX)),
  };
}

export function fromMapScreen(point: MapPoint, camera: MapCamera, viewport: MapViewport): MapPoint {
  const scale = viewport.width * camera.zoom / MAP_WIDTH;
  return fromMapView({ x: (point.x - camera.x) / scale, y: (point.y - camera.y) / scale });
}

export function mapBand(viewport: MapViewport) {
  if (viewport.fullHeight) return { top: 0, height: viewport.height };
  const top = Math.min(146, viewport.height * 0.36);
  const bottom = viewport.height - Math.min(159, viewport.height * 0.38);
  return { top, height: bottom - top };
}

export function mapScreenCentre(viewport: MapViewport): MapPoint {
  const band = mapBand(viewport);
  return { x: viewport.width / 2, y: band.top + band.height / 2 };
}

export function boundMapCamera(camera: MapCamera, viewport: MapViewport): MapCamera {
  const zoom = clamp(camera.zoom, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
  const width = viewport.width * zoom;
  const height = width * MAP_HEIGHT / MAP_WIDTH;
  const band = mapBand(viewport);
  return {
    zoom,
    x: clamp(camera.x, viewport.width - width, 0),
    y: height < band.height ? band.top + (band.height - height) / 2 : clamp(camera.y, band.top + band.height - height, band.top),
  };
}

export function centreMapOn(point: MapPoint, zoom: number, viewport: MapViewport): MapCamera {
  const focus = toMapView(point);
  const centre = mapScreenCentre(viewport);
  const scale = viewport.width * zoom / MAP_WIDTH;
  return boundMapCamera({ zoom, x: centre.x - focus.x * scale, y: centre.y - focus.y * scale }, viewport);
}

export function moveMapCamera(camera: MapCamera, zoom: number, from: MapPoint, to: MapPoint, viewport: MapViewport): MapCamera {
  const nextZoom = clamp(zoom, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
  const ratio = nextZoom / camera.zoom;
  return boundMapCamera({ zoom: nextZoom, x: to.x - (from.x - camera.x) * ratio, y: to.y - (from.y - camera.y) * ratio }, viewport);
}

export function mapCandidates(places: Place[], selectedId: string, category: Category, zoom: number): Place[] {
  const maxLevel = visibleMapLevel(zoom);
  return places.filter(place => !place.mapPositionPending && !place.parentBuildingId &&
    (category !== 'all' || placeDisplayLevel(place) <= maxLevel))
    .sort((a, b) => placeDisplayLevel(a) - placeDisplayLevel(b) ||
      Number(b.id === selectedId) - Number(a.id === selectedId));
}
