import { MAP_WIDTH, MAP_Y_MAX } from './MapArtwork';

// WGS84 bounds of the north-up OpenStreetMap artwork, in longitude/latitude degrees.
const bounds = { west: 114.13283, south: 22.28028, east: 114.14104, north: 22.28491 };
const metresPerDegree = 111195;
const mapCentreLatitude = (bounds.north + bounds.south) / 2;
const mapWidthMetres = (bounds.east - bounds.west) * metresPerDegree * Math.cos(mapCentreLatitude * Math.PI / 180);

export type MapPoint = { x: number; y: number };
export type CampusLocation = MapPoint & { accuracy: number | null; radius: number | null };

export function projectCampusLocation(latitude: number, longitude: number, horizontalAccuracy: number | null): CampusLocation | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < bounds.south || latitude > bounds.north || longitude < bounds.west || longitude > bounds.east) {
    return null;
  }
  const accuracy = horizontalAccuracy !== null && Number.isFinite(horizontalAccuracy) && horizontalAccuracy > 0 ? horizontalAccuracy : null;
  return {
    x: (longitude - bounds.west) / (bounds.east - bounds.west) * MAP_WIDTH,
    y: (bounds.north - latitude) / (bounds.north - bounds.south) * MAP_Y_MAX,
    accuracy,
    radius: accuracy === null ? null : accuracy / mapWidthMetres * MAP_WIDTH,
  };
}
