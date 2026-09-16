import type { Toilet } from '../db/toilets';
import type { LocationCoords } from '../hooks/useLocation';

const R = 6371000; // Earth radius in meters

export function haversine(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} ม.`;
  return `${(meters / 1000).toFixed(1)} กม.`;
}

function nearestFrom(
  toilets: Toilet[],
  from: LocationCoords
): { toilet: Toilet; distance: number } | null {
  if (toilets.length === 0) return null;

  let nearest = toilets[0];
  let minDist = haversine(from.latitude, from.longitude, nearest.latitude, nearest.longitude);

  for (const t of toilets.slice(1)) {
    const d = haversine(from.latitude, from.longitude, t.latitude, t.longitude);
    if (d < minDist) {
      minDist = d;
      nearest = t;
    }
  }

  return { toilet: nearest, distance: minDist };
}

export function findNearest(
  toilets: Toilet[],
  from: LocationCoords,
  options?: { accessibleOnly?: boolean }
): { toilet: Toilet; distance: number; skippedClosed: boolean } | null {
  const pool = options?.accessibleOnly ? toilets.filter(t => t.accessible === 1) : toilets;
  const usable = pool.filter(t => t.status !== 'closed');
  if (usable.length > 0) {
    const result = nearestFrom(usable, from);
    return result ? { ...result, skippedClosed: usable.length < pool.length } : null;
  }
  const fallback = nearestFrom(pool, from);
  return fallback ? { ...fallback, skippedClosed: false } : null;
}
