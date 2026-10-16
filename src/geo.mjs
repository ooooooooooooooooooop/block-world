const EARTH_RADIUS_M = 6_371_008.8;
const radians = (degrees) => degrees * Math.PI / 180;
const finite = (value) => Number.isFinite(Number(value));

/** Convert longitude/latitude to local east/north metres. +z points south. */
export function toWorld(lon, lat, origin = { lon: 113, lat: 28.2 }) {
  if (![lon, lat, origin?.lon, origin?.lat].every(finite)) {
    throw new TypeError('toWorld requires finite longitude and latitude values');
  }
  const lat0 = radians(Number(origin.lat));
  const x = radians(Number(lon) - Number(origin.lon)) * EARTH_RADIUS_M * Math.cos(lat0);
  const z = -radians(Number(lat) - Number(origin.lat)) * EARTH_RADIUS_M;
  return { x, z };
}

/** Convert local east/north metres to longitude/latitude. +z points south. */
export function toGeo(x, z, origin = { lon: 113, lat: 28.2 }) {
  if (![x, z, origin?.lon, origin?.lat].every(finite)) {
    throw new TypeError('toGeo requires finite world coordinates and origin');
  }
  const lat0 = radians(Number(origin.lat));
  const lonScale = EARTH_RADIUS_M * Math.cos(lat0);
  if (Math.abs(lonScale) < 1e-8) throw new RangeError('Longitude scale is undefined at this origin');
  return {
    lon: Number(origin.lon) + Number(x) / lonScale * 180 / Math.PI,
    lat: Number(origin.lat) - Number(z) / EARTH_RADIUS_M * 180 / Math.PI,
  };
}

/** Stable signed grid key; negative coordinates use mathematical floor. */
export function chunkKey(x, z, size = 1024) {
  if (![x, z, size].every(finite) || Number(size) <= 0) {
    throw new TypeError('chunkKey requires finite coordinates and a positive size');
  }
  return `${Math.floor(Number(x) / Number(size))}_${Math.floor(Number(z) / Number(size))}`;
}

/** Horizontal distance in metres for world points, or geodesic distance for lon/lat points. */
export function distance(a, b) {
  if (!a || !b) return Infinity;
  if ([a.lon, a.lat, b.lon, b.lat].every(finite)) {
    const lat1 = radians(Number(a.lat));
    const lat2 = radians(Number(b.lat));
    const dLat = lat2 - lat1;
    const dLon = radians(Number(b.lon) - Number(a.lon));
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const ax = Number(a.x), az = Number(a.z ?? a.y);
  const bx = Number(b.x), bz = Number(b.z ?? b.y);
  if (![ax, az, bx, bz].every(Number.isFinite)) return Infinity;
  return Math.hypot(bx - ax, bz - az);
}
