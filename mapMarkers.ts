import { campusBuildingOutlines, MAP_HEIGHT, MAP_WIDTH, MAP_Y_MAX } from './MapArtwork';
import { getPlace, type Place } from './campus';
import type { CampusFacility } from './campusFacilities';
import { mapPinSizes, placeDisplayLevel } from './mapDisplay';
import type { MapPoint } from './campusLocation';

type Outline = {
  rings: MapPoint[][];
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const outlines: Outline[] = campusBuildingOutlines.map(path => {
  // The campus building artwork uses closed rings of absolute M/line coordinates.
  const rings = path.split('M').filter(Boolean).map(ring => Array.from(
    ring.matchAll(/(-?[\d.]+),(-?[\d.]+)/g),
    ([, x, y]) => ({ x: Number(x), y: Number(y) }),
  ));
  const points = rings.flat();
  return {
    rings,
    left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)),
  };
}).sort((a, b) => (a.right - a.left) * (a.bottom - a.top) - (b.right - b.left) * (b.bottom - b.top));

function contains({ x, y }: MapPoint, outline: Outline) {
  if (x < outline.left || x > outline.right || y < outline.top || y > outline.bottom) return false;
  let inside = false;
  for (const ring of outline.rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a.y > y) !== (b.y > y) && x < a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)) inside = !inside;
    }
  }
  return inside;
}

export function buildingAt(point: MapPoint) {
  return outlines.find(outline => contains(point, outline));
}

type MapMarkerInput<T> = {
  item: T;
  anchor: MapPoint;
  diameter: number;
  building?: Outline;
  square?: boolean;
};
export type MapItem = { place: Place } | { facility: CampusFacility };

const artworkPoint = (point: MapPoint): MapPoint => ({ x: point.x, y: point.y / MAP_Y_MAX * MAP_HEIGHT });
const openSpaceIds = new Set(['sun-yat-sen-place', 'central-podium', 'university-street', 'centennial-red-wall']);

// These records describe an indoor place but put its stored point next to the building.
const hostBuildings: Partial<Record<string, string>> = {
  'water-chiwah': 'chiwah',
  'water-lsk': 'lee-shau-kee',
  'union-restaurant': 'haking-wong',
};

export function placeMarkerInput(place: Place): MapMarkerInput<MapItem> {
  const hostId = hostBuildings[place.id];
  const host = hostId ? getPlace(hostId) ?? place : place;
  const building = place.category === 'access' || openSpaceIds.has(place.id) ? undefined : buildingAt(artworkPoint(host));
  return { item: { place }, anchor: artworkPoint(place), building, diameter: mapPinSizes[placeDisplayLevel(place)].diameter };
}

export function facilityMarkerInput(facility: CampusFacility): MapMarkerInput<MapItem> {
  const [x, y] = facility.at;
  const anchor = { x, y };
  const building = facility.kind === 'gate' ? undefined : buildingAt(anchor);
  return { item: { facility }, anchor, building, diameter: mapPinSizes[facility.displayLevel].diameter, square: true };
}

type PlacedMarker<T> = { item: T; point: MapPoint; radius: number; factor: number };

const insideMap = ({ x, y }: MapPoint) => x >= 0 && x <= MAP_WIDTH && y >= 0 && y <= MAP_HEIGHT;
const distanceSquared = (a: MapPoint, b: MapPoint) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const minimumPinFactor = 0.4;
const pinFactors = [0.6, 0.5, minimumPinFactor] as const;

export function layoutMapMarkers<T>(markers: readonly MapMarkerInput<T>[], screenScale: number) {
  const grids = new Map<Outline, MapPoint[]>();
  const buildingGrid = (building: Outline) => {
    const existing = grids.get(building);
    if (existing) return existing;
    const points: MapPoint[] = [];
    const step = Math.max(0.24, 1.6 / screenScale);
    for (let y = Math.max(0, building.top) + step / 2; y < Math.min(MAP_HEIGHT, building.bottom); y += step) {
      for (let x = Math.max(0, building.left) + step / 2; x < Math.min(MAP_WIDTH, building.right); x += step) {
        const point = { x, y };
        if (contains(point, building)) points.push(point);
      }
    }
    grids.set(building, points);
    return points;
  };

  // Keep the usual screen size and compact only individual pins in crowded areas.
  const pins: PlacedMarker<T>[] = [];
  for (const { item, anchor, building, diameter, square } of [...markers].sort((a, b) => b.diameter - a.diameter)) {
    const anchorAllowed = !building || contains(anchor, building);
    let nearby: MapPoint[] | undefined;
    let rings: { point: MapPoint; section?: Outline }[] | undefined;
    const originalSection = building ?? buildingAt(anchor);
    const ringSlots = () => {
      if (rings) return rings;
      rings = [];
      for (const distance of [4, 8, 12, 16, 20, 24, 28, 32, 36]) {
        const offset = distance / screenScale;
        for (let i = 0; i < 12; i++) {
          const angle = i * Math.PI / 6;
          const point = { x: anchor.x + offset * Math.cos(angle), y: anchor.y + offset * Math.sin(angle) };
          if (!insideMap(point)) continue;
          const section = buildingAt(point);
          if (!section || section === originalSection) rings.push({ point, section });
        }
      }
      return rings;
    };
    const placement = (factor: number, allowOpenSpace = false): PlacedMarker<T> | undefined => {
      const radius = (square ? Math.SQRT2 : 1) * diameter * factor / (2 * screenScale);
      const spaced = (point: MapPoint) => insideMap(point) &&
        pins.every(pin => distanceSquared(pin.point, point) >= (pin.radius + radius + 1 / screenScale) ** 2);
      if (anchorAllowed && spaced(anchor)) return { item, point: anchor, radius, factor };

      if (building && !allowOpenSpace) {
        nearby ??= [...buildingGrid(building)].sort((a, b) => distanceSquared(a, anchor) - distanceSquared(b, anchor));
        const point = nearby.find(spaced);
        return point && { item, point, radius, factor };
      }

      const slot = ringSlots().find(({ point, section }) =>
        (allowOpenSpace || section === originalSection) && spaced(point));
      return slot && { item, point: slot.point, radius, factor };
    };

    let placed: PlacedMarker<T> | undefined;
    for (const factor of pinFactors) {
      placed = placement(factor);
      if (placed) break;
    }
    placed ??= placement(minimumPinFactor, true);
    const fallbackRadius = (square ? Math.SQRT2 : 1) * diameter * minimumPinFactor / (2 * screenScale);
    pins.push(placed ?? { item, point: anchorAllowed ? anchor : nearby?.[0] ?? anchor, radius: fallbackRadius, factor: minimumPinFactor });
  }
  return pins;
}
