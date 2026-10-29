const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export function toLocal(lat, lon, originLat, originLon) {
  const east = (lon - originLon) * RAD * EARTH_RADIUS * Math.cos(originLat * RAD);
  const north = (lat - originLat) * RAD * EARTH_RADIUS;
  return { east, north };
}

export function fromLocal(east, north, originLat, originLon) {
  const lat = originLat + north / EARTH_RADIUS / RAD;
  const lon = originLon + east / (EARTH_RADIUS * Math.cos(originLat * RAD)) / RAD;
  return { lat, lon };
}

export function angleDiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}

export function lerpAngle(a, b, f) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

export function compassLetter(deg) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
